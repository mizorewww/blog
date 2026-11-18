// Same backbone, same data, same steps; only the output head differs
// (dial.json, from outputs/ablation/*/rows.json). Each curve is what one head
// knows: every threshold on its own P("not here"). A decoding rule picks one
// point on that curve, and which point depends on the coordinate vocabulary.
import { el, json, pills, slider, pct, whenSeen } from "./common.js";

const RULES = [["greedy", "贪心解码"], ["threshold", "阈值 0.5"], ["map", "整串比较"]];
const RULE_TEXT = {
  greedy: "每一步取最可能的 token，第一个 token 是 none 就算“不在”",
  threshold: "P(none) ≥ 0.5 就算“不在”",
  map: "比较整串 none 和贪心解出的那串坐标的概率，大的赢；贪心串不一定是最可能的框，所以这是拒答率的上界",
};

export default async function dial(stage, { base }) {
  const data = await json(base, "dial.json");
  const heads = data.heads, ar = heads.filter(h => h.id != "gate");
  let head = "digits", rule = "map", gateAt = 0.5;

  // Chart geometry: x is log refusal of present targets, y is N-acc.
  const W = 440, H = 300, L = 46, R = 12, T = 14, B = 40;
  const xmin = Math.log10(0.05), xmax = Math.log10(60), ymin = 55, ymax = 100;
  const X = v => L + (Math.log10(Math.max(v, 0.05)) - xmin) / (xmax - xmin) * (W - L - R);
  const Y = v => T + (ymax - v) / (ymax - ymin) * (H - T - B);
  const svg = el("svg.g-dial-chart", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const grid = el("g.g-grid");
  for (const v of [0.1, 0.3, 1, 3, 10, 30]) grid.append(el("line", { x1: X(v), x2: X(v), y1: T, y2: H - B }), el("text.g-tick", { x: X(v), y: H - B + 15, "text-anchor": "middle", text: v + "%" }));
  for (const v of [60, 70, 80, 90, 100]) grid.append(el("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), el("text.g-tick", { x: L - 6, y: Y(v) + 3.5, "text-anchor": "end", text: v + "%" }));
  grid.append(el("text.g-axis-name", { x: (L + W - R) / 2, y: H - 6, "text-anchor": "middle", text: "在场的目标，被说成“不在”（对数轴）" }),
    el("text.g-axis-name", { x: 12, y: (T + H - B) / 2, "text-anchor": "middle", transform: `rotate(-90 12 ${(T + H - B) / 2})`, text: "没有的目标，说对了“不在”" }));
  const path = h => h.curve.filter(c => c[0] >= 0.05).map((c, i) => `${i ? "L" : "M"}${X(c[0]).toFixed(1)} ${Y(c[1]).toFixed(1)}`).join("");
  const curves = el("g", {}, ...heads.map(h => el("path.g-curve", { d: path(h), "data-id": h.id })));
  const others = el("g", {}, ...ar.map(h => el("g.g-pt.small", { "data-id": h.id }, el("circle", { r: 4 }))));
  const mark = el("g.g-pt.big", {}, el("circle.g-halo", { r: 13 }), el("circle", { r: 6.5 }), el("text.g-pt-label", { x: 0, y: -14, "text-anchor": "middle" }));
  svg.append(grid, curves, others, mark);

  const bars = el("div.g-bars");
  const barsTitle = el("p.g-side-title");
  const say = el("p.g-dial-say", { "aria-live": "polite" });
  const ruleNote = el("p.g-dial-rule");
  const gateDial = slider({ label: "门控的阈值 P(present)", value: gateAt, min: 0.02, max: 0.98, oninput: v => { gateAt = v; draw(); } });
  const headPills = pills(heads.map(h => [h.id, h.label]), head, id => { head = id; draw(); });
  const rulePills = pills(RULES, rule, id => { rule = id; draw(); });

  stage.append(el("div.g-card.g-dial", {},
    el("div.g-dial-controls", {},
      el("div.g-ctl", {}, el("span.g-ctl-name", { text: "输出头" }), headPills),
      el("div.g-ctl.g-ctl-rule", {}, el("span.g-ctl-name", { text: "解码规则" }), rulePills, gateDial)),
    ruleNote,
    el("div.g-dial-body", {},
      el("div.g-dial-plot", {}, svg),
      el("div.g-dial-side", {},
        barsTitle, bars)),
    say));

  // Bars are built once and animate between rules.
  const barRow = (h, value, max, text, cls = "") => el("div.g-bar-row" + cls, { "data-id": h.id },
    el("span.g-bar-name", { text: h.label }), el("span.g-bar-track", {}, el("i", { style: `width:${Math.min(100, value / max * 100)}%` })), el("b", { text }));

  // The gate's point for a threshold on P(present): interpolate its curve.
  function gatePoint() {
    const c = heads[0].curve; // [refusal, N-acc, threshold], threshold rising with refusal
    let i = c.findIndex(p => p[2] >= gateAt);
    if (i <= 0) i = Math.max(1, i == -1 ? c.length - 1 : 1);
    const [a, b] = [c[i - 1], c[i]], f = Math.min(1, Math.max(0, (gateAt - a[2]) / ((b[2] - a[2]) || 1)));
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
  }
  const point = h => h.id == "gate" ? gatePoint() : h.rules[rule];

  function draw() {
    const h = heads.find(x => x.id == head), gate = h.id == "gate";
    rulePills.style.display = gate ? "none" : "";
    gateDial.style.display = gate ? "" : "none";
    ruleNote.textContent = gate ? "门控只有一个数 P(present)，没有解码规则可选：阈值你来定，点沿着曲线走。" : RULE_TEXT[rule] + "。";
    curves.querySelectorAll("path").forEach(p => p.classList.toggle("on", p.dataset.id == head));
    others.querySelectorAll(".g-pt").forEach(g => {
      const o = ar.find(x => x.id == g.dataset.id), [rx, ry] = o.rules[rule];
      g.style.transform = `translate(${X(rx)}px,${Y(ry)}px)`;
      g.classList.toggle("hide", g.dataset.id == head || gate);
    });
    const [px, py] = point(h);
    mark.style.transform = `translate(${X(px)}px,${Y(py)}px)`;
    const label = mark.querySelector("text");
    label.textContent = `${pct(px)} · ${py.toFixed(1)}%`;
    label.setAttribute("text-anchor", X(px) > W - 90 ? "end" : X(px) < L + 60 ? "start" : "middle");
    barsTitle.textContent = gate ? "在场目标被说成“不在”：门控按你的阈值，生成式头按" + RULES.find(r => r[0] == rule)[1] : `在场目标被说成“不在”：四种坐标写法，都用${RULES.find(r => r[0] == rule)[1]}`;
    bars.replaceChildren(...(gate ? [heads[0]] : []).concat(ar).map(o => {
      const v = o.id == "gate" ? px : o.rules[rule][0];
      return barRow(o, v, 45, pct(v), (o.id == head ? ".on" : "") + (o.id == "gate" ? ".gate" : ""));
    }));
    const g = heads[0];
    say.replaceChildren(...(gate
      ? ["门控：阈值 ", el("b", { text: gateAt.toFixed(2) }), " 时，", el("b", { text: pct(px) }), " 的在场目标被说成“不在”，", el("b", { text: py.toFixed(1) + "%" }),
        " 的无目标表达式被拒掉。同一个底座上，四种坐标写法的曲线和它几乎重合：在 1% 误拒处都拒掉 81–82%，AUROC 都在 96.2–96.7。"]
      : [`${h.label} 词表 + ${RULES.find(r => r[0] == rule)[1]}：`, rule == "map" ? "最多 " : "", el("b", { text: pct(px) }), " 的在场目标被说成“不在”。可它的曲线和门控几乎重合：在 1% 误拒处拒掉 ",
        el("b", { text: h.at1 + "%" }), "（门控 " + g.at1 + "%），AUROC ", el("b", { text: String(h.auroc) }), "（门控 " + g.auroc + "）。模型知道东西在不在，是解码规则在替它选点。"]));
  }

  draw();
  svg.classList.add("pre");
  whenSeen(stage, () => requestAnimationFrame(() => svg.classList.remove("pre")));
}
