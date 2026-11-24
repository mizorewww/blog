// Posts with citations (src/cite.go): hovering or focusing [n] previews the
// reference. Touch keeps the plain link, which jumps to the list and back.
let card;
const clearCard = () => {
  card?._for.removeAttribute("aria-describedby");
  card?.remove();
  card = null;
};
const preview = e => {
  const a = e.target.closest?.(".cite a");
  if (e.type == "pointerover" && e.pointerType != "mouse" || !a || card?._for == a) return;
  clearCard();
  const ref = document.getElementById(decodeURIComponent(a.hash.slice(1)))?.cloneNode(true);
  if (!ref) return;
  ref.querySelector(".ref-back")?.remove();
  card = document.createElement("div");
  card.id = (a.id || "cite") + "-tip";
  card.className = "cite-card";
  card.setAttribute("role", "tooltip");
  card._for = a;
  a.setAttribute("aria-describedby", card.id);
  card.innerHTML = `<span>${a.textContent}</span> `;
  card.append(...ref.childNodes);
  document.body.append(card);
  const r = a.getBoundingClientRect(), width = card.offsetWidth;
  card.style.left = scrollX + Math.max(8, Math.min(r.left - 16, innerWidth - width - 8)) + "px";
  card.style.top = scrollY + r.bottom + 6 + "px";
};
const hide = e => {
  if (card && !card.contains(e.relatedTarget) && e.relatedTarget != card._for) clearCard();
};
document.addEventListener("pointerover", preview, { passive: true });
document.addEventListener("focusin", preview);
document.addEventListener("pointerout", e => (e.target.closest?.(".cite a, .cite-card")) && hide(e), { passive: true });
document.addEventListener("focusout", e => e.target.closest?.(".cite a") && hide(e));
document.addEventListener("keydown", e => e.key == "Escape" && hide({}));
