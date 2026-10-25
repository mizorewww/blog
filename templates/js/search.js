// The search page: filter the listed posts with search.json, fetched on first use.
{
  const f = document.querySelector(".search-form"), q = f.q, status = document.querySelector(".search-status");
  const rows = [...document.querySelectorAll(".post-row")];
  let index;
  const esc = s => s.replace(/[&<>"]/g, c => "&#" + c.charCodeAt(0) + ";");
  const load = () => index ??= fetch(f.dataset.index).then(r => r.json());
  const run = async () => {
    const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    history.replaceState(null, "", terms.length ? "?q=" + encodeURIComponent(q.value) : location.pathname);
    if (!terms.length) {
      rows.forEach(r => {
        r.hidden = false;
        r.querySelector(".snippet").hidden = true;
      });
      status.textContent = "";
      return;
    }
    const data = await load();
    const pattern = new RegExp(terms.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    let n = 0;
    for (const r of rows) {
      const d = data[r.dataset.path], text = d.x, lower = (d.t + " " + text).toLowerCase();
      const ok = terms.every(t => lower.includes(t)), s = r.querySelector(".snippet");
      r.hidden = !ok;
      if (!ok) continue;
      n++;
      const at = text.toLowerCase().indexOf(terms[0]);
      s.hidden = at < 0;
      if (at >= 0) {
        const from = Math.max(0, at - 48);
        s.innerHTML = (from ? "…" : "") + esc(text.slice(from, at + 96)).replace(pattern, "<mark>$&</mark>") + "…";
      }
    }
    status.textContent = n ? f.dataset.found.replace("%d", n) : f.dataset.none;
  };
  q.addEventListener("input", run);
  q.addEventListener("focus", load, { once: true });
  f.addEventListener("submit", e => {
    e.preventDefault();
    run();
  });
  const initial = new URLSearchParams(location.search).get("q");
  if (initial) {
    q.value = initial;
    run();
  }
}
