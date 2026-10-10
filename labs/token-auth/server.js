// トークン方式（JWT）の認証を体感するための最小サーバー。
// 依存ライブラリなし（Node.js 標準モジュールのみ）。 起動: node server.js
// session-auth と同じ題材（alice / bob、/api/me、/admin）で作ってあるので、見比べながら読むとよい。
//
// 学習用なので、本番では使わないこと。JWTの署名・検証は、本番では jose などの実績あるライブラリに任せる。

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3001);
// アクセストークンの寿命（秒）。短くすると「期限切れ → リフレッシュ」を体感できる。例: ACCESS_TTL_SEC=10 node server.js
const ACCESS_TTL_SEC = Number(process.env.ACCESS_TTL_SEC || 60);
const REFRESH_TTL_SEC = 7 * 24 * 60 * 60;
// 署名用の秘密鍵。これを知っている者だけが正しいJWTを作れる。本番では環境変数やキー管理サービスに置く。
// 固定値にしているので、サーバーを再起動しても発行済みのトークンはそのまま使える（session-auth との違い）。
const SECRET = process.env.JWT_SECRET || 'dev-secret-do-not-use-in-production';

// ---------------------------------------------------------------------------
// ユーザー（本来はDB）。パスワードの扱いは session-auth と同じ。
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
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

// ---------------------------------------------------------------------------
// JWT。ここがトークン方式の主役。
// 形は「ヘッダー.ペイロード.署名」の3つをピリオドでつないだもの。
// ヘッダーとペイロードは Base64URL にしただけなので、誰でも読める（暗号化はされていない）。
// 署名は「ヘッダー.ペイロード」を秘密鍵でHMAC-SHA256したもの。中身を1文字でも変えると合わなくなる。
// ---------------------------------------------------------------------------
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const data = `${b64url(header)}.${b64url(payload)}`;
  return `${data}.${hmac(data)}`;
}

