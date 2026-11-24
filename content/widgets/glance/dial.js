// Same backbone, same data, same steps; only the output head differs
// (dial.json, from outputs/ablation/*/rows.json). Each curve is what one head
// knows: every threshold on its own P("not here"). A decoding rule picks one
// point on that curve, and which point depends on the coordinate vocabulary.
import { el, EN, json, pills, slider, pct, whenSeen } from "./common.js";

const HEAD_EN = { gate: "Gated", digits: "Digits", hier: "Hier.", atomic100: "Atomic 100", atomic1000: "Atomic 1000" };
const RULES = EN
  ? [["greedy", "Greedy"], ["threshold", "Threshold 0.5"], ["map", "Full-string MAP"]]
  : [["greedy", "贪心解码"], ["threshold", "阈值 0.5"], ["map", "整串比较"]];
const RULE_TEXT = EN ? {
  greedy: "Pick the top token at each step; count as “not present” if the first token is none",
  threshold: "Count as “not present” when P(none) ≥ 0.5",
  map: "Full-set approximation to Rule A: compare P(none) against the greedy coordinate string's sequence probability; matches exact search on the sampled subset",
} : {
  greedy: "每一步取最可能的 token，第一个 token 是 none 就算“不在”",
  threshold: "P(none) ≥ 0.5 就算“不在”",
  map: "规则 A 的近似（全量）：整串 none 和贪心解出的坐标串比概率，大的赢；在抽样子集上和精确搜索几乎一致",
};

