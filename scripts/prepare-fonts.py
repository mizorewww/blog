# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools[woff]==4.60.1", "brotli==1.1.0"]
# ///
"""Optional asset preparation: uv run scripts/prepare-fonts.py.
Normal blog builds only need Go. New characters load the remaining font shards.
"""
from pathlib import Path
from urllib.request import urlretrieve
from tempfile import TemporaryDirectory
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
out = root / "static/fonts"
out.mkdir(exist_ok=True)
corpus = "".join(p.read_text() for pattern in ("content/**/*.md", "templates/*.html", "site.json") for p in root.glob(pattern))
core = set(range(32, 127)) | {ord(c) for c in corpus}
def unicode_ranges(chars):
    runs = []
    first = last = None
    for cp in sorted(chars):
        if last is not None and cp == last + 1:
            last = cp
            continue
        if first is not None:
            runs.append(f"U+{first:X}" if first == last else f"U+{first:X}-{last:X}")
        first = last = cp
    if first is not None:
        runs.append(f"U+{first:X}" if first == last else f"U+{first:X}-{last:X}")
    return ",".join(runs)

rules = []
with TemporaryDirectory() as tmp:
    for kind, version, weight in (("sans", "2.005R", "100 900"), ("serif", "2.003R", "200 900")):
        family = f"Source Han {kind.title()}"
        base = f"https://raw.githubusercontent.com/adobe-fonts/source-han-{kind}/{version}"
        source = Path(tmp) / f"{kind}.woff2"
        urlretrieve(f"{base}/Variable/WOFF2/TTF/Subset/SourceHan{kind.title()}CN-VF.ttf.woff2", source)
        urlretrieve(f"{base}/LICENSE.txt", out / f"LICENSE-SourceHan{kind.title()}.txt")
        with TTFont(source) as font:
            supported = set(font.getBestCmap())
            font.flavor = None
            decoded = Path(tmp) / f"{kind}.ttf"
            font.save(decoded)
        groups = {"core": supported & core}
        for cp in sorted(supported - core):
            groups.setdefault(f"{cp // 1024:03x}", set()).add(cp)
        for label, chars in groups.items():
            font = TTFont(decoded)
            font.flavor = "woff2"
            options = subset.Options()
            options.flavor = "woff2"
            options.recalc_timestamp = False
            sub = subset.Subsetter(options=options)
            sub.populate(unicodes=chars)
            sub.subset(font)
            # Subset derivatives use distinct internal names; attribution is retained.
            for record in font["name"].names:
                if record.nameID in (1, 3, 4, 6, 16):
                    record.string = f"Blog{kind.title()}Subset".encode(record.getEncoding())
            name = f"source-han-{kind}-{label}.woff2"
            font.save(out / name)
            font.close()
            ranges = unicode_ranges(chars) if label == "core" else unicode_ranges(set(range(int(label, 16)*1024, int(label, 16)*1024+1024)) - core)
            rules.append(f'@font-face{{font-family:"{family}";font-style:normal;font-weight:{weight};font-display:swap;src:url("./{name}") format("woff2");unicode-range:{ranges}}}')
        print(f"{family}: {len(groups)} shards", flush=True)
rules.sort(key=lambda rule: "-core.woff2" in rule)
(out / "fonts.css").write_text("\n".join(rules) + "\n")
