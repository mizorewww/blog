// The ECharts theme, shared by the build (scripts/render-figures.py draws the
// static SVG) and the page (echart.js). color(name) turns a token in style.css
// into a color: the page reads the live value, the build a stand-in that
// style.css maps back to the token, so static charts follow the color scheme.
const chartFont = "'Maple Mono','Blog Sans','Blog Sans Late','PingFang SC','Microsoft YaHei',sans-serif";
const chartTheme = color => {
  const label = { color: color("muted"), fontFamily: chartFont, fontSize: 11 };
  const quiet = { show: false };
  const axis = {
    axisLine: { lineStyle: { color: color("line") } },
    axisTick: quiet,
    axisLabel: label,
    splitLine: quiet,
    nameTextStyle: label,
  };
  // On a phone the column is about 324 px: labels that would collide are dropped.
  const value = { ...axis, axisLabel: { ...label, hideOverlap: true }, axisLine: quiet, splitLine: { lineStyle: { color: color("grid"), type: [3, 3] } } };
  return {
    color: ["clay", "stone", "sky", "olive", "kraft", "fig"].map(color),
    backgroundColor: "transparent",
    textStyle: { fontFamily: chartFont, color: color("body") },
    animationDuration: 1100,
    animationEasing: "cubicOut",
    animationDurationUpdate: 400,
    grid: { left: 4, right: 16, top: 40, bottom: 4, containLabel: true },
    legend: { type: "scroll", top: 0, left: 0, icon: "roundRect", itemWidth: 10, itemHeight: 3, itemGap: 18, textStyle: { ...label, color: color("body") }, inactiveColor: color("faint") },
    tooltip: {
      backgroundColor: color("card"),
      borderColor: color("line"),
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: color("ink"), fontFamily: chartFont, fontSize: 11 },
      extraCssText: "border-radius:0;box-shadow:0 4px 14px rgb(0 0 0/.08)",
      axisPointer: { lineStyle: { color: color("muted"), type: "dashed" }, crossStyle: { color: color("muted") }, shadowStyle: { color: color("muted"), opacity: 0.12 } },
    },
    categoryAxis: axis,
    timeAxis: axis,
    logAxis: value,
    valueAxis: value,
    line: { symbol: "circle", symbolSize: 6, showSymbol: false, lineStyle: { width: 2 }, emphasis: { focus: "series" } },
    bar: { barMaxWidth: 32, itemStyle: { borderRadius: 0 } },
    pie: { itemStyle: { borderColor: color("paper"), borderWidth: 2 }, label: { ...label, color: color("body") } },
    scatter: { symbolSize: 8 },
    radar: { axisName: label, splitLine: { lineStyle: { color: color("grid") } }, splitArea: quiet, axisLine: { lineStyle: { color: color("line") } } },
    sankey: { lineStyle: { color: "gradient", opacity: 0.25 }, label: { ...label, color: color("body") }, itemStyle: { borderWidth: 0 } },
    funnel: { label: { ...label, color: color("body") }, itemStyle: { borderColor: color("paper"), borderWidth: 1 } },
    treemap: { breadcrumb: quiet, itemStyle: { borderColor: color("paper"), borderWidth: 2, gapWidth: 2 }, label: { fontFamily: chartFont, fontSize: 11 } },
    heatmap: { itemStyle: { borderColor: color("paper"), borderWidth: 1 } },
    visualMap: { textStyle: label, inRange: { color: [color("wash"), color("clay")] } },
  };
};
