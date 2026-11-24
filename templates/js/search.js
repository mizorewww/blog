// The search page: filter the listed posts with search.json, fetched on first use.
{
  const f = document.querySelector(".search-form"), q = f.q, status = document.querySelector(".search-status");
  const rows = [...document.querySelectorAll(".post-row")];
  let index;
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
    const sorted = [...terms].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    let n = 0;
    for (const r of rows) {
      const d = data[r.dataset.path], text = d.x, bodyLower = text.toLowerCase(), lower = d.t.toLowerCase() + " " + bodyLower;
      const ok = terms.every(t => lower.includes(t)), s = r.querySelector(".snippet");
      r.hidden = !ok;
      if (!ok) continue;
      n++;
      const hits = terms.map(t => bodyLower.indexOf(t)).filter(i => i >= 0);
      const at = hits.length ? Math.min(...hits) : -1;
      s.hidden = at < 0;
      if (at >= 0) {
        const from = Math.max(0, at - 48), slice = text.slice(from, at + 96);
        const nodes = [];
        if (from) nodes.push("…");
        let last = 0;
        for (const m of slice.matchAll(pattern)) {
          if (m.index > last) nodes.push(slice.slice(last, m.index));
          const mark = document.createElement("mark");
          mark.textContent = m[0];
          nodes.push(mark);
          last = m.index + m[0].length;
        }
        nodes.push(slice.slice(last) + "…");
        s.replaceChildren(...nodes);
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
