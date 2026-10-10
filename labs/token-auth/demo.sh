#!/usr/bin/env bash
# curlでJWTの流れを手でなぞるデモ。
# 先に別ターミナルで `node server.js` を起動しておく（期限切れまで見たいなら `ACCESS_TTL_SEC=10 node server.js`）。
set -euo pipefail

BASE=${BASE:-http://localhost:3001}

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
# JSONから1項目を取り出す（jqが無くても動くようにnodeで）
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[process.argv[1]]))' "$1"; }
# JWTの1パートをBase64URLデコードして表示する
decode() { node -e 'console.log(JSON.stringify(JSON.parse(Buffer.from(process.argv[1],"base64url")),null,2))' "$1"; }

step "1. alice でログイン → アクセストークンとリフレッシュトークンが返ってくる"
LOGIN=$(curl -s -H 'Content-Type: application/json' -d '{"username":"alice","password":"password"}' "$BASE/login")
echo "$LOGIN"
ACCESS=$(echo "$LOGIN" | json accessToken)
REFRESH=$(echo "$LOGIN" | json refreshToken)
TTL=$(echo "$LOGIN" | json expiresIn)

step "2. アクセストークンを分解する（ヘッダー.ペイロード.署名）"
IFS=. read -r H P S <<< "$ACCESS"
echo "--- ヘッダー（誰でも読める）"; decode "$H"
echo "--- ペイロード（誰でも読める。秘密は入れないこと）"; decode "$P"
echo "--- 署名: $S"

step "3. Bearer 付きで /api/me → 200（サーバーは表を引かず、署名を確かめるだけ）"
curl -s -H "Authorization: Bearer $ACCESS" "$BASE/api/me"; echo

step "4. Bearer を付け忘れる → 401"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -H "Authorization: $ACCESS" "$BASE/api/me"

step "5. alice で /admin → 403（role もトークンに入っているので、DBを引かずに判断）"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -H "Authorization: Bearer $ACCESS" "$BASE/admin"

step "6. ペイロードの role を admin に書き換えて送る（改ざん）→ 401"
FORGED_P=$(node -e 'const p=JSON.parse(Buffer.from(process.argv[1],"base64url"));p.role="admin";console.log(Buffer.from(JSON.stringify(p)).toString("base64url"))' "$P")
curl -s -H "Authorization: Bearer $H.$FORGED_P.$S" "$BASE/admin"; echo

step "7. ログアウト（リフレッシュトークンを無効化）"
curl -s -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" "$BASE/logout"; echo

step "8. ログアウトしたのに、同じアクセストークンで /api/me → 200（JWTの弱点）"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -H "Authorization: Bearer $ACCESS" "$BASE/api/me"

step "9. 無効にしたリフレッシュトークンで再発行しようとする → 401"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" "$BASE/refresh"

if [ "$TTL" -le 30 ]; then
  step "10. アクセストークンの期限（${TTL}秒）が切れるまで待ってから /api/me → 401"
  sleep $((TTL + 1))
  curl -s -H "Authorization: Bearer $ACCESS" "$BASE/api/me"; echo
else
  printf '\n（期限切れも見たいときは、サーバーを ACCESS_TTL_SEC=10 node server.js で起動し直して、もう一度実行する）\n'
fi
