// Posts with a ticker card: load the TradingView chart only when asked.
document.addEventListener("click", e => {
  const button = e.target.closest(".ticker button");
  if (!button) return;
  const card = button.closest(".ticker"), box = document.createElement("div"), s = document.createElement("script");
  box.className = "tv tradingview-widget-container";
  box.style.height = (card.dataset.height || 420) + "px";
  box.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  s.async = true;
  s.textContent = JSON.stringify({
    symbol: card.dataset.symbol, interval: card.dataset.interval || "D", timezone: "Etc/UTC",
    theme: dark() ? "dark" : "light", style: "1", locale: root.lang == "en" ? "en" : "zh_CN",
    allow_symbol_change: false, hide_side_toolbar: true, autosize: true,
  });
  box.append(s);
  card.after(box);
  button.remove();
});
