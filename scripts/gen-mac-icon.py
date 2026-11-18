"""Ícone do app de desktop no formato do macOS (1024 px, área útil 824 px, cantos arredondados).

Uso: ~/.venv/bin/python scripts/gen-mac-icon.py
Lê public/icons/icon-512.png e grava electron/resources/icon.png (o electron-builder gera o .icns).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SIZE, BODY, RADIUS, SCALE = 1024, 824, 185, 4  # grade de ícones do macOS

src = Image.open(ROOT / "public/icons/icon-512.png").convert("RGBA").resize((BODY, BODY), Image.LANCZOS)
mask = Image.new("L", (BODY * SCALE, BODY * SCALE), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, BODY * SCALE - 1, BODY * SCALE - 1), RADIUS * SCALE, fill=255)
mask = mask.resize((BODY, BODY), Image.LANCZOS)

out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
off = (SIZE - BODY) // 2
out.paste(src, (off, off), mask)
dest = ROOT / "electron/resources/icon.png"
out.save(dest)
print(dest)
