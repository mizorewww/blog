// Shared helpers for the Glance post's widgets. Colours are CSS tokens, so the
// figures follow the page's light and dark themes without redrawing.
export const SVG = "http://www.w3.org/2000/svg";

// el("div.a.b", {attr: v, style: "…", on: {click: f}}, child, "text", …)
export function el(tag, props = {}, ...children) {
  const [name, ...classes] = tag.split(".");
  const svg = ["svg", "g", "rect", "path", "line", "circle", "text", "polyline", "defs", "clipPath", "pattern", "tspan"].includes(name);
  const node = svg ? document.createElementNS(SVG, name) : document.createElement(name);
  if (classes.length) node.setAttribute("class", classes.join(" "));
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k == "on") for (const [e, f] of Object.entries(v)) node.addEventListener(e, f);
    else if (k == "text") node.textContent = v;
    else if (k == "html") node.innerHTML = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

export const json = async (base, name) => {
  const r = await fetch(base + name);
  if (!r.ok) throw new Error(name + " " + r.status);
  return r.json();
};

export const image = src => new Promise((ok, fail) => {
  const img = new Image();
  img.decoding = "async";
  img.onload = () => ok(img);
  img.onerror = fail;
  img.src = src;
});

export const still = matchMedia("(prefers-reduced-motion: reduce)");

// Probabilities keep three decimals and never round to a certainty they do not claim.
export function fmt(p) {
  if (p >= 0.9995) return ">0.999";
  if (p < 0.0005) return "<0.001";
  return p.toFixed(3);
}

export const pct = (v, d = 1) => (v < 0.1 && v > 0 ? v.toFixed(2) : v.toFixed(d)) + "%";

// One colour per question, in order; all are theme tokens.
export const HUES = ["clay", "blue", "teal", "violet", "orange", "fig", "olive", "sky"];

export const KIND = { box: "框", yesno: "是否", choice: "选择", score: "打分" };

// A labelled range input that reports while dragging.
export function slider({ label, min = 0.05, max = 0.95, step = 0.01, value = 0.5, format = v => v.toFixed(2), oninput }) {
  const out = el("output.g-slider-value", { text: format(value) });
  const input = el("input", { type: "range", min, max, step, value, "aria-label": label });
  const fill = () => input.style.setProperty("--at", ((input.value - min) / (max - min)) * 100 + "%");
  input.addEventListener("input", () => {
    out.textContent = format(+input.value);
    fill();
    oninput(+input.value);
  });
  fill();
  const node = el("label.g-slider", {}, el("span.g-slider-label", { text: label }), input, out);
  node.set = v => {
    input.value = v;
    out.textContent = format(+input.value);
    fill();
  };
  return node;
}

// Pill buttons; one is pressed at a time.
export function pills(items, current, onpick, cls = "") {
  const wrap = el("div.g-pills" + (cls ? "." + cls : ""), { role: "group" });
  const buttons = items.map(([id, text]) => el("button", {
    type: "button", "aria-pressed": String(id == current), "data-id": id, text,
    on: { click: () => pick(id) },
  }));
  const pick = id => {
    buttons.forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id == id)));
    onpick(id);
  };
  wrap.append(...buttons);
  wrap.pick = pick;
  return wrap;
}

// Run f once the node is on screen (or at once when motion is off).
export function whenSeen(node, f) {
  if (still.matches || !("IntersectionObserver" in window)) return f();
  const io = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) {
      io.disconnect();
      f();
    }
  }, { threshold: 0.35 });
  io.observe(node);
}

export function credit([title, author, url, license, licenseUrl, extra]) {
  return el("p.g-credit", {},
    el("a", { href: url, text: title, rel: "noopener" }), " · " + author + " · ",
    el("a", { href: licenseUrl, text: license, rel: "license noopener" }),
    extra ? " · " + extra : "");
}
