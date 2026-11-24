#!/bin/sh
# Rebuilds src/mathjax.js.gz from pinned mathjax-full@3.2.2 for build-time TeX -> SVG.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cd "$work"
npm pack mathjax-full@3.2.2 --quiet >/dev/null
tar -xzf mathjax-full-3.2.2.tgz

cat << 'EOF' > entry.js
const { mathjax } = require("./package/js/mathjax.js");
const { TeX } = require("./package/js/input/tex.js");
const { SVG } = require("./package/js/output/svg.js");
const { liteAdaptor } = require("./package/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("./package/js/handlers/html.js");
require("./package/js/input/tex/base/BaseConfiguration.js");
require("./package/js/input/tex/ams/AmsConfiguration.js");
require("./package/js/input/tex/boldsymbol/BoldsymbolConfiguration.js");
require("./package/js/input/tex/mathtools/MathtoolsConfiguration.js");
require("./package/js/input/tex/braket/BraketConfiguration.js");
require("./package/js/input/tex/cancel/CancelConfiguration.js");

const adaptor = liteAdaptor({ cjkCharWidth: 0.92 });
RegisterHTMLHandler(adaptor);

const tex = new TeX({
  packages: ["base", "ams", "boldsymbol", "mathtools", "braket", "cancel"],
  formatError: (jax, err) => { throw new Error(err.message); }
});
const svg = new SVG({ fontCache: "local" });
const doc = mathjax.document("", { InputJax: tex, OutputJax: svg });

const roundEx = s => s.replace(/-?\d+\.\d+/g, m => String(+parseFloat(m).toFixed(2)));
const roundUnits = s => s.replace(/(-?\d+\.\d+)/g, m => String(Math.round(parseFloat(m))));
const roundTransform = s => s.replace(/(translate|matrix)\(([^)]+)\)/g, (_, fn, args) => {
  if (fn === "translate") return `translate(${args.replace(/-?\d+\.\d+/g, m => String(Math.round(parseFloat(m))))})`;
  return `${fn}(${args.replace(/-?\d+\.\d{3,}/g, m => String(+parseFloat(m).toFixed(3)))})`;
});

// Flatten empty <g> wrappers and strip MathJax client-only attributes so pages
// with hundreds of formulas stay small in bytes and cheap to lay out on phones.
function compactTree(el) {
  if (!el || !el.kind || el.kind === "#text" || el.kind === "#comment") return [el];
  const attrs = el.attributes || {};
  for (const k of Object.keys(attrs)) {
    if (k.startsWith("data-") || k === "focusable" || k === "xmlns:xlink") {
      delete attrs[k];
    } else if (k === "xlink:href") {
      attrs.href = attrs[k].replace(/^#MJX-\d+-TEX-/, "#MJX-TEX-");
      delete attrs[k];
    } else if (k === "id") {
      attrs[k] = attrs[k].replace(/^MJX-\d+-TEX-/, "MJX-TEX-");
    } else if (k === "font-family" && attrs[k] === "serif") {
      delete attrs[k];
    } else if (k === "transform") {
      attrs[k] = roundTransform(attrs[k]);
    } else if (k === "viewBox") {
      attrs[k] = roundUnits(attrs[k]);
    }
  }
  if (el.kind === "g") {
    if (attrs.stroke === "currentColor" && attrs.fill === "currentColor" && attrs["stroke-width"] === "0") {
      delete attrs.stroke;
      delete attrs.fill;
      delete attrs["stroke-width"];
    }
  }
  const next = [];
  for (const ch of el.children || []) {
    for (const c of compactTree(ch)) if (c) next.push(c);
  }
  el.children = next;
  if (el.kind === "g") {
    const keys = Object.keys(attrs);
    if (keys.length === 0) return next;
    if (keys.length === 1 && keys[0] === "transform" && next.length === 1 && next[0].kind === "use" && !next[0].attributes.transform) {
      next[0].attributes.transform = attrs.transform;
      return next;
    }
  }
  return [el];
}

globalThis.renderTeX = function(input, display) {
  const container = doc.convert(input, { display: !!display });
  const svgEl = container.children[0];
  compactTree(svgEl);
  delete svgEl.attributes.xmlns;
  delete svgEl.attributes.role;
  const w = roundEx(svgEl.attributes.width), h = roundEx(svgEl.attributes.height);
  const va = (svgEl.attributes.style || "").match(/vertical-align:\s*([^;]+)/);
  svgEl.attributes = {
    class: "math-svg",
    width: w,
    height: h,
    style: `width:${w};height:${h}` + (va ? `;vertical-align:${roundEx(va[1].trim())}` : ""),
    viewBox: svgEl.attributes.viewBox
  };
  return adaptor.outerHTML(svgEl);
};
EOF

npx -y esbuild@0.25.0 entry.js --bundle --format=iife --target=es2019 --minify --outfile=mathjax.js
gzip -9 -n -c mathjax.js > "$root/src/mathjax.js.gz"
ls -lh "$root/src/mathjax.js.gz"
