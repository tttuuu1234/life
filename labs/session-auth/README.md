# session-auth：セッション方式の認証を体感する

Node.js 標準モジュールだけで書いた、最小のセッション認証サーバーです（`npm install` は不要）。学習用なので、本番では使わないでください。

## 起動

```bash
cd labs/session-auth
node server.js                      # http://localhost:3000
SESSION_TTL_SEC=30 node server.js   # セッション寿命を30秒にして、期限切れを体感する
```

ユーザーは2人で、パスワードはどちらも `password` です。

| ユーザー | role |
|---|---|
| alice | user（一般） |
| bob | admin（管理者） |

## 画面とAPI

| パス | 内容 |
|---|---|
| `GET /` | ログインフォーム。ログイン中は「誰か」を表示する |
| `POST /login` | 認証。成功するとセッションを作り、`Set-Cookie: sid=...` を返す |
| `POST /logout` | サーバー側のセッションを削除する |
| `GET /admin` | 認可の例。未ログインなら **401**、一般ユーザーなら **403**、管理者なら 200 |
| `GET /api/me` | JSON版。モバイルアプリから叩くイメージ |
| `GET /debug/sessions` | サーバーが持つセッション表を覗く（学習用） |
| `POST /debug/revoke` | 指定ユーザーのセッションを全部消す（＝強制ログアウト） |

## やってみること

1. **ブラウザでログインして、DevToolsを見る**
   Application → Cookies に `sid` が1つだけあります。中身はランダムな文字列で、ユーザー名もroleも入っていません。
2. **`/debug/sessions` を開く**
   「sid → 誰か」の表がサーバー側にあることが分かります。これがセッション方式の本体です。
3. **alice と bob で `/admin` を開き比べる**
   401（誰か分からない）と403（誰かは分かるが権限がない）の違いが見えます。
4. **シークレットウィンドウで別ユーザーとしてログインする**
   表の行が増えます。片方の「全端末ログアウト」を押してからもう片方をリロードすると、即座にログアウトされます。トークン方式では難しいことです。
5. **DevToolsのConsoleで `document.cookie` を実行する**
   `HttpOnly` が付いているので `sid` は見えません。XSSで盗まれにくくするための属性です。
6. **サーバーを再起動する**
   セッションはメモリにあるので全員ログアウトされます。本番でRedisやDBに置く理由がこれです。
7. **curlで流れを追う**
   別ターミナルで `bash demo.sh` を実行すると、ブラウザが裏でやっていること（Cookieの保存と送信）を手でなぞれます。

## コードの読みどころ（server.js）

- `sessions`（Map）: セッションストア。sid とユーザーの対応表です。
- `createSession`: 推測できない32バイトの乱数をsidにしています。
- `sessionCookie`: `HttpOnly` / `SameSite=Lax` / `Max-Age` の意味をコメントに書いています。本番では `Secure` も付けます。
- `/login`: ログイン時にsidを必ず作り直します（セッション固定攻撃の対策）。
- `verifyPassword`: パスワードはscryptでハッシュ化し、定数時間で比較しています。
