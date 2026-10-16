// パスキー（WebAuthn）の RP サーバー。Flutter アプリから使う。
// 署名の検証などの面倒な部分は SimpleWebAuthn に任せている。
//
// 起動:
//   npm install
//   RP_ID=xxxx.ngrok-free.app TEAM_ID=ABCDE12345 BUNDLE_ID=com.example.passkeyLab node server.js
//
// はんこにたとえると:
//   秘密鍵 = はんこ本体（iPhone の中。サーバーには来ない）
//   公開鍵 = 登録した印影（サーバーが保存する）
//   署名   = 書類に押したはんこ
//   検証   = 押された印影と、登録済みの印影を見比べること
//
// 学習用なので、本番では使わないこと（データはメモリに置いているので再起動で消える）。

const http = require('node:http');
const crypto = require('node:crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const PORT = Number(process.env.PORT || 4200);
// RP ID = 「このパスキーはどのサイトのものか」。ngrok の固定ドメインを入れる（https:// は付けない）
const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = 'パスキー実験室';
// apple-app-site-association に書くアプリID（チームID.バンドルID）
const TEAM_ID = process.env.TEAM_ID || 'TEAMID1234';
const BUNDLE_ID = process.env.BUNDLE_ID || 'com.example.passkeyLab';
// iOS アプリから来るパスキーのオリジンは https://<RP_ID> になる。動作確認用に追加のオリジンも渡せる
const EXPECTED_ORIGINS = [`https://${RP_ID}`, ...(process.env.EXTRA_ORIGINS || '').split(',').filter(Boolean)];

// ---------------------------------------------------------------------------
// データ（本来はDB）。パスワードは1つも持っていないことに注目
// ---------------------------------------------------------------------------
const users = new Map(); // username -> { id(base64url), name }
const credentials = new Map(); // credentialId -> { username, publicKey(印影), counter, transports, createdAt }
const challenges = new Map(); // challenge -> { type, username?, expiresAt }
const sessions = new Map(); // token -> username（ログイン後は、いつものセッション方式）

function log(title, lines = []) {
  console.log(`\n[パスキー] ${title}`);
  for (const line of lines) console.log(`  ${line}`);
}

function rememberChallenge(challenge, type, extra = {}) {
  // チャレンジ = 毎回新しい「日付入りの書類」。昔の署名の使い回しを防ぐ
  challenges.set(challenge, { type, ...extra, expiresAt: Date.now() + 5 * 60 * 1000 });
}

function takeChallenge(challenge, type) {
  const c = challenges.get(challenge);
  challenges.delete(challenge); // 1回使ったら捨てる
  return c && c.type === type && c.expiresAt > Date.now() ? c : null;
}

// ---------------------------------------------------------------------------
// HTTP まわり
// ---------------------------------------------------------------------------
async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`${req.method} ${url.pathname}`);

  try {
    // iOS が「このドメインはどのアプリを仲間と認めているか」を確かめに来るファイル
    if (req.method === 'GET' && url.pathname === '/.well-known/apple-app-site-association') {
      const appId = `${TEAM_ID}.${BUNDLE_ID}`;
      log('apple-app-site-association を返した', [`webcredentials に ${appId} を載せている（取りに来たのは: ${req.headers['user-agent'] || '不明'}）`]);
      return sendJson(res, 200, { webcredentials: { apps: [appId] } });
    }

    // ① 登録の準備: 「はんこを作って」とお願いするための材料を返す
    if (req.method === 'POST' && url.pathname === '/register/options') {
      const { username } = await readJson(req);
      if (!username) return sendJson(res, 400, { error: 'username が必要です' });
      if (!users.has(username)) {
        users.set(username, { id: crypto.randomBytes(16).toString('base64url'), name: username });
      }
      const user = users.get(username);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: username,
        userID: Buffer.from(user.id, 'base64url'),
        attestationType: 'none',
        // 同じ端末に同じユーザーのはんこを二重に作らない
        excludeCredentials: [...credentials].filter(([, c]) => c.username === username).map(([id, c]) => ({ id, transports: c.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        supportedAlgorithmIDs: [-7, -257], // ES256 / RS256
      });
      rememberChallenge(options.challenge, 'register', { username });
      log(`① 登録の準備: ${username} 用のチャレンジを発行`, [`rp.id = "${RP_ID}"（このドメイン専用のはんこを作ってもらう）`]);
      return sendJson(res, 200, options);
    }

    // ② 登録: 端末が作ったはんこの「印影（公開鍵）」を受け取って保存する
    if (req.method === 'POST' && url.pathname === '/register/verify') {
      const body = await readJson(req);
      let pending = null;
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: (challenge) => !!(pending = takeChallenge(challenge, 'register')),
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      });
      if (!verification.verified) throw new Error('登録の検証に失敗しました');
      const { credential, origin, credentialBackedUp } = verification.registrationInfo;
      credentials.set(credential.id, {
        username: pending.username,
        publicKey: credential.publicKey, // これが「印影」
        counter: credential.counter,
        transports: credential.transports,
        createdAt: new Date().toLocaleString('ja-JP'),
      });
      log(`② 登録完了: ${pending.username} の印影（公開鍵）を保存`, [
        `✅ チャレンジ・オリジン(${origin})・RP ID・本人確認 をすべて確認`,
        `クレデンシャルID: ${credential.id.slice(0, 16)}…`,
        `公開鍵: ${Buffer.from(credential.publicKey).toString('base64url').slice(0, 40)}…`,
        `iCloud キーチェーンで同期されるパスキーか: ${credentialBackedUp ? 'はい' : 'いいえ'}`,
        '※ はんこ本体（秘密鍵）はサーバーに来ていない',
      ]);
      return sendJson(res, 200, { ok: true, username: pending.username });
    }

    // ③ ログインの準備: 「この書類にはんこを押して」とチャレンジを渡す
    if (req.method === 'POST' && url.pathname === '/login/options') {
      // allowCredentials を空にすると、iPhone が「このサイト用のはんこ」の一覧を出してくれる（ユーザー名の入力が不要）
      const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required', allowCredentials: [] });
      rememberChallenge(options.challenge, 'login');
      log('③ ログインの準備: チャレンジ（日付入りの書類）を発行', [`rpId = "${RP_ID}"`]);
      return sendJson(res, 200, options);
    }

    // ④ ログイン: 押されたはんこを、登録済みの印影と見比べる
    if (req.method === 'POST' && url.pathname === '/login/verify') {
      const body = await readJson(req);
      const cred = credentials.get(body.id);
      if (!cred) {
        log('④ ログインを拒否', ['このはんこ（クレデンシャルID）は登録されていない（サーバーを再起動すると登録は消えます）']);
        return sendJson(res, 401, { error: '登録されていないパスキーです' });
      }
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: (challenge) => !!takeChallenge(challenge, 'login'),
        expectedOrigin: EXPECTED_ORIGINS,
        expectedRPID: RP_ID,
        credential: { id: body.id, publicKey: cred.publicKey, counter: cred.counter, transports: cred.transports },
        requireUserVerification: true,
      });
      if (!verification.verified) throw new Error('署名が登録済みの印影と一致しません');
      cred.counter = verification.authenticationInfo.newCounter;

      // ここからは「場面2」。ログインできたので、いつものセッショントークンを発行する
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, cred.username);
      log(`④ ログイン成功: ${cred.username}`, [
        '✅ 署名を登録済みの印影（公開鍵）と見比べて一致',
        '✅ チャレンジ・オリジン・RP ID・本人確認 も確認',
        '→ セッショントークンを発行（ここから先は、いつものセッション方式）',
      ]);
      return sendJson(res, 200, { ok: true, username: cred.username, token });
    }

    // ログイン後のAPI。パスキーはもう関係なく、セッショントークンで「さっきログインした人」を確かめる
    if (req.method === 'GET' && url.pathname === '/me') {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const username = sessions.get(token);
      if (!username) return sendJson(res, 401, { error: 'ログインしていません' });
      return sendJson(res, 200, { username });
    }

    // 学習用: サーバーに何が保存されているかを見る
    if (req.method === 'GET' && url.pathname === '/debug/state') {
      return sendJson(res, 200, {
        rpId: RP_ID,
        expectedOrigins: EXPECTED_ORIGINS,
        appId: `${TEAM_ID}.${BUNDLE_ID}`,
        users: [...users.values()],
        credentials: [...credentials].map(([id, c]) => ({
          id, username: c.username, publicKey: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter, createdAt: c.createdAt,
        })),
        note: 'パスワードも秘密鍵も保存していない。漏れても印影（公開鍵）だけ',
      });
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    // よくある失敗を日本語にする
    const reason = /challenge/i.test(e.message) ? 'チャレンジが無効です（使い回し・期限切れ・別のサーバーが出したもの）'
      : /origin/i.test(e.message) ? `オリジンが違います（期待: ${EXPECTED_ORIGINS.join(', ')}）`
      : /RP ID/i.test(e.message) ? `RP ID が違います（期待: ${RP_ID}）`
      : e.message;
    log(`拒否: ${req.method} ${url.pathname}`, [`❌ ${reason}`, `（元のエラー: ${e.message}）`]);
    return sendJson(res, 400, { error: reason });
  }
});

server.listen(PORT, () => {
  log(`起動: http://localhost:${PORT}`, [
    `RP ID            = ${RP_ID}`,
    `期待するオリジン = ${EXPECTED_ORIGINS.join(', ')}`,
    `アプリID         = ${TEAM_ID}.${BUNDLE_ID}（apple-app-site-association に載せる）`,
  ]);
});
