// Posts with a chart: show the values nearest the pointer (src/chart.go writes data-tip).
let tip;
document.addEventListener("pointermove", e => {
  const plot = e.target.closest?.(".plot[data-tip]");
  if (!plot) {
    tip?.remove();
    tip = null;
    return;
  }
  const d = plot._tip ??= JSON.parse(plot.dataset.tip), r = plot.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 100;
  let i = 0;
  d.x.forEach((v, j) => { if (Math.abs(v - x) < Math.abs(d.x[i] - x)) i = j });
  if (!tip || tip.parentNode != plot) {
    tip?.remove();
    tip = document.createElement("div");
    tip.className = "tip";
    tip.innerHTML = "<i></i><div></div>";
    plot.append(tip);
  }
  tip.style.left = d.x[i] + "%";
  tip.classList.toggle("flip", d.x[i] > 60);
  const shown = d.s.filter(s => s.v[i]);
  tip.lastChild.innerHTML = "<b></b>" + shown.map(() => "<span><i></i><em></em></span>").join("");
  tip.lastChild.firstChild.textContent = d.l[i];
  shown.forEach((s, k) => {
    const row = tip.lastChild.children[k + 1];
    row.firstChild.style.background = s.c;
    row.lastChild.textContent = (d.s.length > 1 ? s.n + " " : "") + s.v[i];
  });
}, { passive: true });
