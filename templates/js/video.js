// Posts with a ```video autoplay="true" clip (src/video.go): play it, muted and
// looping, while half of it is on screen, and pause it when it leaves. A
// reader who prefers reduced motion, or who paused it, starts it themselves.
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const clips = new IntersectionObserver(entries => entries.forEach(e => {
    const v = e.target;
    if (e.isIntersecting && !v.held) v.play().catch(() => {});
    else if (!e.isIntersecting && !v.paused) {
      v.auto = true;
      v.pause();
    }
  }), { threshold: 0.5 });
  for (const v of document.querySelectorAll("video[data-autoplay]")) {
    // A pause the reader asked for sticks; one from scrolling away does not.
    v.addEventListener("pause", () => {
      v.held = !v.auto;
      v.auto = false;
    });
    v.addEventListener("play", () => { v.held = false; });
    clips.observe(v);
  }
}
