#!/usr/bin/env python3
"""docs/wiki/entries/*.html から、Wiki目次ページ docs/wiki/index.html を作る。"""
import html
import pathlib
import re
import unicodedata

REPO = pathlib.Path(__file__).resolve().parents[4]
OUT = REPO / "docs" / "wiki"
ENTRIES = OUT / "entries"


def sort_key(text):
    """アルファベット → ひらがな → カタカナ(→ その他)の順にソートするキーを返す。"""
    normalized = unicodedata.normalize("NFKC", text).lower()
    # カタカナをひらがなに変換して統一
    result = ""
    for ch in normalized:
        cp = ord(ch)
        if 0x30A1 <= cp <= 0x30F6:
            result += chr(cp - 0x60)
        else:
            result += ch
    # ASCII文字で始まるものを先、日本語を後にする
    is_ascii = result[0].isascii() if result else True
    return (0 if is_ascii else 1, result)


def parse(path):
    """カテゴリページからカテゴリ名とエントリ一覧を抽出する。"""
    s = path.read_text(encoding="utf-8")
    cat_match = re.search(r'<meta\s+name="wiki-category"\s+content="([^"]+)"', s)
    category = cat_match.group(1) if cat_match else path.stem

    entries = []
    for m in re.finditer(
        r'<article\s+class="entry"\s+id="([^"]*)">\s*<h2\s+class="entry-head">([^<]+)</h2>',
        s,
    ):
        entries.append({"id": m.group(1), "title": m.group(2).strip()})

    return {
        "file": path.name,
        "category": category,
        "count": len(entries),
        "entries": entries,
    }


def main():
    pages = []
    for p in sorted(ENTRIES.glob("*.html")):
        pages.append(parse(p))

    pages.sort(key=lambda x: sort_key(x["category"]))

    total = sum(p["count"] for p in pages)

    # カテゴリ一覧
    cat_body = []
    if pages:
        cat_body.append('<ul class="cat-list">')
        for p in pages:
            cat_body.append(
                '<li><a href="entries/{file}"><span class="cat-name">{cat}</span>'
                '<span class="cat-count">{count}件</span></a></li>'.format(
                    file=p["file"],
                    cat=html.escape(p["category"]),
                    count=p["count"],
                )
            )
        cat_body.append("</ul>")
    else:
        cat_body.append("<p>まだカテゴリがありません。</p>")

    # 全エントリの索引（カテゴリ横断、五十音・アルファベット順）
    all_entries = []
    for p in pages:
        for e in p["entries"]:
            all_entries.append({
                "title": e["title"],
                "id": e["id"],
                "file": p["file"],
                "category": p["category"],
            })
    all_entries.sort(key=lambda x: sort_key(x["title"]))

    idx_body = []
    if all_entries:
        idx_body.append('<ul class="idx-list">')
        for e in all_entries:
            idx_body.append(
                '<li><a href="entries/{file}#{id}"><span class="idx-title">{title}</span>'
                '<span class="idx-cat">{cat}</span></a></li>'.format(
                    file=e["file"],
                    id=e["id"],
                    title=html.escape(e["title"]),
                    cat=html.escape(e["category"]),
                )
            )
        idx_body.append("</ul>")
    else:
        idx_body.append("<p>まだエントリがありません。</p>")

    page = TEMPLATE.replace("{{CAT_BODY}}", "\n".join(cat_body))
    page = page.replace("{{IDX_BODY}}", "\n".join(idx_body))
    page = page.replace("{{TOTAL}}", str(total))
    page = page.replace("{{CAT_COUNT}}", str(len(pages)))

    (OUT / "index.html").write_text(page, encoding="utf-8")
    print(f"docs/wiki/index.html を更新しました({len(pages)}カテゴリ, {total}エントリ)")


TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Personal Wiki</title>
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
.paper { max-width: 780px; margin: 0 auto; padding: 16px 18px 40px; }
.crumb { margin: 0 0 8px; font-size: 12px; }
.crumb a { color: var(--sub); text-decoration: none; }
.crumb a:hover { text-decoration: underline; }
.head { padding: 12px 14px 14px; text-align: center; border-top: 6px solid var(--ink); border-bottom: 2px solid var(--ink); background: var(--paper2); }
.head .kicker { margin: 0; font-family: var(--display); font-size: 12px; letter-spacing: .5em; color: var(--spot); }
.head h1 { margin: 4px 0 0; font-family: var(--display); font-weight: 400; line-height: 1.2; font-size: clamp(34px, 8vw, 64px); text-shadow: 3px 3px 0 var(--spot-soft); }
.head .stats { margin: 4px 0 0; font-size: 13px; letter-spacing: .3em; color: var(--sub); }
.section-title { margin: 22px 0 8px; padding: 4px 14px; background: var(--ink); color: var(--paper); font-family: var(--display); font-weight: 400; font-size: 18px; letter-spacing: .15em; }
.cat-list { margin: 0; padding: 0; list-style: none; }
.cat-list li { border-bottom: 1px dotted var(--sub); }
.cat-list a { display: grid; grid-template-columns: 1fr auto; gap: 4px 14px; align-items: baseline; padding: 10px 4px; text-decoration: none; }
.cat-list a:hover { background: var(--spot-soft); }
.cat-name { font-family: var(--display); font-size: 18px; color: var(--spot); }
.cat-count { font-size: 13px; color: var(--sub); white-space: nowrap; }
.idx-list { margin: 0; padding: 0; list-style: none; }
.idx-list li { border-bottom: 1px dotted var(--sub); }
.idx-list a { display: grid; grid-template-columns: 1fr auto; gap: 4px 14px; align-items: baseline; padding: 8px 4px; text-decoration: none; }
.idx-list a:hover { background: var(--spot-soft); }
.idx-title { font-size: 15px; }
.idx-cat { font-size: 12px; color: var(--sub); white-space: nowrap; }
.foot { margin-top: 24px; padding-top: 10px; border-top: 6px solid var(--ink); text-align: center; font-size: 12px; color: var(--sub); }
</style>
</head>
<body>
<div class="paper">
  <p class="crumb"><a href="../index.html">life 入口へ</a></p>
  <header class="head">
    <p class="kicker">PERSONAL WIKI</p>
    <h1>Personal Wiki</h1>
    <p class="stats">{{CAT_COUNT}}カテゴリ / {{TOTAL}}エントリ</p>
  </header>
  <h2 class="section-title">カテゴリ一覧</h2>
  {{CAT_BODY}}
  <h2 class="section-title">全エントリ索引</h2>
  {{IDX_BODY}}
  <footer class="foot">Personal Wiki は学んだことを蓄積する個人用百科事典です。</footer>
</div>
</body>
</html>
"""

if __name__ == "__main__":
    main()
