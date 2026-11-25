// Interactive Anki review deck (# Cards): click any [cN] pill to toggle all
// matching cN blanks on that card, or reveal/hide the entire deck at once.
{
  const syncCard = card => {
    const clozes = card.querySelectorAll(".cloze");
    if (clozes.length) {
      const allOpen = [...clozes].every(b => b.getAttribute("aria-expanded") === "true");
      card.classList.toggle("is-solved", allOpen);
    }
  };
  addEventListener("click", e => {
    const cloze = e.target.closest(".cloze");
    if (cloze) {
      const card = cloze.closest(".anki-card");
      const open = cloze.getAttribute("aria-expanded") !== "true";
      const targets = new Set((cloze.dataset.c || "").split(",").filter(Boolean));
      if (card && targets.size) {
        for (const b of card.querySelectorAll(".cloze")) {
          if ((b.dataset.c || "").split(",").some(c => targets.has(c))) {
            b.setAttribute("aria-expanded", open ? "true" : "false");
          }
        }
        syncCard(card);
      } else {
        cloze.setAttribute("aria-expanded", open ? "true" : "false");
      }
      return;
    }
    const act = e.target.closest("[data-cards-act]");
    if (act) {
      const deck = act.closest(".cards-deck");
      if (!deck) return;
      const reveal = act.dataset.cardsAct === "reveal";
      for (const b of deck.querySelectorAll(".cloze")) {
        b.setAttribute("aria-expanded", reveal ? "true" : "false");
      }
      for (const d of deck.querySelectorAll("details.anki-back")) {
        d.open = reveal;
      }
      for (const card of deck.querySelectorAll(".anki-card")) {
        syncCard(card);
      }
    }
  });
  const openHashDeck = () => {
    if (location.hash === "#cards") {
      const deck = document.getElementById("cards");
      if (deck && deck.tagName === "DETAILS") deck.open = true;
    }
  };
  openHashDeck();
  addEventListener("hashchange", openHashDeck);
}
