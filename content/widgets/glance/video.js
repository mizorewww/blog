// Big Buck Bunny, one frame every 4 s, four box questions per frame
// (video.json: real outputs, plus the author's frame-by-frame labels).
// Drag along the curves to scrub; the dial sets where "present" starts.
import { el, json, image, fmt, slider, whenSeen, credit, still } from "./common.js";

const HUE = { rabbit: "clay", squirrel: "violet", butterfly: "teal", car: "blue" };
const NAME = { rabbit: "兔子", squirrel: "飞鼠", butterfly: "蝴蝶", car: "红色汽车" };
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default async function video(stage, { base }) {
  const data = await json(base, "video.json");
  const n = data.t.length, [W, H] = data.size;
  const frames = new Array(n);
  let at = 34, threshold = 0.5, playing = 0;
  const on = Object.fromEntries(data.queries.map(q => [q.id, true]));
  frames[at] = await image(base + `f/t${String(data.t[at]).padStart(3, "0")}.webp`);

  const img = el("img", { alt: "", draggable: "false" });
  const boxes = el("div.g-boxes");
  const time = el("span.g-time");
  const play = el("button.g-play", { type: "button", "aria-label": "播放", on: { click: () => toggle() } });
  const chips = el("div.g-chips", {}, ...data.queries.map(q => el("button.g-chip", {
    type: "button", style: `--c:var(--${HUE[q.id]})`, "aria-pressed": "true", "data-id": q.id,
    on: { click: e => { on[q.id] = !on[q.id]; e.currentTarget.setAttribute("aria-pressed", String(on[q.id])); draw(); } },
    title: q.text,
  }, el("span.g-q-dot"), NAME[q.id], el("small", { text: q.text }))));
  const agree = el("div.g-agree");
  const dial = slider({ label: "“不在”的阈值", value: threshold, min: 0.02, max: 0.98, oninput: v => { threshold = v; draw(); } });

  // The timeline: one lane per question, P(t) as an area, the labels as a strip under it.
  const lane = 30, strip = 5, gap = 12, top = 6, Wt = 1000;
  const Ht = top + data.queries.length * (lane + strip + gap);
  const x = i => (i + 0.5) / n * Wt;
  const svg = el("svg.g-timeline", { viewBox: `0 0 ${Wt} ${Ht}`, preserveAspectRatio: "none", role: "slider", tabindex: "0",
    "aria-label": "视频时间", "aria-valuemin": "0", "aria-valuemax": String(data.t[n - 1]) });
  const lanes = data.queries.map((q, k) => {
    const y0 = top + k * (lane + strip + gap), y = p => y0 + lane - p * lane;
    const line = q.p.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join("");
    const g = el("g", { style: `--c:var(--${HUE[q.id]})`, "data-id": q.id },
      el("rect.g-lane-bg", { x: 0, y: y0, width: Wt, height: lane }),
      el("path.g-area", { d: `${line}L${x(n - 1)} ${y0 + lane}L${x(0)} ${y0 + lane}Z` }),
      el("path.g-line", { d: line }),
      el("line.g-thr", { x1: 0, x2: Wt, y1: y(threshold), y2: y(threshold) }),
      ...q.gt.map((v, i) => v === 0 ? null : el("rect", {
        class: v == null ? "g-gt unsure" : "g-gt", x: i / n * Wt, y: y0 + lane + 2, width: Wt / n + 0.4, height: strip,
      })));
    g.y = y;
    return g;
  });
  const head = el("line.g-head", { y1: 0, y2: Ht });
  svg.append(...lanes, head);
  const labels = el("div.g-lane-labels", {}, ...data.queries.map((q, k) => el("span", {
    style: `top:${(top + k * (lane + strip + gap)) / Ht * 100}%;--c:var(--${HUE[q.id]})`, text: NAME[q.id],
  })));
  const axis = el("div.g-axis", {}, ...[0, 60, 120, 180, 240, 300, 360, 420].map(s => el("span", { style: `left:${(s / 4 + 0.5) / n * 100}%`, text: clock(s) })));

  stage.append(el("div.g-card.g-video", {},
    el("div.g-video-top", {}, chips, el("div.g-video-clock", {}, play, time)),
    el("div.g-shot.seen", {}, el("div.g-shot-frame", { style: `aspect-ratio:${W}/${H}` }, img, boxes)),
    el("div.g-track", {}, labels, svg, axis),
    el("p.g-legend", {}, el("span.g-legend-area"), "Glance 给的 P(present)", el("span.g-legend-gt"), "人工标注“在”", el("span.g-legend-unsure"), "看不清", el("span.g-legend-thr"), "阈值"),
    el("div.g-hero-foot", {}, dial),
    agree,
    el("div.g-credits", {}, credit(["Big Buck Bunny", "© 2008 Blender Foundation · www.bigbuckbunny.org", "https://peach.blender.org/", "CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/", "前 8 分钟，每 4 秒一帧，缩放到 448 px 宽"]))));

  function seek(i) {
    at = Math.max(0, Math.min(n - 1, i));
    draw();
  }

  function draw() {
    const t = data.t[at];
    time.textContent = clock(t);
    svg.setAttribute("aria-valuenow", String(t));
    svg.setAttribute("aria-valuetext", clock(t));
    head.setAttribute("x1", x(at));
    head.setAttribute("x2", x(at));
    let shown = at;
    while (!frames[shown] && shown > 0) shown--; // nearest loaded frame before it
    if (frames[shown]) img.src = frames[shown].src;
    boxes.replaceChildren(...data.queries.map(q => {
      const p = q.p[at];
      if (!on[q.id] || p < threshold) return null;
      const [x1, y1, x2, y2] = q.box[at];
      const l = Math.max(0, x1) / W * 100, tp = Math.max(0, y1) / H * 100;
      return el("div.g-box.static", { style: `--c:var(--${HUE[q.id]});left:${l}%;top:${tp}%;width:${Math.min(100, x2 / W * 100) - l}%;height:${Math.min(100, y2 / H * 100) - tp}%` },
        el("span.g-box-tag", {}, el("span", { text: NAME[q.id] }), el("b", { text: fmt(p) })));
    }).filter(Boolean));
    lanes.forEach((g, k) => {
      const q = data.queries[k];
      g.classList.toggle("off", !on[q.id]);
      const thr = g.querySelector(".g-thr");
      thr.setAttribute("y1", g.y(threshold));
      thr.setAttribute("y2", g.y(threshold));
    });
    agree.replaceChildren(el("span", { text: "和人工逐帧标注一致：" }), ...data.queries.map(q => {
      let ok = 0, m = 0;
      q.gt.forEach((v, i) => { if (v != null) { m++; ok += (q.p[i] >= threshold) == (v == 1); } });
      return el("span.g-agree-item", { style: `--c:var(--${HUE[q.id]})` }, NAME[q.id] + " ", el("b", { text: `${ok}/${m}` }));
    }));
  }

  // Scrub with the pointer anywhere on the curves, or the arrow keys.
  const pick = e => {
    const r = svg.getBoundingClientRect();
    seek(Math.floor((e.clientX - r.left) / r.width * n));
  };
  svg.addEventListener("pointerdown", e => { stop(); svg.setPointerCapture(e.pointerId); pick(e); });
  svg.addEventListener("pointermove", e => { if (svg.hasPointerCapture(e.pointerId)) pick(e); });
  svg.addEventListener("keydown", e => {
    const step = { ArrowRight: 1, ArrowLeft: -1, PageUp: 15, PageDown: -15 }[e.key];
    if (step) { e.preventDefault(); stop(); seek(at + step); }
    if (e.key == "Home") { e.preventDefault(); seek(0); }
    if (e.key == "End") { e.preventDefault(); seek(n - 1); }
  });

  function stop() {
    playing = 0;
    play.classList.remove("on");
    play.setAttribute("aria-label", "播放");
  }
  function toggle() {
    if (playing) return stop();
    if (at >= n - 1) at = 0;
    playing = 1;
    play.classList.add("on");
    play.setAttribute("aria-label", "暂停");
    let last = 0;
    const tick = now => {
      if (!playing) return;
      if (now - last > 260) { last = now; seek(at + 1); if (at >= n - 1) return stop(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  draw();
  // Every frame, a few at a time, once the figure is in view.
  whenSeen(stage, async () => {
    const order = [...data.t.keys()].sort((a, b) => Math.abs(a - at) - Math.abs(b - at));
    const next = async () => {
      for (let i; (i = order.shift()) != null;) {
        if (frames[i]) continue;
        try { frames[i] = await image(base + `f/t${String(data.t[i]).padStart(3, "0")}.webp`); } catch {}
        if (Math.abs(i - at) < 2) draw();
      }
    };
    await Promise.all([next(), next(), next(), next()]);
    draw();
  });
  if (still.matches) return;
}
