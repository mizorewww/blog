// Posts with an ```echarts figure (src/figures.go): the build drew each one as
// static SVG. After load, ECharts is fetched once a figure comes near, and
// takes the figure over as it scrolls into view, so the chart draws itself in
// and answers the pointer. Figures on screen at load are swapped without
// animating; if ECharts never arrives, the static drawing stays.
const figures = [...document.querySelectorAll(".echart")];
const color = name => getComputedStyle(root).getPropertyValue("--" + name).trim();
const live = v => typeof v == "string" ? v.replace(/var\(--([\w-]+)\)/g, (m, name) => color(name) || m)
  : Array.isArray(v) ? v.map(live)
  : v && typeof v == "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, live(x)]))
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
  plot.textContent = "";
  echarts.registerTheme("blog", chartTheme(color));
  figure.chart = echarts.init(plot, "blog", { renderer: "svg" });
  figure.chart.setOption({ ...live(JSON.parse(figure.querySelector("script").textContent)), animation: animate });
  figure.classList.remove("wait");
};
const show = async (figure, animate) => {
  if (figure.chart) return;
  try {
    await load();
  } catch {
    return figure.classList.remove("wait");
  }
  draw(figure, animate);
};
addEventListener("load", () => {
  const near = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) {
      near.unobserve(e.target);
      load().catch(() => {});
    }
  }), { rootMargin: "50% 0px" });
  const seen = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) {
      seen.unobserve(e.target);
      show(e.target, true);
    }
  }), { threshold: 0.35 });
  for (const figure of figures) {
    const box = figure.getBoundingClientRect();
    if (box.top < innerHeight && box.bottom > 0) {
      show(figure, false);
      continue;
    }
    figure.classList.add("wait");
    near.observe(figure);
    seen.observe(figure);
  }
});
const redraw = () => figures.forEach(f => f.chart && draw(f, false));
new MutationObserver(redraw).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
const resized = new ResizeObserver(entries => entries.forEach(e => e.target.closest(".echart").chart?.resize()));
figures.forEach(f => resized.observe(f.querySelector(".figure-plot")));
