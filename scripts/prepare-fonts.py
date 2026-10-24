# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools[woff]==4.60.1", "brotli==1.1.0"]
# ///
"""Optional asset preparation: uv run scripts/prepare-fonts.py.

Writes the source faces the build subsets per page (fonts/*.woff2): Source
Han Sans 400/500 and Source Han Serif 400/500/600, trimmed to GB2312 plus every
character the site already uses, with TrueType outlines because the Go
subsetter does not read CID-keyed CFF. New characters outside GB2312 fall back
to system fonts until this is rerun.
"""
import re
import tempfile
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

root = Path(__file__).resolve().parent.parent
out = root / "fonts"
out.mkdir(exist_ok=True)
FACES = {
    "sans-400": ("sans", "2.005R", "Regular"),
    "sans-500": ("sans", "2.005R", "Medium"),
    "serif-400": ("serif", "2.003R", "Regular"),
    "serif-500": ("serif", "2.003R", "Medium"),
    "serif-600": ("serif", "2.003R", "SemiBold"),
}

chars = set(range(0x20, 0x7F)) | set(range(0xA0, 0x180)) | set(range(0x370, 0x400))
for start, end in [(0x2000, 0x2070), (0x2190, 0x2200), (0x2200, 0x2300), (0x2460, 0x2500), (0x2500, 0x2580), (0x25A0, 0x2600), (0x3000, 0x3040), (0xFF00, 0xFFF0)]:
    chars |= set(range(start, end))
for cp in range(0x4E00, 0xA000):
    try:
        chr(cp).encode("gb2312")
        chars.add(cp)
    except UnicodeEncodeError:
        pass
corpus = "".join(p.read_text() for pattern in ("content/**/*.md", "templates/*.html", "site.json") for p in root.glob(pattern))
chars |= {ord(c) for c in corpus}


def to_truetype(font):
    glyphs = font.getGlyphSet()
    glyf = newTable("glyf")
    glyf.glyphOrder = font.getGlyphOrder()
    glyf.glyphs = {}
    for name in glyf.glyphOrder:
        pen = TTGlyphPen(glyphs)
        glyphs[name].draw(Cu2QuPen(pen, 1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    font["glyf"] = glyf
    font["loca"] = newTable("loca")
    for tag in ("CFF ", "VORG"):
        if tag in font:
            del font[tag]
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for attr in ("maxTwilightPoints", "maxStorage", "maxFunctionDefs", "maxInstructionDefs", "maxStackElements", "maxSizeOfInstructions", "maxComponentElements"):
        setattr(maxp, attr, 0)
    maxp.maxZones = 1
    font["post"].formatType = 3.0
    font["head"].glyphDataFormat = 0
    font.sfntVersion = "\x00\x01\x00\x00"


with tempfile.TemporaryDirectory() as tmp:
    for name, (kind, version, weight) in FACES.items():
        family = f"SourceHan{kind.title()}"
        base = f"https://github.com/adobe-fonts/source-han-{kind}/raw/{version}"
        source = Path(tmp) / f"{name}.otf"
        urllib.request.urlretrieve(f"{base}/SubsetOTF/CN/{family}CN-{weight}.otf", source)
        urllib.request.urlretrieve(f"https://raw.githubusercontent.com/adobe-fonts/source-han-{kind}/{version}/LICENSE.txt", root / "static" / "fonts" / f"LICENSE-{family}.txt")
        font = TTFont(source)
        options = subset.Options()
        options.layout_features = []
        options.hinting = False
        options.desubroutinize = True
        options.name_IDs = []
        sub = subset.Subsetter(options)
        sub.populate(unicodes=chars)
        sub.subset(font)
        to_truetype(font)
        # Derivatives drop the reserved font name; the license ships beside the files.
        font["name"].names = []
        font["name"].setName(f"Blog {kind.title()} {name[-3:]}", 1, 3, 1, 0x409)
        font.flavor = "woff2"
        font.save(out / f"{name}.woff2")
        print(name, (out / f"{name}.woff2").stat().st_size, flush=True)
