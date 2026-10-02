# Source Han web fonts

Self-hosted WOFF2 subsets from Adobe's official Simplified Chinese variable fonts:

- [Source Han Sans 2.005R](https://github.com/adobe-fonts/source-han-sans/tree/2.005R), `Variable/WOFF2/TTF/Subset/SourceHanSansCN-VF.ttf.woff2`
- [Source Han Serif 2.003R](https://github.com/adobe-fonts/source-han-serif/tree/2.003R), `Variable/WOFF2/TTF/Subset/SourceHanSerifCN-VF.ttf.woff2`

Licensed under SIL OFL 1.1; see the two LICENSE files in this directory. Subset derivatives use the internal family names BlogSansSubset / BlogSerifSubset. CSS aliases retain the familiar Source Han names.

`core` contains Latin and characters used by the site when prepared. Other files cover the remaining supported characters with non-overlapping CSS unicode ranges. New articles do not require font regeneration: browsers fetch additional shards as needed. Unsupported characters use system fallback fonts.

To refresh the optimized core after substantial content changes, run `uv run scripts/prepare-fonts.py` from the repository root. This optional asset tool downloads the pinned upstream fonts and preserves all supported characters. Ordinary builds remain Go-only.
