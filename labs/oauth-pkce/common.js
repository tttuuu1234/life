// 3つのサーバーで共通に使う小道具。
// JWTの作り方・確かめ方は labs/token-auth と同じ（HS256）。

const crypto = require('node:crypto');

// 認可サーバーとリソースサーバーが共有する署名鍵。
// 本番では RS256 にして、リソースサーバーは認可サーバーが公開する公開鍵（JWKS）で検証することが多い。
const JWT_SECRET = process.env.JWT_SECRET || 'oauth-lab-secret-do-not-use-in-production';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');

function signJwt(payload) {
  const data = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}`;
  return `${data}.${hmac(data)}`;
}

function verifyJwt(token) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) throw new Error('JWTの形式ではありません');
  if (JSON.parse(Buffer.from(h, 'base64url')).alg !== 'HS256') throw new Error('許可していない署名方式です');
  const expected = Buffer.from(hmac(`${h}.${p}`));
  const actual = Buffer.from(s);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('署名が一致しません');
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  if (Math.floor(Date.now() / 1000) >= payload.exp) throw new Error('有効期限が切れています');
  return payload;
}

const decodeJwt = (token) => JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url'));

const randomString = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// PKCE: code_challenge = BASE64URL(SHA256(code_verifier))
const pkceChallenge = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try { return JSON.parse(body || '{}'); } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 画面の共通レイアウト。役割ごとに色を変えて「いまどのサーバーの画面か」を分かりやすくする
function page(title, role, color, body) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 0 16px 40px; line-height: 1.6; color: #1d1d1a; background: #fafaf7; }
  .role { margin: 0 -16px 16px; padding: 8px 16px; color: #fff; background: ${color}; font-size: 13px; letter-spacing: .05em; }
  h1 { font-size: 22px; }
  code, pre { background: #eeeee8; border-radius: 4px; }
  code { padding: 1px 4px; }
  pre { padding: 10px 12px; overflow-x: auto; font-size: 12.5px; white-space: pre-wrap; word-break: break-all; }
  button { font-size: 15px; padding: 8px 16px; margin: 4px 4px 4px 0; cursor: pointer; }
  .box { border: 1px solid #ccc; border-radius: 6px; padding: 12px 16px; margin: 12px 0; background: #fff; }
  .note { color: #666; font-size: 13px; }
  .step { border-left: 4px solid ${color}; padding: 6px 12px; margin: 10px 0; background: #fff; }
  .step h3 { margin: 0 0 4px; font-size: 14px; }
  .ok { color: #1a7f37; } .ng { color: #c62828; }
  label { display: block; margin: 6px 0; }
</style></head><body>
<div class="role">${escapeHtml(role)}</div>
${body}
</body></html>`;
}

module.exports = {
  signJwt, verifyJwt, decodeJwt, randomString, pkceChallenge,
  readBody, sendJson, sendHtml, redirect, escapeHtml, page,
};
