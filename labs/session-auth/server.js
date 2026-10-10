// セッション方式の認証を体感するための最小サーバー。
// 依存ライブラリなし（Node.js 標準モジュールのみ）。 起動: node server.js
//
// 学習用なので、本番では使わないこと（セッションはメモリに置いているので再起動で消える）。

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
// セッションの寿命（秒）。短くすると「期限切れ」を体感できる。例: SESSION_TTL_SEC=30 node server.js
const SESSION_TTL_SEC = Number(process.env.SESSION_TTL_SEC || 30 * 60);
const COOKIE_NAME = 'sid';

// ---------------------------------------------------------------------------
// ユーザー（本来はDB）。パスワードは平文で持たず、ソルト付きハッシュ（scrypt）で持つ。
// ---------------------------------------------------------------------------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

const users = new Map([
  ['alice', { id: 1, name: 'alice', role: 'user', ...hashPassword('password') }],
  ['bob', { id: 2, name: 'bob', role: 'admin', ...hashPassword('password') }],
]);

function verifyPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  // タイミング攻撃対策に、定数時間で比較する
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

// ---------------------------------------------------------------------------
// セッションストア。ここがセッション方式の主役。
// 「session_id → 誰か」の対応表をサーバーが持っている。本番ではRedisやDBに置く。
// ---------------------------------------------------------------------------
const sessions = new Map(); // sid -> { username, createdAt, expiresAt, userAgent }

function createSession(username, userAgent) {
  // 推測できない十分長いランダム値にする（連番やユーザーIDは絶対にダメ）
  const sid = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sid, { username, createdAt: now, expiresAt: now + SESSION_TTL_SEC * 1000, userAgent });
  return sid;
}

function getSession(sid) {
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sid); // 期限切れは見つけた時点で捨てる
    return null;
  }
  return session;
}

// ---------------------------------------------------------------------------
// HTTPまわりの小道具
// ---------------------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(sid) {
  // HttpOnly : JavaScript(document.cookie)から読めない → XSSで盗まれにくい
  // SameSite=Lax : 他サイトからのPOSTにはCookieが付かない → CSRF対策
  // Secure : 本番(HTTPS)では必ず付ける。ローカルのhttpで試すため、ここでは付けていない
  return `${COOKIE_NAME}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

const clearCookie = `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

async function readForm(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return Object.fromEntries(new URLSearchParams(body));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object';
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body, null, 2) : body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

