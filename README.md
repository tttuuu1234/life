# life

個人の「いろいろ」を置くリポジトリです。1つのプロジェクトを、1つのスキル(やること)と1つの出力先(できたもの)で持ちます。

## 構成

```
.
├─ .claude/
│  └─ skills/
│     ├─ commit/SKILL.md            変更をmainに直接pushする
│     ├─ create-pr/SKILL.md         作業ブランチにpushしてPRを作る
│     ├─ make-newspaper/            新聞作成スキル(入力)
│     │  ├─ SKILL.md                毎日の編集方針。スキルの本体
│     │  ├─ template.html           見た目のテンプレート
│     │  ├─ scripts/build_index.py  バックナンバー一覧を作る
│     │  └─ routine-prompt.txt      ルーティンの指示欄に貼る文
│     ├─ write-wiki/                百科事典スキル(入力)
│     │  ├─ SKILL.md                編集方針・追加手順。スキルの本体
│     │  ├─ template.html           カテゴリページのテンプレート
│     │  └─ scripts/build_index.py  目次ページを作る
│     └─ review-week/               週次の振り返りスキル(入力)
│        ├─ SKILL.md                質問と、まとめ方・push手順。スキルの本体
│        ├─ template.html           振り返りページのテンプレート
│        ├─ scripts/build_index.py  一覧ページを作る
│        └─ routine-prompt.txt      ルーティンの指示欄に貼る文
└─ docs/                            閲覧用の出力(GitHub Pagesの公開元)
   ├─ index.html                    入口(プロジェクトの一覧)
   ├─ newspaper/                    新聞の出力
   │  ├─ index.html                 バックナンバー一覧(自動生成)
   │  └─ archive/YYYY-MM-DD.html    各号
   ├─ wiki/                         百科事典の出力
   │  ├─ index.html                 カテゴリ一覧＋全エントリ索引(自動生成)
   │  └─ entries/{カテゴリ}.html     カテゴリ別ページ
   └─ weekly-review/                週次の振り返りの出力
      ├─ index.html                 振り返りの一覧(自動生成)
      └─ archive/YYYY-MM-DD.html    各週の振り返り
└─ labs/                            学習用の実験コード(スキルを持たない)
   ├─ session-auth/                 セッション方式の認証を体感するサーバー
   ├─ token-auth/                   トークン方式(JWT)の認証を体感するサーバー
   └─ oauth-pkce/                   OAuth 2.0(Authorization Code Flow + PKCE)を体感するサーバー群
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

## 百科事典(write-wiki)

学んだことをカテゴリ別の辞典風HTMLにまとめる個人用百科事典「Personal Wiki」です。`/write-wiki` で呼び出すと、まず何についてまとめるか聞かれるので、トピックを答えるとエントリが作成されます。

- エントリはカテゴリごとに1つのHTMLファイルにまとめ、アルファベット・あいうえお順に並べる。
- カテゴリは内容から自動判定し、既存カテゴリがあればそこに追加、なければ新規作成する。
- 目次ページ（`docs/wiki/index.html`）は `build_index.py` で自動生成する。

編集方針を変えたいときは、`.claude/skills/write-wiki/SKILL.md` を編集してpushする。

## 週次の振り返り(review-week)

毎週土曜に、決まった5つの質問に答えて1週間を振り返る「Weekly Review」です。手元では `/review-week` でも呼び出せます。

1. ルーティン（またはスキル）が、先週の「来週やりたいこと」と一緒に、5つの質問をまとめて投げかける。
2. 番号ごとに回答する。
3. 回答を1ページのHTMLにまとめ、一覧を更新して、mainにpushする。

| # | 質問 |
|---|---|
| ① | 今週やったこと（仕事・学習・暮らし） |
| ② | うまくいったこと・楽しかったこと |
| ③ | うまくいかなかったこと・モヤっとしたこと |
| ④ | 学んだこと・気づき |
| ⑤ | 来週やりたいこと（1〜3個） |

### ルーティンの設定

- トリガーは毎週土曜 9:52（日本時間）。実行のたびに新しいセッションを作り、質問を投げかけたところでスマホに通知が届く。
- 指示欄は `.claude/skills/review-week/routine-prompt.txt` の内容。
- 通知を開いて、そのセッションで回答する。

質問やまとめ方を変えたいときは、`.claude/skills/review-week/SKILL.md` を編集してpushする。

## 実験コード(labs)

手を動かして学ぶための小さな実験コードを `labs/<テーマ>/` に置きます。スキルや出力先を持たないので、上の「1プロジェクト = 1スキル + 1出力先」のルールの対象外です。各フォルダのREADMEに起動方法を書きます。

- `labs/session-auth/`: セッション方式の認証(Cookie + サーバー側セッション表)を体感する。`node server.js` で起動。
- `labs/token-auth/`: トークン方式の認証(JWT + リフレッシュトークン)を体感する。`node server.js` で起動。
- `labs/oauth-pkce/`: OAuth 2.0 の認可サーバー・リソースサーバー・クライアントを別々に動かし、Authorization Code Flow + PKCE を体感する。`node start.js` で起動。
