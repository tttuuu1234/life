# passkey-server：Flutter アプリでパスキーを体感するための RP サーバー

iPhone の Flutter アプリから **Face ID でパスキーログイン**するための、サーバー側だけの実験です。
アプリ側（Flutter）は自分で作る前提で、ここには API の仕様と、Mac・iPhone で必要な設定をまとめています。学習用なので、本番では使わないでください。

```
[Flutter アプリ（iPhone）] ──HTTPS──> [ngrok] ──> [このサーバー（Mac の localhost:4200）]
   ・Associated Domains                          ・チャレンジを発行
   ・passkeys パッケージ                         ・署名を検証（SimpleWebAuthn）
                                                 ・public/.well-known/ に置いたファイルを配る
```

## はんこにたとえると

| パスキー | はんこ | ある場所 |
|---|---|---|
| 秘密鍵 | はんこ本体 | iPhone の中（iCloud キーチェーンで同期）。サーバーには来ない |
| 公開鍵 | 登録した印影 | サーバー |
| 署名 | 書類に押したはんこ | ログインのたびに作られる |
| チャレンジ | 日付入りの書類 | サーバーが毎回作る。使い回せない |

## 準備（Mac）

### 1. ngrok で固定ドメインを用意する

パスキーはドメインに紐づくので、URLが毎回変わらない **固定ドメイン** が必要です。ngrok の無料プランでも1つもらえます。

1. https://ngrok.com でアカウントを作る
2. `brew install ngrok` でインストールし、管理画面に出ているコマンドで authtoken を設定する
3. 管理画面の **Domains** で、無料の固定ドメイン（`xxxx.ngrok-free.app` のような形）を取得する

### 2. apple-app-site-association を自分で置く

ドメイン側の「このアプリは仲間です」という宣言です。本番の Web サーバー（nginx、Firebase Hosting など）と同じく、**決まった場所にファイルを置く**と、サーバーがそのまま配ります。

置く場所:

```
labs/passkey-server/public/.well-known/apple-app-site-association
```

- **拡張子は付けません**（`.json` を付けない）。中身は JSON です。
- `public/.well-known/` フォルダも自分で作ります。

中身の形:

```json
{
  "webcredentials": {
    "apps": ["<チームID>.<バンドルID>"]
  }
}
```

| 入れるもの | 中身 | どこで分かるか |
|---|---|---|
| チームID | Apple のチームID（英数字10文字） | Apple Developer の Membership details、または Xcode の Signing & Capabilities |
| バンドルID | Flutter アプリのバンドルID | Xcode の Signing & Capabilities |

`webcredentials` はパスキー用の項目です。ユニバーサルリンクも使うときは、同じファイルに `applinks` の項目を足します。

本番で配置するときに気をつけること（このサーバーでは満たしてあります）:

- `https://<ドメイン>/.well-known/apple-app-site-association` で取れること（HTTPS 必須、リダイレクトしない）
- `Content-Type: application/json` で返すこと

### 3. サーバーを起動する

```bash
cd labs/passkey-server
npm install
RP_ID=xxxx.ngrok-free.app node server.js
```

`RP_ID` は ngrok の固定ドメインです（`https://` は付けない）。起動ログの「配るファイル」に `apple-app-site-association（あり）` と出ていれば、ファイルを読めています。

### 4. ngrok で公開する

別のターミナルで:

```bash
ngrok http --url=xxxx.ngrok-free.app 4200
```

### 5. apple-app-site-association が見えるか確かめる

```bash
curl -i https://xxxx.ngrok-free.app/.well-known/apple-app-site-association
```

置いたファイルの中身が `Content-Type: application/json` で返ってくればOKです。404 なら、置き場所かファイル名（拡張子なし）を見直してください。
ngrok の警告ページ（HTML）が返ってくる場合は、下の「うまくいかないとき」を見てください。

## 準備（Xcode と iPhone）

1. Flutter プロジェクトの `ios/Runner.xcworkspace` を Xcode で開く
2. **Signing & Capabilities** で、Team に有料の開発者アカウントを選び、Bundle Identifier を apple-app-site-association に書いたバンドルIDと同じにする
3. **+ Capability** から **Associated Domains** を追加し、次の1行を入れる

   ```
   webcredentials:xxxx.ngrok-free.app?mode=developer
   ```

   `?mode=developer` を付けると、Apple のサーバー（CDN）を経由せずに、iPhone が直接このサーバーへファイルを取りに来ます。開発中はこちらのほうが確認しやすいです。
4. iPhone の **設定 → プライバシーとセキュリティ → デベロッパモード** をオンにする
5. iPhone の **設定 → デベロッパ → Associated Domains Development** をオンにする

