// Posts with citations (src/cite.go): hovering or focusing [n] previews the
// reference. Touch keeps the plain link, which jumps to the list and back.
let card;
const preview = e => {
  const a = e.target.closest?.(".cite a");
  if (e.type == "pointerover" && e.pointerType != "mouse" || !a || card?._for == a) return;
  card?.remove();
  const ref = document.getElementById(decodeURIComponent(a.hash.slice(1)))?.cloneNode(true);
  if (!ref) return;
  ref.querySelector(".ref-back")?.remove();
  card = document.createElement("div");
  card.className = "cite-card";
  card.setAttribute("role", "tooltip");
  card._for = a;
  card.innerHTML = `<span>${a.textContent}</span> `;
  card.append(...ref.childNodes);
  document.body.append(card);
  const r = a.getBoundingClientRect(), width = card.offsetWidth;
  card.style.left = scrollX + Math.max(8, Math.min(r.left - 16, innerWidth - width - 8)) + "px";
  card.style.top = scrollY + r.bottom + 6 + "px";
};
const hide = e => {
  if (card && !card.contains(e.relatedTarget) && e.relatedTarget != card._for) {
    card.remove();
    card = null;
  }
};
document.addEventListener("pointerover", preview, { passive: true });
document.addEventListener("focusin", preview);
document.addEventListener("pointerout", e => (e.target.closest?.(".cite a, .cite-card")) && hide(e), { passive: true });
document.addEventListener("focusout", e => e.target.closest?.(".cite a") && hide(e));
document.addEventListener("keydown", e => e.key == "Escape" && hide({}));
