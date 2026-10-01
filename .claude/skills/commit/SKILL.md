---
name: commit
description: 変更をコミットしてpushする。差分を確認し、日本語でコミットメッセージを作成し、mcp__github__push_filesでpushする。
user_invocable: true
---

現在の変更をコミットしてpushする。

## 手順

1. macOSが自動生成するドットファイル（`.DS_Store`、`._*`、`.AppleDouble` など）がリポジトリ内に存在するか確認し、あれば削除する。
2. `git status` と `git diff`（ステージ済み・未ステージ両方）を実行し、変更内容を把握する。
3. 変更がなければ「コミットする変更がありません」と伝えて終了する。
4. 変更内容を分析し、日本語でコミットメッセージを作成する。
   - 1行目: 変更の要約（例: 「新聞スキルの要約形式を変更」）
   - 必要なら2行目以降に補足
5. コミットメッセージの案をユーザーに提示し、確認を取る。
6. 確認が取れたら、`mcp__github__push_files` ツールで `tttuuu1234/life` リポジトリの main ブランチにpushする（owner: `tttuuu1234`, repo: `life`, branch: `main`）。
   - 変更したファイルをすべて1回の呼び出しでまとめて渡す。
   - `git push` ではなく `mcp__github__push_files` を使う理由: contributionsの草に反映させるため。
7. push後、`git fetch origin main && git reset --hard origin/main` でローカルをリモートに合わせる。

## ルール

- .env、credentials.json など秘密情報を含む可能性のあるファイルは除外し、警告する。
- 変更していないファイルは含めない。
- コミットメッセージはユーザーの承認なしに確定しない。
