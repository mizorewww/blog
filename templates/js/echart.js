// Posts with an ```echarts figure (src/figures.go): the build drew each one as
// static SVG. After load, ECharts is fetched once a figure comes near, and
// takes the figure over as it scrolls into view, so the chart draws itself in
// and answers the pointer. Figures on screen at load are swapped without
// animating. A figure is hidden for its entrance only once ECharts is here;
// if ECharts never arrives, or cannot draw, the static drawing stays.
const figures = [...document.querySelectorAll(".echart")];
const color = name => getComputedStyle(root).getPropertyValue("--" + name).trim();
// Options are JSON, so valueFormatter, which ECharts calls, is written as a template: "{value}%".
const live = v => typeof v == "string" ? v.replace(/var\(--([\w-]+)\)/g, (m, name) => color(name) || m)
  : Array.isArray(v) ? v.map(live)
  : v && typeof v == "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) =>
    [k, k == "valueFormatter" && typeof x == "string" ? value => x.replaceAll("{value}", value) : live(x)]))
  : v;
let library;
const load = () => library ??= new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "{{echarts}}";
  script.onload = () => resolve(window.echarts);
  script.onerror = reject;
  document.head.append(script);
});
const draw = (figure, animate) => {
  figure.chart?.dispose();
  const plot = figure.querySelector(".figure-plot");
  figure.still ??= plot.innerHTML;
  plot.textContent = "";
  try {
    echarts.registerTheme("blog", chartTheme(color));
    figure.chart = echarts.init(plot, "blog", { renderer: "svg" });
    figure.chart.setOption({ ...live(JSON.parse(figure.querySelector("script").textContent)), animation: animate });
  } catch {
    figure.chart?.dispose();
    figure.chart = null;
    plot.innerHTML = figure.still;
  }
  figure.classList.remove("wait");
};
const onScreen = figure => {
  const box = figure.getBoundingClientRect();
  return box.top < innerHeight && box.bottom > 0;
};
const show = async (figure, animate) => {
  if (figure.drawn) return;
  figure.drawn = true;
  try {
    await load();
  } catch {
    return;
  }
  draw(figure, animate);
};
addEventListener("load", () => {
  const near = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) {
      near.unobserve(e.target);
      load().then(() => e.target.drawn || onScreen(e.target) || e.target.classList.add("wait"), () => {});
    }
  }), { rootMargin: "50% 0px" });
  const seen = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) {
      seen.unobserve(e.target);
      show(e.target, true);
    }
  }), { threshold: 0.35 });
  for (const figure of figures) {
    if (onScreen(figure)) {
      show(figure, false);
      continue;
    }
    near.observe(figure);
    seen.observe(figure);
  }
});
const redraw = () => figures.forEach(f => f.chart && draw(f, false));
new MutationObserver(redraw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
const resized = new ResizeObserver(entries => entries.forEach(e => e.target.closest(".echart").chart?.resize()));
figures.forEach(f => resized.observe(f.querySelector(".figure-plot")));
