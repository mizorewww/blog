// Posts with a ```plot figure (src/plot.go): the build wrote each point's
// values into data-t. Show the point nearest the pointer, within reach of a
// finger, beside it; the point itself is often only a few pixels wide.
let plotTip, plotMark;
const plotHide = () => {
  plotTip?.remove();
  plotMark?.classList.remove("on");
  plotTip = plotMark = null;
};
document.addEventListener("pointermove", e => {
  const svg = e.target.closest?.(".plot-panel svg");
  if (!svg) return plotHide();
  let best, gap = 24;
  for (const el of svg.querySelectorAll("[data-t]")) {
    const b = el.getBoundingClientRect(), d = Math.hypot(b.x + b.width / 2 - e.clientX, b.y + b.height / 2 - e.clientY);
    if (d < gap) [best, gap] = [el, d];
  }
  if (!best) return plotHide();
  if (best == plotMark) return;
  plotHide();
  const panel = svg.closest(".plot-panel"), b = best.getBoundingClientRect(), p = panel.getBoundingClientRect();
  plotMark = best;
  best.classList.add("on");
  plotTip = document.createElement("div");
  plotTip.className = "plot-tip";
  plotTip.textContent = best.dataset.t;
  panel.append(plotTip);
  const x = b.x + b.width / 2 - p.x, y = b.y - p.y;
  plotTip.style.left = Math.min(Math.max(0, x - plotTip.offsetWidth / 2), p.width - plotTip.offsetWidth) + "px";
  plotTip.style.top = (y - plotTip.offsetHeight - 8 < 0 ? y + b.height + 8 : y - plotTip.offsetHeight - 8) + "px";
}, { passive: true });
