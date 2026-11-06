# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright==1.64.1"]
# ///
"""Build helper: draws ```echarts and ```mermaid figures as static SVG.

src/figures.go starts this once per build, and only when a figure is missing
from its cache. Arguments: the ECharts file and a JSON object mapping each
color token in style.css to a stand-in color. Each stdin line is a request,
{"kind": "echarts"|"mermaid", "source": ..., "width": ..., "height": ...},
answered by one stdout line, {"svg": ...} or {"error": ...}.

Both libraries run in headless Chrome so text is measured in the page's own
fonts. Stand-in colors are swapped for var(--token) in the SVG, so a drawing
made once follows the reader's color scheme.
"""
import base64
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import Error, sync_playwright

MERMAID = "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js"
MERMAID_SHA256 = "a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f"
FONTS = [
    ("Maple Mono", 400, "static/fonts/maple-mono-400.woff2"),
    ("Maple Mono", 500, "static/fonts/maple-mono-500.woff2"),
    ("Blog Sans", 400, "fonts/sans-400.woff2"),
    ("Blog Sans", 500, "fonts/sans-500.woff2"),
]

# Mermaid's theme, in style.css tokens. Every color it draws with is set here,
# so none is derived from a stand-in and left behind as a fixed color.
MERMAID_THEME = {
    "background": "paper", "mainBkg": "wash", "primaryColor": "wash", "primaryTextColor": "ink",
    "primaryBorderColor": "faint", "nodeBorder": "faint", "nodeTextColor": "ink", "textColor": "ink",
    "secondaryColor": "clay-wash", "secondaryTextColor": "ink", "secondaryBorderColor": "clay",
    "tertiaryColor": "card", "tertiaryTextColor": "ink", "tertiaryBorderColor": "line",
    "lineColor": "muted", "defaultLinkColor": "muted", "titleColor": "ink", "edgeLabelBackground": "paper",
    "clusterBkg": "card", "clusterBorder": "line",
    "actorBkg": "wash", "actorBorder": "faint", "actorTextColor": "ink", "actorLineColor": "faint",
    "signalColor": "muted", "signalTextColor": "ink", "labelBoxBkgColor": "wash", "labelBoxBorderColor": "faint",
    "labelTextColor": "ink", "loopTextColor": "ink", "noteBkgColor": "clay-wash", "noteBorderColor": "clay",
    "noteTextColor": "ink", "activationBkgColor": "card", "activationBorderColor": "muted", "sequenceNumberColor": "paper",
    "altBackground": "wash", "stateBkg": "wash", "stateBorder": "faint", "compositeBackground": "card",
    "compositeTitleBackground": "wash", "transitionColor": "muted", "transitionLabelColor": "ink", "specialStateColor": "muted",
    "innerEndBackground": "muted", "labelBackgroundColor": "paper", "errorBkgColor": "clay-wash", "errorTextColor": "clay",
    "pie1": "clay", "pie2": "stone", "pie3": "sky", "pie4": "olive", "pie5": "kraft", "pie6": "fig",
    "pieTitleTextColor": "ink", "pieSectionTextColor": "paper", "pieLegendTextColor": "body",
    "pieStrokeColor": "paper", "pieOuterStrokeColor": "paper",
    "quadrant1Fill": "wash", "quadrant2Fill": "wash", "quadrant3Fill": "wash", "quadrant4Fill": "wash",
    "quadrant1TextFill": "ink", "quadrant2TextFill": "ink", "quadrant3TextFill": "ink", "quadrant4TextFill": "ink",
    "quadrantPointFill": "clay", "quadrantPointTextFill": "ink", "quadrantXAxisTextFill": "muted",
    "quadrantYAxisTextFill": "muted", "quadrantInternalBorderStrokeFill": "line",
    "quadrantExternalBorderStrokeFill": "line", "quadrantTitleFill": "ink",
    "git0": "clay", "git1": "sky", "git2": "olive", "git3": "kraft", "git4": "fig", "git5": "stone",
    "cScale0": "wash", "cScale1": "clay-wash", "cScale2": "card", "cScaleLabel0": "ink", "cScaleLabel1": "ink", "cScaleLabel2": "ink",
}

PAGE = """<!doctype html><meta charset="utf-8"><style>%s
body{margin:0;font-family:"Blog Sans",sans-serif}</style><body></body>"""

