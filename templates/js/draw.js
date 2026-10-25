// Posts with bold text: each paragraph's underline draws itself the first
// time it scrolls into view. Without scripts, or with reduced motion, the
// underlines are simply there.
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const seen = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) {
      e.target.classList.replace("undrawn", "drawn");
      seen.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -15% 0px" });
  for (const p of new Set([...document.querySelectorAll(".prose p>strong")].map(s => s.parentNode))) {
    p.classList.add("undrawn");
    seen.observe(p);
  }
}
