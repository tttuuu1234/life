// クライアント（Client）。「写真印刷アプリ」にあたる。
// 役割: ユーザーを認可サーバーへ送り出し、戻ってきた認可コードをトークンに引き換え、
//       そのトークンでリソースサーバーのAPIを呼ぶ。
//
// 本物のモバイルアプリの代わりに、ブラウザで動くWebアプリとして作っている。
// 1台の端末で動くアプリを想定し、状態（PKCEの値やトークン）はこのプロセスのメモリに1人分だけ持つ。
// モバイルなら、code_verifier はメモリ、トークンは Keychain / Keystore に置くところ。

const http = require('node:http');
const {
  randomString, pkceChallenge, decodeJwt, readBody, sendHtml, redirect, escapeHtml, page,
} = require('./common');

const PORT = Number(process.env.CLIENT_PORT || 4002);
const AUTH = `http://localhost:${process.env.AUTH_PORT || 4000}`;
const API = `http://localhost:${process.env.RESOURCE_PORT || 4001}`;
const CLIENT_ID = 'photo-print-app';
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// アプリの状態（1台の端末ぶん）
const app = {
  pending: null, // 認可の途中で覚えておく { state, codeVerifier }
  tokens: null, // { access_token, refresh_token, ... }
  photos: null,
  steps: [], // 画面に出す「いま何が起きたか」の記録
};

const log = (msg) => console.log(`[クライアント] ${msg}`);
const step = (title, detail, ok = true) => app.steps.push({ title, detail, ok });
const json = (obj) => JSON.stringify(obj, null, 2);

async function callToken(params) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: await res.json() };
}