# Runs in the page: swaps stand-ins for var(--token) and drops fixed sizes.
SCRIPT = r"""
const recolor = (svg, tokens, tidy) => {
  const swap = {};
  for (const [name, hex] of Object.entries(tokens)) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    swap[hex] = `var(--${name})`;
    swap[`rgb(${r},${g},${b})`] = `var(--${name})`;
    swap[`rgb(${r}, ${g}, ${b})`] = `var(--${name})`;
  }
  const keys = Object.keys(swap).sort((a, b) => b.length - a.length).map(k => k.replace(/[()]/g, "\\$&"));
  const any = new RegExp(keys.join("|"), "gi");
  const alpha = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g;
  const text = s => s.replace(alpha, (m, r, g, b, a) => {
    const hex = "#" + [r, g, b].map(n => (+n).toString(16).padStart(2, "0")).join("");
    const name = Object.keys(tokens).find(k => tokens[k] == hex);
    return name ? `color-mix(in srgb,var(--${name}) ${Math.round(a * 100)}%,transparent)` : m;
  }).replace(any, m => swap[m.toLowerCase()] ?? m);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName != "svg") throw new Error("no SVG drawn");
  tidy?.(root);
  const left = new Set();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (el.nodeName == "style") { el.textContent = text(el.textContent); continue; }
    for (const attr of ["fill", "stroke", "stop-color", "color", "flood-color"]) {
      const v = el.getAttribute(attr);
      if (v == null) continue;
      const t = text(v);
      if (t != v) { el.removeAttribute(attr); el.style.setProperty(attr, t); }
    }
    const style = el.getAttribute("style");
    if (style) el.setAttribute("style", text(style));
  }
  const out = new XMLSerializer().serializeToString(root);
  for (const hex of Object.values(tokens)) if (out.toLowerCase().includes(hex)) left.add(hex);
  if (left.size) throw new Error("colors derived from tokens were left fixed: " + [...left].join(" "));
  return out;
};
window.drawEcharts = async (source, width, height, tokens) => {
  await document.fonts.ready;
  const option = JSON.parse(source.replace(/var\(--([\w-]+)\)/g, (m, n) => tokens[n] ?? m));
  const chart = echarts.init(null, "blog", { renderer: "svg", ssr: true, width, height });
  chart.setOption({ ...option, animation: false });
  const svg = chart.renderToSVGString();
  chart.dispose();
  // The page sizes the drawing and sets its font (style.css), so neither is repeated.
  return recolor(svg, tokens, root => {
    root.removeAttribute("width");
    root.removeAttribute("height");
    for (const el of root.querySelectorAll("[style]")) el.style.removeProperty("font-family");
  });
};
window.drawMermaid = async (source, id, tokens) => {
  await document.fonts.ready;
  const { svg } = await mermaid.render(id, source);
  // Flat, like the page's other figures: no drop shadows under the shapes.
  return recolor(svg, tokens, root => {
    for (const el of root.querySelectorAll("[style]")) el.style.removeProperty("filter");
  });
};
"""


def font_css():
    rules = []
    for family, weight, path in FONTS:
        data = base64.b64encode(Path(path).read_bytes()).decode()
        rules.append(f'@font-face{{font-family:"{family}";font-weight:{weight};src:url(data:font/woff2;base64,{data}) format("woff2")}}')
    return "\n".join(rules)


def mermaid_file():
    path = Path(".cache/vendor/mermaid-12.2.0.min.js")
    if not path.is_file():
        data = urllib.request.urlopen(MERMAID, timeout=60).read()
        if hashlib.sha256(data).hexdigest() != MERMAID_SHA256:
            raise RuntimeError(f"{MERMAID}: checksum mismatch")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path


def launch(playwright):
    try:
        return playwright.chromium.launch(channel="chrome")
    except Error:
        try:
            return playwright.chromium.launch()
        except Error as error:
            raise RuntimeError("needs Google Chrome, or run: uv run --with playwright==1.64.1 playwright install chromium") from error


def main():
    echarts_file, tokens = sys.argv[1], json.loads(sys.argv[2])
    with sync_playwright() as playwright:
        browser = launch(playwright)
        page = browser.new_page()
        page.set_content(PAGE % font_css())
        page.evaluate("document.fonts.load('11px \"Maple Mono\"'), document.fonts.load('11px \"Blog Sans\"', '中')")
        page.add_script_tag(path=echarts_file)
        page.add_script_tag(path="templates/js/chart-theme.js")
        page.add_script_tag(content=SCRIPT)
        page.evaluate("t => echarts.registerTheme('blog', chartTheme(n => t[n]))", tokens)
        mermaid_ready = False
        for line in sys.stdin:
            request = json.loads(line)
            try:
                if request["kind"] == "echarts":
                    svg = page.evaluate("([s, w, h, t]) => drawEcharts(s, w, h, t)", [request["source"], request["width"], request["height"], tokens])
                else:
                    if not mermaid_ready:
                        page.add_script_tag(path=str(mermaid_file()))
                        theme = {k: tokens[v] for k, v in MERMAID_THEME.items()}
                        page.evaluate("""v => mermaid.initialize({startOnLoad: false, theme: "base", securityLevel: "strict",
                            fontFamily: '"Blog Sans","Blog Sans Late","PingFang SC",sans-serif', themeVariables: {...v, fontSize: "14px"},
                            flowchart: {curve: "basis", padding: 12}, sequence: {mirrorActors: false}})""", theme)
                        mermaid_ready = True
                    # Named by content, so ids stay the same however figures are cached.
                    name = "diagram-" + hashlib.sha256(request["source"].encode()).hexdigest()[:8]
                    svg = page.evaluate("([s, i, t]) => drawMermaid(s, i, t)", [request["source"], name, tokens])
                answer = {"svg": svg}
            except Error as error:
                answer = {"error": str(error).splitlines()[0]}
            print(json.dumps(answer), flush=True)
        browser.close()


if __name__ == "__main__":
    main()
