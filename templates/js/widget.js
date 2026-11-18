// Posts with a ```widget figure (src/widget.go): the build left a still
// picture of it. After load, each figure's own module is imported once the
// figure comes near, its stylesheet (data-style, beside it) is linked,
// and the module's default export draws into the figure's stage:
//   export default (stage, { figure, base }) => { … }
// The still stays until the module has drawn; if it fails, the still stays.
const widgets = [...document.querySelectorAll(".widget[data-src]")];
const linked = new Set();
const style = (base, name) => !name || linked.has(base + name) || (linked.add(base + name), new Promise(done => {
  const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: base + name });
  link.onload = link.onerror = done;
  document.head.append(link);
}));
const mount = async figure => {
  const src = new URL(figure.dataset.src, location.href), base = new URL(".", src).href;
  const stage = figure.querySelector(".widget-stage");
  try {
    const [module] = await Promise.all([import(src.href), style(base, figure.dataset.style)]);
    // Hold the still's height while the module swaps it out, so the text below stays put.
    stage.style.minHeight = stage.offsetHeight + "px";
    const live = document.createElement("div");
    live.className = "widget-live";
    stage.append(live);
    await module.default(live, { figure, base });
    figure.classList.add("live");
    requestAnimationFrame(() => stage.style.minHeight = "");
  } catch (error) {
    figure.querySelector(".widget-live")?.remove();
    stage.style.minHeight = "";
    console.warn("widget", figure.dataset.src, error);
  }
};
addEventListener("load", () => {
  const near = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) {
      near.unobserve(e.target);
      mount(e.target);
    }
  }), { rootMargin: "600px 0px" });
  widgets.forEach(figure => near.observe(figure));
});
