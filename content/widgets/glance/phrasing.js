// The same thing, asked different ways (phrasing.json: real outputs).
// On a tidy picture every wording works; on a crowded table the answer
// flips with the wording.
import { el, EN, json, image, fmt, pills, credit } from "./common.js";

const LABEL = EN
  ? { cake: "Iced coffee & cake", umbrella: "Dinner under umbrella", editor: "App UI" }
  : { cake: "冰咖啡和蛋糕", umbrella: "伞下的晚饭", editor: "软件界面" };

const GROUP_EN = {
  "甜点": "Dessert",
  "喝的": "Drink",
  "图里没有的": "Not in image",
  "番茄酱": "Ketchup",
  "面包": "Bread",
  "导出": "Export",
  "保存": "Save",
  "取消": "Cancel",
};

const ASK_EN = {
  "甜点": "甜点 (dessert)",
  "甜的东西": "甜的东西 (sweet)",
  "喝的东西": "喝的东西 (drink)",
  "饮料": "饮料 (beverage)",
  "披萨": "披萨 (pizza)",
  "番茄酱": "番茄酱 (ketchup)",
  "水瓶": "水瓶 (bottle)",
  "面包": "面包 (bread)",
  "导出按钮": "导出按钮 (Export)",
  "对话框里的保存按钮": "对话框里的保存按钮 (Save)",
  "取消按钮": "取消按钮 (Cancel)",
};

export default async function phrasing(stage, { base }) {
  const data = await json(base, "phrasing.json");
  const pics = await Promise.all(data.scenes.map(s => image(base + s.image)));
  let scene = 0, sel = [0, 0];
  const shot = el("div.g-shot.seen");
  const groups = el("div.g-groups");
  const credits = el("div.g-credits");
  const tabs = pills(data.scenes.map((s, i) => [i, LABEL[s.id]]), 0, i => { scene = +i; sel = [0, 0]; draw(); });
  stage.append(el("div.g-card.g-phr", {}, tabs, el("div.g-phr-body", {}, shot, groups), credits));

  const askText = t => EN && ASK_EN[t] ? ASK_EN[t] : t;

  function draw() {
    const s = data.scenes[scene], [w, h] = s.size;
    const ask = s.groups[sel[0]].asks[sel[1]];
    const [x1, y1, x2, y2] = ask.box, l = Math.max(0, x1) / w * 100, t = Math.max(0, y1) / h * 100;
    const yes = ask.p >= 0.5;
    shot.replaceChildren(el("div.g-shot-frame", { style: `aspect-ratio:${w}/${h}` },
      el("img", { src: pics[scene].src, alt: "" }),
      el("div.g-box.static" + (yes ? "" : ".maybe"), { style: `--c:var(--${yes ? "clay" : "stone"});left:${l}%;top:${t}%;width:${Math.min(100, x2 / w * 100) - l}%;height:${Math.min(100, y2 / h * 100) - t}%` },
        el("span.g-box-tag" + (t < 9 ? ".in" : ""), {}, el("span", { text: yes ? askText(ask.text) : (EN ? "says not present" : "它说不在") }), el("b", { text: fmt(ask.p) })))));
    groups.replaceChildren(...s.groups.map((g, gi) => el("div.g-group", {},
      el("p.g-group-name", { text: EN ? (GROUP_EN[g.label] || g.label) : g.label }),
      el("ol", {}, ...g.asks.map((a, ai) => el("li", {}, el("button.g-say" + (a.p >= 0.5 ? "" : ".no"), {
        type: "button", "aria-pressed": String(gi == sel[0] && ai == sel[1]),
        on: { click: () => { sel = [gi, ai]; draw(); }, pointerenter: () => { sel = [gi, ai]; draw(); } },
      }, el("span.g-say-text", { text: askText(a.text) }), el("span.g-say-bar", {}, el("i", { style: `width:${a.p * 100}%` })), el("b", { text: fmt(a.p) }))))))));
    credits.replaceChildren(credit(s.credit));
  }
  draw();
}
