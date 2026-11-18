// Why a block mask is not enough on a hybrid model: in the Gated-DeltaNet
// layers the recurrent state runs along the sequence, so question 1 is
// written into what question 2 reads. Glance restarts every question from
// the prefix's state. Numbers: outputs/27b/bench/masktest.json (27B, 8 blocks
// of 25 tokens), and the fp32 equivalence test in the README.
import { el, pills, still } from "./common.js";

const MODES = [["mask", "拼起来 + block mask"], ["glance", "Glance：从前缀状态重开"]];
const BLOCKS = [["前缀：图像", "plain"], ["问题 1", "q1"], ["问题 2", "q2"], ["问题 3", "q3"]];

export default async function leak(stage) {
  let mode = "mask";
  const svg = el("svg.g-leak-svg", { role: "img", "aria-label": "GDN 状态怎样在问题块之间泄漏，以及 Glance 怎样避免" });
  const say = el("div.g-leak-say", { "aria-live": "polite" });
  const modes = pills(MODES, mode, id => { mode = id; draw(); });
  const card = el("div.g-card.g-leak", {}, modes, el("div.g-leak-stage", {}, svg), say);
  stage.append(card);

  function draw() {
    const W = Math.max(320, Math.round(svg.parentNode.getBoundingClientRect().width)) || 680;
    const narrow = W < 520, H = narrow ? 236 : 236;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.height = H + "px";
    const left = narrow ? 8 : 104, gap = narrow ? 6 : 10;
    const widths = [1.35, 1, 1, 1], unit = (W - left - 8 - gap * 3) / widths.reduce((a, b) => a + b);
    let x = left;
    const blocks = BLOCKS.map(([name, cls], i) => { const w = widths[i] * unit, b = { name, cls, x, w, cx: x + w / 2 }; x += w + gap; return b; });
    const yTok = narrow ? 8 : 22, yGdn = narrow ? 96 : 104, yAtt = narrow ? 214 : 182;
    const kids = [];
    if (!narrow) kids.push(
      el("text.g-leak-row", { x: 0, y: yTok + 17, text: "token 序列" }),
      el("text.g-leak-row", { x: 0, y: yGdn + 4, text: "GDN 层 ×3" }),
      el("text.g-leak-row.sub", { x: 0, y: yGdn + 19, text: "递归状态" }),
      el("text.g-leak-row", { x: 0, y: yAtt + 4, text: "注意力层 ×1" }),
      el("text.g-leak-row.sub", { x: 0, y: yAtt + 19, text: "加了 mask" }));
    else kids.push(el("text.g-leak-row.sub", { x: 8, y: yGdn - 34, text: "GDN 层的递归状态（每 4 层 3 层）" }),
      el("text.g-leak-row.sub", { x: 8, y: yAtt - 60, text: "注意力层（每 4 层 1 层，加了 mask）" }));
    blocks.forEach(b => kids.push(el("g.g-leak-tok." + b.cls, {},
      el("rect", { x: b.x, y: yTok, width: b.w, height: 30, rx: 6 }),
      el("text", { x: b.cx, y: yTok + 19.5, "text-anchor": "middle", text: narrow && b.cls == "plain" ? "前缀" : b.name }))));

    // GDN: one state running along everything, or a fork from the prefix's state.
    const pre = blocks[0], snap = pre.x + pre.w;
    if (mode == "mask") {
      const d = `M${pre.x + 6} ${yGdn}H${blocks[3].x + blocks[3].w - 4}`;
      kids.push(el("path.g-leak-state", { d }),
        ...blocks.slice(1, 3).map((b, i) => el("path.g-leak-carry." + b.cls, { d: `M${b.cx} ${yGdn}H${blocks[3].x + blocks[3].w - 4}`, style: `--o:${i * 5}px` })),
        el("circle.g-leak-pulse", { r: 5, style: `offset-path:path("${d}")` }));
      blocks.slice(2).forEach(b => kids.push(el("g.g-leak-hit", { transform: `translate(${b.cx} ${yGdn - 16})` },
        el("circle", { r: 9 }), el("text", { y: 4, "text-anchor": "middle", text: "!" }))));
    } else {
      kids.push(el("path.g-leak-state", { d: `M${pre.x + 6} ${yGdn}H${snap - 4}` }),
        el("g.g-leak-snap", {}, el("rect", { x: snap - 10, y: yGdn - 9, width: 18, height: 18, rx: 4 })));
      blocks.slice(1).forEach((b, i) => {
        const d = `M${snap + 8} ${yGdn}C${snap + 30} ${yGdn},${b.x - 10} ${yGdn - 22 + i * 2},${b.x + 8} ${yGdn - 22 + i * 2}H${b.x + b.w - 6}`;
        kids.push(el("path.g-leak-branch." + b.cls, { d }), el("circle.g-leak-pulse." + b.cls, { r: 4.5, style: `offset-path:path("${d}");animation-delay:${i * 0.15}s` }));
      });
    }
    // Attention: each question looks back at the prefix; across questions is masked.
    blocks.slice(1).forEach((b, i) => {
      kids.push(el("path.g-leak-att", { d: `M${b.cx} ${yAtt - 8}C${b.cx} ${yAtt - 40},${pre.cx} ${yAtt - 40},${pre.cx} ${yAtt - 8}`, style: `--d:${i * 0.2}s` }));
      if (i) {
        const prev = blocks[i], mid = (prev.cx + b.cx) / 2;
        kids.push(el("path.g-leak-att.blocked", { d: `M${b.cx} ${yAtt - 8}C${b.cx} ${yAtt - 22},${prev.cx} ${yAtt - 22},${prev.cx} ${yAtt - 8}` }),
          el("text.g-leak-x", { x: mid, y: yAtt - 13, "text-anchor": "middle", text: "×" }));
      }
    });
    blocks.forEach(b => kids.push(el("circle.g-leak-node", { cx: b.cx, cy: yAtt - 6, r: 3 })));
    svg.replaceChildren(...kids);
    svg.classList.toggle("glance", mode == "glance");

    say.replaceChildren(...(mode == "mask"
      ? [el("p", {}, "注意力层的 mask 只挡住了每 4 层里的 1 层。另外 3 层是 Gated DeltaNet，它没有注意力矩阵可遮，问题 1 写进状态的东西，问题 2、3 照样读得到。"),
        el("div.g-leak-nums", {}, num("44.1%", "不加 mask：第 4 块和单独运行的隐状态差"), num("39.8%", "加上 block mask：几乎没变", "hot"), num("1.8%", "第 1 块：前面没有别的块，当对照"))]
      : [el("p", {}, "前缀只算一次，记下每个 GDN 层最后的递归状态和最后 3 个 conv 输入；每个问题块都从这份状态重新开始，注意力层只看前缀和自己。数学上等于把每个“前缀 + 问题”分开跑。"),
        el("div.g-leak-nums", {}, num("≈1e-7", "fp32 下和逐个单独运行的相对误差", "good"), num("85.5 → 85.6 ms", "问 1 个和问 8 个框问题（v1，RTX PRO 6000）"))]));
  }
  const num = (v, t, cls = "") => el("div.g-leak-num" + (cls ? "." + cls : ""), {}, el("b", { text: v }), el("span", { text: t }));

  draw();
  let width = 0;
  new ResizeObserver(([e]) => { if (Math.abs(e.contentRect.width - width) > 1) { width = e.contentRect.width; draw(); } }).observe(card);
  if (still.matches) svg.classList.add("still");
}
