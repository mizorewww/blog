# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools[woff]==4.60.1", "brotli==1.1.0"]
# ///
"""Rebuild the Maple Mono subsets: uv run scripts/prepare-maple.py.

Latin, arrows and the math signs the posts use, no ligatures. The build
inlines the 400/500 files into style.css; the italic stays a separate file.
"""
import hashlib
import io
import urllib.request
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

URL = "https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-Variable.zip"
SHA256 = "b9e57677cc4ec069ce178bd965d66cd14bd26c12e37d89d786ff959339bf8c93"
UNICODES = "U+20-7E,U+A0-FF,U+394,U+3A3,U+3C0,U+3C3,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2190-2199,U+2212,U+221A,U+2248,U+2260,U+2264,U+2265"
OUT = Path("static/fonts")

data = urllib.request.urlopen(URL).read()
assert hashlib.sha256(data).hexdigest() == SHA256, "unexpected download"
archive = zipfile.ZipFile(io.BytesIO(data))
for source, weight, name in [("MapleMono[wght].ttf", 400, "400"), ("MapleMono[wght].ttf", 500, "500"), ("MapleMono-Italic[wght].ttf", 400, "italic")]:
    font = instancer.instantiateVariableFont(TTFont(io.BytesIO(archive.read(source))), {"wght": weight})
    options = subset.Options(flavor="woff2", layout_features=["kern"], hinting=False, desubroutinize=True)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(OUT / f"maple-mono-{name}.woff2")
(OUT / "LICENSE-MapleMono.txt").write_bytes(archive.read("LICENSE.txt"))
