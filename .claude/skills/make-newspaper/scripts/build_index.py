#!/usr/bin/env python3
"""docs/newspaper/archive/*.html から、バックナンバー一覧 docs/newspaper/index.html を作る。"""
import datetime
import html
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[4]
OUT = REPO / "docs" / "newspaper"
ISSUES = OUT / "archive"
WEEK = "月火水木金土日"


def parse(path):
    s = path.read_text(encoding="utf-8")
    date = datetime.date.fromisoformat(path.stem)
    no = re.search(r'<span class="issue">第(\d+)号</span>', s)
    top = re.search(r'<article class="story top">.*?<h3 class="hd l"><a [^>]*>(.*?)</a>', s, re.S)
    return {
        "date": date,
        "file": path.name,
        "no": no.group(1) if no else "",
        "top": re.sub(r"<[^>]+>", "", top.group(1)).strip() if top else "",
        "count": s.count('<article class="story'),
    }


def main():
    items = sorted(
        (parse(p) for p in ISSUES.glob("????-??-??.html")),
        key=lambda x: x["date"],
        reverse=True,
    )
    groups = {}
    for it in items:
        groups.setdefault((it["date"].year, it["date"].month), []).append(it)

    body = []
    for (y, m), rows in groups.items():
        body.append(f'<h2 class="month">{y}年{m}月</h2>\n<ul class="list">')
        for it in rows:
            d = it["date"]
            body.append(
                '<li><a href="archive/{f}"><span class="no">第{no}号</span>'
                '<span class="dt">{m}月{d}日({w})</span>'
                '<span class="tp">{top}</span>'
                '<span class="ct">{ct}件</span></a></li>'.format(
                    f=it["file"], no=it["no"], m=d.month, d=d.day,
                    w=WEEK[d.weekday()], top=html.escape(it["top"]), ct=it["count"],
                )
            )
        body.append("</ul>")
    if not items:
        body.append("<p>まだ号がありません。</p>")

    page = TEMPLATE.replace("{{BODY}}", "\n".join(body)).replace("{{TOTAL}}", str(len(items)))
    (OUT / "index.html").write_text(page, encoding="utf-8")
    print(f"docs/newspaper/index.html を更新しました({len(items)}号)")


TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Daily Dispatch バックナンバー</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Antique&family=Zen+Old+Mincho:wght@400;700;900&display=swap" rel="stylesheet">
<style>
:root {
  --paper: #d8d8ce; --paper2: #cbcbc0; --ink: #1d1d1a; --sub: #56564f;
  --spot: #22398b; --spot-soft: rgba(34,57,139,.30);
  --display: "Zen Antique", "Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif;
  --text: "Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif;
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
@media (prefers-color-scheme: dark) {
  :root { --paper: #15161b; --paper2: #1d1e26; --ink: #e7e4d8; --sub: #a9a79a; --spot: #93a8ff; --spot-soft: rgba(147,168,255,.28); }
}
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; color: var(--ink); font-family: var(--text); font-size: 15px; line-height: 1.8;
  background-color: var(--paper);
  background-image: radial-gradient(color-mix(in srgb, var(--ink) 10%, transparent) .7px, transparent .9px);
  background-size: 4px 4px;
}
a { color: inherit; }
a:focus-visible { outline: 2px solid var(--spot); outline-offset: 2px; }
.paper { max-width: 860px; margin: 0 auto; padding: 16px 18px 40px; }
.head { padding: 10px 14px 12px; text-align: center; border-top: 6px solid var(--ink); border-bottom: 2px solid var(--ink); background: var(--paper2); }
.head p { margin: 0; font-family: var(--display); font-size: 12px; letter-spacing: .5em; color: var(--spot); }
.head h1 { margin: 0; font-family: var(--display); font-weight: 400; line-height: 1.1; font-size: clamp(34px, 8vw, 64px); text-shadow: 3px 3px 0 var(--spot-soft); }
.head span { font-size: 13px; letter-spacing: .3em; color: var(--sub); }
.month { margin: 22px 0 8px; padding: 4px 14px; background: var(--ink); color: var(--paper); font-family: var(--display); font-weight: 400; font-size: 18px; letter-spacing: .15em; }
.list { margin: 0; padding: 0; list-style: none; }
.list li { border-bottom: 1px dotted var(--sub); }
.list a { display: grid; grid-template-columns: 4.2em 8.5em 1fr auto; gap: 4px 12px; align-items: baseline; padding: 9px 4px; text-decoration: none; }
.list a:hover { background: var(--spot-soft); }
.no { font-family: var(--display); color: var(--spot); }
.dt { font-family: var(--display); font-size: 14px; }
.tp { font-size: 14.5px; }
.ct { font-size: 12px; color: var(--sub); white-space: nowrap; }
.crumb { margin: 0 0 8px; font-size: 12px; }
.foot { margin-top: 24px; padding-top: 10px; border-top: 6px solid var(--ink); text-align: center; font-size: 12px; color: var(--sub); }
@media (max-width: 600px) {
  .list a { grid-template-columns: auto 1fr auto; }
  .tp { grid-column: 1 / -1; }
}
</style>
</head>
<body>
<div class="paper">
  <p class="crumb"><a href="../index.html">life 入口へ</a></p>
  <header class="head"><p>TECH &amp; LIFE</p><h1>Daily Dispatch</h1><span>バックナンバー {{TOTAL}}号</span></header>
  {{BODY}}
  <footer class="foot">Daily Dispatch は自動編集の個人用日刊紙です。</footer>
</div>
</body>
</html>
"""

if __name__ == "__main__":
    main()
