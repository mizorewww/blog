# Fonts

The CJK faces are not served from here: the build subsets them per page from
`fonts/*.woff2` (see `fonts.go`) and writes each page's late subset into this
directory of the output. `uv run scripts/prepare-fonts.py` rebuilds those
sources from Adobe's static OTFs — Source Han Sans 2.005R (Regular, Medium) and
Source Han Serif 2.003R (Regular, Medium, SemiBold) — trimmed to GB2312 plus
every character the site uses, with TrueType outlines and renamed per the SIL
OFL 1.1 (licenses in this directory).

Maple Mono 7.9 (`maple-mono-*.woff2`) is a Latin subset without ligatures,
rebuilt by `uv run scripts/prepare-maple.py`. The build inlines the 400 and 500
faces into each page's CSS; the italic stays a file.
