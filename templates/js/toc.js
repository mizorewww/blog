// Posts with a table of contents: mark the section being read.
{
  const toc = document.querySelector(".toc");
  const links = new Map([...toc.querySelectorAll("a")].map(a => [decodeURIComponent(a.hash.slice(1)), a]));
  const heads = [...document.querySelectorAll(".prose :is(h2,h3)[id]")].filter(h => links.has(h.id));
  let current, queued;
  const update = () => {
    queued = false;
    let h;
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) h = heads.at(-1);
    else for (const x of heads) {
      if (x.getBoundingClientRect().top > innerHeight * .3) break;
      h = x;
    }
    const a = h && links.get(h.id);
    if (a == current) return;
    current?.removeAttribute("aria-current");
    current = a;
    if (!a) return;
    a.setAttribute("aria-current", "location");
    if (toc.scrollHeight > toc.clientHeight) toc.scrollTop = a.offsetTop - toc.clientHeight / 2;
  };
  addEventListener("scroll", () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  addEventListener("resize", update);
  update();
}