async function callApi(method, path) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${app.tokens?.access_token}` },
  });
  return { status: res.status, body: await res.json(), wwwAuth: res.headers.get('www-authenticate') };
}

function renderHome() {
  const t = app.tokens;
  const steps = app.steps.map((s, i) => `
    <div class="step"><h3 class="${s.ok ? 'ok' : 'ng'}">${i + 1}. ${escapeHtml(s.title)}</h3>
    ${s.detail ? `<pre>${escapeHtml(s.detail)}</pre>` : ''}</div>`).join('');

  const loggedOut = `
    <p>写真を印刷するには、PhotoAuth にある写真へのアクセスを許可してください。</p>
    <form method="post" action="/login" class="box">
      <b>求める権限（スコープ）</b>
      <label><input type="checkbox" name="read" checked disabled> 写真を見る（<code>photos.read</code>）</label>
      <label><input type="checkbox" name="write"> 写真を削除する（<code>photos.write</code>）</label>
      <button>PhotoAuth でログイン</button>
    </form>`;

  const loggedIn = t && `
    <div class="box">
      <b>受け取ったアクセストークンの中身（JWTのペイロード）</b>
      <pre>${escapeHtml(json(decodeJwt(t.access_token)))}</pre>
      <form method="post" style="display:inline"><button formaction="/photos">写真を見る（GET /photos）</button></form>
      <form method="post" style="display:inline"><button formaction="/delete">写真1を削除（DELETE /photos/1）</button></form>
      <form method="post" style="display:inline"><button formaction="/refresh">トークンをリフレッシュ</button></form>
      <form method="post" style="display:inline"><button formaction="/logout">連携を解除</button></form>
      ${app.photos ? `<ul>${app.photos.map((p) => `<li>${escapeHtml(p.title)}（${p.taken}）</li>`).join('')}</ul>` : ''}
    </div>`;

  return page('写真印刷アプリ', `クライアント（写真印刷アプリ） http://localhost:${PORT}`, '#1565c0', `
    <h1>写真印刷アプリ</h1>
    ${t ? loggedIn : loggedOut}
    <h2>何が起きたか</h2>
    ${steps || '<p class="note">まだ何も起きていません。</p>'}
    ${app.steps.length ? '<form method="post" action="/clear-log"><button>記録を消す</button></form>' : ''}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, 200, renderHome());

  // 「PhotoAuth でログイン」: PKCE の値を作って、ブラウザを認可サーバーへ送り出す
  if (req.method === 'POST' && url.pathname === '/login') {
    const f = await readBody(req);
    const scope = f.write ? 'photos.read photos.write' : 'photos.read';
    const state = randomString(16); // CSRF対策。戻ってきたときに同じ値か確かめる
    const codeVerifier = randomString(32); // アプリだけが知る秘密。最後のトークン交換まで外に出さない
    const codeChallenge = pkceChallenge(codeVerifier); // その指紋（SHA-256）。こちらは先に渡してよい
    app.pending = { state, codeVerifier };
    app.steps = [];
    app.photos = null;

    const authorizeUrl = new URL(`${AUTH}/authorize`);
    Object.entries({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope, state,
      code_challenge: codeChallenge, code_challenge_method: 'S256',
    }).forEach(([k, v]) => authorizeUrl.searchParams.set(k, v));

    step('アプリがPKCEの値を作る（code_verifier はまだ誰にも渡さない）',
      `code_verifier  = ${codeVerifier}   ← アプリのメモリにだけ置く\ncode_challenge = SHA256(code_verifier) = ${codeChallenge}\nstate          = ${state}`);
    step('ブラウザを認可サーバーへリダイレクト（認可リクエスト）',
      `GET ${AUTH}/authorize\n${[...authorizeUrl.searchParams].map(([k, v]) => `  ${k}=${v}`).join('\n')}`);
    log(`認可サーバーへリダイレクト（scope="${scope}"）`);
    return redirect(res, authorizeUrl.toString());
  }

  // 認可サーバーから戻ってくる場所（redirect_uri）。モバイルならカスタムURLスキームやユニバーサルリンク
  if (req.method === 'GET' && url.pathname === '/callback') {
    const q = Object.fromEntries(url.searchParams);
    step('認可サーバーからアプリに戻ってきた（リダイレクト）', `GET ${REDIRECT_URI}?${url.searchParams}`);

    if (q.error) {
      step(`認可されなかった: ${q.error}`, q.error_description || '', false);
      app.pending = null;
      return redirect(res, '/');
    }
    if (!app.pending || q.state !== app.pending.state) {
      step('state が一致しない → 自分が始めたログインではないので中止（CSRF対策）', `期待: ${app.pending?.state}\n受信: ${q.state}`, false);
      app.pending = null;
      return redirect(res, '/');
    }
    step('state が一致 → 自分が始めたログインの続きだと確認', `state = ${q.state}`);

    // 認可コード → トークン。ここはブラウザを通さず、アプリから認可サーバーへ直接送る
    const params = {
      grant_type: 'authorization_code', code: q.code, redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID, code_verifier: app.pending.codeVerifier,
    };
    const { status, body } = await callToken(params);
    step('認可コードとcode_verifierを送って、トークンに引き換える',
      `POST ${AUTH}/token\n${Object.entries(params).map(([k, v]) => `  ${k}=${v}`).join('\n')}\n\n→ ${status}\n${json(body)}`, status === 200);
    app.pending = null; // code_verifier はもう使わないので捨てる
    if (status === 200) {
      app.tokens = body;
      log('トークンを受け取った');
    }
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/photos') {
    const r = await callApi('GET', '/photos');
    if (r.status === 200) app.photos = r.body.photos;
    step('アクセストークンで写真APIを呼ぶ', `GET ${API}/photos\nAuthorization: Bearer ${app.tokens?.access_token.slice(0, 24)}…\n\n→ ${r.status}\n${json(r.body)}`, r.status === 200);
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/delete') {
    const r = await callApi('DELETE', '/photos/1');
    step(r.status === 403 ? '削除は許可されていない → 403（スコープ不足）' : '写真1を削除する',
      `DELETE ${API}/photos/1\n\n→ ${r.status}\n${json(r.body)}${r.wwwAuth ? `\nWWW-Authenticate: ${decodeURIComponent(r.wwwAuth)}` : ''}`, r.status === 200);
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/refresh') {
    const params = { grant_type: 'refresh_token', refresh_token: app.tokens?.refresh_token, client_id: CLIENT_ID };
    const { status, body } = await callToken(params);
    step('リフレッシュトークンで、新しいトークン一式をもらう（ログイン画面は出ない）',
      `POST ${AUTH}/token\n  grant_type=refresh_token\n  refresh_token=${params.refresh_token}\n\n→ ${status}\n${json(body)}`, status === 200);
    if (status === 200) app.tokens = body;
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    await fetch(`${AUTH}/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: app.tokens?.refresh_token || '' }),
    });
    step('連携を解除（リフレッシュトークンを無効化し、アプリのトークンを削除）', '');
    app.tokens = null;
    app.photos = null;
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/clear-log') {
    app.steps = [];
    return redirect(res, '/');
  }

  sendHtml(res, 404, 'not found');
});

module.exports = { start: () => server.listen(PORT, () => log(`http://localhost:${PORT} で起動 ← ブラウザでここを開く`)) };
if (require.main === module) module.exports.start();
