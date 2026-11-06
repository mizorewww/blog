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
import itertools
import json
import math
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
// Every color a drawing paints must come from a token: a stand-in, a mix of
// two that the option asks ECharts to blend (a visualMap range, a gradient),
// or either with some alpha. Each becomes var(--token) or color-mix() of
// tokens; any other painted color fails the drawing. Mermaid's stylesheet
// is recolored too, but not checked: it carries rules for shapes a diagram
// may not draw.
const colorPattern = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi;
const parseColor = s => {
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length == 3 ? [...m[1]].map(c => c + c).join("") : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
  return m && [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
};
const tokenColor = (s, tokens, pairs) => {
  const c = parseColor(s);
  if (!c) return null;
  const points = Object.entries(tokens).map(([name, hex]) => [name, parseColor(hex)]);
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  let best = null, gap = 1;
  for (const [name, p] of points) if (dist(c, p) < gap) [best, gap] = [`var(--${name})`, dist(c, p)];
  if (!best) {
    gap = 1.5;
    for (const [a, b] of pairs) {
      const p = parseColor(tokens[a]), q = parseColor(tokens[b]);
      const d = [0, 1, 2].map(k => q[k] - p[k]), t = [0, 1, 2].reduce((s, k) => s + (c[k] - p[k]) * d[k], 0) / [0, 1, 2].reduce((s, k) => s + d[k] * d[k], 0);
      const off = dist(c, [0, 1, 2].map(k => p[k] + t * d[k]));
      if (t > 0 && t < 1 && off < gap) [best, gap] = [`color-mix(in srgb,var(--${a}) ${Math.round((1 - t) * 100)}%,var(--${b}))`, off];
    }
  }
  if (best && c[3] < 1) best = `color-mix(in srgb,${best} ${Math.round(c[3] * 100)}%,transparent)`;
  return best;
};
// blends lists the token pairs an option blends: consecutive colors of a
// visualMap range or a gradient's stops. Only these may be read as mixes.
const blends = option => {
  const pairs = [], name = c => typeof c == "string" && c.match(/^var\(--([\w-]+)\)$/)?.[1];
  const add = colors => colors.map(name).forEach((n, i, all) => i && n && all[i - 1] && pairs.push([all[i - 1], n]));
  const walk = (v, key, parent) => {
    if (Array.isArray(v)) {
      if (key == "color" && /^(inRange|outOfRange)$/.test(parent)) add(v);
      if (key == "colorStops") add(v.map(stop => stop?.color));
      v.forEach(x => walk(x, key, parent));
    } else if (v && typeof v == "object") {
      for (const [k, x] of Object.entries(v)) walk(x, k, key);
    }
  };
  walk(option);
  return pairs;
};
const recolor = (svg, tokens, tidy, strictStyles, pairs = []) => {
  const left = new Set();
  const text = (s, strict) => s.replace(colorPattern, m => {
    const t = tokenColor(m, tokens, pairs);
    if (!t && strict) left.add(m);
    return t ?? m;
  });
  // Parsed and written as HTML, where the SVG ends up; Mermaid's labels hold <br>.
  const box = document.createElement("div");
  box.innerHTML = svg;
  const root = box.firstElementChild;
  if (root?.nodeName != "svg") throw new Error("no SVG drawn");
  tidy?.(root);
  // A stylesheet rule beats a paint attribute (Mermaid sets both); such an
  // attribute is never painted, so it goes rather than fail the check below.
  document.body.append(box);
  for (const el of root.querySelectorAll("[fill], [stroke]")) {
    for (const attr of ["fill", "stroke"]) {
      const c = parseColor(el.getAttribute(attr) ?? ""), shown = parseColor(getComputedStyle(el)[attr]);
      if (c && shown && c.slice(0, 3).join() != shown.slice(0, 3).join()) el.removeAttribute(attr);
    }
  }
  box.remove();
  const used = new Set([...root.querySelectorAll("use")].map(u => (u.getAttribute("href") ?? u.getAttribute("xlink:href") ?? "").slice(1)));
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (el.nodeName == "style") { el.textContent = text(el.textContent, strictStyles); continue; }
    // A clip path's paint is never seen, nor a symbol nothing uses (Mermaid
    // defines its icons in every sequence diagram), nor paint at zero opacity or width.
    if (el.closest("clipPath, mask")) continue;
    const symbol = el.closest("symbol");
    if (symbol && !used.has(symbol.id)) continue;
    if (el.getAttribute("fill-opacity") == "0") el.setAttribute("fill", "none");
    if (el.getAttribute("stroke-width") == "0" || el.getAttribute("stroke-opacity") == "0") el.setAttribute("stroke", "none");
    for (const attr of ["fill", "stroke", "stop-color", "color", "flood-color"]) {
      const v = el.getAttribute(attr);
      if (v == null) continue;
      const t = text(v, true);
      if (t != v) { el.removeAttribute(attr); el.style.setProperty(attr, t); }
    }
    const style = el.getAttribute("style");
    if (style) el.setAttribute("style", text(style, true));
  }
  if (left.size) throw new Error("colors not from a var(--token): " + [...left].join(" "));
  return root.outerHTML;
};
window.drawEcharts = async (source, width, height, tokens, prefix) => {
  await document.fonts.ready;
  const pairs = [...blends(chartTheme(n => `var(--${n})`)), ...blends(JSON.parse(source))];
  const option = JSON.parse(source.replace(/var\(--([\w-]+)\)/g, (m, n) => tokens[n] ?? m));
  const chart = echarts.init(null, "blog", { renderer: "svg", ssr: true, width, height });
  const errors = [];
  const log = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    chart.setOption({ ...option, animation: false });
  } finally {
    console.error = log;
  }
  // ECharts skips a series it cannot draw, such as an unknown type, and only logs it.
  const drawn = chart.getOption().series?.length ?? 0;
  if (errors.length || drawn != option.series.length) {
    chart.dispose();
    throw new Error(errors[0] || `drew ${drawn} of ${option.series.length} series`);
  }
  const svg = chart.renderToSVGString();
  chart.dispose();
  return recolor(svg, tokens, root => {
    // The page sizes the drawing and sets its font (style.css), so neither is repeated.
    root.removeAttribute("width");
    root.removeAttribute("height");
    for (const el of root.querySelectorAll("[style]")) el.style.removeProperty("font-family");
    // Hover rules are for the live chart; their class names count the charts this
    // process drew, so they would change with whatever else was drawn.
    for (const el of root.querySelectorAll("style")) el.remove();
    for (const el of root.querySelectorAll("[class]")) {
      el.setAttribute("class", el.getAttribute("class").replace(/\bzr\d+-cls-\d+\b/g, "").trim());
      if (!el.getAttribute("class")) el.removeAttribute("class");
    }
    // So do its clip path ids; they are named by the figure instead.
    for (const el of [root, ...root.querySelectorAll("*")]) {
      for (const attr of [...el.attributes]) {
        if (/\bzr\d+-/.test(attr.value)) el.setAttribute(attr.name, attr.value.replace(/\bzr\d+-/g, prefix + "-"));
      }
    }
  }, true, pairs);
};
window.drawMermaid = async (source, id, tokens) => {
  await document.fonts.ready;
  // Mermaid's parser takes no var(): style and classDef lines draw with stand-ins too.
  const { svg } = await mermaid.render(id, source.replace(/var\(--([\w-]+)\)/g, (m, n) => tokens[n] ?? m));
  // Flat, like the page's other figures: no drop shadows under the shapes.
  return recolor(svg, tokens, root => {
    for (const el of root.querySelectorAll("[style]")) el.style.removeProperty("filter");
    for (const el of root.querySelectorAll("[filter]")) el.removeAttribute("filter");
    for (const el of root.querySelectorAll("filter")) el.remove();
    // On a phone a wide diagram scrolls sideways rather than shrink its text past reading.
    if (root.style.maxWidth) root.style.minWidth = `min(${root.style.maxWidth}, 520px)`;
    for (const el of root.querySelectorAll("style")) el.textContent = el.textContent.replace(/filter:\s*(drop-shadow\([^;}]*\)|url\([^)]*\))/g, "filter:none");
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


def check_stand_ins(tokens):
    """Mixes are told apart only while no stand-in lies on the line between two others."""
    points = {name: [int(hex[i:i + 2], 16) for i in (1, 3, 5)] for name, hex in tokens.items()}
    for a, b in itertools.combinations(points, 2):
        p, q = points[a], points[b]
        d = [q[k] - p[k] for k in range(3)]
        for c, r in points.items():
            if c in (a, b):
                continue
            t = sum((r[k] - p[k]) * d[k] for k in range(3)) / sum(x * x for x in d)
            if 0 < t < 1 and math.dist(r, [p[k] + t * d[k] for k in range(3)]) < 3:
                raise RuntimeError(f"stand-in for {c} lies between {a} and {b}")


def main():
    echarts_file, tokens = sys.argv[1], json.loads(sys.argv[2])
    check_stand_ins(tokens)
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
                    # Clip path ids are named by content, like diagram ids below.
                    prefix = "chart-" + hashlib.sha256(request["source"].encode()).hexdigest()[:8]
                    svg = page.evaluate("([s, w, h, t, p]) => drawEcharts(s, w, h, t, p)", [request["source"], request["width"], request["height"], tokens, prefix])
                else:
                    if not mermaid_ready:
                        page.add_script_tag(path=str(mermaid_file()))
                        theme = {k: tokens[v] for k, v in MERMAID_THEME.items()}
                        page.evaluate("""v => mermaid.initialize({startOnLoad: false, theme: "base", securityLevel: "strict",
                            fontFamily: '"Blog Sans","Blog Sans Late","PingFang SC",sans-serif', themeVariables: {...v, fontSize: "14px"},
                            htmlLabels: false, flowchart: {curve: "basis", padding: 12, wrappingWidth: 280, htmlLabels: false}, sequence: {mirrorActors: false}})""", theme)
                        mermaid_ready = True
                    # Named by content, so ids stay the same however figures are cached.
                    name = "diagram-" + hashlib.sha256(request["source"].encode()).hexdigest()[:8]
                    svg = page.evaluate("([s, i, t]) => drawMermaid(s, i, t)", [request["source"], name, tokens])
                answer = {"svg": svg}
            except Error as error:
                # Mermaid's parse errors name the line on the first and the expected tokens below.
                answer = {"error": " ".join(line.strip() for line in str(error).splitlines()[:4] if line.strip())}
            print(json.dumps(answer), flush=True)
        browser.close()


if __name__ == "__main__":
    main()