アプリを入れたときに、サーバーのログに「apple-app-site-association を返した」と出れば、iPhone がファイルを取りに来ています。

## API の仕様（Flutter アプリから呼ぶもの）

リクエスト・レスポンスはすべて JSON です。オプションと端末の応答は、**WebAuthn の標準の JSON 形式**（文字列はすべて base64url）なので、`passkeys` パッケージなどの型にそのまま、または詰め替えて渡せます。

### 登録

| # | リクエスト | 送るもの | 返ってくるもの |
|---|---|---|---|
| ① | `POST /register/options` | `{"username": "alice"}` | 登録オプション（`challenge`、`rp`、`user`、`pubKeyCredParams`、`authenticatorSelection`、`excludeCredentials` など） |
| ② | `POST /register/verify` | 端末が作った登録の応答（下の形） | `{"ok": true, "username": "alice"}` |

②で送る形:

```json
{
  "id": "クレデンシャルID",
  "rawId": "クレデンシャルID",
  "type": "public-key",
  "response": {
    "clientDataJSON": "...",
    "attestationObject": "...",
    "transports": ["internal", "hybrid"]
  },
  "clientExtensionResults": {}
}
```

### ログイン

| # | リクエスト | 送るもの | 返ってくるもの |
|---|---|---|---|
| ③ | `POST /login/options` | `{}` | ログインオプション（`challenge`、`rpId`、`allowCredentials: []`、`userVerification`） |
| ④ | `POST /login/verify` | 端末が作ったログインの応答（下の形） | `{"ok": true, "username": "alice", "token": "..."}` |

④で送る形:

```json
{
  "id": "クレデンシャルID",
  "rawId": "クレデンシャルID",
  "type": "public-key",
  "response": {
    "clientDataJSON": "...",
    "authenticatorData": "...",
    "signature": "...",
    "userHandle": "..."
  },
  "clientExtensionResults": {}
}
```

`allowCredentials` が空なので、iPhone は「このドメイン用のパスキー」の一覧を出してくれます。ユーザー名の入力は要りません。

### ログイン後

| リクエスト | 送るもの | 返ってくるもの |
|---|---|---|
| `GET /me` | ヘッダー `Authorization: Bearer <④でもらった token>` | `{"username": "alice"}` |

ここから先はパスキーとは関係なく、いつものセッション（トークン）方式です。**パスキーはログインの瞬間の本人確認だけ**を担当している、というのがポイントです。

### 学習用

| リクエスト | 中身 |
|---|---|
| `GET /debug/state` | サーバーに保存されているもの（ユーザーと印影の一覧）。パスワードも秘密鍵もないことが分かる |
| `GET /.well-known/apple-app-site-association` | `public/.well-known/` に置いたファイルをそのまま返す。iOS が「このドメインはどのアプリを仲間と認めているか」を確かめに来る |

## やってみる実験

1. **登録 → ログイン → `/me`**：Face ID が出て、ログインできる。`/debug/state` に印影だけが保存されている
2. **アプリを仲間から外す**：apple-app-site-association のアプリIDをわざと違う値に書き換え、アプリを入れ直す → パスキーが使えなくなる（ファイルは毎回読み直すので、サーバーの再起動は不要）
3. **アプリ側の設定を外す**：Associated Domains の行を消してビルドし直す → 同じく使えなくなる
4. **RP ID を変える**：アプリから送る RP ID を別のドメインにする → iOS が拒否する

2と3で、「アプリとドメインの**両方**がお互いを指名していないと動かない」ことが確かめられます。

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| curl で ngrok の警告ページ（HTML）が返る | 無料プランでは、ブラウザからのアクセスに警告ページが挟まることがある。アプリからのAPI呼び出しには、ヘッダー `ngrok-skip-browser-warning: 1` を付けると確実 |
| サーバーに apple-app-site-association を取りに来ない | iPhone の Associated Domains Development がオンか、Xcode の行に `?mode=developer` が付いているか、アプリを入れ直したか |
| iOS で「アプリはこのドメインに関連付けられていません」系のエラー | ファイルに書いた `チームID.バンドルID` と、Xcode のチーム・バンドルIDが一致しているか |
| `/.well-known/apple-app-site-association` が 404 | `public/.well-known/` に置いたか、ファイル名に拡張子が付いていないか |
| `/login/verify` が「登録されていないパスキー」 | サーバーを再起動すると登録が消える（メモリ保存のため）。iPhone 側のパスキーは残るので、もう一度登録する |
| 「オリジンが違います」 | iOS アプリのオリジンは `https://<RP_ID>` になる。`RP_ID` が ngrok のドメインと一致しているか |
