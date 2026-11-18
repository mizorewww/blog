// The opening figure: three pictures, eight questions each, answered by
// Glance in one forward pass (real outputs, hero.json). Pointing at a
// question shows its box. Two knobs: below one P(present) a box question is
// answered "not here"; below one P(IoU >= 0.5) its box is drawn as unreliable.
import { el, json, image, fmt, HUES, KIND, slider, pills, whenSeen, credit, still } from "./common.js";

export default async function hero(stage, { base }) {
  const data = await json(base, "hero.json");
  const pictures = await Promise.all(data.scenes.map((s, i) => i == 0 ? image(base + s.image) : null));
  let scene = 0, threshold = 0.5, quality = 0.5, focus = -1, pinned = -1, shown = false;

  const shot = el("div.g-shot");
  const list = el("ol.g-qs");
  const detail = el("div.g-detail", { "aria-live": "polite" });
  const tally = el("span.g-tally");
  const credits = el("div.g-credits");
  const dial = slider({
    label: "“不在”的阈值", value: threshold, min: 0.02, max: 0.98,
    oninput: v => { threshold = v; update(); },
  });
  const knob = slider({
    label: "框准不准的阈值", value: quality, min: 0.02, max: 0.98,
    oninput: v => { quality = v; update(); },
  });
  const tabs = pills(data.scenes.map((s, i) => [i, s.label]), 0, i => show(+i), "g-scenes");
  const badge = el("div.g-badge", {},
    el("b", { text: "8" }), " 个问题 · ", el("b", { text: "1" }), " 次前向 · ",
    el("b", { text: data.gpu_ms_8q + " ms" }), el("span", { text: " " + data.gpu + " · 预先算好的真实输出" }));

  stage.append(el("div.g-card.g-hero", {},
    el("div.g-hero-top", {}, tabs, badge),
    el("div.g-hero-body", {}, el("div.g-hero-main", {}, shot, detail), list),
    el("div.g-hero-foot", {}, dial, knob, tally),
    credits));

  // The picture is painted on a canvas: the build's still is this page's
  // largest paint, and swapping in a new <img> above the fold would make the
  // browser count a second, later one.
  function paint(img) {
    const canvas = el("canvas", { width: img.naturalWidth, height: img.naturalHeight, "aria-hidden": "true" });
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas;
  }

  // Box questions draw a box; the others answer in the list.
  function boxNode(q, i) {
    const [w, h] = data.scenes[scene].size;
    const [x1, y1, x2, y2] = q.box;
    const left = Math.max(0, x1) / w * 100, top = Math.max(0, y1) / h * 100;
    const node = el("div.g-box", {
      style: `--c:var(--${HUES[i]});left:${left}%;top:${top}%;width:${Math.min(100, x2 / w * 100) - left}%;height:${Math.min(100, y2 / h * 100) - top}%;--d:${i * 70}ms`,
      "data-i": i,
    }, el("span.g-box-tag", {}, el("span", { text: q.text }), el("b", { text: fmt(q.p) }), el("em", { text: "框不准 " + fmt(q.iou) })));
    node.addEventListener("pointerenter", () => hover(i));
    node.addEventListener("pointerleave", () => hover(-1));
    // A box at the top edge hangs its tag below it, or inside when it also reaches the bottom.
    if (top < 9) node.classList.add(y2 / h > 0.9 ? "tag-inside" : "tag-in");
    return node;
  }

  // A distribution with no clear winner is the model saying it does not know.
  const unsure = q => q.probs && Math.max(...q.probs.map(p => p[1])) < 0.4;

  function row(q, i) {
    const value = q.kind == "box" || q.kind == "yesno"
      ? el("span.g-q-val", {}, el("span.g-q-word"), el("b", { text: fmt(q.p) }))
      : el("span.g-q-val", {}, el("span.g-q-word", { text: unsure(q) ? "拿不准" : q.answer }), el("b", { text: unsure(q) ? "" : fmt(q.probs.find(p => p[0] == q.answer)[1]) }));
    const bar = q.kind == "box" || q.kind == "yesno"
      ? el("span.g-q-bar", {}, el("i", { style: `width:${q.p * 100}%` }))
      : el("span.g-q-bar.split", {}, ...q.probs.map(([l, p]) => el("i", { style: `width:${p * 100}%`, title: `${l} ${fmt(p)}` })));
    const button = el("button.g-q", {
      type: "button", style: `--c:var(--${HUES[i]})`, "data-kind": q.kind, "aria-pressed": "false",
      on: {
        pointerenter: () => hover(i), pointerleave: () => hover(-1), focus: () => hover(i), blur: () => hover(-1),
        click: () => { pinned = pinned == i ? -1 : i; update(); },
      },
    }, el("span.g-q-dot"), el("span.g-q-kind", { text: KIND[q.kind] }), el("span.g-q-text", { text: q.text, title: q.text }), value, bar);
    return el("li", {}, button);
  }

  function hover(i) {
    focus = i;
    update();
  }

  async function show(i) {
    scene = i;
    pictures[i] ??= await image(base + data.scenes[i].image);
    const s = data.scenes[i];
    pinned = focus = -1;
    shot.replaceChildren(el("div.g-shot-frame", { style: `aspect-ratio:${s.size[0]}/${s.size[1]}` },
      paint(pictures[i]),
      el("div.g-scan"),
      ...s.questions.map((q, j) => q.kind == "box" && q.box ? boxNode(q, j) : null)));
    list.replaceChildren(...s.questions.map(row));
    credits.replaceChildren(credit(s.credit));
    shot.classList.remove("seen");
    if (shown) requestAnimationFrame(() => requestAnimationFrame(() => shot.classList.add("seen")));
    update();
  }

  function update() {
    const s = data.scenes[scene];
    const active = pinned >= 0 ? pinned : focus;
    let here = 0, gone = 0, weak = 0;
    s.questions.forEach((q, i) => {
      const button = list.children[i]?.firstChild;
      if (!button) return;
      const box = shot.querySelector(`.g-box[data-i="${i}"]`);
      const yes = q.p >= threshold;
      if (q.kind == "box") {
        const loose = yes && q.iou < quality;
        yes ? (loose ? weak++ : here++) : gone++;
        button.classList.toggle("absent", !yes);
        button.classList.toggle("loose", loose);
        button.querySelector(".g-q-word").textContent = yes ? (loose ? "框不准" : "") : "不在";
        box?.classList.toggle("off", !yes);
        box?.classList.toggle("loose", loose);
      } else if (q.kind == "yesno") {
        button.querySelector(".g-q-word").textContent = q.p >= 0.5 ? "是" : "否";
      }
      button.style.setProperty("--t", threshold * 100 + "%");
      button.classList.toggle("hot", i == active);
      button.setAttribute("aria-pressed", String(i == pinned));
      box?.classList.toggle("hot", i == active);
    });
    shot.classList.toggle("focused", active >= 0 && s.questions[active].kind == "box");
    tally.replaceChildren(el("b", { text: here }), " 个框 · ", el("b", { text: weak }), " 个框不准 · ", el("b", { text: gone }), " 个“不在”");
    detail.replaceChildren(...describe(active >= 0 ? s.questions[active] : null, active));
  }

  function describe(q, i) {
    if (!q) return [el("p.g-detail-hint", { text: "指一个问题，看它的框和完整的分布。" })];
    const head = el("p.g-detail-q", { style: `--c:var(--${HUES[i]})` }, el("span.g-q-dot"), q.text);
    if (q.kind == "box") {
      const yes = q.p >= threshold;
      const loose = yes && q.iou < quality;
      return [head, el("p.g-detail-row", {},
        "P(present) ", el("b", { text: fmt(q.p) }), yes ? ` ≥ ${threshold.toFixed(2)}：在` : ` < ${threshold.toFixed(2)}：回答“不在”`,
        yes ? el("span", {}, "。框准的概率 P(IoU≥0.5) ", el("b", { text: fmt(q.iou) }),
          loose ? ` < ${quality.toFixed(2)}：东西在，但这个框不可靠，别直接点` : ` ≥ ${quality.toFixed(2)}：框可以用`) : "")];
    }
    if (q.kind == "yesno") return [head, el("p.g-detail-row", {}, "P(yes) ", el("b", { text: fmt(q.p) }))];
    return [head, el("ul.g-dist", {}, ...q.probs.map(([l, p]) => el("li", { class: l == q.answer && !unsure(q) ? "top" : "" },
      el("span", { text: l }), el("i", { style: `--w:${p * 100}%` }), el("b", { text: fmt(p) })))),
      unsure(q) ? el("p.g-detail-row", { text: "几档的概率差不多：它不知道。一个分布比一个答案多给出的，正是这一点。" }) : ""];
  }

  await show(0);
  whenSeen(stage, () => {
    shown = true;
    shot.classList.add("seen");
  });
  if (still.matches) shot.classList.add("seen");
  // Fetch the other pictures when the reader reaches for the tabs.
  tabs.addEventListener("pointerenter", () => data.scenes.forEach((s, i) => { if (!pictures[i]) image(base + s.image).then(img => pictures[i] ??= img, () => {}); }), { once: true });
}
