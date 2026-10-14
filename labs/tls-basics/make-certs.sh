#!/usr/bin/env bash
# 実験で使う証明書を certs/ に作る。何度実行しても作り直すだけ。
#   1. 自己署名証明書（自分で自分を保証した証明書）       → :8443 で使う
#   2. 自作の認証局（CA）と、その CA が発行したサーバー証明書 → :8444 で使う
set -euo pipefail
cd "$(dirname "$0")"
rm -rf certs && mkdir certs && cd certs

echo "== 1. 自己署名証明書（発行者 = 自分）"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout self-signed.key -out self-signed.crt \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost" 2>/dev/null
echo "   self-signed.key（秘密鍵） / self-signed.crt（証明書）"

echo "== 2a. 自作の認証局（CA）を作る"
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
  -keyout ca.key -out ca.crt -subj "/CN=Lab Root CA" 2>/dev/null
echo "   ca.key（CAの秘密鍵。これが漏れると何でも発行できてしまう） / ca.crt（CAの証明書。信頼する側に配る）"

echo "== 2b. サーバーが鍵ペアを作り、CA に「証明書を発行してください」と申請する（CSR）"
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" 2>/dev/null
echo "   server.key（サーバーの秘密鍵。外に出さない） / server.csr（申請書。公開鍵とドメイン名が入っている）"

echo "== 2c. CA が申請を確認して、CA の秘密鍵で署名した証明書を発行する"
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > san.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 30 -extfile san.ext -out server.crt 2>/dev/null
rm -f san.ext ca.srl
echo "   server.crt（CA が保証したサーバー証明書）"
