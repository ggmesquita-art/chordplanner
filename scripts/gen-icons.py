"""Gera os ícones PWA (PNG) a partir de public/favicon.svg com o Chromium do Playwright.
Uso: ~/.venv/bin/python scripts/gen-icons.py"""
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
SVG = (RAIZ / "public" / "favicon.svg").read_text()
SAIDA = RAIZ / "public" / "icons"
BG = "#0f1117"  # --bg do tema escuro

# (arquivo, tamanho, fração do lado ocupada pelo logo; maskable usa ~60% p/ margem de segurança)
ICONES = [("icon-192.png", 192, 0.7), ("icon-512.png", 512, 0.7), ("icon-512-maskable.png", 512, 0.6)]

def html(tam: int, frac: float) -> str:
    lado = round(tam * frac)
    return f"""<html><body style="margin:0;width:{tam}px;height:{tam}px;background:{BG};
display:flex;align-items:center;justify-content:center">
<div style="width:{lado}px;height:{lado}px;display:flex">{SVG.replace('width="48" height="46"', 'width="100%" height="100%"', 1)}</div>
</body></html>"""

SAIDA.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    nav = p.chromium.launch()
    for nome, tam, frac in ICONES:
        pg = nav.new_page(viewport={"width": tam, "height": tam})
        pg.set_content(html(tam, frac))
        pg.screenshot(path=str(SAIDA / nome))
        pg.close()
    nav.close()
print("ok:", [n for n, _, _ in ICONES])
