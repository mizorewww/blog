// Every page: late fonts, the theme toggle and code copy buttons.
const root = document.documentElement;
// The page's "Late" font subsets (src/fonts.go) switch on at the first scroll,
// or soon after load; phones wait so the first paint keeps the network.
const late = () => root.classList.add("late");
addEventListener("scroll", late, { once: true, passive: true });
addEventListener("load", () => setTimeout(late, matchMedia("(min-width:901px)").matches ? 0 : 1500));
const dark = () => (root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) == "dark";
document.addEventListener("click", async e => {
  const button = e.target.closest("button");
  if (button?.matches(".theme")) {
    root.dataset.theme = dark() ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme) } catch {}
  } else if (button?.matches(".copy")) {
    const pre = button.closest(".code").querySelector("pre").cloneNode(true);
    pre.querySelectorAll(".ln").forEach(n => n.remove());
    try {
      await navigator.clipboard.writeText(pre.textContent);
      button.textContent = "copied";
    } catch {
      button.textContent = "failed";
    }
    setTimeout(() => button.textContent = "copy", 1600);
  }
});
