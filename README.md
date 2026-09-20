# life

個人の「いろいろ」を置くリポジトリです。1つのプロジェクトを、1つのスキル(やること)と1つの出力先(できたもの)で持ちます。

## 構成

```
.
├─ .claude/
│  └─ skills/
│     └─ make-newspaper/          新聞作成スキル(入力)
│        ├─ SKILL.md              毎日の編集方針。スキルの本体
│        ├─ template.html         見た目のテンプレート
│        ├─ scripts/build_index.py  バックナンバー一覧を作る
│        └─ routine-prompt.txt    ルーティンの指示欄に貼る文
└─ docs/                          閲覧用の出力(GitHub Pagesの公開元)
   ├─ index.html                  入口(プロジェクトの一覧)
   └─ newspaper/                  新聞の出力
      ├─ index.html               バックナンバー一覧(自動生成)
      └─ issues/YYYY-MM-DD.html   各号
```

## ルール

- **1プロジェクト = 1スキル + 1出力先**: 元になるもの(指示、テンプレート、スクリプト)は `.claude/skills/<やること>/`、生成物は `docs/<できたもの>/` に置く。スキル名は「動詞+名詞」(例: `make-newspaper`)、出力先は名詞(例: `newspaper`)にする。
- **プロジェクトごとに閉じる**: 他のプロジェクトのファイルを直接いじらない。
- **新しいプロジェクトを足すとき**: `.claude/skills/<やること>/SKILL.md` を作り、`docs/<できたもの>/` を作り、`docs/index.html` の一覧に1行足す。ルーティンは、プロジェクトごとに1つ作る。

## 読み方

- ローカル: `git pull` して、`docs/index.html` をブラウザで開く。
- GitHub Pages: 設定で `main` ブランチの `/docs` を公開元にする(公開範囲に注意)。

## 新聞作成(make-newspaper)

技術と暮らしのニュースを、新聞風HTMLにまとめる日刊紙「Daily Dispatch」を作ります。手元では `/make-newspaper` でも呼び出せます。

| セクション | 件数 | 対象期間 | 掲載する日 |
|---|---|---|---|
| AIニュース | 5 | 過去48時間 | 毎日 |
| ITニュース | 5 | 過去48時間 | 毎日 |
| Flutter | 10 | 過去7日 | 土曜のみ |
| セキュリティ | 5 | 過去48時間 | 毎日 |
| キャリア / 人生観 / 名言 | 各1 | 直近1か月 | 毎日 |

### ルーティンの設定

1. claude.ai/code/routines で新規作成する。
2. 指示欄に `.claude/skills/make-newspaper/routine-prompt.txt` の内容を貼る。
3. リポジトリに `life` を選ぶ。
4. 環境のネットワークアクセスを「Full」か、ニュースサイトを許可した「Custom」にする。
5. コネクタは、すべて外す。
6. トリガーはスケジュール(毎日朝)にする。
7. 最初に「Run now」で試し、実行の記録を開いて結果を確認する。

編集方針を変えたいときは、`.claude/skills/make-newspaper/SKILL.md` を編集してpushする。
