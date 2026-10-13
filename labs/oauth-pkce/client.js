// クライアント（Client）。「写真印刷アプリ」にあたる。
// 役割: ユーザーを認可サーバーへ送り出し、戻ってきた認可コードをトークンに引き換え、
//       そのトークンでリソースサーバーのAPIを呼ぶ。
//
// 本物のモバイルアプリの代わりに、ブラウザで動くWebアプリとして作っている。
// 1台の端末で動くアプリを想定し、状態（PKCEの値やトークン）はこのプロセスのメモリに1人分だけ持つ。
// モバイルなら、code_verifier はメモリ、トークンは Keychain / Keystore に置くところ。

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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
  pending: null, // 認可の途中で覚えておく { state, codeVerifier, nonce }
  tokens: null, // { access_token, refresh_token, id_token, ... }
  user: null, // IDトークンを検証して分かった「ログインしたのは誰か」
  photos: null,
  steps: [], // 画面に出す「いま何が起きたか」の記録
  flow: {}, // 図解ページ（/flow）に出す実際の値。キーは図のステップ番号（0始まり）
};

const log = (msg) => console.log(`[クライアント] ${msg}`);
const step = (title, detail, ok = true) => app.steps.push({ title, detail, ok });
const json = (obj) => JSON.stringify(obj, null, 2);
const FLOW_HTML = path.join(__dirname, 'flow.html');
const sendJsonRes = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
};

async function callToken(params) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: await res.json() };
}