export default async function dial(stage, { base }) {
  const data = await json(base, "dial.json");
  const rawHeads = data.heads.map(h => ({ ...h, name: EN ? (HEAD_EN[h.id] || h.label) : h.label }));
  const ar = ["digits", "hier", "atomic1000", "atomic100"].map(id => rawHeads.find(h => h.id == id));
  const heads = [rawHeads.find(h => h.id == "gate"), ...ar];
  let head = "digits", rule = "map", gateAt = 0.5;

  const W = 440, H = 314, L = 46, R = 12, T = 22, B = 50;
  const xmin = Math.log10(0.05), xmax = Math.log10(60), ymin = 55, ymax = 100;
  const X = v => L + (Math.log10(Math.max(v, 0.05)) - xmin) / (xmax - xmin) * (W - L - R);
  const Y = v => T + (ymax - v) / (ymax - ymin) * (H - T - B);
  const svg = el("svg.g-dial-chart", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": EN ? "ROC curves of five output heads showing false rejection vs. absent-target rejection across decoding rules" : "五个输出头在不同解码规则下的误拒率与无目标拒答率曲线" });
  const grid = el("g.g-grid");
  for (const v of [0.1, 0.3, 1, 3, 10, 30]) grid.append(el("line", { x1: X(v), x2: X(v), y1: T, y2: H - B }), el("text.g-tick", { x: X(v), y: H - B + 15, "text-anchor": "middle", text: v + "%" }));
  for (const v of [60, 70, 80, 90, 100]) grid.append(el("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v) }), el("text.g-tick", { x: L - 6, y: Y(v) + 3.5, "text-anchor": "end", text: v + "%" }));
  grid.append(
    el("text.g-axis-name", { x: (L + W - R) / 2, y: H - 5, "text-anchor": "middle", text: EN ? "Present targets called “not present” (log)" : "在场的目标，被说成“不在”（对数轴）" }),
    el("text.g-axis-name.y", { x: 12, y: (T + H - B) / 2, "text-anchor": "middle", transform: `rotate(-90 12 ${(T + H - B) / 2})`, text: EN ? "Absent targets rejected (N-acc)" : "没有的目标，说对了“不在”" }));
  const path = h => h.curve.filter(c => c[0] >= 0.05).map((c, i) => `${i ? "L" : "M"}${X(c[0]).toFixed(1)} ${Y(c[1]).toFixed(1)}`).join("");
  const curves = el("g", {}, ...heads.map(h => el("path.g-curve", { d: path(h), "data-id": h.id })));
  const others = el("g", {}, ...ar.map(h => el("g.g-pt.small", { "data-id": h.id }, el("circle", { r: 4 }))));
  const mark = el("g.g-pt.big", {}, el("circle.g-halo", { r: 13 }), el("circle", { r: 6.5 }), el("text.g-pt-label", { x: 0, y: -14, "text-anchor": "middle" }));
  svg.append(grid, curves, others, mark);

  const bars = el("div.g-bars");
  const barsTitle = el("p.g-side-title");
  const say = el("p.g-dial-say", { "aria-live": "polite" });
  const ruleNote = el("p.g-dial-rule");
  const gateDial = slider({ label: EN ? "Gate threshold P(present)" : "门控的阈值 P(present)", value: gateAt, min: 0.02, max: 0.98, oninput: v => { gateAt = v; draw(); } });
  const headPills = pills(heads.map(h => [h.id, h.name]), head, id => { head = id; draw(); });
  const rulePills = pills(RULES, rule, id => { rule = id; draw(); });

  stage.append(el("div.g-card.g-dial", {},
    el("div.g-dial-controls", {},
      el("div.g-ctl", {}, el("span.g-ctl-name", { text: EN ? "Head" : "输出头" }), headPills),
      el("div.g-ctl.g-ctl-rule", {}, el("span.g-ctl-name", { text: EN ? "Decoding" : "解码规则" }), rulePills, gateDial)),
    ruleNote,
    el("div.g-dial-body", {},
      el("div.g-dial-plot", {}, el("p.g-yname", { text: EN ? "Y-axis: absent targets rightly rejected" : "纵轴：没有的目标，说对了“不在”" }), svg),
      el("div.g-dial-side", {},
        barsTitle, bars)),
    say));

  const barRow = (h, value, max, text, cls = "") => el("div.g-bar-row" + cls, { "data-id": h.id },
    el("span.g-bar-name", { text: h.name }), el("span.g-bar-track", {}, el("i", { style: `width:${Math.min(100, value / max * 100)}%` })), el("b", { text }));

  function gatePoint() {
    const c = heads[0].curve;
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
    ruleNote.textContent = gate
      ? (EN ? "The gate outputs a single scalar P(present) with no decoding rule: drag the threshold and the operating point moves smoothly along the curve." : "门控只有一个数 P(present)，没有解码规则可选：阈值你来定，点沿着曲线走。")
      : RULE_TEXT[rule] + (EN ? "." : "。");
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
    const rName = RULES.find(r => r[0] == rule)[1];
    barsTitle.textContent = EN
      ? (gate ? `Present targets rejected: gate at your threshold vs. generative heads (${rName})` : `Present targets rejected: 4 coordinate vocabularies under ${rName}`)
      : (gate ? "在场目标被说成“不在”：门控按你的阈值，生成式头按" + rName : `在场目标被说成“不在”：四种坐标写法，都用${rName}`);
    bars.replaceChildren(...(gate ? [heads[0]] : []).concat(ar).map(o => {
      const v = o.id == "gate" ? px : o.rules[rule][0];
      return barRow(o, v, 45, pct(v), (o.id == head ? ".on" : "") + (o.id == "gate" ? ".gate" : ""));
    }));
    const g = heads[0];
    say.replaceChildren(...(EN
      ? (gate
          ? ["Gated head at threshold ", el("b", { text: gateAt.toFixed(2) }), ": ", el("b", { text: pct(px) }), " of present targets are rejected, while ", el("b", { text: py.toFixed(1) + "%" }),
            " of no-target expressions are rightly rejected. On the same backbone, all four coordinate vocabularies trace nearly the same curve: 81–82% N-acc at 1% false rejection, AUROC 96.2–96.7."]
          : [`${h.name} + ${rName}: `, rule == "map" ? "~" : "", el("b", { text: pct(px) }), " of present targets are called “not present.” Yet its underlying curve nearly overlaps the gate: at 1% false rejection it rejects ",
            el("b", { text: h.at1 + "%" }), ` (gate ${g.at1}%), AUROC `, el("b", { text: String(h.auroc) }), ` (gate ${g.auroc}). The model knows whether the object is there—the decoding rule picks the point.`])
      : (gate
          ? ["门控：阈值 ", el("b", { text: gateAt.toFixed(2) }), " 时，", el("b", { text: pct(px) }), " 的在场目标被说成“不在”，", el("b", { text: py.toFixed(1) + "%" }),
            " 的无目标表达式被拒掉。同一个底座上，四种坐标写法的曲线和它几乎重合：在 1% 误拒处都拒掉 81–82%，AUROC 都在 96.2–96.7。"]
          : [`${h.name} 词表 + ${rName}：`, rule == "map" ? "约 " : "", el("b", { text: pct(px) }), " 的在场目标被说成“不在”。可它的曲线和门控几乎重合：在 1% 误拒处拒掉 ",
            el("b", { text: h.at1 + "%" }), "（门控 " + g.at1 + "%），AUROC ", el("b", { text: String(h.auroc) }), "（门控 " + g.auroc + "）。模型知道东西在不在，是解码规则在替它选点。"])));
  }

  draw();
  svg.classList.add("pre");
  whenSeen(stage, () => requestAnimationFrame(() => svg.classList.remove("pre")));
}
