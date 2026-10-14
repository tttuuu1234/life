#!/usr/bin/env bash
# curlで Authorization Code Flow + PKCE（+ OIDC）を1手ずつなぞるデモ。
# このスクリプト自身が「アプリ」と「ブラウザ」の両方の役をやる。
# 先に別ターミナルで `node start.js` を起動しておく。
set -euo pipefail

AUTH=${AUTH:-http://localhost:4000}
API=${API:-http://localhost:4001}
CLIENT_ID=photo-print-app
CLIENT=${CLIENT:-http://localhost:4002}
SCOPE="openid email photos.read"
REDIRECT_URI=http://localhost:4002/callback

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]))' "$1"; }
query() { node -e 'console.log(new URL(process.argv[1]).searchParams.get(process.argv[2]) ?? "")' "$1" "$2"; }
rand() { node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'; }
payload() { node -e 'console.log(JSON.stringify(JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url")),null,2))' "$1"; }
claim() { node -e 'console.log(JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"))[process.argv[2]])' "$1" "$2"; }
challenge() { node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("base64url"))' "$1"; }

step "1. アプリが PKCE の値と state と nonce を作る"
VERIFIER=$(rand); CHALLENGE=$(challenge "$VERIFIER"); STATE=$(rand); NONCE=$(rand)
echo "code_verifier  = $VERIFIER（アプリだけが知る）"
echo "code_challenge = $CHALLENGE（SHA-256した指紋。先に渡してよい）"
echo "state          = $STATE"
echo "nonce          = $NONCE（IDトークンに入って戻ってくるはずの値）"

step "2. 認可リクエスト（ブラウザで同意画面を開く）→ 200"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -G "$AUTH/authorize" \
  --data-urlencode response_type=code --data-urlencode client_id=$CLIENT_ID \
  --data-urlencode redirect_uri=$REDIRECT_URI --data-urlencode scope="$SCOPE" \
  --data-urlencode state="$STATE" --data-urlencode nonce="$NONCE" --data-urlencode code_challenge="$CHALLENGE" --data-urlencode code_challenge_method=S256

step "2'. 登録されていない redirect_uri で認可リクエスト → 400（リダイレクトせずに止める）"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -G "$AUTH/authorize" \
  --data-urlencode response_type=code --data-urlencode client_id=$CLIENT_ID \
  --data-urlencode redirect_uri=https://evil.example/callback --data-urlencode scope=photos.read \
  --data-urlencode code_challenge="$CHALLENGE" --data-urlencode code_challenge_method=S256

step "3. alice がログインして許可 → 認可コード付きでアプリへリダイレクト"
LOCATION=$(curl -s -o /dev/null -w '%{redirect_url}' "$AUTH/authorize" \
  --data-urlencode decision=allow --data-urlencode username=alice --data-urlencode password=password \
  --data-urlencode response_type=code --data-urlencode client_id=$CLIENT_ID \
  --data-urlencode redirect_uri=$REDIRECT_URI --data-urlencode scope="$SCOPE" \
  --data-urlencode state="$STATE" --data-urlencode nonce="$NONCE" --data-urlencode code_challenge="$CHALLENGE" --data-urlencode code_challenge_method=S256)
echo "Location: $LOCATION"
CODE=$(query "$LOCATION" code)
[ "$(query "$LOCATION" state)" = "$STATE" ] && echo "state が一致 → 自分が始めたログインの続き"

step "4. 攻撃: 認可コードを横取りした別アプリが、code_verifier を知らずに交換しようとする → 400"
curl -s "$AUTH/token" -d grant_type=authorization_code -d code="$CODE" -d client_id=$CLIENT_ID \
  --data-urlencode redirect_uri=$REDIRECT_URI -d code_verifier="$(rand)"; echo

step "5. 本物のアプリが、認可コード + code_verifier でトークンに引き換える → 200"
TOKENS=$(curl -s "$AUTH/token" -d grant_type=authorization_code -d code="$CODE" -d client_id=$CLIENT_ID \
  --data-urlencode redirect_uri=$REDIRECT_URI -d code_verifier="$VERIFIER")
echo "$TOKENS"
ACCESS=$(echo "$TOKENS" | json access_token)
REFRESH=$(echo "$TOKENS" | json refresh_token)
ID_TOKEN=$(echo "$TOKENS" | json id_token)

step "6. 同じ認可コードをもう一度使う → 400（1回限り）"
curl -s "$AUTH/token" -d grant_type=authorization_code -d code="$CODE" -d client_id=$CLIENT_ID \
  --data-urlencode redirect_uri=$REDIRECT_URI -d code_verifier="$VERIFIER"; echo

step "7. アクセストークンの中身（写真APIに見せる許可証。scope に photos.read が入っている）"
payload "$ACCESS"

step "7'. IDトークンの中身（アプリ宛ての身分証。aud がこのアプリ、nonce が手順1の値）"
payload "$ID_TOKEN"
[ "$(claim "$ID_TOKEN" nonce)" = "$NONCE" ] \
  && echo "nonce が一致 → このログインのために発行されたIDトークン"

step "8. 写真APIを呼ぶ（photos.read）→ 200"
curl -s -H "Authorization: Bearer $ACCESS" "$API/photos"; echo

step "9. 写真を削除しようとする（photos.write が必要）→ 403"
curl -s -w '\nHTTP %{http_code}\n' -X DELETE -H "Authorization: Bearer $ACCESS" "$API/photos/1"

step "10. リフレッシュトークンで新しいトークンをもらう（ログイン画面は出ない）→ 200"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$AUTH/token" -d grant_type=refresh_token -d refresh_token="$REFRESH" -d client_id=$CLIENT_ID

# ---------------------------------------------------------------------------
# OIDC: 「別のアプリ宛てのトークン」でログインさせようとする攻撃
# alice が、悪意のある「占いアプリ」（fortune-app）にもログインしたとする。
# 占いアプリの運営者は、alice のトークンを手に入れたので、それを写真印刷アプリのログインAPIに送り込む。
# ---------------------------------------------------------------------------

step "11. 攻撃の準備: alice が占いアプリ（fortune-app）にログインし、占いアプリがトークンを手に入れる"
F_REDIRECT=http://localhost:4003/callback
F_VERIFIER=$(rand); F_CHALLENGE=$(challenge "$F_VERIFIER")
F_LOCATION=$(curl -s -o /dev/null -w '%{redirect_url}' "$AUTH/authorize" \
  --data-urlencode decision=allow --data-urlencode username=alice --data-urlencode password=password \
  --data-urlencode response_type=code --data-urlencode client_id=fortune-app \
  --data-urlencode redirect_uri=$F_REDIRECT --data-urlencode scope="openid email" \
  --data-urlencode nonce="$(rand)" --data-urlencode code_challenge="$F_CHALLENGE" --data-urlencode code_challenge_method=S256)
F_TOKENS=$(curl -s "$AUTH/token" -d grant_type=authorization_code -d code="$(query "$F_LOCATION" code)" -d client_id=fortune-app \
  --data-urlencode redirect_uri=$F_REDIRECT -d code_verifier="$F_VERIFIER")
F_ACCESS=$(echo "$F_TOKENS" | json access_token)
F_ID_TOKEN=$(echo "$F_TOKENS" | json id_token)
echo "占いアプリ宛てのIDトークン: sub=$(claim "$F_ID_TOKEN" sub) aud=$(claim "$F_ID_TOKEN" aud)（中身は alice 本人だが、宛先は占いアプリ）"

step "12. ❌ 危ない実装: アクセストークンでログインさせるAPIに、占いアプリのアクセストークンを送る → 200（alice になりすませてしまう）"
curl -s -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' -d "{\"access_token\":\"$F_ACCESS\"}" "$CLIENT/api/login/access-token"

step "13. ✅ 正しい実装: IDトークンを検証してログインさせるAPIに、占いアプリのIDトークンを送る → 401（aud が違う）"
curl -s -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' -d "{\"id_token\":\"$F_ID_TOKEN\"}" "$CLIENT/api/login/id-token"

step "14. ✅ 正しい実装に、写真印刷アプリ宛ての本物のIDトークンを送る → 200"
curl -s -w '\nHTTP %{http_code}\n' -H 'Content-Type: application/json' -d "{\"id_token\":\"$ID_TOKEN\"}" "$CLIENT/api/login/id-token"