// OIDC: IDトークンを検証する。チェック結果を1項目ずつ返して、画面とデモで見えるようにしている。
// 本番では openid-client や jose などのライブラリに任せる。
// expectedNonce: ログインを始めたアプリなら自分が作った nonce。分からない立場（自社サーバーなど）なら null
async function verifyIdToken(idToken, expectedNonce) {
  const [h, p, s] = String(idToken).split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  const now = Math.floor(Date.now() / 1000);

  // 認可サーバーが公開している公開鍵を取ってきて、ヘッダーの kid に合う鍵で署名を検証する
  const jwks = await (await fetch(`${AUTH}/jwks`)).json();
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  const signatureOk = header.alg === 'RS256' && !!jwk
    && crypto.verify('sha256', Buffer.from(`${h}.${p}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));

  const checks = [
    ['署名（認可サーバーの公開鍵で検証）', signatureOk, `alg=${header.alg} kid=${header.kid}`],
    ['iss（期待した発行者か）', claims.iss === AUTH, `${claims.iss}`],
    ['aud（自分宛てか）', claims.aud === CLIENT_ID, `${claims.aud}（自分は ${CLIENT_ID}）`],
    ['exp（期限内か）', now < claims.exp, `あと ${claims.exp - now} 秒`],
  ];
  if (expectedNonce !== null) checks.push(['nonce（自分が始めたログインのものか）', claims.nonce === expectedNonce, `${claims.nonce}`]);
  return { ok: checks.every(([, ok]) => ok), claims, checks };
}

const formatChecks = (checks) => checks.map(([label, ok, detail]) => `${ok ? '✅' : '❌'} ${label}: ${detail}`).join('\n');

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
      <b>ログインしているのは: ${app.user ? `${escapeHtml(app.user.name)}（${escapeHtml(app.user.email || 'メール非公開')}）` : '不明（IDトークンなし）'}</b>
      ${t.id_token ? `<p class="note">IDトークン（このアプリ宛ての身分証）を検証して分かったユーザーです。</p>
      <pre>${escapeHtml(json(decodeJwt(t.id_token)))}</pre>` : ''}
    </div>
    <div class="box">
      <b>受け取ったアクセストークンの中身（写真API宛ての鍵）</b>
      <pre>${escapeHtml(json(decodeJwt(t.access_token)))}</pre>
      <form method="post" style="display:inline"><button formaction="/photos">写真を見る（GET /photos）</button></form>
      <form method="post" style="display:inline"><button formaction="/delete">写真1を削除（DELETE /photos/1）</button></form>
      <form method="post" style="display:inline"><button formaction="/refresh">トークンをリフレッシュ</button></form>
      <form method="post" style="display:inline"><button formaction="/logout">連携を解除</button></form>
      ${app.photos ? `<ul>${app.photos.map((p) => `<li>${escapeHtml(p.title)}（${p.taken}）</li>`).join('')}</ul>` : ''}
    </div>`;

  return page('写真印刷アプリ', `クライアント（写真印刷アプリ） http://localhost:${PORT}`, '#1565c0', `
    <h1>写真印刷アプリ</h1>
    <p><a href="/flow">この流れを図で見る</a>（ログインしたあとに開くと、実際の値が図に入ります）</p>
    ${t ? loggedIn : loggedOut}
    <h2>何が起きたか</h2>
    ${steps || '<p class="note">まだ何も起きていません。</p>'}
    ${app.steps.length ? '<form method="post" action="/clear-log"><button>記録を消す</button></form>' : ''}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, 200, renderHome());

  // 図解ページと、そこに流し込む実際の値
  if (req.method === 'GET' && url.pathname === '/flow') return sendHtml(res, 200, fs.readFileSync(FLOW_HTML, 'utf8'));
  if (req.method === 'GET' && url.pathname === '/flow.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(app.flow));
  }

  // 「PhotoAuth でログイン」: PKCE の値を作って、ブラウザを認可サーバーへ送り出す
  if (req.method === 'POST' && url.pathname === '/login') {
    const f = await readBody(req);
    // openid を付けると OpenID Connect になり、IDトークンも発行される
    const scope = `openid email ${f.write ? 'photos.read photos.write' : 'photos.read'}`;
    const state = randomString(16); // CSRF対策。戻ってきたときに同じ値か確かめる
    const codeVerifier = randomString(32); // アプリだけが知る秘密。最後のトークン交換まで外に出さない
    const codeChallenge = pkceChallenge(codeVerifier); // その指紋（SHA-256）。こちらは先に渡してよい
    const nonce = randomString(16); // OIDC: IDトークンの中に入って返ってくる。古い・盗まれたIDトークンの使い回しを防ぐ
    app.pending = { state, codeVerifier, nonce };
    app.steps = [];
    app.photos = null;
    app.flow = {};
    app.user = null;

    const authorizeUrl = new URL(`${AUTH}/authorize`);
    Object.entries({
      response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope, state, nonce,
      code_challenge: codeChallenge, code_challenge_method: 'S256',
    }).forEach(([k, v]) => authorizeUrl.searchParams.set(k, v));

    step('アプリがPKCEの値を作る（code_verifier はまだ誰にも渡さない）',
      `code_verifier  = ${codeVerifier}   ← アプリのメモリにだけ置く\ncode_challenge = SHA256(code_verifier) = ${codeChallenge}\nstate          = ${state}\nnonce          = ${nonce}   ← OIDC。IDトークンに入って返ってくるはず`);
    step('ブラウザを認可サーバーへリダイレクト（認可リクエスト）',
      `GET ${AUTH}/authorize\n${[...authorizeUrl.searchParams].map(([k, v]) => `  ${k}=${v}`).join('\n')}`);
    app.flow[0] = `code_verifier  = ${codeVerifier}   （秘密。アプリだけが持つ）\ncode_challenge = ${codeChallenge}   （SHA256した指紋）\nstate          = ${state}\nnonce          = ${nonce}   （OIDC）`;
    app.flow[1] = `GET ${AUTH}/authorize?\n${[...authorizeUrl.searchParams].map(([k, v]) => `  ${k}=${v}`).join('\n')}`;
    log(`認可サーバーへリダイレクト（scope="${scope}"）`);
    return redirect(res, authorizeUrl.toString());
  }

  // 認可サーバーから戻ってくる場所（redirect_uri）。モバイルならカスタムURLスキームやユニバーサルリンク
  if (req.method === 'GET' && url.pathname === '/callback') {
    const q = Object.fromEntries(url.searchParams);
    step('認可サーバーからアプリに戻ってきた（リダイレクト）', `GET ${REDIRECT_URI}?${url.searchParams}`);
    app.flow[4] = `GET ${REDIRECT_URI}?\n${[...url.searchParams].map(([k, v]) => `  ${k}=${v}`).join('\n')}\n\nstate の照合: ${q.state === app.pending?.state ? '一致（自分が始めたログインの続き）' : '不一致'}`;

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
    app.flow[5] = `POST ${AUTH}/token\n${Object.entries(params).map(([k, v]) => `  ${k}=${v}`).join('\n')}`;
    app.flow[6] = `${status}\n${json(body)}`;
    const { nonce } = app.pending;
    app.pending = null; // code_verifier はもう使わないので捨てる
    if (status === 200) {
      app.tokens = body;
      log('トークンを受け取った');
      if (body.id_token) {
        const v = await verifyIdToken(body.id_token, nonce);
        step(v.ok ? 'IDトークンを検証 → ログインしたのは誰かが分かった' : 'IDトークンの検証に失敗 → ログインさせない',
          `${formatChecks(v.checks)}\n\nIDトークンの中身:\n${json(v.claims)}`, v.ok);
        if (v.ok) app.user = v.claims;
        else app.tokens = null;
      }
    }
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/photos') {
    const r = await callApi('GET', '/photos');
    if (r.status === 200) app.photos = r.body.photos;
    app.flow[7] = `GET ${API}/photos\nAuthorization: Bearer ${app.tokens?.access_token}`;
    app.flow[8] = `${r.status}\n${json(r.body)}`;
    step('アクセストークンで写真APIを呼ぶ', `GET ${API}/photos\nAuthorization: Bearer ${app.tokens?.access_token.slice(0, 24)}…\n\n→ ${r.status}\n${json(r.body)}`, r.status === 200);
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/delete') {
    const r = await callApi('DELETE', '/photos/1');
    app.flow[7] = `DELETE ${API}/photos/1\nAuthorization: Bearer ${app.tokens?.access_token}`;
    app.flow[8] = `${r.status}\n${json(r.body)}`;
    step(r.status === 403 ? '削除は許可されていない → 403（スコープ不足）' : '写真1を削除する',
      `DELETE ${API}/photos/1\n\n→ ${r.status}\n${json(r.body)}${r.wwwAuth ? `\nWWW-Authenticate: ${decodeURIComponent(r.wwwAuth)}` : ''}`, r.status === 200);
    return redirect(res, '/');
  }

  if (req.method === 'POST' && url.pathname === '/refresh') {
    const params = { grant_type: 'refresh_token', refresh_token: app.tokens?.refresh_token, client_id: CLIENT_ID };
    const { status, body } = await callToken(params);
    step('リフレッシュトークンで、新しいトークン一式をもらう（ログイン画面は出ない）',
      `POST ${AUTH}/token\n  grant_type=refresh_token\n  refresh_token=${params.refresh_token}\n\n→ ${status}\n${json(body)}`, status === 200);
    if (status === 200) {
      app.tokens = body;
      if (body.id_token) {
        const v = await verifyIdToken(body.id_token, null); // リフレッシュで返るIDトークンには nonce が入らない
        if (v.ok) app.user = v.claims;
      }
    }
    return redirect(res, '/');
  }

  // ---- ここから下は、このアプリの「自社サーバー」にあたるログイン窓口（demo.sh から呼ぶ） ----
  // モバイルアプリでよくある形: アプリが受け取ったトークンを自社サーバーに送り、自社サーバーがユーザーを特定してログインさせる

  // ❌ 危ない実装: アクセストークンを受け取り、/userinfo を呼んで「この人だ」とログインさせる
  if (req.method === 'POST' && url.pathname === '/api/login/access-token') {
    const { access_token } = await readBody(req);
    const r = await fetch(`${AUTH}/userinfo`, { headers: { Authorization: `Bearer ${access_token}` } });
    const body = await r.json();
    if (r.status !== 200) return sendJsonRes(res, 401, { error: 'login_failed', reason: body.error_description });
    log(`❌ アクセストークンでログイン: ${body.name} としてログインさせた（そのトークンが誰宛てに発行されたかは確かめていない）`);
    return sendJsonRes(res, 200, { loggedInAs: body.name, warning: 'このアクセストークンが自分のアプリ宛てに発行されたものかは確かめていない' });
  }

  // ✅ 正しい実装: IDトークンを受け取り、署名・iss・aud・exp を検証してからログインさせる
  if (req.method === 'POST' && url.pathname === '/api/login/id-token') {
    const { id_token } = await readBody(req);
    try {
      const v = await verifyIdToken(id_token, null); // 自社サーバーは nonce を知らないので、nonce はアプリ側で確認済みとする
      if (!v.ok) {
        log(`✅ IDトークンでログイン: 検証に失敗したので拒否\n${formatChecks(v.checks)}`);
        return sendJsonRes(res, 401, { error: 'login_failed', checks: v.checks.map(([label, ok, detail]) => `${ok ? 'OK' : 'NG'} ${label}: ${detail}`) });
      }
      log(`✅ IDトークンでログイン: ${v.claims.name} としてログインさせた`);
      return sendJsonRes(res, 200, { loggedInAs: v.claims.name, sub: v.claims.sub });
    } catch {
      return sendJsonRes(res, 401, { error: 'login_failed', reason: 'IDトークンの形式ではありません' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/logout') {
    await fetch(`${AUTH}/revoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: app.tokens?.refresh_token || '' }),
    });
    step('連携を解除（リフレッシュトークンを無効化し、アプリのトークンを削除）', '');
    app.tokens = null;
    app.photos = null;
    app.user = null;
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
