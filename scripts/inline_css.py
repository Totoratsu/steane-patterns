"""Inline src/css/{tokens,main}.css into index.html (Qollab's preview fails to load linked stylesheets).
Fonts load from the raw GitHub URL on main. Run after editing those CSS files: python scripts/inline_css.py"""
import pathlib, re

RAW = "https://raw.githubusercontent.com/Totoratsu/steane-patterns/main/src"
root = pathlib.Path(__file__).resolve().parent.parent
css = "\n".join((root / "src/css" / f).read_text() for f in ("tokens.css", "main.css"))
css = css.replace('url("../fonts/', f'url("{RAW}/fonts/')
block = f"<!--css-->\n<style>\n{css}\n</style>\n<!--/css-->"
page = root / "index.html"
html = page.read_text()
if "<!--css-->" in html:
    html = re.sub(r"<!--css-->.*?<!--/css-->", lambda _: block, html, flags=re.S)
else:  # first run: replace the two stylesheet links
    html = re.sub(r'<link rel="stylesheet" href="src/css/tokens.css">\n<link rel="stylesheet" href="src/css/main.css">', lambda _: block, html)
html = html.replace('href="src/fonts/', f'href="{RAW}/fonts/')
page.write_text(html)
