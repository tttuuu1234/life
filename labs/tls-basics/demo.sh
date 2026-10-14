#!/usr/bin/env bash
# curl で「証明書の検証」が何をしているかを確かめる。
# 先に別ターミナルで `node server.js` を起動しておく。
cd "$(dirname "$0")"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
try() { # curl の結果を、成功なら本文の見出し、失敗ならエラーだけ表示する
  local out
  if out=$(curl -sS --noproxy '*' "$@" 2>&1); then echo "✅ つながった: $(echo "$out" | grep -o '<h1>.*</h1>' | sed 's/<[^>]*>//g')"
  else echo "❌ 拒否: $(echo "$out" | head -1)"; fi
}

step "0. 証明書の中身を見る（server.crt）"
openssl x509 -in certs/server.crt -noout -subject -issuer -dates -ext subjectAltName | sed 's/^/   /'
echo "   → 「localhost の公開鍵はこれです」と「Lab Root CA」が署名して保証している"

step "1. 自己署名の :8443 に普通につなぐ → 拒否（誰も保証していない）"
try https://localhost:8443

step "2. 自作CA発行の :8444 に普通につなぐ → 拒否（Lab Root CA を知らない）"
try https://localhost:8444

step "3. :8444 に「Lab Root CA を信頼する」と教えてつなぐ → 成功"
try --cacert certs/ca.crt https://localhost:8444

step "4. 本物の証明書を持たない偽サーバー（:8443）に、同じく Lab Root CA を信頼してつなぐ → 拒否"
try --cacert certs/ca.crt https://localhost:8443

step "5. 証明書は正しいが、別のドメイン名（api.example.com）としてつなぐ → 拒否（名前が合わない）"
try --cacert certs/ca.crt --resolve api.example.com:8444:127.0.0.1 https://api.example.com:8444

step "6. 検証をオフにする（-k）→ どこにでもつながってしまう"
try -k https://localhost:8443
echo "   → 暗号化はされているが、相手が誰かは確かめていない。開発以外では絶対に使わない"
