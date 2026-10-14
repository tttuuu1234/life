// 認可サーバー（Authorization Server）。Googleのログイン画面・同意画面にあたる。
// 役割: ユーザーを認証し、同意をもらい、クライアントにトークンを発行する。

const http = require('node:http');
const crypto = require('node:crypto');
const {
  signJwt, verifyJwt, randomString, pkceChallenge, readBody, sendJson, sendHtml, redirect, escapeHtml, page,
} = require('./common');

const PORT = Number(process.env.AUTH_PORT || 4000);
const ISSUER = `http://localhost:${PORT}`;
const ACCESS_TTL_SEC = Number(process.env.ACCESS_TTL_SEC || 300);
const CODE_TTL_SEC = 60;

// 登録済みのクライアント（アプリ）。本番では開発者コンソールで登録する。
// モバイルアプリは「public client」なので client_secret を持たない（アプリに埋め込んでも抜き取られるため）。
// その代わりに PKCE で「認可を始めたアプリと、トークンを取りに来たアプリが同じか」を確かめる。
const clients = new Map([
  ['photo-print-app', {
    name: '写真印刷アプリ',
    redirectUris: [`http://localhost:${process.env.CLIENT_PORT || 4002}/callback`],
  }],
  // OIDC のデモ用に、もう1つ別のアプリを登録しておく（攻撃者が公開した「占いアプリ」という設定）。
  // 起動はしない。demo.sh がこのアプリになりすまして、alice のトークンを手に入れるのに使う。
  ['fortune-app', {
    name: '占いアプリ',
    redirectUris: ['http://localhost:4003/callback'],
  }],
]);

// このサーバーにアカウントを持つユーザー（Googleアカウントにあたる）
const users = new Map([['alice', { id: '1', name: 'alice', email: 'alice@example.com', password: 'password' }]]);

const SCOPES = {
  openid: 'あなたが誰かをアプリに伝える（ログイン）',
  email: 'メールアドレスを見る',
  'photos.read': '写真を見る',
  'photos.write': '写真を削除する',
};

const authCodes = new Map(); // code -> { clientId, redirectUri, scope, userId, codeChallenge, nonce, expiresAt }
const refreshTokens = new Map(); // refreshToken -> { clientId, scope, userId }

const log = (msg) => console.log(`[認可サーバー] ${msg}`);

// IDトークンの署名用の鍵ペア（RS256）。秘密鍵で署名し、公開鍵は /jwks で誰にでも公開する。
// アプリは公開鍵で署名を検証するので、署名用の秘密をアプリに渡さずに済む（HS256との違い）。
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'lab-key-1';
const JWKS = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] };

function signIdToken(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const data = `${b64({ alg: 'RS256', typ: 'JWT', kid: KID })}.${b64(payload)}`;
  return `${data}.${crypto.sign('sha256', Buffer.from(data), privateKey).toString('base64url')}`;
}

function issueTokens({ clientId, scope, userId, nonce }) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJwt({
    iss: ISSUER, // 発行者
    sub: userId, // 誰のデータへのアクセスか
    aud: 'photo-api', // 宛先（どのリソースサーバー向けか）
    client_id: clientId, // どのアプリに渡したか
    scope, // 何をしてよいか
    iat: now,
    exp: now + ACCESS_TTL_SEC,
  });
  const refreshToken = randomString();
  refreshTokens.set(refreshToken, { clientId, scope, userId });
  const tokens = { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, refresh_token: refreshToken, scope };

  // scope に openid があれば、IDトークン（このアプリ宛ての身分証）も発行する。これが OpenID Connect
  if (scope.split(' ').includes('openid')) {
    const user = [...users.values()].find((u) => u.id === userId);
    tokens.id_token = signIdToken({
      iss: ISSUER, // 誰が発行したか
      sub: userId, // 誰がログインしたか（この発行者の中で一意・不変）
      aud: clientId, // ★ どのアプリ宛てか。アクセストークンの aud（photo-api）とは違う
      iat: now,
      exp: now + ACCESS_TTL_SEC,
      ...(nonce ? { nonce } : {}), // ★ ログイン開始時にアプリが作った値をそのまま入れて返す
      name: user.name,
      ...(scope.split(' ').includes('email') ? { email: user.email } : {}),
    });
  }
  return tokens;
}