// 検証に成功したらペイロードを返し、失敗したら理由を投げる
function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JWTの形式ではありません');
  const [h, p, signature] = parts;

  const header = JSON.parse(Buffer.from(h, 'base64url'));
  // alg はトークン側が名乗っているだけなので、信用せずにサーバーが決めた方式と一致するか確かめる。
  // ここを見ないと「alg: none（署名なし）」のトークンを通してしまう有名な脆弱性になる。
  if (header.alg !== 'HS256') throw new Error(`許可していない署名方式です: ${header.alg}`);

  const expected = Buffer.from(hmac(`${h}.${p}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('署名が一致しません（改ざんされたか、別の鍵で作られたトークン）');
  }

  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  if (Math.floor(Date.now() / 1000) >= payload.exp) throw new Error('有効期限が切れています');
  return payload;
}

function issueAccessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: String(user.id), // 誰か（subject）
    name: user.name,
    role: user.role, // 認可に使う情報もトークンに入れておける → サーバーはDBを引かずに403を判断できる
    iat: now, // 発行時刻（issued at）
    exp: now + ACCESS_TTL_SEC, // 有効期限（expiration）
  });
}

// ---------------------------------------------------------------------------
// リフレッシュトークン。こちらはJWTではなく、ただのランダム文字列にしてサーバーの表で管理する。
// アクセストークンは短命にして、切れたらこれで取り直す。表で管理しているので、こちらは即時に無効化できる。
// ---------------------------------------------------------------------------
const refreshTokens = new Map(); // refreshToken -> { username, expiresAt }

function issueRefreshToken(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  refreshTokens.set(token, { username, expiresAt: Date.now() + REFRESH_TTL_SEC * 1000 });
  return token;
}

function issueTokens(user) {
  return {
    accessToken: issueAccessToken(user),
    refreshToken: issueRefreshToken(user.name),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TTL_SEC,
  };
}

// ---------------------------------------------------------------------------
// HTTPまわりの小道具
// ---------------------------------------------------------------------------
async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body, null, 2));
}

// Authorization: Bearer <token> からトークンを取り出して検証する
function authenticate(req) {
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme !== 'Bearer' || !token) return { error: 'Authorization: Bearer <token> の形で送ってください' };
  try {
    return { claims: verifyJwt(token) };
  } catch (e) {
    return { error: e.message };
  }
}

const unauthorized = (res, error) =>
  send(res, 401, { error: 'unauthenticated', reason: error }, { 'WWW-Authenticate': 'Bearer' });

// ---------------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ログイン = 認証。成功したらアクセストークンとリフレッシュトークンを返す（Cookieは使わない）
  if (req.method === 'POST' && url.pathname === '/login') {
    const { username, password } = await readJson(req);
    const user = users.get(username);
    if (!user || !verifyPassword(user, password || '')) {
      return send(res, 401, { error: 'ユーザー名かパスワードが違います' });
    }
    console.log(`POST /login → ${user.name} にトークンを発行（サーバー側にアクセストークンの記録は残らない）`);
    return send(res, 200, issueTokens(user));
  }

  // アクセストークンの取り直し。古いリフレッシュトークンは捨てて、新しいものを渡す（ローテーション）
  if (req.method === 'POST' && url.pathname === '/refresh') {
    const { refreshToken } = await readJson(req);
    const entry = refreshTokens.get(refreshToken);
    if (!entry || Date.now() > entry.expiresAt) {
      refreshTokens.delete(refreshToken);
      return unauthorized(res, 'リフレッシュトークンが無効です。ログインし直してください');
    }
    refreshTokens.delete(refreshToken);
    console.log(`POST /refresh → ${entry.username} のトークンを再発行`);
    return send(res, 200, issueTokens(users.get(entry.username)));
  }

  // ログアウト: リフレッシュトークンは消せる。でも発行済みのアクセストークンは消しようがない
  if (req.method === 'POST' && url.pathname === '/logout') {
    const { refreshToken } = await readJson(req);
    refreshTokens.delete(refreshToken);
    return send(res, 200, {
      message: 'リフレッシュトークンを無効にしました',
      note: '発行済みのアクセストークンは、有効期限が切れるまで使えてしまいます',
    });
  }

  // API版の「自分は誰か」。サーバーはDBも表も引かず、署名を確かめてトークンの中身を信じるだけ
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const { claims, error } = authenticate(req);
    console.log(`GET /api/me → ${claims ? `${claims.name}（署名の検証だけで判断）` : `401: ${error}`}`);
    if (!claims) return unauthorized(res, error);
    return send(res, 200, {
      id: Number(claims.sub),
      name: claims.name,
      role: claims.role,
      tokenExpiresAt: new Date(claims.exp * 1000).toISOString(),
    });
  }

  // 認可の例。role もトークンに入っているので、DBを引かずに 401 / 403 を判断できる
  if (req.method === 'GET' && url.pathname === '/admin') {
    const { claims, error } = authenticate(req);
    if (!claims) return unauthorized(res, error);
    if (claims.role !== 'admin') return send(res, 403, { error: 'forbidden', reason: `${claims.name} は管理者ではありません` });
    return send(res, 200, { message: `ようこそ管理者 ${claims.name} さん` });
  }

  // 学習用: サーバーが持っている状態を覗く（本番には絶対に置かない）
  if (req.method === 'GET' && url.pathname === '/debug/state') {
    return send(res, 200, {
      accessTokens: 'サーバーは何も記録していない（署名を検証するだけ）',
      refreshTokens: [...refreshTokens.entries()].map(([t, e]) => ({
        token: `${t.slice(0, 8)}…`,
        username: e.username,
        expiresAt: new Date(e.expiresAt).toISOString(),
      })),
    });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT} で起動しました（アクセストークンの寿命 ${ACCESS_TTL_SEC} 秒）`);
});
