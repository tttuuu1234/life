#!/usr/bin/env bash
# curlで「ブラウザがやっていること」を手でなぞるデモ。
# 先に別ターミナルで `node server.js` を起動しておく。
set -euo pipefail

BASE=${BASE:-http://localhost:3000}
JAR=$(mktemp)            # Cookieを保存するファイル（＝ブラウザのCookie置き場の代わり）
trap 'rm -f "$JAR"' EXIT

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "1. ログイン前に /api/me → 401（誰か分からない）"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$BASE/api/me"

step "2. alice でログイン → Set-Cookie で sid が返ってくる"
curl -s -o /dev/null -D - -c "$JAR" -d 'username=alice&password=password' "$BASE/login" | grep -i '^set-cookie'

step "3. 保存された Cookie の中身（sid しか入っていない）"
grep sid "$JAR"   # HttpOnly のCookieは "#HttpOnly_" で始まる行に保存される

step "4. Cookie を付けて /api/me → 200（サーバーがセッション表で alice と判断）"
curl -s -b "$JAR" "$BASE/api/me"; echo

step "5. alice で /admin → 403（誰かは分かるが権限がない）"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b "$JAR" "$BASE/admin"

step "6. サーバー側で alice のセッションを消す（強制ログアウト）"
curl -s -o /dev/null -d 'username=alice' "$BASE/debug/revoke"

step "7. 同じ Cookie のまま /api/me → 401（Cookie は手元にあるのに即無効）"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' -b "$JAR" "$BASE/api/me"