function page(title, content) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  nav a { margin-right: 1rem; }
  code, pre { background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { border: 1px solid #ccc; padding: 0.3rem 0.5rem; text-align: left; }
  .note { color: #555; font-size: 0.9rem; }
</style></head><body>
<nav><a href="/">トップ</a><a href="/admin">管理者ページ</a><a href="/api/me">/api/me</a><a href="/debug/sessions">セッション表</a></nav>
<h1>${title}</h1>${content}</body></html>`;
}

// ---------------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sid = parseCookies(req)[COOKIE_NAME];
  const session = getSession(sid);
  const user = session ? users.get(session.username) : null;

  console.log(`${req.method} ${url.pathname}  cookie sid=${sid ? sid.slice(0, 8) + '…' : '(なし)'}  → ${user ? user.name : '未ログイン'}`);

  // トップ: ログイン状態によって表示を変える
  if (req.method === 'GET' && url.pathname === '/') {
    if (user) {
      return send(res, 200, page('ログイン中', `
        <p>こんにちは、<b>${escapeHtml(user.name)}</b> さん（role: <code>${user.role}</code>）</p>
        <p class="note">ブラウザが送ってきたCookie <code>sid=${escapeHtml(sid.slice(0, 8))}…</code> を、サーバーがセッション表で引いて「誰か」を判断しました。</p>
        <form method="post" action="/logout"><button>ログアウト</button></form>`));
    }
    const error = url.searchParams.get('error') ? '<p style="color:#c00">ユーザー名かパスワードが違います</p>' : '';
    return send(res, 200, page('ログイン', `${error}
      <form method="post" action="/login">
        <p><label>ユーザー名 <input name="username" value="alice"></label></p>
        <p><label>パスワード <input name="password" type="password" value="password"></label></p>
        <button>ログイン</button>
      </form>
      <p class="note">alice（一般ユーザー）/ bob（管理者）。パスワードはどちらも <code>password</code>。</p>`));
  }

  // ログイン = 認証。成功したらセッションを作ってCookieで渡す
  if (req.method === 'POST' && url.pathname === '/login') {
    const { username, password } = await readForm(req);
    const found = users.get(username);
    if (!found || !verifyPassword(found, password)) {
      // 「ユーザーが存在しない」と「パスワード違い」を区別しない（ユーザー名の列挙を防ぐ）
      return redirect(res, '/?error=1');
    }
    // セッション固定攻撃対策: ログイン前のセッションがあれば捨て、必ず新しいIDを発行する
    if (sid) sessions.delete(sid);
    const newSid = createSession(found.name, req.headers['user-agent'] || '');
    return redirect(res, '/', { 'Set-Cookie': sessionCookie(newSid) });
  }

  // ログアウト: サーバー側のセッションを消す。これだけで即座に無効になる
  if (req.method === 'POST' && url.pathname === '/logout') {
    if (sid) sessions.delete(sid);
    return redirect(res, '/', { 'Set-Cookie': clearCookie });
  }

  // 管理者ページ = 認可の例。401と403の違いを体感する
  if (req.method === 'GET' && url.pathname === '/admin') {
    if (!user) return send(res, 401, page('401 Unauthorized', '<p>誰だか分かりません（未認証）。<a href="/">ログイン</a>してください。</p>'));
    if (user.role !== 'admin') return send(res, 403, page('403 Forbidden', `<p>${escapeHtml(user.name)} さんだとは分かりましたが、管理者ではないので見せられません（認可NG）。</p>`));
    return send(res, 200, page('管理者ページ', `<p>ようこそ管理者 ${escapeHtml(user.name)} さん。</p>`));
  }

  // API版。モバイルアプリから叩くイメージ
  if (req.method === 'GET' && url.pathname === '/api/me') {
    if (!user) return send(res, 401, { error: 'unauthenticated' });
    return send(res, 200, { id: user.id, name: user.name, role: user.role, sessionExpiresAt: new Date(session.expiresAt).toISOString() });
  }

  // 学習用: サーバーが持っているセッション表を覗く（本番には絶対に置かない）
  if (req.method === 'GET' && url.pathname === '/debug/sessions') {
    const rows = [...sessions.entries()].map(([id, s]) => `<tr>
      <td><code>${escapeHtml(id.slice(0, 8))}…</code>${id === sid ? ' ← あなた' : ''}</td>
      <td>${escapeHtml(s.username)}</td>
      <td>${new Date(s.expiresAt).toLocaleTimeString('ja-JP')}</td>
      <td class="note">${escapeHtml(s.userAgent.slice(0, 40))}</td>
      <td><form method="post" action="/debug/revoke"><input type="hidden" name="username" value="${escapeHtml(s.username)}"><button>${escapeHtml(s.username)} を全端末ログアウト</button></form></td>
    </tr>`).join('');
    return send(res, 200, page('セッション表（サーバーの中身）', `
      <p class="note">これがサーバーの記憶です。Cookieにはこの表の「鍵（sid）」しか入っていません。</p>
      <table><tr><th>sid</th><th>ユーザー</th><th>期限</th><th>User-Agent</th><th></th></tr>${rows || '<tr><td colspan="5">セッションなし</td></tr>'}</table>`));
  }

  // 学習用: 特定ユーザーのセッションを全部消す（＝パスワード変更時の強制ログアウト）
  if (req.method === 'POST' && url.pathname === '/debug/revoke') {
    const { username } = await readForm(req);
    for (const [id, s] of sessions) if (s.username === username) sessions.delete(id);
    return redirect(res, '/debug/sessions');
  }

  send(res, 404, page('404', '<p>見つかりません</p>'));
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT} で起動しました（セッション寿命 ${SESSION_TTL_SEC} 秒）`);
});