const tokenError = (res, error, description) => sendJson(res, 400, { error, error_description: description });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);

  // ① 認可リクエスト: アプリからブラウザでここに飛ばされてくる
  if (req.method === 'GET' && url.pathname === '/authorize') {
    const q = Object.fromEntries(url.searchParams);
    const client = clients.get(q.client_id);

    // client_id と redirect_uri がおかしいときは、リダイレクトせずにここでエラー画面を出す。
    // 登録されていないURLに認可コードを送ると、攻撃者のサイトにコードが渡ってしまうため。
    if (!client) return sendHtml(res, 400, page('エラー', '認可サーバー', '#6a1b9a', '<h1>不明なクライアントです</h1>'));
    if (!client.redirectUris.includes(q.redirect_uri)) {
      log(`登録されていない redirect_uri を拒否: ${q.redirect_uri}`);
      return sendHtml(res, 400, page('エラー', '認可サーバー', '#6a1b9a', '<h1>redirect_uri が登録されたものと一致しません</h1>'));
    }
    if (q.response_type !== 'code' || !q.code_challenge || q.code_challenge_method !== 'S256') {
      return redirect(res, `${q.redirect_uri}?error=invalid_request&error_description=${encodeURIComponent('response_type=code と PKCE(S256) が必要です')}&state=${encodeURIComponent(q.state || '')}`);
    }

    const scopes = (q.scope || '').split(' ').filter((s) => SCOPES[s]);
    log(`認可リクエストを受信: client=${q.client_id} scope="${scopes.join(' ')}" code_challenge=${q.code_challenge.slice(0, 10)}…`);
    const hidden = Object.entries({ ...q, scope: scopes.join(' ') })
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');

    return sendHtml(res, 200, page('PhotoAuth にログイン', '認可サーバー（Googleのログイン/同意画面にあたる） http://localhost:' + PORT, '#6a1b9a', `
      <h1>PhotoAuth にログイン</h1>
      <p><b>${escapeHtml(client.name)}</b> が、あなたのアカウントへのアクセスを求めています。</p>
      <div class="box">
        <b>許可を求められている権限（スコープ）</b>
        <ul>${scopes.map((s) => `<li>${SCOPES[s]}（<code>${s}</code>）</li>`).join('')}</ul>
      </div>
      <form method="post" action="/authorize">
        ${hidden}
        <label>ユーザー名 <input name="username" value="alice"></label>
        <label>パスワード <input name="password" type="password" value="password"></label>
        <button name="decision" value="allow">ログインして許可</button>
        <button name="decision" value="deny">拒否</button>
      </form>
      <p class="note">パスワードを入力しているのは認可サーバーの画面です。${escapeHtml(client.name)} にはパスワードは渡りません。<br>
      URL欄を見ると、アプリ（:4002）ではなく認可サーバー（:${PORT}）にいることが分かります。</p>`));
  }

  // ② ユーザーがログインして「許可」を押した
  if (req.method === 'POST' && url.pathname === '/authorize') {
    const f = await readBody(req);
    const client = clients.get(f.client_id);
    if (!client || !client.redirectUris.includes(f.redirect_uri)) return sendHtml(res, 400, 'bad request');
    const back = new URL(f.redirect_uri);
    if (f.state) back.searchParams.set('state', f.state);

    if (f.decision !== 'allow') {
      log('ユーザーが拒否しました');
      back.searchParams.set('error', 'access_denied');
      return redirect(res, back.toString());
    }
    const user = users.get(f.username);
    if (!user || user.password !== f.password) {
      return sendHtml(res, 401, page('ログイン失敗', '認可サーバー', '#6a1b9a', '<h1>ユーザー名かパスワードが違います</h1><p><a href="javascript:history.back()">戻る</a></p>'));
    }

    // 認可コードは「短命・1回限り」の引換券。トークンそのものではない
    const code = randomString(16);
    authCodes.set(code, {
      clientId: f.client_id,
      redirectUri: f.redirect_uri,
      scope: f.scope,
      userId: user.id,
      codeChallenge: f.code_challenge, // あとで code_verifier と照合するために覚えておく
      nonce: f.nonce, // OIDC: IDトークンに入れて返すために覚えておく
      expiresAt: Date.now() + CODE_TTL_SEC * 1000,
    });
    log(`${user.name} が許可 → 認可コード ${code.slice(0, 8)}… を発行し、アプリへリダイレクト`);
    back.searchParams.set('code', code);
    return redirect(res, back.toString());
  }

  // ③ トークンエンドポイント: アプリが（ブラウザを通さずに）直接叩く
  if (req.method === 'POST' && url.pathname === '/token') {
    const f = await readBody(req);

    if (f.grant_type === 'authorization_code') {
      const entry = authCodes.get(f.code);
      if (!entry || Date.now() > entry.expiresAt) return tokenError(res, 'invalid_grant', '認可コードが無効か、使用済みか、期限切れです');
      if (entry.clientId !== f.client_id) return tokenError(res, 'invalid_grant', 'client_id が一致しません');
      if (entry.redirectUri !== f.redirect_uri) return tokenError(res, 'invalid_grant', 'redirect_uri が一致しません');

      // PKCE の検証: 受け取った code_verifier をハッシュして、最初に預かった code_challenge と一致するか
      if (!f.code_verifier || pkceChallenge(f.code_verifier) !== entry.codeChallenge) {
        log(`PKCE 検証に失敗（code_verifier が違う）→ 拒否`);
        return tokenError(res, 'invalid_grant', 'code_verifier が code_challenge と一致しません（PKCE）');
      }

      authCodes.delete(f.code); // 1回使ったら捨てる
      log(`認可コードと code_verifier を確認 → トークンを発行（scope="${entry.scope}"）`);
      return sendJson(res, 200, issueTokens(entry));
    }

    if (f.grant_type === 'refresh_token') {
      const entry = refreshTokens.get(f.refresh_token);
      if (!entry || entry.clientId !== f.client_id) return tokenError(res, 'invalid_grant', 'リフレッシュトークンが無効です');
      refreshTokens.delete(f.refresh_token); // ローテーション
      log('リフレッシュトークンでトークンを再発行');
      return sendJson(res, 200, issueTokens(entry));
    }

    return tokenError(res, 'unsupported_grant_type', 'authorization_code か refresh_token を指定してください');
  }

  // OIDC: 認可サーバーの設定を公開する（アプリやライブラリはここを読んで各URLや公開鍵の場所を知る）
  if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
    return sendJson(res, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      userinfo_endpoint: `${ISSUER}/userinfo`,
      jwks_uri: `${ISSUER}/jwks`,
      scopes_supported: Object.keys(SCOPES),
      response_types_supported: ['code'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    });
  }

  // OIDC: IDトークンを検証するための公開鍵
  if (req.method === 'GET' && url.pathname === '/jwks') return sendJson(res, 200, JWKS);

  // OIDC: アクセストークンで呼ぶと、そのトークンの持ち主のプロフィールを返す
  if (req.method === 'GET' && url.pathname === '/userinfo') {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    try {
      if (scheme !== 'Bearer') throw new Error('Bearer トークンがありません');
      const claims = verifyJwt(token);
      if (!claims.scope.split(' ').includes('openid')) throw new Error('openid スコープがありません');
      const user = [...users.values()].find((u) => u.id === claims.sub);
      log(`/userinfo: アクセストークン（${claims.client_id} 宛てに発行したもの）の持ち主 ${user.name} を返す`);
      return sendJson(res, 200, { sub: user.id, name: user.name, email: user.email });
    } catch (e) {
      return sendJson(res, 401, { error: 'invalid_token', error_description: e.message });
    }
  }

  // アプリ連携の解除（Googleの「サードパーティアクセス」画面で解除するのにあたる）
  if (req.method === 'POST' && url.pathname === '/revoke') {
    const f = await readBody(req);
    refreshTokens.delete(f.token);
    return sendJson(res, 200, { revoked: true });
  }

  sendJson(res, 404, { error: 'not found' });
});

module.exports = { start: () => server.listen(PORT, () => log(`${ISSUER} で起動`)) };
if (require.main === module) module.exports.start();
