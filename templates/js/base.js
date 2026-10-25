// Every page: late fonts, the theme toggle and code copy buttons.
const root = document.documentElement;
// The page's "Late" font subsets (src/fonts.go) switch on at the first scroll,
// or soon after load; phones wait so the first paint keeps the network.
const late = () => root.classList.add("late");
addEventListener("scroll", late, { once: true, passive: true });
addEventListener("load", () => setTimeout(late, matchMedia("(min-width:901px)").matches ? 0 : 1500));
const dark = () => (root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) == "dark";
document.addEventListener("click", async e => {
  const button = e.target.closest("button");
  if (button?.matches(".theme")) {
    root.dataset.theme = dark() ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme) } catch {}
  } else if (button?.matches(".copy")) {
    const pre = button.closest(".code").querySelector("pre").cloneNode(true);
    pre.querySelectorAll(".ln").forEach(n => n.remove());
    try {
      await navigator.clipboard.writeText(pre.textContent);
      button.textContent = "copied";
    } catch {
      button.textContent = "failed";
    }
    setTimeout(() => button.textContent = "copy", 1600);
  }
});
// Page transitions (style.css): the rules on screen are named top to bottom,
// so each slides to its place on the next page. A rule without a partner
// merges into, or splits from, the nearest one. Switching language cross-fades.
const rules = () => {
  const all = [...document.querySelectorAll(".rule")];
  all.forEach(r => r.style.viewTransitionName = "");
  return all.map(r => [r, r.getBoundingClientRect()]).filter(([, b]) => b.height && b.bottom > 0 && b.top < innerHeight).map(([r, b], i) => {
    r.style.viewTransitionName = "rule-" + i;
    return [b.left, b.top];
  });
};
addEventListener("pageswap", e => {
  if (!e.viewTransition) return;
  try { sessionStorage.setItem("rules", JSON.stringify(rules())) } catch {}
});
addEventListener("pagereveal", async e => {
  const t = e.viewTransition;
  if (!t) return;
  const from = window.navigation?.activation?.from?.url, other = document.querySelector("a[hreflang]");
  if (from && other && new URL(from).pathname == new URL(other.href).pathname) t.types.add("swap");
  let was = [];
  try { was = JSON.parse(sessionStorage.getItem("rules")) || [] } catch {}
  const now = rules();
  if (!was.length || !now.length) return;
  await t.ready;
  const near = (list, y) => list.reduce((a, b) => Math.abs(b[1] - y) < Math.abs(a[1] - y) ? b : a);
  const slide = (i, a, b) => root.animate({ transform: [a, b].map(([x, y]) => `translate(${x}px,${y}px)`) }, { duration: 400, easing: "cubic-bezier(.4,0,.2,1)", fill: "both", pseudoElement: `::view-transition-group(rule-${i})` });
  was.forEach((p, i) => i >= now.length && slide(i, p, near(now, p[1])));
  now.forEach((p, i) => i >= was.length && slide(i, near(was, p[1]), p));
});
