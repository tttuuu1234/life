#!/usr/bin/env python3
"""docs/weekly-review/archive/*.html から、振り返りの一覧ページ docs/weekly-review/index.html を作る。"""
import datetime
import html
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[4]
OUT = REPO / "docs" / "weekly-review"
ARCHIVE = OUT / "archive"
WEEKDAYS = "月火水木金土日"


def meta(text, name):
    m = re.search(rf'<meta name="{name}" content="([^"]*)"', text)
    return html.unescape(m.group(1)) if m else ""


def next_items(text):
    """「来週やりたいこと」(<ol id="next">)の項目をテキストで取り出す。"""
    m = re.search(r'<ol id="next">(.*?)</ol>', text, re.S)
    if not m:
        return []
    items = re.findall(r"<li>(.*?)</li>", m.group(1), re.S)
    return [html.unescape(re.sub(r"<[^>]+>", "", i)).strip() for i in items]


def parse(path):
    text = path.read_text(encoding="utf-8")
    date = meta(text, "review-date") or path.stem
    d = datetime.date.fromisoformat(date)
    return {
        "file": path.name,
        "date": d,
        "label": f"{d.year}年{d.month}月{d.day}日（{WEEKDAYS[d.weekday()]}）",
        "range": meta(text, "review-range"),
        "next": next_items(text),
    }


def render(reviews):
    if reviews:
        rows = "\n".join(
            f'<li><a href="archive/{r["file"]}">'
            f'<span class="dt">{html.escape(r["label"])}</span>'
            f'<span class="rg">{html.escape(r["range"])}</span>'
            f'<span class="nx">来週: {html.escape(" / ".join(r["next"]) or "なし")}</span>'
            f"</a></li>"
            for r in reviews
        )
        body = f'<ul class="list">\n{rows}\n</ul>'
    else:
        body = '<p class="empty">まだ振り返りはありません。毎週土曜のルーティンか、<code>/review-week</code> で始められます。</p>'

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Weekly Review</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Antique&family=Zen+Old+Mincho:wght@400;700;900&display=swap" rel="stylesheet">
<style>
:root {{
  --paper: #d8d8ce; --paper2: #cbcbc0; --ink: #1d1d1a; --sub: #56564f;
  --spot: #22398b; --spot-soft: rgba(34,57,139,.30);
  --display: "Zen Antique", "Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif;
  --text: "Zen Old Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif;
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}}
@media (prefers-color-scheme: dark) {{
  :root {{ --paper: #15161b; --paper2: #1d1e26; --ink: #e7e4d8; --sub: #a9a79a; --spot: #93a8ff; --spot-soft: rgba(147,168,255,.28); }}
}}
*, *::before, *::after {{ box-sizing: border-box; }}
body {{
  margin: 0; color: var(--ink); font-family: var(--text); font-size: 15px; line-height: 1.8;
  background-color: var(--paper);
  background-image: radial-gradient(color-mix(in srgb, var(--ink) 10%, transparent) .7px, transparent .9px);
  background-size: 4px 4px;
}}
a {{ color: inherit; }}
a:focus-visible {{ outline: 2px solid var(--spot); outline-offset: 2px; }}
.paper {{ max-width: 780px; margin: 0 auto; padding: 16px 18px 40px; }}
.crumb {{ margin: 0 0 8px; font-size: 12px; }}
.crumb a {{ color: var(--sub); text-decoration: none; }}
.head {{ padding: 12px 14px 14px; text-align: center; border-top: 6px solid var(--ink); border-bottom: 2px solid var(--ink); background: var(--paper2); }}
.head .kicker {{ margin: 0; font-family: var(--display); font-size: 12px; letter-spacing: .5em; color: var(--spot); }}
.head h1 {{ margin: 4px 0 0; font-family: var(--display); font-weight: 400; line-height: 1.2; font-size: clamp(34px, 8vw, 64px); text-shadow: 3px 3px 0 var(--spot-soft); }}
.head .stats {{ margin: 4px 0 0; font-size: 13px; letter-spacing: .3em; color: var(--sub); }}
.section-title {{ margin: 22px 0 8px; padding: 4px 14px; background: var(--ink); color: var(--paper); font-family: var(--display); font-weight: 400; font-size: 18px; letter-spacing: .15em; }}
.list {{ margin: 0; padding: 0; list-style: none; }}
.list li {{ border-bottom: 1px dotted var(--sub); }}
.list a {{ display: grid; grid-template-columns: auto 1fr; gap: 0 14px; padding: 10px 4px; text-decoration: none; }}
.list a:hover {{ background: var(--spot-soft); }}
.dt {{ font-family: var(--display); font-size: 18px; color: var(--spot); }}
.rg {{ align-self: baseline; font-size: 12px; color: var(--sub); }}
.nx {{ grid-column: 1 / -1; font-size: 14px; }}
.empty {{ color: var(--sub); }}
.empty code {{ font-size: 13px; padding: 1px 5px; background: var(--spot-soft); border-radius: 3px; }}
.foot {{ margin-top: 24px; padding-top: 10px; border-top: 6px solid var(--ink); text-align: center; font-size: 12px; color: var(--sub); }}
</style>
</head>
<body>
<div class="paper">
  <p class="crumb"><a href="../index.html">life 入口へ</a></p>
  <header class="head">
    <p class="kicker">WEEKLY REVIEW</p>
    <h1>Weekly Review</h1>
    <p class="stats">{len(reviews)}週分の振り返り</p>
  </header>
  <h2 class="section-title">これまでの振り返り</h2>
  {body}
  <footer class="foot">Weekly Review は毎週土曜の振り返りを残す記録です。</footer>
</div>
</body>
</html>
"""


def main():
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    reviews = sorted((parse(p) for p in ARCHIVE.glob("*.html")), key=lambda r: r["date"], reverse=True)
    (OUT / "index.html").write_text(render(reviews), encoding="utf-8")
    print(f"docs/weekly-review/index.html を更新しました({len(reviews)}週分)")


if __name__ == "__main__":
    main()
