// The about page: copy the PGP public key or EVM wallet address.
document.addEventListener("click", async e => {
  const button = e.target.closest("[data-copy]");
  if (!button) return;
  const target = document.getElementById(button.dataset.copy);
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.textContent.trim());
    button.classList.add("copied");
    clearTimeout(button._t);
    button._t = setTimeout(() => button.classList.remove("copied"), 1600);
  } catch {}
});
