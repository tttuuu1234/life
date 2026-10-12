// リソースサーバー（Resource Server）。GoogleフォトのAPIにあたる。
// 役割: アクセストークンを検証し、スコープで許された操作だけを実行する。
// ユーザーのパスワードもログイン画面も知らない。見るのは Bearer トークンだけ。

const http = require('node:http');
const { verifyJwt, sendJson } = require('./common');

const PORT = Number(process.env.RESOURCE_PORT || 4001);

// ユーザーごとの写真（本来はDB）
const photos = new Map([
  ['1', [
    { id: 1, title: '富士山', taken: '2026-08-11' },
    { id: 2, title: '海辺の夕日', taken: '2026-09-02' },
    { id: 3, title: '紅葉', taken: '2026-10-05' },
  ]],
]);

const log = (msg) => console.log(`[リソースサーバー] ${msg}`);

// 401 / 403 のときは WWW-Authenticate で理由を返すのが OAuth の作法（RFC 6750）
const fail = (res, status, error, description) =>
  sendJson(res, status, { error, error_description: description }, {
    'WWW-Authenticate': `Bearer error="${error}", error_description="${encodeURIComponent(description)}"`,
  });

function authorize(req, res, requiredScope) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    fail(res, 401, 'invalid_token', 'Authorization: Bearer <token> がありません');
    return null;
  }
  let claims;
  try {
    claims = verifyJwt(token);
  } catch (e) {
    log(`401: ${e.message}`);
    fail(res, 401, 'invalid_token', e.message);
    return null;
  }
  if (claims.aud !== 'photo-api') {
    fail(res, 401, 'invalid_token', 'このAPI宛てのトークンではありません（aud が違う）');
    return null;
  }
  // ここが「認可」: トークンの持ち主が誰かではなく、トークンに何が許されているか（スコープ）を見る
  const granted = claims.scope.split(' ');
  if (!granted.includes(requiredScope)) {
    log(`403: ${requiredScope} が必要だが、トークンのスコープは "${claims.scope}"`);
    fail(res, 403, 'insufficient_scope', `${requiredScope} のスコープが必要です`);
    return null;
  }
  return claims;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/photos') {
    const claims = authorize(req, res, 'photos.read');
    if (!claims) return;
    log(`photos.read OK → ユーザー${claims.sub} の写真を ${claims.client_id} に返す`);
    return sendJson(res, 200, { photos: photos.get(claims.sub) || [] });
  }

  const del = url.pathname.match(/^\/photos\/(\d+)$/);
  if (req.method === 'DELETE' && del) {
    const claims = authorize(req, res, 'photos.write');
    if (!claims) return;
    const list = photos.get(claims.sub) || [];
    photos.set(claims.sub, list.filter((p) => p.id !== Number(del[1])));
    log(`photos.write OK → 写真 ${del[1]} を削除`);
    return sendJson(res, 200, { deleted: Number(del[1]) });
  }

  sendJson(res, 404, { error: 'not found' });
});

module.exports = { start: () => server.listen(PORT, () => log(`http://localhost:${PORT} で起動`)) };
if (require.main === module) module.exports.start();
