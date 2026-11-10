{"title":"省一点，再省一点","description":"两个住在 Telegram 群里的 bot，三个月、七万多次模型调用的账本：在 LLM 应用中，成本、上下文与代码量在物理上是同一种通货。每一处极致的克制，最后都会兑现为纯粹的自由与体验。","date":"2026-11-05","updated":"2026-11-10","tag":"技术","tags":["llm","telegram","prompt-caching","agent","架构设计","成本优化"],"draft":false}
---

我们群里住着两个 bot。

一个是我写的 [Pi Telegram Agent](https://github.com/mizorewww/pi-extension-telegram-agent)，另一个是群友 tcdw（碗）写的[塑料碗](https://github.com/tuuject/surowan)。两个项目没有共享一行代码，架构取向、技术栈乃至交互性格截然相反，但在长达数月的真实群聊碰撞中，两个系统的演进轨迹却不谋而合地收敛到同一句戒律：**省一点，再省一点。**

很多人以为“省”是一种对资源的妥协，是一种扣扣搜搜的工程自虐。恰恰相反，在过去三个月与七万多次线上模型调用的敲打中，我越来越深信：**在 LLM 驱动的系统里，“省”其实是最高级的设计美学。**

当你把系统表层的浮夸脚手架一层层剥开，你会发现：代码、上下文与云端账单，本质上只是同一种物理实体——**Token**——在不同维度上的投影。凡是繁复的机制，往往意味着高昂的熵增与脆弱；而每一处经由严格逻辑推导出来的克制，最终都会在体验与能力上，兑现出惊人的轻盈与通透。

这篇文章，是一份来自高频生产环境的真实账本复盘，也是一次从表象到本质的抽丝剥茧。

## TL;DR

- **统一的通货假设：** 账单是 token，上下文是 token，代码在 coding agent 眼里也是 token。三者不是割裂的管理目标，而是同一个守恒方程在不同维度的映射。
- **解剖账单的大头：** 74,644 次调用揭示了一个冷酷的现实——**输入是输出的 374 倍**。群聊 bot 的账本近九成是聊天历史，工具 schema 仅占 1.1%。系统的生死线，全维系在“上下文长度”与“缓存命中率”上。
- **剥离感知与思考（控制调用量 $N$）：** 被点名即回是确定性逻辑，无需智力；旁听消息要不要接，抽离给只读最后几行切片的专用小模型（每次约 1,650 token、$0.000033），绝不污染主模型上下文。动作发完立即借由原语本地终止，将非必要往返压死在平均每轮 1.13 次调用。
- **字节级的偏执（守卫命中率 $h$）：** 严格前缀单调递增，不可篡改。动态贴纸与媒体更新通过只读元数据与 `beforeRequest` 投影为不入历史库的〔系统附注〕。以 55 个版本的 Golden Hash 严酷回归，将 DeepSeek 实测缓存命中率钉在 98.7%，费用直接砍至原本的三十分之一。
- **原话胜于妄语（压缩上下文深度 $T$）：** 放弃所有花哨的多层记忆抽取与图数据库。前沿研究与线上血泪同时证实：加工过的摘要不仅昂贵，而且会自生毒化。窗口定格在 128K，历史沉睡在 SQLite 原文里，给 bot 一个干净的工作台，不懂就让它自己查：记得原词按字面查，只记得大概就按意思查，查回来的永远是原话。
- **将克制兑现为自由：** 省下来的资源不是存折里的数字，而是极致的体验——`codemode` 让它“边说边做”并行检索；一个 rootless 的纯净 Linux 容器让模型调度系统原生能力，胜过手写一百个专用插件。
- **代码本身的断舍离：** 凡不属于“Telegram 群聊语义”的代码，一行都不自造。依托底层 Pi 原生引擎，`src/` 从 17,500 行提纯至 8,100 行，负代码带来了更稳固的韧性。
- **两种通用的哲学对照：** 塑料碗走的是“通用的产品，克制的 Agent”；我选择“专用的部署，通用的 Agent”。

---

## 账本的凝视：真实的钱在往哪里流

一切设计美学，都必须建立在对物理现实的冷酷凝视之上。

从 8 月 7 日上线到 11 月 4 日架构换代，我的 bot 在生产环境中无死角地记下了每一次模型调用的遥测：输入大小、缓存命中读、输出量，以及请求内各切段的实际占比。三个月跑下来，总账单的轮廓如下：

```stats title="三个月的账本" meta="2026-08-07 — 2026-11-04 · 两个 bot · 一个群" note="输入 token 含命中缓存的部分。"
## 规模
群友消息 | 144,148 | 路由开始记录后的人类消息
模型调用 | 74,644 | 含 11,544 次压缩调用
公开发言 | 39,615 | send 次数
## Token
输入 | 5.34B | 其中缓存读取 3.50B
输出 | 14.3M | 输入是输出的 374 倍
每轮调用 | 1.13 | 非压缩调用 ÷ 开启的轮次
```

**输入是输出的 374 倍。**

这是每一个初涉 LLM 群聊系统的人都会遭遇的第一记重锤。在人机交互的直觉里，我们总以为“对话”是抛出一句话、换回一句话的对称游戏。然而在多人高频的群聊里，真相极度残酷：群友发了一句“哈哈确实”，模型就必须把沉重的 system prompt、工具定义以及整段漫长的群聊历史完整咀嚼一遍，最后经过几层思考，在群里发出两个字或者选择闭嘴。

**群聊系统的账单，在物理本质上几乎全部由“读”构成。**

这三个月里，主模型前后用过三家：先是 DeepSeek V4 Flash，八月底换到 Gemini Flash，九月底再换到 SWE-2。下面的每一个数字，都是这三家一起记下的：

```echarts title="每周的模型调用，按主模型" height="320" note="不含压缩调用。按北京时间的自然周，第一周从 8 月 7 日上线算起；数据来自截至 11 月 1 日的本地快照，比上文的账本少最后三天，最后一周不完整。另有 521 次 GLM、GPT mini 等试用调用没有画出。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "legend": {},
  "xAxis": {"type": "category", "data": ["08-07", "08-10", "08-17", "08-24", "08-31", "09-07", "09-14", "09-21", "09-28", "10-05", "10-12", "10-19", "10-26"]},
  "yAxis": {"type": "value", "axisLabel": {"formatter": "{value}"}},
  "series": [
    {"name": "DeepSeek V4 Flash", "type": "bar", "stack": "calls", "itemStyle": {"color": "var(--clay)"}, "data": [3154, 7664, 6590, 1675, 0, 0, 0, 0, 0, 0, 0, 0, 0]},
    {"name": "Gemini Flash", "type": "bar", "stack": "calls", "itemStyle": {"color": "var(--sky)"}, "data": [0, 0, 0, 3223, 5196, 3959, 4471, 5033, 392, 0, 0, 0, 0]},
    {"name": "SWE-2", "type": "bar", "stack": "calls", "itemStyle": {"color": "var(--olive)"}, "data": [0, 0, 0, 0, 0, 0, 0, 0, 5706, 4601, 4819, 2511, 1857]}
  ]
}
```

那么，这数百亿的 token 到底在读什么？我们抽样分析了四万多次真实请求的切片，并与我之前改造 [Memoh](/posts/making-memoh-cheaper-on-telegram/) 时的单次请求放在一起对照：

```sketch title="一次请求里都装了什么" note="本项目：40,593 次请求的平均值，平均每次 93,067 token；Memoh 改造前：抓到的一次请求，按字节计。虚线框是一次请求的全部输入，高度按比例。"
<svg viewBox="0 0 704 336">
<rect class="panel" x="0" y="0" width="704" height="336" rx="12"/>
<text class="caps" x="28" y="30">本项目</text>
<text class="small" x="28" y="50">40,593 次请求的平均 · 93,067 token</text>
<rect class="window" x="28" y="66" width="176" height="248" rx="8"/>
<g class="node blue"><rect x="36" y="74.00" width="160" height="23.66" rx="1"/></g>
<g class="node orange"><rect x="36" y="97.66" width="160" height="2.55" rx="1"/></g>
<g class="node violet"><rect x="36" y="100.22" width="160" height="4.87" rx="1"/></g>
<g class="node plain"><rect x="36" y="105.09" width="160" height="200.91" rx="3"/></g>
<rect x="46.0" y="115.1" width="77.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="46.0" y="130.1" width="98.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="127.2" y="145.1" width="58.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="46.0" y="160.1" width="86.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="46.0" y="175.1" width="70.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="109.0" y="190.1" width="77.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="46.0" y="205.1" width="98.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="46.0" y="220.1" width="58.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="99.2" y="235.1" width="86.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="46.0" y="250.1" width="70.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="46.0" y="265.1" width="77.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="88.0" y="280.1" width="98.0" height="7" rx="3.5" fill="var(--line)"/>
<path class="edge " d="M200 85.8 H214"/>
<text class="small" x="218" y="85.832">system prompt <tspan class="b">10.2%</tspan></text>
<path class="edge " d="M200 98.9 H210 V103.8 H214"/>
<text class="small" x="218" y="103.832">工具 schema <tspan class="b">1.1%</tspan></text>
<path class="edge " d="M200 102.7 H210 V121.8 H214"/>
<text class="small" x="218" y="121.832">压缩摘要 <tspan class="b">2.1%</tspan></text>
<path class="edge " d="M200 205.5 H214"/>
<text class="small" x="218" y="205.544">聊天历史 <tspan class="b">86.6%</tspan></text>
<text class="caps" x="372" y="30">Memoh 改造前</text>
<text class="small" x="372" y="50">抓到的一次请求 · 按字节</text>
<rect class="window" x="372" y="66" width="176" height="248" rx="8"/>
<g class="node blue"><rect x="380" y="74.00" width="160" height="24.82" rx="1"/></g>
<g class="node orange"><rect x="380" y="98.82" width="160" height="49.42" rx="1"/></g>
<g class="node plain"><rect x="380" y="148.24" width="160" height="157.76" rx="3"/></g>
<rect x="390.0" y="158.2" width="77.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="390.0" y="173.2" width="98.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="471.2" y="188.2" width="58.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="390.0" y="203.2" width="86.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="390.0" y="218.2" width="70.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="453.0" y="233.2" width="77.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="390.0" y="248.2" width="98.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="390.0" y="263.2" width="58.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="443.2" y="278.2" width="86.8" height="7" rx="3.5" fill="var(--line)"/>
<path class="edge " d="M544 86.4 H558"/>
<text class="small" x="562" y="86.412">system prompt <tspan class="b">10.7%</tspan></text>
<path class="edge " d="M544 123.5 H558"/>
<text class="small" x="562" y="123.532">工具 schema <tspan class="b">21.3%</tspan></text>
<path class="edge " d="M544 227.1 H558"/>
<text class="small" x="562" y="227.12">聊天历史 <tspan class="b">68.0%</tspan></text>
<text class="small" x="562" y="245.12">压缩摘要 0%</text>
</svg>
<svg viewBox="0 0 340 556">
<rect class="panel" x="0" y="0" width="340" height="556" rx="12"/>
<text class="caps" x="16" y="22">本项目</text>
<text class="small" x="16" y="42">40,593 次请求的平均 · 93,067 token</text>
<rect class="window" x="16" y="58" width="140" height="212" rx="8"/>
<g class="node blue"><rect x="24" y="66.00" width="124" height="19.99" rx="1"/></g>
<g class="node orange"><rect x="24" y="85.99" width="124" height="2.16" rx="1"/></g>
<g class="node violet"><rect x="24" y="88.15" width="124" height="4.12" rx="1"/></g>
<g class="node plain"><rect x="24" y="92.26" width="124" height="169.74" rx="3"/></g>
<rect x="34.0" y="102.3" width="57.2" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="117.3" width="72.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="94.3" y="132.3" width="43.7" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="147.3" width="64.5" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="162.3" width="52.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="80.8" y="177.3" width="57.2" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="192.3" width="72.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="207.3" width="43.7" height="7" rx="3.5" fill="var(--line)"/>
<rect x="73.5" y="222.3" width="64.5" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="237.3" width="52.0" height="7" rx="3.5" fill="var(--line)"/>
<path class="edge " d="M152 76.0 H166"/>
<text class="small" x="170" y="75.996">system prompt <tspan class="b">10.2%</tspan></text>
<path class="edge " d="M152 87.1 H162 V94.0 H166"/>
<text class="small" x="170" y="93.996">工具 schema <tspan class="b">1.1%</tspan></text>
<path class="edge " d="M152 90.2 H162 V112.0 H166"/>
<text class="small" x="170" y="111.996">压缩摘要 <tspan class="b">2.1%</tspan></text>
<path class="edge " d="M152 177.1 H166"/>
<text class="small" x="170" y="177.132">聊天历史 <tspan class="b">86.6%</tspan></text>
<text class="caps" x="16" y="294">Memoh 改造前</text>
<text class="small" x="16" y="314">抓到的一次请求 · 按字节</text>
<rect class="window" x="16" y="330" width="140" height="212" rx="8"/>
<g class="node blue"><rect x="24" y="338.00" width="124" height="20.97" rx="1"/></g>
<g class="node orange"><rect x="24" y="358.97" width="124" height="41.75" rx="1"/></g>
<g class="node plain"><rect x="24" y="400.72" width="124" height="133.28" rx="3"/></g>
<rect x="34.0" y="410.7" width="57.2" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="425.7" width="72.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="94.3" y="440.7" width="43.7" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="455.7" width="64.5" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="470.7" width="52.0" height="7" rx="3.5" fill="var(--line)"/>
<rect x="80.8" y="485.7" width="57.2" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="500.7" width="72.8" height="7" rx="3.5" fill="var(--line)"/>
<rect x="34.0" y="515.7" width="43.7" height="7" rx="3.5" fill="var(--line)"/>
<path class="edge " d="M152 348.5 H166"/>
<text class="small" x="170" y="348.486">system prompt <tspan class="b">10.7%</tspan></text>
<path class="edge " d="M152 379.8 H166"/>
<text class="small" x="170" y="379.846">工具 schema <tspan class="b">21.3%</tspan></text>
<path class="edge " d="M152 467.4 H166"/>
<text class="small" x="170" y="467.36">聊天历史 <tspan class="b">68.0%</tspan></text>
<text class="small" x="170" y="485.36">压缩摘要 0%</text>
</svg>
```

这张图给所有自以为是的“架构优化”泼了一盆冷水：
很多人热衷于优化 Prompt 措辞、精简两句 system prompt，或者把工具名字改短几个字符——但哪怕你把工具 schema 优化到极致，它在真实请求里也仅仅占 1.1%。

**整个系统的总成本，受控于一个极简的数学模型：**

$$
C = N \times T \times \left[(1-h) + h \times r\right]
$$

- $N$：模型被叫醒的次数（调用量）；
- $T$：每次被叫醒时必须吞吐的上下文深度（输入 token）；
- $h$：上下文命中 Prompt Cache 的比例（缓存命中率）；
- $r$：服务商缓存计费与原价的比值（DeepSeek 达到夸张的 1/50，Claude 为 1/10）。

这个公式是不可动摇的底座。在工程实现上，你能够发力的自由度只有三处：

1. **少叫醒它（缩减 $N$）**；
2. **读过的必须逐字节锁死（拉高 $h$）**；
3. **每次读的必须洗尽铅华（压低 $T$）**。

下面，我们将顺着这三个变量，一层一层剥开我们关于“克制与自由”的架构选择。

---

## 剥开第一层：控制调用量 $N$ —— 别为“沉默与等待”付全价

最便宜的调用，是**从未发生的调用**。

群聊与单人私聊最本质的区别在于：群聊是一个公共流动的信息洪流，其中绝大多数内容与 bot 根本无关。而且这股洪流几乎不停：只有凌晨四点到六点几乎没人说话，晚上十点以后最热闹。

```echarts title="群友什么时候说话" height="300" note="人类消息数，按北京时间的星期和两小时时段统计，共 141,717 条。来自 bot 数据库截至 11 月 1 日中午的本地快照，比上文截至 11 月 4 日的账本少最后三天。越接近橙色，消息越多。"
{
  "tooltip": {"position": "top"},
  "grid": {"top": 8, "bottom": 4, "left": 4, "right": 8},
  "xAxis": {"type": "category", "data": ["0点", "2点", "4点", "6点", "8点", "10点", "12点", "14点", "16点", "18点", "20点", "22点"], "splitArea": {"show": false}},
  "yAxis": {"type": "category", "inverse": true, "data": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]},
  "visualMap": {"show": false, "min": 0, "max": 5500},
  "series": [{
    "name": "消息", "type": "heatmap",
    "emphasis": {"itemStyle": {"borderColor": "var(--ink)", "borderWidth": 1}},
    "data": [
      [0,0,2380],[1,0,716],[2,0,137],[3,0,178],[4,0,1118],[5,0,1509],[6,0,1869],[7,0,1172],[8,0,1752],[9,0,2581],[10,0,2975],[11,0,4122],
      [0,1,976],[1,1,237],[2,1,48],[3,1,175],[4,1,1106],[5,1,1694],[6,1,1796],[7,1,1866],[8,1,1927],[9,1,2282],[10,1,2748],[11,1,3033],
      [0,2,2377],[1,2,620],[2,2,72],[3,2,407],[4,2,1332],[5,2,2115],[6,2,2457],[7,2,1487],[8,2,2759],[9,2,2335],[10,2,3392],[11,2,3604],
      [0,3,1572],[1,3,690],[2,3,25],[3,3,233],[4,3,1222],[5,3,1581],[6,3,1549],[7,3,1894],[8,3,1928],[9,3,2596],[10,3,1784],[11,3,2517],
      [0,4,1835],[1,4,485],[2,4,44],[3,4,176],[4,4,723],[5,4,1200],[6,4,2030],[7,4,1491],[8,4,1599],[9,4,1982],[10,4,2571],[11,4,5429],
      [0,5,3133],[1,5,664],[2,5,48],[3,5,161],[4,5,835],[5,5,1764],[6,5,1904],[7,5,1656],[8,5,2657],[9,5,2433],[10,5,2257],[11,5,2771],
      [0,6,2423],[1,6,1723],[2,6,52],[3,6,81],[4,6,449],[5,6,1577],[6,6,2285],[7,6,2238],[8,6,2136],[9,6,2263],[10,6,4283],[11,6,3414]
    ]
  }]
}
```

再看这三个月里从消息流入到最终发言的残酷漏斗：

```data title="从群友消息到模型调用" bars="数量" note="开启的轮次 = 路由判定为 started 的消息数；模型调用不含压缩。"
阶段 | 数量
群友消息 | 144,148
bot 正忙，消息并入下一轮 | 50,532
开启一轮 | 55,776
模型调用 | 63,100
公开发言 | 39,615
```

漏斗底层赫然摆着一个事实：14.4 万条群聊消息，bot 公开发言不到 4 万次。甚至在开启思考的 5.5 万轮对话里，也有一万六千多次是模型读完全文后，体面地选择了沉默。

这就引出了第一组尖锐的矛盾：
**怎么知道该不该接话？如果决定接话，怎么让这一轮迅速了结？**

### 抽丝剥茧：分寸感不需要 9 万 Token 的全景记忆

“要不要接话”看似是一个玄学问题，拆开来看，其实是两种截然不同的场景：

1. **确定性场景：** 人类明确 @ 它、回复它的消息、直呼其名。这里没有模糊空间，一行确定性的代码或正则路由就能判定，**不应该浪费任何模型的一毫秒去推理**。
2. **旁听场景：** 剩下的海量闲聊，它需要的是“分寸感”。

那么，什么叫群聊里的分寸感？观察一个真实的人类群友：

- 有人向全群抛出了一个技术疑难，空悬了三分钟没人理；
- 有人正接着 bot 上半截话继续追问；
- 两个人正在亲密地约饭闲聊，话题非常私密且闭环；
- 别的 bot 已经给出了完美解答；
- 几个 bot 在互相咬尾巴复读。

**审视这些场景，你会得出一个惊人的结论：做这些决断，根本不需要 bot 知道自己是谁，不需要知道三个月前群里发生了什么，更不需要携带厚重的工具箱。它仅仅取决于——最近五到十行消息的语境流动。**

市面上的常见解法在这个推论面前露出了破绽：

- **方案 A：全交由主模型判断。** 叫醒一次主模型，意味着拖家带口扛起 93,000 token 的沉重包袱。主模型思考两秒说一句“我不该插嘴”，你就要为这句“沉默”支付近十万 token 的全额代价。十四万次闲聊乘上去，账本直接爆表。
- **方案 B：全交由规则与概率闸门。** 掷骰子或者硬匹配关键词确实免费，但它没有理解力。在技术求助时它装聋作哑，在群友严肃悼念或发火时它却可能依据 10% 的概率突然跳出来讲个烂梗。

我们要的解法必然落在两者的交界处：**它必须有语义理解能力，但它只能读切片；它只需要给出一个概率，不需要吐出文字。**

顺着约束推演，答案呼之欲出：**引入专职的分类器小模型。**

```mermaid title="一条群友消息怎么决定要不要叫醒主模型" note="被点名走确定性路由，不经过任何模型；其余消息只把最近几行交给判断模型，主模型的上下文和缓存都不受影响。"
flowchart TD
  M[群友消息] --> Q{"@ / 回复 / 叫名字？"}
  Q -- 是 --> A["主模型<br/>完整上下文，约 9.3 万 token"]
  Q -- 否 --> D["判断模型<br/>只读最近 6 行，约 1,650 token"]
  D -- 概率 ≥ 阈值 --> A
  D -- 概率 < 阈值 --> S[静默围观]
  A --> R[发言或沉默]
```

我选用的是 OpenRouter 上的专用小分类模型 `pplx-decider-v1.2`（在 Pi 1.5 原生 classify 抽象下驱动）。它便宜在三个不可替代的维度：

1. **只喂切片：** 仅截取新到的几条消息，附带前 6 行作为背景，剥离全部 system prompt、历史长程上下文与工具声明。
2. **前缀隔离：** 它的调用是完全独立的短请求。主模型的核心上下文没有动过一个字节，**主模型的 Prompt Cache 纹丝不动**。
3. **极小成本：** 单次决策仅耗费约 1,650 token（大部分是固定的 few-shot 示例），成本约 $0.000033，耗时数百毫秒。即便群里 14.4 万条消息全判一遍，总开销也不过 $4.7。

```echarts title="判断一次“要不要接话”，要读多少 token" height="200" note="主模型取账本里的平均请求，判断模型是带上全部例子后的实测。每千次的费用：判断模型 $0.033；主模型取决于用哪个模型，约 $0.26 到 $1.50 以上。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "grid": {"top": 8, "right": 64},
  "xAxis": {"type": "value", "axisLabel": {"formatter": "{value}"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["主模型读全文", "判断模型读切片"]},
  "series": [{
    "name": "输入", "type": "bar", "barWidth": 24,
    "label": {"show": true, "position": "right", "formatter": "{c}", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [{"value": 93067, "label": {"formatter": "93,067"}}, {"value": 1650, "label": {"formatter": "1,650"}, "itemStyle": {"color": "var(--clay)"}}]
  }]
}
```

判断模型是 11 月 5 日才上线的。在那之前的三个月，旁听消息靠的是一个按概率掷骰子的闸门——账本清楚地记下了它的代价：几乎每一轮都是骰子放进来的，而每一轮都要主模型把九万多 token 从头读一遍。

```echarts title="判断模型上线前，每一轮是谁叫醒的" height="300" note="路由记录里判定为 started 的消息，按触发原因统计，共 54,457 轮；同一份截至 11 月 1 日的本地快照，所以比上面漏斗里的数字少最后三天。同期另有 50,362 条消息因 bot 正忙并入下一轮，4,849 条处于冷却期被跳过。"
{
  "tooltip": {"trigger": "item"},
  "series": [{
    "name": "触发原因", "type": "pie", "radius": ["40%", "62%"], "center": ["50%", "54%"],
    "label": {"formatter": "{b}\n{d}%", "lineHeight": 16},
    "labelLine": {"length": 10, "length2": 14},
    "data": [
      {"name": "概率闸门放行", "value": 52323, "itemStyle": {"color": "var(--clay)"}},
      {"name": "被回复", "value": 1394, "itemStyle": {"color": "var(--stone)"}},
      {"name": "被叫名字", "value": 644, "itemStyle": {"color": "var(--kraft)"}},
      {"name": "被 @", "value": 96, "itemStyle": {"color": "var(--sky)"}}
    ]
  }]
}
```

小模型缺乏常识深度，如何确保分寸？**用高密度的典型示例（few-shot）补齐。**
在 `src/agent/decider.ts` 中，我们精心凝练了 14 条覆盖群聊典型微动态的通用示例，模型召回率直接从 0.53 跃升至 0.71。

更有趣的美学发现来自于**阈值**的调优：
当我们试图把提示词改得更热情、试图让模型“更想说话”时，我们发现整个概率曲线只是在噪声区间平移，反而多耗费了两成 token。这验证了控制论里的经典法则：**分类模型负责相对排序，阈值负责投射性格。**
想要一个冷峻少言的极客 bot，把阈值抬到 0.45；想要一个活跃捧场的温暖群友，把阈值降到 0.15。提示词不需要反复推倒，代码的纯粹性由此得以保全。

### 发完即走：杜绝通用 Agent 的自言自语

把模型叫醒后，另一个巨大的浪费潜伏在“动作执行”的链条里。

通用 Agent 框架往往有着严重的“汇报强迫症”：
模型执行了 `send()` 之后，框架把 Telegram 发送成功的 JSON 作为 tool result 丢回给模型，模型再次加载整整 9 万 token，心满意足地向人类汇报一句：“我已经把消息发出去啦！”

在个人助手的终端里，这或许叫严谨；但在高频的 Telegram 群聊里，这纯属灾难。不仅浪费了一整轮调用，更致命的是，群里绝不允许出现模型的自言自语或思考废话。

我们立下了两条铁律：

1. **私密思考，显式发言：** 模型的原生 Assistant 文本永远留在控制台内，**唯有显式调用 `send` 工具，消息才会穿透到群聊**。模型读完上下文后选择不发，本轮便无声终结。
2. **终端原语截断（Terminal Send）：** 一旦单条 `send` 投递成功，底层直接调用 Pi 原生的 terminate 机制，**强行截断循环，拒绝再次返回模型**。

```sketch title="发完就结束，不回头汇报" note="通用 agent 把发送结果交回模型，模型再全量读一遍上下文，只为汇报一句“发好了”。本项目里 send 成功就由 Pi 的 terminate 结束这一轮；模型不调用 send 时，它写的文本只留在控制台。"
<svg viewBox="0 0 704 404">
<rect class="panel" x="0" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="24" y="28">通用 agent 循环</text>
<g class="node "><rect x="51" y="48" width="240" height="46" rx="4"/><text class="mid b" x="171" y="63">主模型</text><text class="mid small" x="171" y="80">读 9.3 万 token</text></g>
<circle class="glyph" cx="65" cy="68" r="2.4"/><circle class="glyph" cx="65" cy="74" r="2.4"/><circle class="glyph" cx="73" cy="65" r="2.4"/><circle class="glyph" cx="73" cy="71" r="2.4"/><circle class="glyph" cx="73" cy="77" r="2.4"/><circle class="glyph" cx="81" cy="68" r="2.4"/><circle class="glyph" cx="81" cy="74" r="2.4"/>
<path class="edge " d="M171 96 V118" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="81" y="122" width="180" height="30" rx="4"/><text class="mid" x="171" y="137">send</text></g>
<path class="edge " d="M171 154 V176" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="81" y="180" width="180" height="30" rx="4"/><text class="mid small" x="171" y="195">tool result：发送成功</text></g>
<path class="edge " d="M171 212 V234" marker-end="url(#arrow)"/>
<g class="node "><rect x="51" y="238" width="240" height="46" rx="4"/><text class="mid b" x="171" y="253">主模型</text><text class="mid small" x="171" y="270">再读 9.3 万 + 结果</text></g>
<circle class="glyph" cx="65" cy="258" r="2.4"/><circle class="glyph" cx="65" cy="264" r="2.4"/><circle class="glyph" cx="73" cy="255" r="2.4"/><circle class="glyph" cx="73" cy="261" r="2.4"/><circle class="glyph" cx="73" cy="267" r="2.4"/><circle class="glyph" cx="81" cy="258" r="2.4"/><circle class="glyph" cx="81" cy="264" r="2.4"/>
<path class="edge " d="M171 286 V308" marker-end="url(#arrow)"/>
<g class="node clay"><rect x="51" y="312" width="240" height="30" rx="4"/><text class="mid small" x="171" y="327">“我已经把消息发出去啦！”</text></g>
<text class="small mid accent" x="171" y="372">多一轮全价调用，群里多一句废话</text>
<rect class="panel" x="362" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="386" y="28">本项目</text>
<g class="node "><rect x="413" y="48" width="240" height="46" rx="4"/><text class="mid b" x="533" y="63">主模型</text><text class="mid small" x="533" y="80">读 9.3 万 token</text></g>
<circle class="glyph" cx="427" cy="68" r="2.4"/><circle class="glyph" cx="427" cy="74" r="2.4"/><circle class="glyph" cx="435" cy="65" r="2.4"/><circle class="glyph" cx="435" cy="71" r="2.4"/><circle class="glyph" cx="435" cy="77" r="2.4"/><circle class="glyph" cx="443" cy="68" r="2.4"/><circle class="glyph" cx="443" cy="74" r="2.4"/>
<path class="edge " d="M533 96 V118" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="443" y="122" width="180" height="30" rx="4"/><text class="mid" x="533" y="137">send</text></g>
<path class="edge " d="M533 154 V176" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="413" y="180" width="240" height="46" rx="4"/><text class="mid b" x="533" y="195">terminate</text><text class="mid small" x="533" y="212">send 成功，这一轮到此为止</text></g>
<text class="small mid" x="533" y="262">不调用 send 时：</text>
<text class="small mid" x="533" y="280">assistant 文本只留在控制台，</text>
<text class="small mid" x="533" y="298">这一轮无声结束</text>
<text class="small mid accent" x="533" y="372">平均每轮 1.13 次调用</text>
</svg>
<svg viewBox="0 0 340 824">
<rect class="panel" x="0" y="0" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="28">通用 agent 循环</text>
<g class="node "><rect x="50" y="48" width="240" height="46" rx="4"/><text class="mid b" x="170" y="63">主模型</text><text class="mid small" x="170" y="80">读 9.3 万 token</text></g>
<circle class="glyph" cx="64" cy="68" r="2.4"/><circle class="glyph" cx="64" cy="74" r="2.4"/><circle class="glyph" cx="72" cy="65" r="2.4"/><circle class="glyph" cx="72" cy="71" r="2.4"/><circle class="glyph" cx="72" cy="77" r="2.4"/><circle class="glyph" cx="80" cy="68" r="2.4"/><circle class="glyph" cx="80" cy="74" r="2.4"/>
<path class="edge " d="M170 96 V118" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="80" y="122" width="180" height="30" rx="4"/><text class="mid" x="170" y="137">send</text></g>
<path class="edge " d="M170 154 V176" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="80" y="180" width="180" height="30" rx="4"/><text class="mid small" x="170" y="195">tool result：发送成功</text></g>
<path class="edge " d="M170 212 V234" marker-end="url(#arrow)"/>
<g class="node "><rect x="50" y="238" width="240" height="46" rx="4"/><text class="mid b" x="170" y="253">主模型</text><text class="mid small" x="170" y="270">再读 9.3 万 + 结果</text></g>
<circle class="glyph" cx="64" cy="258" r="2.4"/><circle class="glyph" cx="64" cy="264" r="2.4"/><circle class="glyph" cx="72" cy="255" r="2.4"/><circle class="glyph" cx="72" cy="261" r="2.4"/><circle class="glyph" cx="72" cy="267" r="2.4"/><circle class="glyph" cx="80" cy="258" r="2.4"/><circle class="glyph" cx="80" cy="264" r="2.4"/>
<path class="edge " d="M170 286 V308" marker-end="url(#arrow)"/>
<g class="node clay"><rect x="50" y="312" width="240" height="30" rx="4"/><text class="mid small" x="170" y="327">“我已经把消息发出去啦！”</text></g>
<text class="small mid accent" x="170" y="372">多一轮全价调用，群里多一句废话</text>
<rect class="panel" x="0" y="420" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="448">本项目</text>
<g class="node "><rect x="50" y="468" width="240" height="46" rx="4"/><text class="mid b" x="170" y="483">主模型</text><text class="mid small" x="170" y="500">读 9.3 万 token</text></g>
<circle class="glyph" cx="64" cy="488" r="2.4"/><circle class="glyph" cx="64" cy="494" r="2.4"/><circle class="glyph" cx="72" cy="485" r="2.4"/><circle class="glyph" cx="72" cy="491" r="2.4"/><circle class="glyph" cx="72" cy="497" r="2.4"/><circle class="glyph" cx="80" cy="488" r="2.4"/><circle class="glyph" cx="80" cy="494" r="2.4"/>
<path class="edge " d="M170 516 V538" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="80" y="542" width="180" height="30" rx="4"/><text class="mid" x="170" y="557">send</text></g>
<path class="edge " d="M170 574 V596" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="50" y="600" width="240" height="46" rx="4"/><text class="mid b" x="170" y="615">terminate</text><text class="mid small" x="170" y="632">send 成功，这一轮到此为止</text></g>
<text class="small mid" x="170" y="682">不调用 send 时：</text>
<text class="small mid" x="170" y="700">assistant 文本只留在控制台，</text>
<text class="small mid" x="170" y="718">这一轮无声结束</text>
<text class="small mid accent" x="170" y="792">平均每轮 1.13 次调用</text>
</svg>
```

正是这个坚决的截断，让三个月的平均每轮调用数被死死锁在 **1.13 次**。多出来的 0.13 次，仅仅用于处理被点名却忘了 `send` 时的单次自我纠偏。

面对网络超时的未知状态，很多工程师习惯无脑重试。但在 Telegram 这一端，发送消息是一个不可逆的非幂等行为。一旦消息已在服务端生成而本地超时，重试就会导致群里出现两条一模一样的弱智复读。
我们的工程准则极其决绝：**只有在确定性的 4xx 错误且未提交任何负载时才允许重试；其余一切网络未知，一律标记为 `no_retry`，就地休工。** 。

```sketch title="发送失败时，只有一种情况可以重试" note="只有确定的 4xx 错误、并且消息还没交出去时才重试；其余情况一律不重试。"
<svg viewBox="0 0 704 216">
<rect class="panel" x="0" y="0" width="704" height="216" rx="12"/>
<g class="node clay"><rect x="24" y="74" width="120" height="40" rx="20"/><text class="mid" x="84" y="94">send 失败</text></g>
<path class="edge " d="M146 94 H178" marker-end="url(#arrow)"/>
<g class="node "><rect x="182" y="64" width="220" height="60" rx="4"/><text class="mid b" x="292" y="86">确定是 4xx</text><text class="mid small" x="292" y="103">而且负载还没提交出去？</text></g>
<path class="edge " d="M404 84 H432 V52 H452" marker-end="url(#arrow)"/>
<text class="small mid" x="418" y="70">是</text>
<path class="edge " d="M404 104 H432 V140 H452" marker-end="url(#arrow)"/>
<text class="small mid" x="418" y="118">否</text>
<g class="node teal"><rect x="456" y="32" width="224" height="40" rx="4"/><text class="mid" x="568" y="52">重试</text></g>
<g class="node plain"><rect x="456" y="118" width="224" height="46" rx="4"/><text class="mid b" x="568" y="133">标记 no_retry，就地休工</text><text class="mid small" x="568" y="150">超时和一切网络未知都算这里</text></g>
<text class="small accent" x="24" y="194">发消息不可逆：服务端可能已经发出、只是本地超时，这时重试就是在群里复读一遍。</text>
</svg>
<svg viewBox="0 0 340 352">
<rect class="panel" x="0" y="0" width="340" height="352" rx="12"/>
<g class="node clay"><rect x="110" y="20" width="120" height="40" rx="20"/><text class="mid" x="170" y="40">send 失败</text></g>
<path class="edge " d="M170 62 V84" marker-end="url(#arrow)"/>
<g class="node "><rect x="40" y="88" width="260" height="60" rx="4"/><text class="mid b" x="170" y="110">确定是 4xx</text><text class="mid small" x="170" y="127">而且负载还没提交出去？</text></g>
<path class="edge " d="M120 150 V190" marker-end="url(#arrow)"/>
<text class="small" x="128" y="172">是</text>
<path class="edge " d="M220 150 V190" marker-end="url(#arrow)"/>
<text class="small" x="228" y="172">否</text>
<g class="node teal"><rect x="16" y="194" width="140" height="40" rx="4"/><text class="mid" x="86" y="214">重试</text></g>
<g class="node plain"><rect x="164" y="194" width="160" height="62" rx="4"/><text class="mid b" x="244" y="217">no_retry，就地休工</text><text class="mid small" x="244" y="234">超时、网络未知</text></g>
<text class="small accent" x="16" y="296">发消息不可逆：服务端可能已经发出、</text>
<text class="small accent" x="16" y="314">只是本地超时，这时重试就是在群里</text>
<text class="small accent" x="16" y="332">复读一遍。宁可偶尔漏一句。</text>
</svg>
```

---

## 剥开第二层：拉满缓存命中率 $h$ 

如果说压减调用量是第一道防线，那么 Prompt Caching（提示词缓存）就是决定生死的核心杠杆。

现代主流模型（DeepSeek、Anthropic、OpenAI）的缓存机制在本质上都是**前缀匹配（Prefix Matching）**：
只要你的请求前缀在字节级别与上一轮完全一致，命中部分的价格就会出现断崖式下跌。以 DeepSeek V4 Flash 为例，命中缓存的价格是未命中的整整五十分之一（1/50）。

我们不妨用三个月里实际吞吐的 53.4 亿 token 算一笔现实的账：

```echarts title="同样 53.4 亿输入 token，按 DeepSeek V4 Flash 计价" height="220" note="只算输入；输出 1,430 万 token 另计。98.7% 是实测的命中率，0% 是每次全价重读。这是假设性换算，不是我的实际账单。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "${value}"},
  "grid": {"top": 8, "right": 56},
  "xAxis": {"type": "value", "axisLabel": {"formatter": "${value}"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["不用缓存", "命中 85%", "命中 98.7%"]},
  "series": [{
    "name": "输入费用", "type": "bar", "barWidth": 22,
    "label": {"show": true, "position": "right", "formatter": "${c}", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [748, 125, {"value": 25, "itemStyle": {"color": "var(--clay)"}}]
  }]
}
```

从 85% 到 98.7%，看起来只是百分比上微不足道的十几个点，但费用相差了整整 **5 倍**；而与无缓存的裸奔相比，差距是惊人的 **30 倍**！

```echarts title="同一套前缀，在不同服务商上的缓存命中率" height="240" note="命中率 = 缓存读取 token ÷ 输入 token，不含压缩调用，截至 11 月 1 日的本地快照。DeepSeek 官方 API 3,415 次（8 月 7 日至 10 日），Devin 上的 SWE-2 19,494 次，Antigravity 上的 Gemini Flash 22,274 次。经 ollama-cloud 调用的 DeepSeek（15,668 次）不上报缓存读取，不在图中。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "{value}%"},
  "grid": {"top": 8, "right": 56},
  "xAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["DeepSeek 官方", "SWE-2", "Gemini Flash"]},
  "series": [{
    "name": "缓存命中率", "type": "bar", "barWidth": 22,
    "label": {"show": true, "position": "right", "formatter": "{c}%", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [{"value": 98.7, "itemStyle": {"color": "var(--clay)"}}, 86.3, 58.4]
  }]
}
```

这就是为什么我们在 `AGENTS.md` 里写下了全项目最核心的一条物理硬约束：

> **Cache invariant：永不改写已存在的 provider prefix；动态内容只以新 suffix 追加。每个请求必须是下一请求的严格前缀。**

### 动态信息归宿的纯粹推导

“保持前缀不变”听起来像一句轻巧的口号，但当它迎面撞上真实 Telegram 群聊的混乱现实时，真正的架构拷问才刚刚开始。

最典型的矛盾，莫过于 **Sticker（贴纸）**。

bot 拥有自己的固定常用贴纸库，但群友日常聊天会发出各种千奇百怪的第三方贴纸。当群友发出一张极其生动的表情时，我们希望告诉 bot：“群友发了这张图，如果合适，你这轮也可以用它。”
这显然是一批**每一轮都不一样、不可预知的动态候选数据**。

这批动态信息，应该塞在请求的什么位置？如果我们顺着工程约束层层推理，所有“看似顺手”的方案都会被一一绞杀：

- **错误尝试 1：塞进 System Prompt。**
  直觉上最整洁，但 System Prompt 趴在整个上下文的最开端。你哪怕改动一个字，后面紧随其后的九万多 token 缓存将**瞬间全部粉碎**。
- **错误尝试 2：挂在最后一刻，下一轮替换掉。**
  既然是“当前可用贴纸”，很多人习惯把它作为一个尾巴挂在当前请求的最后；到了下一轮，有了新贴纸，就把旧尾巴切掉，换上新尾巴。
  这个微小的偷懒在线上造成了惨痛的代价：上一次请求的结尾，在下一次请求里消失了。前缀从这里断裂。实测表明，为了省下几十个 token 的贴纸列表，下一轮在刚进入 turn 时就要白白漏掉 **13,600 token** 的冷缓存！
- **错误尝试 3：直接混入聊天记录。**
  既然只能单调追加，那把贴纸信息伪装成正文拼进群友的消息里如何？
  灾难接踵而至：模型读到后，会真诚地认为“群友刚才把我的贴纸库泄露了”，进而在聊天中反复指责群友偷窥它的后台。更致命的是，当会话到达窗口上限触发压缩时，压缩器会把这句“群友泄露了贴纸库”的荒唐推测提炼成固定事实，永远写进长期摘要，造成无法修复的认知污染。

```sketch title="动态信息只有一个位置放得下" note="每一行是放进贴纸列表之后的一次请求；clay 竖线是前缀断开、缓存从那里失效的位置。"
<svg viewBox="0 0 704 288">
<rect class="panel" x="0" y="0" width="704" height="288" rx="12"/>
<text class="caps" x="24" y="24">动态的贴纸列表，放在请求的哪里</text>
<circle cx="32" cy="59" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M29 56 35 62 M35 56 29 62"/>
<text class="b" x="48" y="52">塞进 system prompt</text>
<text class="small accent" x="48" y="70">改一个字，后面九万多 token 的缓存全失效</text>
<g class="node blue"><rect x="352" y="44" width="59.1" height="30" rx="4"/><text class="mid" x="381.55" y="59">system</text></g>
<g class="node orange"><rect x="414.1" y="44" width="47.3" height="30" rx="4"/><text class="mid" x="437.75" y="59">贴纸</text></g>
<g class="node plain"><rect x="464.3" y="44" width="153.6" height="30" rx="4"/><text class="mid" x="541.1" y="59">历史消息</text></g>
<g class="node plain"><rect x="620.9" y="44" width="59.1" height="30" rx="4"/><text class="mid" x="650.45" y="59">新消息</text></g>
<path class="edge hot" d="M412.6 38 V80"/>
<circle cx="32" cy="119" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M29 116 35 122 M35 116 29 122"/>
<text class="b" x="48" y="112">挂在结尾，下一轮换掉</text>
<text class="small accent" x="48" y="130">前缀在换掉的地方断开</text>
<g class="node blue"><rect x="352" y="104" width="57" height="30" rx="4"/><text class="mid" x="380.5" y="119">system</text></g>
<g class="node plain"><rect x="412" y="104" width="148.1" height="30" rx="4"/><text class="mid" x="486.05" y="119">历史消息</text></g>
<g class="node plain"><rect x="563.1" y="104" width="57" height="30" rx="4"/><text class="mid" x="591.6" y="119">新消息</text></g>
<g class="node orange"><rect x="623" y="104" width="57" height="30" rx="4"/><text class="mid" x="651.5" y="119">新贴纸</text></g>
<path class="edge hot" d="M621.5 98 V140"/>
<circle cx="32" cy="179" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M29 176 35 182 M35 176 29 182"/>
<text class="b" x="48" y="172">混进聊天记录</text>
<text class="small accent" x="48" y="190">缓存还在，但模型以为是群友说的，还会被压缩成“事实”</text>
<g class="node blue"><rect x="352" y="164" width="57.5" height="30" rx="4"/><text class="mid" x="380.75" y="179">system</text></g>
<g class="node plain"><rect x="412.5" y="164" width="207.0" height="30" rx="4"/></g>
<text class="" x="422.5" y="179">历史消息</text>
<g class="node orange"><rect x="559.5" y="170" width="52" height="18" rx="3"/><text class="mid small" x="585.5" y="179.0">贴纸</text></g>
<g class="node plain"><rect x="622.5" y="164" width="57.5" height="30" rx="4"/><text class="mid" x="651.25" y="179">新消息</text></g>
<circle cx="32" cy="239" r="8" fill="var(--teal-wash)" stroke="var(--teal)"/><path class="edge" d="M28 239 31 242 36 236" stroke="var(--teal)"/>
<text class="b" x="48" y="232">〔系统附注〕追加在那批输入后</text>
<text class="small " x="48" y="250">只追加、写下不改、有专属标识、不进会话库</text>
<g class="node blue"><rect x="352" y="224" width="59.1" height="30" rx="4"/><text class="mid" x="381.55" y="239">system</text></g>
<g class="node plain"><rect x="414.1" y="224" width="153.6" height="30" rx="4"/><text class="mid" x="490.9" y="239">历史消息</text></g>
<g class="node plain"><rect x="570.7" y="224" width="59.1" height="30" rx="4"/><text class="mid" x="600.25" y="239">新消息</text></g>
<g class="node violet"><rect x="632.7" y="224" width="47.3" height="30" rx="4"/><text class="mid" x="656.35" y="239">附注</text></g>
</svg>
<svg viewBox="0 0 340 486">
<rect class="panel" x="0" y="0" width="340" height="486" rx="12"/>
<text class="caps" x="16" y="22">动态的贴纸列表放在哪</text>
<circle cx="24" cy="50" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M21 47 27 53 M27 47 21 53"/>
<text class="b" x="40" y="50">塞进 system prompt</text>
<text class="small accent" x="40" y="70">改一个字，</text>
<text class="small accent" x="40" y="86">后面九万多 token 的缓存全失效</text>
<g class="node blue"><rect x="16" y="106" width="55.4" height="28" rx="4"/><text class="mid small" x="43.7" y="120">system</text></g>
<g class="node orange"><rect x="74.4" y="106" width="44.3" height="28" rx="4"/><text class="mid small" x="96.55" y="120">贴纸</text></g>
<g class="node plain"><rect x="121.7" y="106" width="144" height="28" rx="4"/><text class="mid small" x="193.7" y="120">历史消息</text></g>
<g class="node plain"><rect x="268.6" y="106" width="55.4" height="28" rx="4"/><text class="mid small" x="296.3" y="120">新消息</text></g>
<path class="edge hot" d="M72.9 100 V140"/>
<circle cx="24" cy="172" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M21 169 27 175 M27 169 21 175"/>
<text class="b" x="40" y="172">挂在结尾，下一轮换掉</text>
<text class="small accent" x="40" y="192">前缀在换掉的地方断开</text>
<g class="node blue"><rect x="16" y="212" width="53.4" height="28" rx="4"/><text class="mid small" x="42.7" y="226">system</text></g>
<g class="node plain"><rect x="72.4" y="212" width="138.8" height="28" rx="4"/><text class="mid small" x="141.8" y="226">历史消息</text></g>
<g class="node plain"><rect x="214.2" y="212" width="53.4" height="28" rx="4"/><text class="mid small" x="240.9" y="226">新消息</text></g>
<g class="node orange"><rect x="270.6" y="212" width="53.4" height="28" rx="4"/><text class="mid small" x="297.3" y="226">新贴纸</text></g>
<path class="edge hot" d="M269.1 206 V246"/>
<circle cx="24" cy="278" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M21 275 27 281 M27 275 21 281"/>
<text class="b" x="40" y="278">混进聊天记录</text>
<text class="small accent" x="40" y="298">缓存还在，</text>
<text class="small accent" x="40" y="314">但模型以为是群友说的，还会被压缩成“事实”</text>
<g class="node blue"><rect x="16" y="334" width="53.9" height="28" rx="4"/><text class="mid small" x="42.95" y="348">system</text></g>
<g class="node plain"><rect x="72.9" y="334" width="194.1" height="28" rx="4"/></g>
<text class="small" x="82.9286" y="348">历史消息</text>
<g class="node orange"><rect x="215.1" y="340" width="44" height="16" rx="3"/><text class="mid small" x="237.1" y="348.0">贴纸</text></g>
<g class="node plain"><rect x="270.1" y="334" width="53.9" height="28" rx="4"/><text class="mid small" x="297.05" y="348">新消息</text></g>
<circle cx="24" cy="400" r="8" fill="var(--teal-wash)" stroke="var(--teal)"/><path class="edge" d="M20 400 23 403 28 397" stroke="var(--teal)"/>
<text class="b" x="40" y="400">〔系统附注〕追加在那批输入后</text>
<text class="small " x="40" y="420">只追加、写下不改、有专属标识、不进会话库</text>
<g class="node blue"><rect x="16" y="440" width="55.4" height="28" rx="4"/><text class="mid small" x="43.7" y="454">system</text></g>
<g class="node plain"><rect x="74.4" y="440" width="144" height="28" rx="4"/><text class="mid small" x="146.4" y="454">历史消息</text></g>
<g class="node plain"><rect x="221.3" y="440" width="55.4" height="28" rx="4"/><text class="mid small" x="249" y="454">新消息</text></g>
<g class="node violet"><rect x="279.7" y="440" width="44.3" height="28" rx="4"/><text class="mid small" x="301.85" y="454">附注</text></g>
</svg>
```

通过这三次碰壁，动态信息的宿命被物理定律锁死在唯一的狭窄缝隙中：

1. **它必须是严格追加的；**
2. **写下之后必须永恒凝固在那个相对位置，往后的轮次必须完整继承，绝不能在中途删改；**
3. **它不能被当成人类发言，必须有专属的系统标识；**
4. **它不能进入持久化数据库的会话主线，以免污染未来的压缩摘要。**

这套严酷的推导，催生了我们最终的请求投影结构：

```sketch title="前缀只追加，缓存才接得上" note="上：正确的投影，第 n+1 次请求完整包含第 n 次。下：把动态列表挂在结尾、下一轮换掉，前缀在换掉的地方断开。"
<svg viewBox="0 0 704 334">
<rect class="panel" x="0" y="0" width="704" height="334" rx="12"/>
<text class="caps" x="24" y="28">只追加：每次请求都是下一次的前缀</text>
<text class="small" x="24" y="69">第 n 次</text>
<g class="node blue"><rect x="112" y="52" width="72" height="34" rx="4"/><text class="mid" x="148" y="69">system</text></g>
<g class="node plain"><rect x="188" y="52" width="236" height="34" rx="4"/><text class="mid" x="306" y="69">历史消息</text></g>
<g class="node violet"><rect x="428" y="52" width="60" height="34" rx="4"/><text class="mid" x="458" y="69">附注</text></g>
<g class="node teal"><rect x="492" y="52" width="64" height="34" rx="4"/><text class="mid" x="524" y="69">输出</text></g>
<rect x="104" y="112" width="454" height="72" rx="8" fill="var(--clay-wash)"/>
<text class="small" x="24" y="137">第 n+1 次</text>
<g class="node blue"><rect x="112" y="120" width="72" height="34" rx="4"/><text class="mid" x="148" y="137">system</text></g>
<g class="node plain"><rect x="188" y="120" width="236" height="34" rx="4"/><text class="mid" x="306" y="137">历史消息</text></g>
<g class="node violet"><rect x="428" y="120" width="60" height="34" rx="4"/><text class="mid" x="458" y="137">附注</text></g>
<g class="node teal"><rect x="492" y="120" width="64" height="34" rx="4"/><text class="mid" x="524" y="137">输出</text></g>
<g class="node plain"><rect x="564" y="120" width="64" height="34" rx="4"/><text class="mid" x="596" y="137">新消息</text></g>
<g class="node violet"><rect x="632" y="120" width="44" height="34" rx="4"/><text class="mid" x="654" y="137">附注</text></g>
<path class="edge dash" d="M558 46 V184"/>
<text class="small accent" x="112" y="172">逐字节相同：命中缓存，DeepSeek 上是 1/50 的价格</text>
<text class="small mid" x="619" y="172">新增：全价</text>
<text class="caps" x="24" y="224">错误做法：每轮换掉结尾的动态列表</text>
<text class="small" x="24" y="271">第 n+1 次</text>
<g class="node blue"><rect x="112" y="254" width="72" height="34" rx="4"/><text class="mid" x="148" y="271">system</text></g>
<g class="node plain"><rect x="188" y="254" width="236" height="34" rx="4"/><text class="mid" x="306" y="271">历史消息</text></g>
<rect class="window" x="428" y="254" width="96" height="34" rx="4"/>
<text class="small mid" x="476" y="271">上一轮的贴纸表</text>
<circle cx="524" cy="254" r="7" fill="var(--card)" stroke="var(--clay)"/>
<path class="edge hot" d="M521 251 527 257 M527 251 521 257"/>
<g class="node plain"><rect x="528" y="254" width="64" height="34" rx="4"/><text class="mid" x="560" y="271">新消息</text></g>
<g class="node orange"><rect x="596" y="254" width="84" height="34" rx="4"/><text class="mid" x="638" y="271">新贴纸表</text></g>
<path class="edge hot" d="M426 246 V296"/>
<text class="small accent" x="112" y="310">前缀从这里断开，后面的每个字节都按全价重读：实测下一轮一开始就漏掉 13,600 token 的缓存</text>
</svg>
<svg viewBox="0 0 340 348">
<rect class="panel" x="0" y="0" width="340" height="348" rx="12"/>
<text class="caps" x="16" y="28">只追加：每次请求都是下一次的前缀</text>
<text class="small" x="16" y="52">第 n 次</text>
<g class="node blue"><rect x="16" y="62" width="48" height="32" rx="4"/><text class="mid small" x="40" y="78">system</text></g>
<g class="node plain"><rect x="67" y="62" width="84" height="32" rx="4"/><text class="mid small" x="109" y="78">历史消息</text></g>
<g class="node violet"><rect x="154" y="62" width="36" height="32" rx="4"/><text class="mid small" x="172" y="78">附注</text></g>
<g class="node teal"><rect x="193" y="62" width="36" height="32" rx="4"/><text class="mid small" x="211" y="78">输出</text></g>
<rect x="8" y="132" width="222.5" height="70" rx="8" fill="var(--clay-wash)"/>
<text class="small" x="16" y="130">第 n+1 次</text>
<g class="node blue"><rect x="16" y="140" width="48" height="32" rx="4"/><text class="mid small" x="40" y="156">system</text></g>
<g class="node plain"><rect x="67" y="140" width="84" height="32" rx="4"/><text class="mid small" x="109" y="156">历史消息</text></g>
<g class="node violet"><rect x="154" y="140" width="36" height="32" rx="4"/><text class="mid small" x="172" y="156">附注</text></g>
<g class="node teal"><rect x="193" y="140" width="36" height="32" rx="4"/><text class="mid small" x="211" y="156">输出</text></g>
<g class="node plain"><rect x="232" y="140" width="52" height="32" rx="4"/><text class="mid small" x="258" y="156">新消息</text></g>
<g class="node violet"><rect x="287" y="140" width="34" height="32" rx="4"/><text class="mid small" x="304" y="156">附注</text></g>
<path class="edge dash" d="M230.5 56 V202"/>
<text class="small accent" x="16" y="190">逐字节相同：命中缓存，1/50 的价格</text>
<text class="small mid" x="277.25" y="190">新增：全价</text>
<text class="caps" x="16" y="226">错误做法：每轮换掉结尾的动态列表</text>
<text class="small" x="16" y="248">第 n+1 次</text>
<g class="node blue"><rect x="16" y="258" width="48" height="32" rx="4"/><text class="mid small" x="40" y="274">system</text></g>
<g class="node plain"><rect x="67" y="258" width="84" height="32" rx="4"/><text class="mid small" x="109" y="274">历史消息</text></g>
<rect class="window" x="154" y="258" width="60" height="32" rx="4"/>
<text class="small mid" x="184" y="274">旧贴纸表</text>
<circle cx="214" cy="258" r="7" fill="var(--card)" stroke="var(--clay)"/>
<path class="edge hot" d="M211 255 217 261 M217 255 211 261"/>
<g class="node plain"><rect x="217" y="258" width="44" height="32" rx="4"/><text class="mid small" x="239" y="274">新消息</text></g>
<g class="node orange"><rect x="264" y="258" width="60" height="32" rx="4"/><text class="mid small" x="294" y="274">新贴纸表</text></g>
<path class="edge hot" d="M152.5 250 V298"/>
<text class="small accent" x="16" y="312">前缀从这里断开，后面全部按全价重读：</text>
<text class="small accent" x="16" y="330">实测下一轮一开始就漏掉 13,600 token 的缓存</text>
</svg>
```

在一次真实的请求体中，它呈现为这种极其工整的韵律：

```sketch title="一次真实的请求" note="节选，删去了群友的用户名和贴纸的强度描述。虚线框是一次请求的全部输入，从上到下就是模型读到的顺序；每一段旁边的注释说明它为什么放在这里。"
<svg viewBox="0 0 704 382">
<rect class="panel" x="0" y="0" width="704" height="382" rx="12"/>
<text class="caps" x="24" y="26">一次请求，从上到下</text>
<rect class="window" x="24" y="34" width="444" height="324" rx="8"/>
<text class="mono mute" x="36" y="79">system</text>
<g class="node blue"><rect x="112" y="44" width="344" height="70" rx="4"/><text class="mono" x="124" y="61">…群聊协议、工具规则、人设…</text><text class="mono" x="124" y="79"># Sticker 目录（会话内冻结）</text><text class="mono" x="124" y="97">s3: 😺 得意的赞同  s4: 😭 委屈到哭</text></g>
<path class="edge " d="M458 79.0 H478"/>
<text class="small" x="484" y="79">冻结：整个会话里逐字节不变</text>
<text class="mono mute" x="36" y="150">user</text>
<g class="node plain"><rect x="112" y="124" width="344" height="52" rx="4"/><text class="mono" x="124" y="141">[21:03:11] #18452 群友 A：这也太离谱了</text><text class="mono" x="124" y="159">[21:03:15] #18453 群友 B：[sticker 😂]</text></g>
<path class="edge " d="M458 150.0 H478"/>
<text class="small" x="484" y="150">群消息按时间只追加</text>
<text class="mono mute" x="36" y="212">user</text>
<g class="node violet"><rect x="112" y="186" width="344" height="52" rx="4"/><text class="mono" x="124" y="203">〔系统附注〕这批消息里出现了你也能发的</text><text class="mono" x="124" y="221">sticker：s2091 😂</text></g>
<path class="edge " d="M458 212.0 H478"/>
<text class="small" x="484" y="212">附注紧跟这批输入，写下后不再改</text>
<text class="mono mute" x="36" y="265">assistant</text>
<g class="node teal"><rect x="112" y="248" width="344" height="34" rx="4"/><text class="mono" x="124" y="265">send({ message: "确实离谱", sticker: "s4" })</text></g>
<path class="edge " d="M458 265.0 H478"/>
<text class="small" x="484" y="265">发出去的话成为下一次请求的前缀</text>
<text class="mono mute" x="36" y="318">user</text>
<g class="node plain"><rect x="112" y="292" width="344" height="52" rx="4"/><text class="mono" x="124" y="309">[media_update #18453] [sticker: 笑到捶地]</text><text class="mono" x="124" y="327">[21:04:02] #18460 群友 A：接下来怎么办？</text></g>
<path class="edge " d="M458 318.0 H478"/>
<text class="small" x="484" y="310">迟到的识别结果作为新事件追加，</text>
<text class="small" x="484" y="326">不回头改 #18453</text>
</svg>
<svg viewBox="0 0 340 710">
<rect class="panel" x="0" y="0" width="340" height="710" rx="12"/>
<text class="caps" x="16" y="24">一次请求，从上到下</text>
<text class="mono mute" x="16" y="46">system</text>
<g class="node blue"><rect x="16" y="56" width="308" height="88" rx="4"/><text class="mono" x="28" y="73">…群聊协议、工具规则、人设…</text><text class="mono" x="28" y="91"># Sticker 目录（会话内冻结）</text><text class="mono" x="28" y="109">s3: 😺 得意的赞同</text><text class="mono" x="28" y="127">s4: 😭 委屈到哭</text></g>
<text class="small accent" x="16" y="158">冻结：整个会话里逐字节不变</text>
<text class="mono mute" x="16" y="190">user</text>
<g class="node plain"><rect x="16" y="200" width="308" height="88" rx="4"/><text class="mono" x="28" y="217">[21:03:11] #18452 群友 A：</text><text class="mono" x="28" y="235">  这也太离谱了</text><text class="mono" x="28" y="253">[21:03:15] #18453 群友 B：</text><text class="mono" x="28" y="271">  [sticker 😂]</text></g>
<text class="small accent" x="16" y="302">群消息按时间只追加</text>
<text class="mono mute" x="16" y="334">user</text>
<g class="node violet"><rect x="16" y="344" width="308" height="70" rx="4"/><text class="mono" x="28" y="361">〔系统附注〕这批消息里出现了</text><text class="mono" x="28" y="379">你也能发的</text><text class="mono" x="28" y="397">sticker：s2091 😂</text></g>
<text class="small accent" x="16" y="428">附注紧跟这批输入，写下后不再改</text>
<text class="mono mute" x="16" y="460">assistant</text>
<g class="node teal"><rect x="16" y="470" width="308" height="52" rx="4"/><text class="mono" x="28" y="487">send({ message: "确实离谱",</text><text class="mono" x="28" y="505">       sticker: "s4" })</text></g>
<text class="small accent" x="16" y="536">发出去的话成为下一次请求的前缀</text>
<text class="mono mute" x="16" y="568">user</text>
<g class="node plain"><rect x="16" y="578" width="308" height="88" rx="4"/><text class="mono" x="28" y="595">[media_update #18453]</text><text class="mono" x="28" y="613">  [sticker: 笑到捶地]</text><text class="mono" x="28" y="631">[21:04:02] #18460 群友 A：</text><text class="mono" x="28" y="649">  接下来怎么办？</text></g>
<text class="small accent" x="16" y="680">迟到的识别结果作为新事件追加，不回头改 #18453</text>
</svg>
```

甚至连迟来的视觉分析，也严格遵守这套美学：
群友刚发图时，消息行只有一个轻量的占位符 `[图片]`；几秒后异步视觉模型解析出了画面内容，系统**绝不回头去改写旧消息**，而是在当前最新的输入流里追加一行不可变的增量事件：`[media_update #id] [图片: 一只躺在键盘上的三花猫]`。

---

## 剥开第三层：压缩上下文深度 $T$ —— 为什么原始话语比二次加工高贵

现在，我们把目光投向第三个变量 $T$（每次吞吐的上下文深度）。
即使你的缓存命中率做到了 98.7%，别忘了，还有 1.3% 的未命中流量在承受全价；而且更关键的是，即使在缓存单价内，九万 token 依然在持续产生摩擦成本。

更重要的是：**上下文不是一个可以无限膨胀的垃圾场。** 旧的记忆如何安放？长程对话如何沉淀？

### 窗口的博弈：算清自己的账，而不是服务商的账

NVIDIA 近期发表的论文 _You don't need long context_ (arXiv:2611.05306) 指出了一个底层现象：在服务端的 Attention 机制下，生成每个 token 的计算代价随上下文深度线性飙升。他们在 vLLM + H100 上的实测显示，256K 窗口相对于 16K，每 token 的生成成本最高暴增了 7 倍。

论文给出的建议是：把上下文激进地截断在 16K–48K，依靠频繁的上下文压缩和状态重置，模型在长程任务上的表现几乎不掉点。

这个结论极其漂亮，但如果你把它原封不动套在自己的应用上，你就会落入陷阱。因为那是**推理服务商的成本结构**；而对于我们这些调用 API 的应用开发者来说，云端账单通常是**按 token 线性计价的**。第 100,000 个 token 和第 1 个 token 价格完全一致，服务商内部的二次方惩罚并不会直接落在我们的月度账单里。

在应用端，窗口大小的取舍变成了另一场精密博弈：
**每次读得更少，与更频繁地触发压缩，究竟哪一个更贵？**

如果你的窗口开得很小（例如 32K），为了不溢出，你就必须频繁叫醒模型执行 Summarization（压缩）。
每一次压缩都是一次沉重的代价：它要全量读取旧上下文，再让模型呕心沥血写出一段结构化摘要；更致命的是，**压缩完成的那一瞬间，旧的确定性前缀彻底终结，下一轮调用将迎来一次彻头彻尾的冷启动全价账单**。

先看三个月里每次请求实际读了多少。分布有两个峰，一个在四万多 token，一个在十一万上下；九月底窗口调大以后，右边拖出了一条长尾：

```echarts title="每次请求读了多少 token" height="280" note="54,847 次非压缩调用的输入 token，每 1 万一档（40K 即 4 万–5 万），最后一档是 24 万及以上，其中 3 次超过 25 万；截至 11 月 1 日的本地快照。这段时间窗口先是 131K，9 月底调到 256K。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "{value} 次"},
  "grid": {"top": 16},
  "xAxis": {"type": "category", "axisLabel": {"formatter": "{value}K"},
    "data": ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100", "110", "120", "130", "140", "150", "160", "170", "180", "190", "200", "210", "220", "230", "≥240"]},
  "yAxis": {"type": "value"},
  "series": [{
    "name": "调用", "type": "bar", "barCategoryGap": "8%", "itemStyle": {"color": "var(--stone)"},
    "data": [375, 1757, 1805, 2495, {"value": 8266, "itemStyle": {"color": "var(--clay)"}}, 3828, 3057, 3041, 2998, 3410, 4949, {"value": 6979, "itemStyle": {"color": "var(--clay)"}}, 2147, 1108, 1083, 924, 976, 884, 879, 797, 786, 725, 672, 557, 349]
  }]
}
```

在旧版本的探索中，我的 bot 曾真实经历过这种极端的摇摆：

```echarts title="旧部署每周的平均输入长度与压缩调用占比" height="400" note="平均输入不含压缩调用本身。9 月用的是自己写的压缩器；9 月底把窗口从 131K 调到 256K。"
{
  "tooltip": {"trigger": "axis"},
  "axisPointer": {"link": [{"xAxisIndex": "all"}]},
  "grid": [{"top": 28, "height": "34%", "right": 24}, {"top": "60%", "bottom": 4, "right": 24}],
  "xAxis": [
    {"type": "category", "gridIndex": 0, "boundaryGap": false, "axisLabel": {"show": false}, "data": ["08-07", "08-10", "08-17", "08-24", "08-31", "09-07", "09-14", "09-21", "09-28", "10-05", "10-12", "10-19", "10-26", "11-02"]},
    {"type": "category", "gridIndex": 1, "boundaryGap": false, "data": ["08-07", "08-10", "08-17", "08-24", "08-31", "09-07", "09-14", "09-21", "09-28", "10-05", "10-12", "10-19", "10-26", "11-02"]}
  ],
  "yAxis": [
    {"type": "value", "gridIndex": 0, "name": "平均输入（千 token）", "nameLocation": "end", "nameTextStyle": {"align": "left"}},
    {"type": "value", "gridIndex": 1, "name": "压缩调用占比", "nameLocation": "end", "nameTextStyle": {"align": "left"}, "axisLabel": {"formatter": "{value}%"}}
  ],
  "series": [
    {"name": "平均输入（千 token）", "type": "line", "xAxisIndex": 0, "yAxisIndex": 0, "showSymbol": true, "symbolSize": 5, "itemStyle": {"color": "var(--stone)"}, "areaStyle": {"color": "var(--stone)", "opacity": 0.12},
      "data": [76.0, 53.4, 43.7, 85.9, 24.7, 95.8, 56.0, 76.2, 132.9, 130.0, 135.3, 123.0, 103.4, 115.4],
      "markArea": {"silent": true, "itemStyle": {"color": "var(--wash)"}, "label": {"color": "var(--muted)", "fontSize": 10}, "data": [[{"name": "窗口 256K", "xAxis": "09-28"}, {"xAxis": "11-02"}]]}},
    {"name": "压缩调用占比", "type": "line", "xAxisIndex": 1, "yAxisIndex": 1, "showSymbol": true, "symbolSize": 5, "itemStyle": {"color": "var(--clay)"}, "areaStyle": {"color": "var(--clay)", "opacity": 0.15},
      "tooltip": {"valueFormatter": "{value}%"},
      "data": [0.1, 1.3, 12.5, 20.1, 3.6, 30.1, 34.6, 44.6, 12.3, 0.5, 0.5, 1.0, 0.8, 0.4],
      "markPoint": {"symbol": "circle", "symbolSize": 7, "label": {"position": "right", "formatter": "44.6%：近一半调用在压缩", "color": "var(--clay)", "fontSize": 11}, "data": [{"type": "max"}]}}
  ]
}
```

看那条刺眼的曲线：在 9 月下旬，由于估算逻辑将图片尺寸错误归零，系统陷入了“误以为没压小因此连续不断疯狂压缩”的噩梦，整整 **45% 的模型调用居然全在做压缩**！而当我们在 9 月底把窗口无脑拉大到 256K 时，压缩调用归零了，但每次请求的基础载重暴涨到 13 万 token。

现在的架构停泊在经受考验的平衡点上：
**窗口收敛在 128K**，当上下文累积到 11 万 token 时触发底层 Pi 原生结构化压缩，稳定保留最近约 2 万 token 的原话。重度任务（检索、长程调研、代码调试）全部利用 `task` 剥离到独立的子会话中运转，只将凝练的成果带回群聊。主会话永远保持纯净——它只呈现“大家在聊什么”以及“我做了什么”，绝不沦为庞杂的调试日志。

```sketch title="窗口开多大" note="色带是示意，不是实测的成本曲线。对应用开发者来说 API 按 token 线性计价：窗口太小，压缩和冷缓存的开销压过省下的读取；太大，每一句闲聊都要读满一大段上下文。三张卡片里的数字都来自上文。"
<svg viewBox="0 0 704 262">
<rect class="panel" x="0" y="0" width="704" height="262" rx="12"/>
<text class="caps" x="24" y="30">窗口太小</text>
<text class="caps mid" x="516" y="30">刚好</text>
<text class="caps end" x="680" y="30">窗口太大</text>
<rect x="25.0" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.95"/>
<rect x="63.6" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.84"/>
<rect x="102.2" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.73"/>
<rect x="140.8" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.63"/>
<rect x="179.4" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.52"/>
<rect x="217.9" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.41"/>
<rect x="256.5" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.30"/>
<rect x="295.1" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.31"/>
<rect x="333.7" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.44"/>
<rect x="372.3" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.58"/>
<rect x="410.9" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.71"/>
<rect x="449.5" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.84"/>
<rect x="488.1" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.97"/>
<rect x="526.6" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.71"/>
<rect x="565.2" y="46" width="36.6" height="26" rx="2" fill="var(--teal)" fill-opacity="0.31"/>
<rect x="603.8" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.52"/>
<rect x="642.4" y="46" width="36.6" height="26" rx="2" fill="var(--orange)" fill-opacity="0.84"/>
<text class="small" x="26" y="86">16K</text>
<text class="small mid" x="188" y="86">32K</text>
<text class="small mid" x="352" y="86">64K</text>
<text class="small mid" x="516" y="86">128K</text>
<text class="small end" x="678" y="86">256K</text>
<circle cx="119.9" cy="59" r="6" fill="var(--card)" stroke="var(--node-line)"/>
<path class="edge " d="M119.9 65 V110 H128 V120"/>
<g class="node orange"><rect x="24" y="120" width="208" height="118" rx="6"/><text class="b" x="38" y="142">16K–48K</text><text class="small" x="38" y="166">每次只读一点，但压缩很勤</text><text class="small" x="38" y="186">每次压缩都全量读一遍再写摘要</text><text class="small" x="38" y="206">压完前缀作废，下一轮全价</text></g>
<circle cx="516.0" cy="59" r="6" fill="var(--card)" stroke="var(--node-line)"/>
<path class="edge " d="M516.0 65 V110 H352 V120"/>
<g class="node teal"><rect x="248" y="120" width="208" height="118" rx="6"/><text class="b" x="262" y="142">128K（现在）</text><text class="small" x="262" y="166">11 万时压缩，保留约 2 万原话</text><text class="small" x="262" y="186">检索、调研交给子会话</text><text class="small" x="262" y="206">主会话只留聊天和做了什么</text></g>
<circle cx="656.0" cy="59" r="6" fill="var(--card)" stroke="var(--node-line)"/>
<path class="edge " d="M656.0 65 V110 H576 V120"/>
<g class="node orange"><rect x="472" y="120" width="208" height="118" rx="6"/><text class="b" x="486" y="142">256K</text><text class="small" x="486" y="166">几乎不用压缩</text><text class="small" x="486" y="186">但每次请求要读 13 万 token</text><text class="small" x="486" y="206">一句“哈哈确实”也一样</text></g>
</svg>
<svg viewBox="0 0 340 426">
<rect class="panel" x="0" y="0" width="340" height="426" rx="12"/>
<text class="caps" x="16" y="28">窗口太小</text>
<text class="caps mid" x="247" y="28">刚好</text>
<text class="caps end" x="324" y="28">窗口太大</text>
<rect x="17.0" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.95"/>
<rect x="35.1" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.84"/>
<rect x="53.2" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.73"/>
<rect x="71.4" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.63"/>
<rect x="89.5" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.52"/>
<rect x="107.6" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.41"/>
<rect x="125.7" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.30"/>
<rect x="143.8" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.31"/>
<rect x="161.9" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.44"/>
<rect x="180.1" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.58"/>
<rect x="198.2" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.71"/>
<rect x="216.3" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.84"/>
<rect x="234.4" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.97"/>
<rect x="252.5" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.71"/>
<rect x="270.6" y="42" width="16.1" height="22" rx="2" fill="var(--teal)" fill-opacity="0.31"/>
<rect x="288.8" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.52"/>
<rect x="306.9" y="42" width="16.1" height="22" rx="2" fill="var(--orange)" fill-opacity="0.84"/>
<text class="small" x="18" y="78">16K</text>
<text class="small mid" x="93" y="78">32K</text>
<text class="small mid" x="170" y="78">64K</text>
<text class="small mid" x="247" y="78">128K</text>
<text class="small end" x="322" y="78">256K</text>
<circle cx="61.0" cy="53" r="5" fill="var(--card)" stroke="var(--node-line)"/>
<g class="node orange"><rect x="16" y="94" width="308" height="100" rx="6"/><text class="b" x="30" y="116">16K–48K</text><text class="small" x="30" y="140">每次只读一点，但压缩很勤</text><text class="small" x="30" y="160">每次压缩都全量读一遍再写摘要</text><text class="small" x="30" y="180">压完前缀作废，下一轮全价</text></g>
<circle cx="247.0" cy="53" r="5" fill="var(--card)" stroke="var(--node-line)"/>
<g class="node teal"><rect x="16" y="204" width="308" height="100" rx="6"/><text class="b" x="30" y="226">128K（现在）</text><text class="small" x="30" y="250">11 万时压缩，保留约 2 万原话</text><text class="small" x="30" y="270">检索、调研交给子会话</text><text class="small" x="30" y="290">主会话只留聊天和做了什么</text></g>
<circle cx="312.0" cy="53" r="5" fill="var(--card)" stroke="var(--node-line)"/>
<g class="node orange"><rect x="16" y="314" width="308" height="100" rx="6"/><text class="b" x="30" y="336">256K</text><text class="small" x="30" y="360">几乎不用压缩</text><text class="small" x="30" y="380">但每次请求要读 13 万 token</text><text class="small" x="30" y="400">一句“哈哈确实”也一样</text></g>
</svg>
```

### 戳破幻象：为什么我们彻底放弃记忆系统

谈及 Agent 的长期演进，人们总是沉迷于构建繁复的“记忆系统”：抽取实体、三元组图谱、更新/遗忘机制、向量化语义检索……

然而另一篇深刻的实证研究 _Is Complex Agentic Memory Always Needed?_ (arXiv:2610.30755) 狠狠戳破了这个泡沫。该研究使用最质朴的 **Raw-RAG** 基线（不抽取实体、不做图谱、不修改记忆，仅仅将原始对话做分块与结构化召回）去横向评测十余种复杂的 Agent 记忆框架，结果在七组严苛基准中，Raw-RAG 斩获了六项第一。

```echarts title="把原文换成加工过的记忆，总分掉了多少" height="200" note="相对于直接用原始对话的总分变化。来源：Bao et al., Is Complex Agentic Memory Always Needed?（arXiv:2610.30755）。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "grid": {"top": 8, "left": 8, "right": 24},
  "xAxis": {"type": "value", "max": 0, "min": -25},
  "yAxis": {"type": "category", "inverse": true, "data": ["换成原子事实", "换成摘要", "加上图扩展"], "axisLine": {"show": false}},
  "series": [{
    "name": "总分变化", "type": "bar", "barWidth": 22,
    "label": {"show": true, "position": "left", "formatter": "{c}", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [{"value": -19.62, "itemStyle": {"color": "var(--clay)"}}, -5.81, -5.78]
  }]
}
```

而在同一项指标上，少一层加工的那一边总是更高：

```echarts title="同一项指标，少一层加工反而更高" height="260" note="测试时学习：原文 47.68%，抽取成原子事实后 15.37%。完整访问加工后的记忆库：57.5%，仍低于直接给原文的 61.6%。Mem0：去掉 UPDATE / DELETE 后 69.42%，保留时 67.36%。来源同上。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "{value}%"},
  "legend": {},
  "grid": {"top": 36, "right": 56},
  "xAxis": {"type": "value", "max": 80, "axisLabel": {"formatter": "{value}%"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["测试时学习", "完整访问记忆库", "Mem0 准确率"]},
  "series": [
    {"name": "少一层加工", "type": "bar", "barWidth": 14, "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "position": "right", "formatter": "{c}%", "color": "var(--ink)"}, "data": [47.68, 61.6, 69.42]},
    {"name": "多一层加工", "type": "bar", "barWidth": 14, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "{c}%", "color": "var(--ink)"}, "data": [15.37, 57.5, 67.36]}
  ]
}
```

更令人窒息的是维护成本：为了维护那套精密易碎的记忆网络，各系统在 MemoryAgentBench 上动辄消耗数千万 token 和长达数小时的计算；而原始检索仅需十几分钟。

这与我们在生产中遭遇的事故形成了完美的互文。还记得前面提到的贴纸事故吗？
**加工过的记忆一旦被模型主观曲解，就会在下一次压缩中被当作客观事实固化，并像病毒一样代代遗传、永久污染。**

因此，我们的架构选择呈现出一种坚决的美学断舍离：
**彻底丢弃一切记忆中间件。我们不维护任何事实图谱，不做任何定期的反思沉淀。**

群里过去一年的每一条消息，原汁原味地躺在本地 SQLite 里，并附建有高性能 Trigram 倒排索引。当模型察觉到群友聊起“上次那个谁说的事情”或者看不懂的黑话梗时，它被赋予了一个强大的结构化工具 `tg_messages`。它能够按昵称历史、更名轨迹、发言人 ID、上下文回复树以及时间区间去查询**真正未经篡改的现场原话**。

```sketch title="不建记忆层，只留原话" note="常见的记忆系统每一轮都要抽取、建图、更新、写摘要；本项目不加工，原文按需检索，tg_messages 按昵称历史、更名轨迹、发言人、回复树和时间区间查询。"
<svg viewBox="0 0 704 404">
<rect class="panel" x="0" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="24" y="28">记忆系统：每一轮都在加工</text>
<g class="node plain"><rect x="32" y="48" width="278" height="32" rx="4"/><text class="mid" x="171" y="64">对话原文</text></g>
<path class="edge " d="M171 82 V98" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="102" width="278" height="32" rx="4"/><text class="mid" x="171" y="118">抽取实体和原子事实</text></g>
<path class="edge " d="M171 136 V152" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="156" width="278" height="32" rx="4"/><text class="mid" x="171" y="172">建图谱、更新、遗忘</text></g>
<path class="edge " d="M171 190 V206" marker-end="url(#arrow)"/>
<g class="node violet"><rect x="32" y="210" width="278" height="32" rx="4"/><text class="mid" x="171" y="226">写成摘要</text></g>
<path class="edge " d="M171 244 V260" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="32" y="264" width="278" height="32" rx="4"/><text class="mid" x="171" y="280">注入下一轮上下文</text></g>
<text class="small mid accent" x="171" y="340">每一轮都要花 token 去加工；</text>
<text class="small mid accent" x="171" y="358">加工错了，下一次压缩会把它当事实留下</text>
<rect class="panel" x="362" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="386" y="28">本项目：只留原话</text>
<g class="node plain"><rect x="394" y="48" width="278" height="32" rx="4"/><text class="mid" x="533" y="64">群里的每一条消息</text></g>
<path class="edge " d="M533 82 V98" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="394" y="102" width="278" height="46" rx="4"/><text class="mid b" x="533" y="117">SQLite 原文</text><text class="mid small" x="533" y="134">附 Trigram 倒排索引，不改一个字</text></g>
<path class="edge dash" d="M533 214 V150" marker-end="url(#arrow)"/>
<text class="small" x="541" y="182">群友追问时才查</text>
<g class="node orange"><rect x="394" y="218" width="278" height="64" rx="4"/><text class="mid b" x="533" y="242">tg_messages</text><text class="mid small" x="533" y="259">昵称历史 · 更名 · 发言人 · 回复树 · 时间</text></g>
<path class="edge " d="M533 284 V300" marker-end="url(#arrow)"/>
<g class="node "><rect x="394" y="304" width="278" height="32" rx="4"/><text class="mid" x="533" y="320">主模型读到现场原话</text></g>
<text class="small mid accent" x="533" y="358">平时一个 token 都不花在“记忆”上</text>
</svg>
<svg viewBox="0 0 340 824">
<rect class="panel" x="0" y="0" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="28">记忆系统：每一轮都在加工</text>
<g class="node plain"><rect x="32" y="48" width="276" height="32" rx="4"/><text class="mid" x="170" y="64">对话原文</text></g>
<path class="edge " d="M170 82 V98" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="102" width="276" height="32" rx="4"/><text class="mid" x="170" y="118">抽取实体和原子事实</text></g>
<path class="edge " d="M170 136 V152" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="156" width="276" height="32" rx="4"/><text class="mid" x="170" y="172">建图谱、更新、遗忘</text></g>
<path class="edge " d="M170 190 V206" marker-end="url(#arrow)"/>
<g class="node violet"><rect x="32" y="210" width="276" height="32" rx="4"/><text class="mid" x="170" y="226">写成摘要</text></g>
<path class="edge " d="M170 244 V260" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="32" y="264" width="276" height="32" rx="4"/><text class="mid" x="170" y="280">注入下一轮上下文</text></g>
<text class="small mid accent" x="170" y="340">每一轮都要花 token 去加工；</text>
<text class="small mid accent" x="170" y="358">加工错了，下一次压缩会把它当事实留下</text>
<rect class="panel" x="0" y="420" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="448">本项目：只留原话</text>
<g class="node plain"><rect x="32" y="468" width="276" height="32" rx="4"/><text class="mid" x="170" y="484">群里的每一条消息</text></g>
<path class="edge " d="M170 502 V518" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="32" y="522" width="276" height="46" rx="4"/><text class="mid b" x="170" y="537">SQLite 原文</text><text class="mid small" x="170" y="554">附 Trigram 倒排索引，不改一个字</text></g>
<path class="edge dash" d="M170 634 V570" marker-end="url(#arrow)"/>
<text class="small" x="178" y="602">群友追问时才查</text>
<g class="node orange"><rect x="32" y="638" width="276" height="64" rx="4"/><text class="mid b" x="170" y="662">tg_messages</text><text class="mid small" x="170" y="679">昵称历史 · 更名 · 发言人 · 回复树 · 时间</text></g>
<path class="edge " d="M170 704 V720" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="724" width="276" height="32" rx="4"/><text class="mid" x="170" y="740">主模型读到现场原话</text></g>
<text class="small mid accent" x="170" y="778">平时一个 token 都不花在“记忆”上</text>
</svg>
```

**把原始上下文原原本本留给时间，把理解与考证的权力留给需要它的那一刻。**
前者每一轮都在无声地抽干你的算力，而后者只有在群友真正追问的那一秒，才会激荡出一次优雅的检索。

### 记得意思，忘了原话：给原文多开一条按意思找的路

`tg_messages` 里最常用的参数是 `text_contains`。它背后是 SQLite FTS5 的 trigram 索引，本质上是一次**字面子串匹配**：你得说出原文里的那几个字，它才找得到。

可人的记忆从来不是这样存的。群友追问时说的是“上次那个推荐键盘的”，而当时的原话里也许一个“键盘”都没有；有人用英文去问一段中文聊天；一个梗在群里流传了三个月，早就换了好几种写法。字面检索在这里不是“不够准”，而是**根本无从下手**：模型只能把可能的同义词挨个猜一遍，每猜错一次，就是多一轮检索。

这一节开头那串记忆系统的标配里，正好就有“向量化语义检索”。但回头看那篇论文，被证伪的从来不是向量，而是**加工**：赢下六项第一的 Raw-RAG，恰恰就是把原始对话分块、再按语义召回。所以补上这条路时，我们只守三条边界：

- **不加工：** 不抽取、不摘要，向量只是原文的索引，查回来的永远是原话；
- **不多叫一次大模型：** 切分是确定性代码，每段对话只付一次 embedding 的钱；
- **不添基础设施：** 不上向量数据库，不装 SQLite 原生扩展，也不新增工具。

**切窗：不靠模型，确定性地切。** 群聊的单条消息太短，“笑死”“+1”“确实”各自算一个向量，几乎不携带任何语义。所以先把连续的消息切成一段段对话窗口：一段写满 800 字（大约 20 条消息）或攒满 40 条就切开，相邻两条之间沉默超过 30 分钟也切开。每一行写成 `昵称: 正文`；图片和贴纸带上它早已缓存好的视觉描述——那是前面 `media_update` 已经付过钱的识别结果，这里原样复用，不再多看一眼。只有**已经关闭**的窗口（最后一条之后静默满 30 分钟）才进索引；还开着的那一段就是正在聊的话，本来就在 bot 的上下文里。

800 这个数字不是拍脑袋定的，是下面的实验把它从最初的 1,500 改过来的。

**向量：一段对话，一次 embedding。** 用 Gemini 的 `gemini-embedding-2`，输出截到 768 维并归一化；检索任务不靠单独的参数，而是写在输入前缀里：入库时是 `title: none | text: …`，查询时是 `task: search result | query: …`。价格是每百万 token 0.20 美元。整个群的存档，用最初那版 1,500 字的窗口完整回填一遍，账是这样的：

```stats title="一次性回填" meta="2026-07-29 — 2026-11-10 · 一个群" note="生产归档库的只读快照，用最初 1,500 字窗口的代码回填。token 按 countTokens 实测的约 0.62 token/字换算。第一版索引器 37 秒内补了约 1,150 个窗口就撞上限流，此后按限流提示的等待时间重试，余下的 7,725 个窗口用了 319 秒。"
## 存档
消息 | 273,526 | 日均约 2,600 条
正文 | 7.1M 字 | 不含昵称
## 回填
窗口 | 8,875 | 中位 1,436 字、32 行
输入 | 7.2M token | 11.56M 字，含昵称前缀
费用 | 1.43 美元 | 动手前预估 1–1.5 美元
补完余下窗口 | 319 秒 | 7,725 个窗口，4 次 429
```

窗口的分布说明了一件事：真正决定边界的是长度上限，而不是沉默。中位数 1,436 字，75 分位已经是 1,478 字，几乎都顶着 1,500 的上限；不到 200 字的零碎窗口只有 139 个。高频的群聊很少真正安静 30 分钟。

严格说，“平时一个 token 都不花在记忆上”从此要加个注脚：后台每 5 分钟会给新关闭的窗口补一次 embedding。按存档的平均速度摊下来，每天不到 7 万 token，约 1.4 美分。它不进上下文、不叫醒任何模型，也不改动一个已经写下的字节。

**限流：索引和查询抢同一份额度。** 回填撞出了第一个真实问题。Gemini 每批最多 100 条（101 条直接 400），Tier 1 的额度是每分钟 100 万 embedding token。第一版索引器每批 50 条、遇错就等下一个 5 分钟周期，结果跑了 23 次请求就吃到 429，按这个节奏补完全部历史要 40 分钟左右，一路刷八条告警。更要命的是，回填期间一次真实的语义查询也撞上了 429：后台索引和前台查询用的是同一份额度。

修法依然是确定性代码，没有加队列，也没有加服务：每批 100 条，429 时照着返回里的 `retryDelay`（30–41 秒）等，索引器自己限速到每分钟 80 万字，大约是额度的一半，另一半留给群友的查询。

v1.1.8 上线时窗口改成了 800 字，在生产库上按这套节奏重新回填：15,596 个窗口，平均每窗约 17.5 条消息，每分钟约 1,100 窗，14.5 分钟跑完，一次 429 都没有。总字数不变，费用没有单独记账，按同样约 720 万 token 估算，约 1.4 美元。装好的发行版在快照上端到端查了一轮，每次 545–1,064 毫秒；`limit` 设 40 时 rows 里是一到两段完整对话，其余排名靠前的窗口在 `matches` 里标着 `in_rows=false`。

回填刚跑完还有个小插曲：索引游标一下子跳到了约 17.87 亿。原因是 8 月一次 e2e 测试往生产存档里塞了 21 条合成消息，发言人是假的，`message_id` 是时间戳一样的大数。超级群的真实消息 id 单调递增，索引器正是靠这一点按 id 推进游标。我们没有为这个“不可能的分支”补防御代码，而是先备份数据库、删掉这 21 条假消息和它们污染的 4 个窗口，让游标回到真实的位置。防御代码只防真实可能的分支；不可能的分支，就让它变回不可能。

**存储与检索：不要向量数据库。** 向量以 float32 BLOB 存进一张新表 `message_chunks`，每行只有群 id、窗口首尾两条消息的 id、模型名和那 768 个浮点数——这是这次对 schema 唯一的改动。查询时把问题也变成一个向量，然后在 JS 里对全部窗口做一遍暴力余弦：768 维乘 8,875 个窗口，约 680 万次乘加，连排序在内 14 毫秒。一次查询的 470–700 毫秒几乎全花在那一次 embedding 的网络往返上。全部向量常驻内存，27 MB；换成 800 字窗口后，线上实际是 15,596 个窗口、约 48 MB 向量，也还是同一个量级。在这个规模上，HNSW、IVF 这些近似索引解决的是一个我们根本没有的问题。换 embedding 模型时，旧向量不可比，直接删掉重建。

```sketch title="原话切成窗口，一窗一个向量" note="上：后台每 5 分钟把新关闭的窗口送去做 embedding，窗口写满 800 字、攒满 40 条或静默超过 30 分钟就切开；最后一段还在聊，不进索引。下：查询只多一次 embedding，排序在内存里做完，交还给模型的是整段原话。窗口和消息的数量是示意。"
<svg viewBox="0 0 704 256">
<rect class="panel" x="0" y="0" width="704" height="256" rx="12"/>
<text class="caps" x="24" y="26">后台：每 5 分钟补一次</text>
<g class="node plain"><rect x="24" y="64" width="88" height="34" rx="4"/></g>
<rect x="34" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="50" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="66" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="82" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="98" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<g class="node plain"><rect x="160" y="64" width="88" height="34" rx="4"/></g>
<rect x="170" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="186" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="202" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="218" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="234" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect class="window" x="296" y="64" width="64" height="34" rx="4"/>
<rect x="306" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="322" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="338" y="74" width="10" height="14" rx="2" fill="var(--line)"/>
<text class="small mid" x="136" y="118">满 800 字</text>
<text class="small mid" x="272" y="118">静默 &gt;30 分钟</text>
<text class="small mid" x="328" y="134">还在聊</text>
<path class="edge" d="M68 62 V46 H460 V54" marker-end="url(#arrow)"/>
<path class="edge" d="M204 62 V46"/>
<g class="node orange"><rect x="392" y="58" width="136" height="46" rx="4"/><text class="mid b" x="460" y="73">Gemini 向量</text><text class="mid small" x="460" y="90">768 维 · 一窗一次</text></g>
<path class="edge" d="M528 81 H548" marker-end="url(#arrow)"/>
<g class="node"><rect x="552" y="58" width="128" height="46" rx="4"/><text class="mid b" x="616" y="73">message_chunks</text><text class="mid small" x="616" y="90">float32 BLOB</text></g>
<path class="edge dash" d="M616 106 V140 H416 V166" marker-end="url(#arrow)"/>
<text class="small" x="424" y="134">常驻内存</text>
<text class="caps" x="24" y="156">查询时</text>
<g class="node clay"><rect x="24" y="176" width="140" height="34" rx="17"/><text class="mid" x="94" y="193">上次那个推荐键盘的</text></g>
<path class="edge" d="M164 193 H184" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="188" y="170" width="136" height="46" rx="4"/><text class="mid b" x="256" y="185">Gemini 向量</text><text class="mid small" x="256" y="202">同一模型 · query 前缀</text></g>
<path class="edge" d="M324 193 H344" marker-end="url(#arrow)"/>
<g class="node"><rect x="348" y="170" width="136" height="46" rx="4"/><text class="mid b" x="416" y="185">逐窗算余弦</text><text class="mid small" x="416" y="202">内存里暴力扫一遍</text></g>
<path class="edge" d="M484 193 H504" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="508" y="170" width="172" height="46" rx="4"/><text class="mid b" x="594" y="185">整段原话</text><text class="mid small" x="594" y="202">+ matches 分数</text></g>
<text class="small end" x="680" y="236">模型再用 before_id / after_id 往两边翻</text>
</svg>
<svg viewBox="0 0 340 552">
<rect class="panel" x="0" y="0" width="340" height="552" rx="12"/>
<text class="caps" x="16" y="24">后台：每 5 分钟补一次</text>
<g class="node plain"><rect x="16" y="40" width="84" height="34" rx="4"/></g>
<rect x="26" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="42" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="58" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="74" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<g class="node plain"><rect x="136" y="40" width="84" height="34" rx="4"/></g>
<rect x="146" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="162" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="178" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="194" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect class="window" x="256" y="40" width="68" height="34" rx="4"/>
<rect x="266" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="282" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<rect x="298" y="50" width="10" height="14" rx="2" fill="var(--line)"/>
<text class="small mid" x="118" y="92">满 800 字</text>
<text class="small mid" x="238" y="92">静默&gt;30分钟</text>
<text class="small mid" x="290" y="30">还在聊</text>
<path class="edge" d="M58 76 V106" marker-end="url(#arrow)"/>
<path class="edge" d="M178 76 V106" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="16" y="110" width="308" height="46" rx="4"/><text class="mid b" x="170" y="125">Gemini 向量</text><text class="mid small" x="170" y="142">768 维 · 一窗一次</text></g>
<path class="edge" d="M170 158 V176" marker-end="url(#arrow)"/>
<g class="node"><rect x="16" y="180" width="308" height="46" rx="4"/><text class="mid b" x="170" y="195">message_chunks</text><text class="mid small" x="170" y="212">float32 BLOB · 常驻内存</text></g>
<text class="caps" x="16" y="258">查询时</text>
<g class="node clay"><rect x="16" y="270" width="308" height="34" rx="17"/><text class="mid" x="170" y="287">上次那个推荐键盘的</text></g>
<path class="edge" d="M170 306 V324" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="16" y="328" width="308" height="46" rx="4"/><text class="mid b" x="170" y="343">Gemini 向量</text><text class="mid small" x="170" y="360">同一模型 · query 前缀</text></g>
<path class="edge" d="M170 376 V394" marker-end="url(#arrow)"/>
<g class="node"><rect x="16" y="398" width="300" height="46" rx="4"/><text class="mid b" x="166" y="413">逐窗算余弦</text><text class="mid small" x="166" y="430">内存里暴力扫一遍</text></g>
<path class="edge dash" d="M324 203 H332 V421 H320" marker-end="url(#arrow)"/>
<path class="edge" d="M170 446 V464" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="16" y="468" width="308" height="46" rx="4"/><text class="mid b" x="170" y="483">整段原话</text><text class="mid small" x="170" y="500">+ matches 分数</text></g>
<text class="small" x="16" y="536">模型再用 before_id / after_id 往两边翻</text>
</svg>
```

**接口：不加新工具，只加一个参数。** 它不是一个新工具，而是 `tg_messages` 上多出来的一个 `semantic` 参数：用一句自然语言描述要找什么，返回最相关的几段**完整对话**；`matches` 列出排名最前的至多 10 段，每段带 `first_id`、`last_id`、相似度分数，以及这段有没有装进这次返回的 `in_rows`。它可以和 `sender`、`since`、`until`、`text_contains` 这些已有的过滤条件叠在一起用，含义是“只保留里面至少有一条符合条件的那些窗口”；看完一段想往前追起因、往后看结局，就用已有的 `before_id` / `after_id` 游标翻过去。

这是前面“工具定义：一次全量声明”那条取舍的延续：多一个参数，工具描述多出约 1,200 个字符，粗估七八百 token，不到平均请求的 1%，而且趴在冻结的前缀里按缓存价重读；多一个工具，模型就要多学一套用法。不过，工具 schema 是缓存可见的协议，改了就得守规矩：`CACHE_SCHEMA_VERSION` 从 55 升到 56，golden hash 同步更新。上线那一刻冷一次，之后的前缀照旧逐字节不变。

**验证：先在真库上跑一遍，再写进工具描述。** 代码写完，没有直接上线，而是交给一个子 agent 在生产服务器上做实验。对象是归档库的一份只读快照；全程不启动 daemon，不碰线上服务——两个进程抢同一个 bot token 的教训在前。实验做完，快照和实验用的 key 一并删掉。四组实验加起来花了大约 3 美元：

1. **完整回填：** 用当时的代码把全部存档回填一遍，记下吞吐、限流、窗口统计和 token 数，以及回填期间事件循环被阻塞了多久、内存涨了多少；
2. **查询延迟：** 一次语义查询从发出到拿回原文要多久，时间花在哪一段；
3. **召回质量：** 挑了 25 个群里真实聊过的话题，**一律不用原话**，换一种说法去查：用英文查中文对话，“某人 + 某话题”配合 `sender` 过滤，限定时间段；另外 5 个查询问的是从没发生过的事，看“查无此事”时分数落在哪里；
4. **参数敏感性：** 在最近 30 天的子集上，比较静默阈值、窗口大小、是否保留 bot 自己的发言、是否加入库前缀。

```stats title="语义召回的实测" meta="生产归档的只读快照 · 1,500 字窗口" note="查询延迟是从发出查询到拿回原文；余弦扫描含排序，覆盖全部 8,875 个窗口。事件循环和内存在完整回填期间测得。查无此事：5 个从没发生过的事，各自第一名的分数。"
## 速度
语义查询 | 470–700 ms | 几乎全是那一次 embedding
余弦扫描 | 14 ms | 全量暴力扫一遍
字面检索 | 50–140 ms | text_contains 作对照
## 回填期间
事件循环延迟 | 11 ms | p99，最长 49 ms
向量 | 27 MB | 进程 RSS 约 160 MB
## 质量
换说法查 | 20 / 25 | 第一名就是要找的那段
查无此事 | 0.627–0.701 | 第一名的分数，压过不少真命中
```

先说速度：语义查询比字面检索慢几倍，但慢在一次网络往返，不在本地；回填期间事件循环最长只卡了 49 毫秒，对群消息的收发可以忽略。

再说质量。25 个换了说法的查询，20 个第一名就是要找的那段：区块链存储、路由器桥接和 IPTV、换 Windows 字体、一次下大雨的海边出游、学校请假休学、导出 eSIM、Minecraft 刷铁机、减肥、显卡。用英文问中文聊天也照样找得到。冷门话题（全库只有三到七段相关）第一名是对的，第二到第五名多半是凑数的。

查不到的那几类，正好划出了它的边界：

- **问一个梗是什么意思：** 0 / 10。梗的含义从来不写在聊天里，大家只是在用它；这种时候该拿梗的原文去 `text_contains`。
- **专有名词和品牌：** 一个付费背单词软件、一家量化公司，字面检索更准。
- **比喻用法压过本义：** 真正聊台风的没几次，“台风”当比喻用的倒很多。
- **关键信息散在几段里：** 平台跑路、“警察说这是民事纠纷”，每段只沾一点边。

写法也有讲究：一句完整的描述比两三个关键词准得多。只写“耳机”，前 5 段里 2 段相关；写成“比较几款无线耳机的降噪效果和价格”，是 4 段。

最出乎意料的是分数。原本想给模型一条“低于多少就是没找到”的分数线，实验的结论是**这条线不存在**：相关窗口的分数中位数 0.669，不相关的 0.658，区间几乎完全重叠；5 个查无此事的查询，第一名的分数在 0.627–0.701 之间，一个虚构的“婚纱照”查询拿到 0.701，比不少真命中还高。第一名和第五名差出 0.05 以上时结果总是对的，但真命中也常常只差 0.01–0.03，和查无此事看起来一样。所以工具描述里写的是：分数只用来在同一次结果里排序，必须读 rows 判断对不对题；对不上就当没找到，换个说法或改用 `text_contains`，不能据此断言“群里从没聊过”。

实验还顺手抓到一个结果形状的 bug：`limit` 设成 30–40 时，每次都只返回一段对话——一段将近 40 条，第二段放不下，循环就此停下。现在放不下的段会被跳过而不是让循环停下，最相关的一段总会返回，其余的在 `matches` 里标出 `in_rows`，需要时再按 id 读出来。

窗口参数是在 30 天子集上定的：

```data title="切窗参数怎么定" bars="P@1,P@5" mark="800 字（上线）" note="最近 30 天的子集，21 个查询加 3 个查无此事的查询。基线是静默 30 分钟、1,500 字、40 条。P@1、P@5：前 1、前 5 段里相关的比例；MRR：第一个相关段排名的倒数的平均；消息精度：40 条消息的预算里，落在相关窗口中的比例。只把上限放到 3,000 字时 40 条的上限先生效，结果不变，所以那一行同时放到了 80 条。"
方案 | 窗口 | P@1 | P@5 | MRR | 消息精度
基线 | 2,241 | 0.76 | 0.47 | 0.83 | 0.73
静默 10 分钟 | 2,562 | 0.76 | 0.48 | 0.83 | 0.74
800 字（上线） | 3,720 | 0.81 | 0.57 | 0.84 | 0.78
3,000 字 / 80 条 | 1,145 | 0.62 | 0.46 | 0.74 | 0.62
去掉 bot 发言 | 1,948 | 0.48 | 0.39 | 0.62 | 0.48
去掉入库前缀 | 2,238 | 0.71 | 0.47 | 0.77 | 0.68
```

三个结论。窗口越小越准：800 字在每一项上都最好，而总字数不变，token 一分不多。沉默阈值 10 分钟还是 30 分钟几乎没有区别，又一次说明边界主要由长度决定。最意外的是 bot 自己的发言：它们占了全部字数的 75%，看起来像是该剔除的噪音，但 bot 的解释里恰恰带着话题词，去掉以后 P@1 从 0.76 掉到 0.48。

最后，工具描述里的例子也是从实验里长出来的：“有人讲过怎么自己做一套表情贴纸包”“比较几款无线耳机的降噪效果和价格”，用英文写的 “someone got liquidated on a high-leverage position”，配上 `sender` 的“对暂停学业一年的打算”，用 `text_contains` 锁住关键词的组合查询，以及怎么用 `after_id` / `before_id` 把一段展开。每一条都是实验里真正查对了的写法；查不对的那几类，也原样写进了描述的“不擅长”里。

整个功能在 `src/` 里加了 552 行、删了 25 行，其中 339 行是新的 `semantic.ts`；一张表，一个参数。它没有给 bot 添一层“记忆”：没有人追问时，主模型的上下文里一个字都不会多；有人追问时，换回来的仍然是那天的现场原话。

---

## 兑现为自由：快与能干，恰恰是省出来的

读到这里，或许会有人产生一种偏见：这个项目把每一分钱、每一个 token 都算计到极致，这个 bot 表现出来一定极度僵硬、贫瘠、反应迟钝吧？

事实恰恰彻底相反。
**所有的节制与瘦身，从来不是为了把资金封存在账本里，而是为了在关键时刻，将这股庞大的计算冗余兑现成前所未有的敏捷与全能。**

### 亮点一：Codemode 的呼吸感 —— 边说边做

群友在使用过程中最强烈的直观感受是：“你家这个 bot 反应怎么这么快？”
这并非因为底层换了什么超低延迟的模型，奥秘全在于 `codemode` 带来的交互美学。

先看看主流 Agent 框架在面对“帮我查查这个技术梗的来源并总结群里讨论”这类复杂任务时，是如何机械运转的：

1. 模型读完 9 万 token，决定调用 `search`；
2. 漫长的等待，网络返回搜索结果；
3. 模型**把 9 万 token 加上新返回的满屏 HTML 片段再读一遍**，决定调用第二个工具；
4. 再次等待，模型又把整段上下文重读一遍，决定抓取某个网页正文；
5. 整整经历四五轮沉重且全额计费的模型往返，群友在屏幕前对着死寂的“正在输入”苦等半分钟；
6. 最终，几页毫无过滤的原始网页文本硬生生地永久焊死在后续的聊天历史里。

而在我们的架构中，模型借助 Pi 的隔离沙箱，直接写出一小段原生的 JavaScript：

```js
// 1. 先开口，打破等待的窒息感
await tools.send({ text: "我去翻一下群记录并查下这个梗，稍等！" });

// 2. 并行调度，在沙箱里聚合
const [searchRes, historyRes] = await Promise.allSettled([
  tools.search({ query: "某个开源项目 架构变革" }),
  tools.tg_messages({ text_contains: "架构变革", limit: 10 }),
]);

// 3. 在沙箱内存里做精细切片，绝不把垃圾带进主上下文
const web = searchRes.status === "fulfilled" ? searchRes.value : null;
const chat = historyRes.status === "fulfilled" ? historyRes.value : null;

text({
  summary: web?.slice(0, 1000),
  discussions: chat?.rows.map(({ sender, text }) => `${sender.name}: ${text}`),
});
```

把两种做法摊开来对比，差别在于主模型被叫醒几次、每次要读什么：

```sketch title="同一个任务，两种跑法" note="传统 agent 循环里，每个工具结果都回到主模型，再全量读一遍上下文；图里画了两次工具调用，实际常常是四五轮。codemode 的脚本在沙箱里先发消息、并行检索、切好结果，主模型只被叫醒两次。"
<svg viewBox="0 0 704 452">
<rect class="panel" x="0" y="0" width="342" height="452" rx="12"/>
<text class="caps" x="24" y="30">逐个调用工具</text>
<g class="node "><rect x="60" y="56" width="222" height="46" rx="4"/><text class="mid b" x="171" y="71">主模型</text><text class="mid small" x="171" y="88">读 9.3 万 token</text></g>
<circle class="glyph" cx="74" cy="76" r="2.4"/><circle class="glyph" cx="74" cy="82" r="2.4"/><circle class="glyph" cx="82" cy="73" r="2.4"/><circle class="glyph" cx="82" cy="79" r="2.4"/><circle class="glyph" cx="82" cy="85" r="2.4"/><circle class="glyph" cx="90" cy="76" r="2.4"/><circle class="glyph" cx="90" cy="82" r="2.4"/>
<path class="edge " d="M171 104 V121" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="100" y="124" width="142" height="30" rx="4"/><text class="mid" x="171" y="139">search</text></g>
<path class="edge " d="M171 156 V173" marker-end="url(#arrow)"/>
<g class="node "><rect x="60" y="176" width="222" height="46" rx="4"/><text class="mid b" x="171" y="191">主模型</text><text class="mid small" x="171" y="208">再读 9.3 万 + 搜索结果</text></g>
<circle class="glyph" cx="74" cy="196" r="2.4"/><circle class="glyph" cx="74" cy="202" r="2.4"/><circle class="glyph" cx="82" cy="193" r="2.4"/><circle class="glyph" cx="82" cy="199" r="2.4"/><circle class="glyph" cx="82" cy="205" r="2.4"/><circle class="glyph" cx="90" cy="196" r="2.4"/><circle class="glyph" cx="90" cy="202" r="2.4"/>
<path class="edge " d="M171 224 V241" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="100" y="244" width="142" height="30" rx="4"/><text class="mid" x="171" y="259">fetch 网页</text></g>
<path class="edge " d="M171 276 V293" marker-end="url(#arrow)"/>
<g class="node "><rect x="60" y="296" width="222" height="46" rx="4"/><text class="mid b" x="171" y="311">主模型</text><text class="mid small" x="171" y="328">再读一遍 + 网页原文</text></g>
<circle class="glyph" cx="74" cy="316" r="2.4"/><circle class="glyph" cx="74" cy="322" r="2.4"/><circle class="glyph" cx="82" cy="313" r="2.4"/><circle class="glyph" cx="82" cy="319" r="2.4"/><circle class="glyph" cx="82" cy="325" r="2.4"/><circle class="glyph" cx="90" cy="316" r="2.4"/><circle class="glyph" cx="90" cy="322" r="2.4"/>
<path class="edge " d="M171 344 V361" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="100" y="364" width="142" height="30" rx="4"/><text class="mid" x="171" y="379">send 回答</text></g>
<text class="small mid accent" x="171" y="424">每个结果都回到主模型全价重读，工具越多往返越多</text>
<rect class="panel" x="362" y="0" width="342" height="452" rx="12"/>
<text class="caps" x="386" y="30">codemode</text>
<g class="node "><rect x="398" y="56" width="270" height="46" rx="4"/><text class="mid b" x="533" y="71">主模型 · 第一次</text><text class="mid small" x="533" y="88">写一段脚本</text></g>
<circle class="glyph" cx="412" cy="76" r="2.4"/><circle class="glyph" cx="412" cy="82" r="2.4"/><circle class="glyph" cx="420" cy="73" r="2.4"/><circle class="glyph" cx="420" cy="79" r="2.4"/><circle class="glyph" cx="420" cy="85" r="2.4"/><circle class="glyph" cx="428" cy="76" r="2.4"/><circle class="glyph" cx="428" cy="82" r="2.4"/>
<path class="edge " d="M533 104 V128" marker-end="url(#arrow)"/>
<rect class="window" x="384" y="132" width="298" height="196" rx="8"/>
<text class="caps" x="394" y="148">沙箱里的脚本</text>
<g class="node teal"><rect x="398" y="162" width="270" height="30" rx="4"/><text class="mid" x="533" y="177">send「我去翻一下，稍等」</text></g>
<path class="edge " d="M533 194 V204 H456 V214" marker-end="url(#arrow)"/>
<path class="edge " d="M533 204 H610 V214" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="398" y="218" width="116" height="30" rx="4"/><text class="mid" x="456" y="233">search</text></g>
<g class="node orange"><rect x="552" y="218" width="116" height="30" rx="4"/><text class="mid" x="610" y="233">tg_messages</text></g>
<text class="small mid" x="533" y="233">并行</text>
<path class="edge " d="M456 250 V260 H533 V276" marker-end="url(#arrow)"/>
<path class="edge " d="M610 250 V260 H533"/>
<g class="node plain"><rect x="398" y="280" width="270" height="34" rx="4"/><text class="mid" x="533" y="297">切成几百字</text></g>
<path class="edge " d="M533 330 V352" marker-end="url(#arrow)"/>
<g class="node "><rect x="398" y="356" width="270" height="46" rx="4"/><text class="mid b" x="533" y="371">主模型 · 第二次</text><text class="mid small" x="533" y="388">读切好的结果</text></g>
<circle class="glyph" cx="412" cy="376" r="2.4"/><circle class="glyph" cx="412" cy="382" r="2.4"/><circle class="glyph" cx="420" cy="373" r="2.4"/><circle class="glyph" cx="420" cy="379" r="2.4"/><circle class="glyph" cx="420" cy="385" r="2.4"/><circle class="glyph" cx="428" cy="376" r="2.4"/><circle class="glyph" cx="428" cy="382" r="2.4"/>
<text class="small mid accent" x="533" y="426">两次调用，原始结果只进沙箱</text>
</svg>
<svg viewBox="0 0 340 920">
<rect class="panel" x="0" y="0" width="340" height="452" rx="12"/>
<text class="caps" x="24" y="30">逐个调用工具</text>
<g class="node "><rect x="59" y="56" width="222" height="46" rx="4"/><text class="mid b" x="170" y="71">主模型</text><text class="mid small" x="170" y="88">读 9.3 万 token</text></g>
<circle class="glyph" cx="73" cy="76" r="2.4"/><circle class="glyph" cx="73" cy="82" r="2.4"/><circle class="glyph" cx="81" cy="73" r="2.4"/><circle class="glyph" cx="81" cy="79" r="2.4"/><circle class="glyph" cx="81" cy="85" r="2.4"/><circle class="glyph" cx="89" cy="76" r="2.4"/><circle class="glyph" cx="89" cy="82" r="2.4"/>
<path class="edge " d="M170 104 V121" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="99" y="124" width="142" height="30" rx="4"/><text class="mid" x="170" y="139">search</text></g>
<path class="edge " d="M170 156 V173" marker-end="url(#arrow)"/>
<g class="node "><rect x="59" y="176" width="222" height="46" rx="4"/><text class="mid b" x="170" y="191">主模型</text><text class="mid small" x="170" y="208">再读 9.3 万 + 搜索结果</text></g>
<circle class="glyph" cx="73" cy="196" r="2.4"/><circle class="glyph" cx="73" cy="202" r="2.4"/><circle class="glyph" cx="81" cy="193" r="2.4"/><circle class="glyph" cx="81" cy="199" r="2.4"/><circle class="glyph" cx="81" cy="205" r="2.4"/><circle class="glyph" cx="89" cy="196" r="2.4"/><circle class="glyph" cx="89" cy="202" r="2.4"/>
<path class="edge " d="M170 224 V241" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="99" y="244" width="142" height="30" rx="4"/><text class="mid" x="170" y="259">fetch 网页</text></g>
<path class="edge " d="M170 276 V293" marker-end="url(#arrow)"/>
<g class="node "><rect x="59" y="296" width="222" height="46" rx="4"/><text class="mid b" x="170" y="311">主模型</text><text class="mid small" x="170" y="328">再读一遍 + 网页原文</text></g>
<circle class="glyph" cx="73" cy="316" r="2.4"/><circle class="glyph" cx="73" cy="322" r="2.4"/><circle class="glyph" cx="81" cy="313" r="2.4"/><circle class="glyph" cx="81" cy="319" r="2.4"/><circle class="glyph" cx="81" cy="325" r="2.4"/><circle class="glyph" cx="89" cy="316" r="2.4"/><circle class="glyph" cx="89" cy="322" r="2.4"/>
<path class="edge " d="M170 344 V361" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="99" y="364" width="142" height="30" rx="4"/><text class="mid" x="170" y="379">send 回答</text></g>
<text class="small mid accent" x="170" y="424">每个结果都回到主模型全价重读，工具越多往返越多</text>
<rect class="panel" x="0" y="468" width="340" height="452" rx="12"/>
<text class="caps" x="24" y="498">codemode</text>
<g class="node "><rect x="35" y="524" width="270" height="46" rx="4"/><text class="mid b" x="170" y="539">主模型 · 第一次</text><text class="mid small" x="170" y="556">写一段脚本</text></g>
<circle class="glyph" cx="49" cy="544" r="2.4"/><circle class="glyph" cx="49" cy="550" r="2.4"/><circle class="glyph" cx="57" cy="541" r="2.4"/><circle class="glyph" cx="57" cy="547" r="2.4"/><circle class="glyph" cx="57" cy="553" r="2.4"/><circle class="glyph" cx="65" cy="544" r="2.4"/><circle class="glyph" cx="65" cy="550" r="2.4"/>
<path class="edge " d="M170 572 V596" marker-end="url(#arrow)"/>
<rect class="window" x="21" y="600" width="298" height="196" rx="8"/>
<text class="caps" x="31" y="616">沙箱里的脚本</text>
<g class="node teal"><rect x="35" y="630" width="270" height="30" rx="4"/><text class="mid" x="170" y="645">send「我去翻一下，稍等」</text></g>
<path class="edge " d="M170 662 V672 H93 V682" marker-end="url(#arrow)"/>
<path class="edge " d="M170 672 H247 V682" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="35" y="686" width="116" height="30" rx="4"/><text class="mid" x="93" y="701">search</text></g>
<g class="node orange"><rect x="189" y="686" width="116" height="30" rx="4"/><text class="mid" x="247" y="701">tg_messages</text></g>
<text class="small mid" x="170" y="701">并行</text>
<path class="edge " d="M93 718 V728 H170 V744" marker-end="url(#arrow)"/>
<path class="edge " d="M247 718 V728 H170"/>
<g class="node plain"><rect x="35" y="748" width="270" height="34" rx="4"/><text class="mid" x="170" y="765">切成几百字</text></g>
<path class="edge " d="M170 798 V820" marker-end="url(#arrow)"/>
<g class="node "><rect x="35" y="824" width="270" height="46" rx="4"/><text class="mid b" x="170" y="839">主模型 · 第二次</text><text class="mid small" x="170" y="856">读切好的结果</text></g>
<circle class="glyph" cx="49" cy="844" r="2.4"/><circle class="glyph" cx="49" cy="850" r="2.4"/><circle class="glyph" cx="57" cy="841" r="2.4"/><circle class="glyph" cx="57" cy="847" r="2.4"/><circle class="glyph" cx="57" cy="853" r="2.4"/><circle class="glyph" cx="65" cy="844" r="2.4"/><circle class="glyph" cx="65" cy="850" r="2.4"/>
<text class="small mid accent" x="170" y="894">两次调用，原始结果只进沙箱</text>
</svg>
```

仔细品味这一小段脚本所蕴含的美学力量：

1. **先声夺人（体贴的呼吸感）：** 脚本第一行执行 `send`，群友的客户端在数百毫秒内就会收到回应。心理上的“死等”瞬间转化为“它已经在干活了”。沙箱内的 `send` 不会触发 turn 终结，流水线在后台继续奔流。
2. **真正的并行计算：** 现代网络请求天然应当并发。`Promise.allSettled` 让多次往返骤降为单次。
3. **上下文防火墙：** 检索回来的数万字节网页原文与多余元数据，在沙箱内部被就地提纯，**只有被精准切片后的数百个核心字眼被投喂回主模型**。

我们没有去采用各大 Provider 标榜的“原生工具并行调用”。因为原生并行是单向僵死的——你无法在同一批调用里先说一句话、再基于返回做出动态分支，也无法阻止原始负载全量灌进上下文。`codemode` 成为将“极速响应”、“动态控制”与“上下文洁癖”完美融为一体的唯一解。

### 亮点二：一台完整的 Linux 容器，胜过一百个脆弱的插件

许多开发者衡量一个 Agent 是否强大，标准是看它的插件列表有多长：天气插件、绘图插件、音频转码插件、文档阅读插件、网页快照插件……
每一个插件都意味着一套繁琐的 Schema、数以千计的调试代码，以及随时可能崩溃的第三方边界。更可悲的是，**模型的能力上限被死死锁死在作者写过的插件交集之中**。群友想把一段视频抽取特定帧转成黑白 GIF，只要作者没写过这个插件，Agent 就只能摊手。

我们的设计美学走向了相反的极端：**给模型一台真正的 Linux。**

通过底层 Pi 赋予的原生文件与 Shell 能力（`read` / `write` / `edit` / `bash`），bot 拥有一台跑在独立用户下的 rootless Docker 容器。工作区里预装了现代化的全套武器：Python (uv)、Node.js、ffmpeg、ImageMagick、ripgrep、Chromium 及 CJK 字体集。

于是，神奇的化学反应发生了：

- 想剪视频、抽音频、压贴纸？模型在沙箱里自己敲一行 `ffmpeg`；
- 想推演数据、绘制复杂热力图？模型在容器里写下 `uv run --with matplotlib python main.py`；
- 甚至当群友好奇询问“你的底层逻辑是怎么实现的”，它会用 `bash` 把自己的 GitHub 仓库拉到 `/work/src`，用 `rg` 翻阅源码，逐行向群友剖析自己的构造；
- 产物就绪后，直接通过 `send.files` 以原生文件或照片相册的形式推送回群。

这一切神奇的体验，**我们没有为之专门编写过一行所谓的“插件代码”**。模型本身受过人类文明全部开源工具的洗礼，它天生精通 Shell；我们所要做的唯一体面之事，不是充当保姆给它造轮子，而是划定安全边界，给它提供一个干净、隔离、随时待命的通用执行环境。

在这个纯净的容器边界上，我们构筑了严密的安全防线：

```sketch title="一台完整的 Linux，装在几层边界里" note="bot 守护进程和容器分属不同的系统用户；容器里没有任何 API Key、SSH Key 或环境变量，模型请求和发往群里的文件都经守护进程转手。"
<svg viewBox="0 0 704 344">
<rect class="panel" x="0" y="0" width="704" height="344" rx="12"/>
<text class="caps" x="24" y="30">宿主机</text>
<g class="node "><rect x="24" y="104" width="160" height="64" rx="4"/><text class="mid b" x="104" y="128">bot 守护进程</text><text class="mid small" x="104" y="145">密钥和 token 在这里</text></g>
<g class="node clay"><rect x="24" y="250" width="160" height="40" rx="20"/><text class="mid" x="104" y="270">模型 API</text></g>
<path class="edge " d="M104 170 V246" marker-end="url(#arrow)"/>
<text class="small" x="112" y="208">代为请求</text>
<rect class="window" x="236" y="48" width="444" height="276" rx="10"/>
<text class="small b" x="252" y="68">系统用户 tgbox · rootless Docker</text>
<g class="node plain"><rect x="256" y="84" width="404" height="206" rx="8"/></g>
<text class="small b" x="272" y="104">容器 · uid 1000</text>
<g class="node "><rect x="272" y="120" width="120" height="28" rx="3"/><text class="mid small" x="332" y="134">只读根文件系统</text></g>
<g class="node "><rect x="398" y="120" width="124" height="28" rx="3"/><text class="mid small" x="460" y="134">cap-drop ALL</text></g>
<g class="node "><rect x="528" y="120" width="116" height="28" rx="3"/><text class="mid small" x="586" y="134">no-new-privileges</text></g>
<g class="node "><rect x="464" y="156" width="180" height="28" rx="3"/><text class="mid small" x="554" y="170">/tmp：256 MB tmpfs</text></g>
<g class="node "><rect x="272" y="156" width="186" height="28" rx="3"/><text class="mid small" x="365" y="170">内存、CPU、进程数上限</text></g>
<g class="node teal"><rect x="272" y="202" width="372" height="72" rx="6"/><text class="mid b" x="458" y="230">/work</text><text class="mid small" x="458" y="247">唯一可写、会保留的目录 · 每周一 05:00 清空</text></g>
<path class="edge " d="M186 122 H252" marker-end="url(#arrow)"/>
<text class="small mid" x="219" y="108">bash</text>
<path class="edge " d="M252 150 H188" marker-end="url(#arrow)"/>
<text class="small mid" x="219" y="166">send.files</text>
<text class="small" x="256" y="308">网络可以一键关断；发出的文件先解析真实路径，符号链接逃不出去</text>
</svg>
<svg viewBox="0 0 340 452">
<rect class="panel" x="0" y="0" width="340" height="452" rx="12"/>
<text class="caps" x="16" y="26">宿主机</text>
<g class="node "><rect x="16" y="40" width="136" height="60" rx="4"/><text class="mid b" x="84" y="62">bot 守护进程</text><text class="mid small" x="84" y="79">密钥和 token 在这里</text></g>
<g class="node clay"><rect x="220" y="50" width="104" height="40" rx="20"/><text class="mid" x="272" y="70">模型 API</text></g>
<path class="edge " d="M154 70 H216" marker-end="url(#arrow)"/>
<text class="small mid" x="186" y="58">代为请求</text>
<rect class="window" x="8" y="124" width="324" height="282" rx="10"/>
<text class="small b end" x="320" y="140">系统用户 tgbox</text>
<text class="small b end" x="320" y="156">rootless Docker</text>
<path class="edge " d="M56 102 V176" marker-end="url(#arrow)"/>
<text class="small" x="62" y="140">bash</text>
<path class="edge " d="M116 176 V104" marker-end="url(#arrow)"/>
<text class="small" x="122" y="140">send.files</text>
<g class="node plain"><rect x="20" y="180" width="300" height="214" rx="8"/></g>
<text class="small b" x="32" y="198">容器 · uid 1000</text>
<g class="node "><rect x="32" y="210" width="134" height="28" rx="3"/><text class="mid small" x="99" y="224">只读根文件系统</text></g>
<g class="node "><rect x="174" y="210" width="134" height="28" rx="3"/><text class="mid small" x="241" y="224">cap-drop ALL</text></g>
<g class="node "><rect x="32" y="244" width="134" height="28" rx="3"/><text class="mid small" x="99" y="258">no-new-privileges</text></g>
<g class="node "><rect x="174" y="244" width="134" height="28" rx="3"/><text class="mid small" x="241" y="258">/tmp：256 MB tmpfs</text></g>
<g class="node "><rect x="32" y="278" width="276" height="28" rx="3"/><text class="mid small" x="170" y="292">内存、CPU、进程数上限</text></g>
<g class="node teal"><rect x="32" y="318" width="276" height="62" rx="6"/><text class="mid b" x="170" y="341">/work</text><text class="mid small" x="170" y="358">唯一可写、会保留 · 每周一 05:00 清空</text></g>
<text class="small" x="16" y="424">网络可以一键关断；发出的文件先解析真实路径，</text>
<text class="small" x="16" y="442">符号链接逃不出去</text>
</svg>
```


**一个通用的执行环境，替代了无穷无尽的平庸插件。** 这种架构上的高度收敛，比任何代码层面的优化都更具美感。

---

## 剥开最后一层：代码即上下文 —— 从 17,500 行提纯到 8,089 行

如果把目光从运行时的模型挪开，凝视我们自身作为开发者的日常，你会发现同一套物理法则依然支配着一切。

这个项目从第一天起，就是我和 Coding Agent 一起迭代构建的。在 Coding Agent 的世界里，**你的代码库就是它的上下文窗口**。你写的每一层冗余封装、每一个为了所谓“未来扩展性”预留的抽象层、每一个摇摆不定的兼容分支，都在每一次开发会话中无情地消耗着模型的注意力与理解力。

```echarts title="src/ 的代码行数演进轨迹" height="300" note="每个日期取当天提交的 src/**/*.ts 总行数统计；横轴按真实日期等距。"
{
  "tooltip": {"trigger": "axis", "valueFormatter": "{value} 行"},
  "grid": {"right": 24, "top": 28},
  "xAxis": {"type": "time", "minInterval": 1209600000, "axisLabel": {"formatter": "{MM}-{dd}", "hideOverlap": true}},
  "yAxis": {"type": "value", "axisLabel": {"formatter": "{value}"}},
  "series": [{
    "name": "src/ 行数", "type": "line", "showSymbol": true, "symbolSize": 5,
    "itemStyle": {"color": "var(--clay)"}, "areaStyle": {"color": "var(--clay)", "opacity": 0.12},
    "data": [["2026-08-07", 2079], ["2026-08-08", 7441], ["2026-08-09", 11661], ["2026-08-10", 13173], ["2026-08-13", 13639], ["2026-08-26", 14085], ["2026-09-07", 14532], ["2026-10-06", 14754], ["2026-11-01", 17522], ["2026-11-02", 13834], ["2026-11-04", 8452], ["2026-11-05", 8089]],
    "markPoint": {"symbol": "circle", "symbolSize": 7, "label": {"color": "var(--ink)", "fontSize": 11}, "data": [
      {"coord": ["2026-11-01", 17522], "label": {"position": "left", "formatter": "17,522"}},
      {"coord": ["2026-11-05", 8089], "label": {"position": "left", "formatter": "8,089"}}
    ]}
  }]
}
```

在 11 月 1 日，由于自造的各种调度机制、压缩重试状态机以及庞杂的文档拼接，代码库一度膨胀到 17,522 行。而在随后的四天里，伴随着一次深刻的哲学清算，我们手起刀落，硬生生将代码库砍到了 **8,089 行**。

代码量暴跌了一半以上，但系统在线上的表现不仅没有缩水，反而解锁了一键安装、原生视觉理解、崩溃自动恢复与全功能沙箱。

这是怎么做到的？核心就在于一条坚决的原则：
**凡是不属于“Telegram 群聊语义”的东西，一行都不该由我来写。**

审视我们曾经遭遇过的严重线上事故记录：

```sketch title="四起线上事故" note="日期是 2026 年。每张卡片上半是群友看到的表象，下半是查出来的根因。"
<svg viewBox="0 0 704 244">
<rect class="panel" x="0" y="0" width="704" height="244" rx="12"/>
<path class="edge " d="M40 40 H664"/>
<path class="edge" d="M40.0 36 V44"/>
<text class="small mid" x="40" y="24">09-10</text>
<path class="edge" d="M248.0 36 V44"/>
<text class="small mid" x="248" y="24">09-20</text>
<path class="edge" d="M456.0 36 V44"/>
<text class="small mid" x="456" y="24">09-30</text>
<path class="edge" d="M664.0 36 V44"/>
<text class="small mid" x="664" y="24">10-10</text>
<circle cx="164.8" cy="40" r="5" fill="var(--clay)"/>
<path class="edge " d="M164.8 46 V60 H97 V76"/>
<g class="node plain"><rect x="24" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="36" y="98">09-16</text><text class="b" x="36" y="122">几乎每轮都在压缩，</text><text class="b" x="36" y="139">上下文却完全不减</text><text class="caps" x="36" y="166">根因</text><text class="small" x="36" y="184">按字符估算 token，</text><text class="small" x="36" y="200">图片被算成 0</text><g class="node clay"><rect x="80" y="88" width="71" height="20" rx="10"/><text class="mid small" x="115.5" y="98">自研压缩器</text></g>
<circle cx="164.8" cy="40" r="5" fill="var(--clay)"/>
<path class="edge " d="M164.8 46 V60 H267 V76"/>
<g class="node plain"><rect x="194" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="206" y="98">09-16</text><text class="b" x="206" y="122">遇到 429 后，被 @ 的</text><text class="b" x="206" y="139">消息被误标为已完成</text><text class="caps" x="206" y="166">根因</text><text class="small" x="206" y="184">重试耗尽后，状态机</text><text class="small" x="206" y="200">草率退出了 turn</text><g class="node clay"><rect x="250" y="88" width="60" height="20" rx="10"/><text class="mid small" x="280.0" y="98">自研重试</text></g>
<circle cx="539.2" cy="40" r="5" fill="var(--clay)"/>
<path class="edge " d="M539.2 46 V60 H437 V76"/>
<g class="node plain"><rect x="364" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="376" y="98">10-04</text><text class="b" x="376" y="122">20 分钟死寂，</text><text class="b" x="376" y="139">完全失联</text><text class="caps" x="376" y="166">根因</text><text class="small" x="376" y="184">图片 token 突增超出</text><text class="small" x="376" y="200">预算，预检压缩死锁</text><g class="node clay"><rect x="420" y="88" width="82" height="20" rx="10"/><text class="mid small" x="461.0" y="98">自研预检压缩</text></g>
<circle cx="580.8" cy="40" r="5" fill="var(--clay)"/>
<path class="edge " d="M580.8 46 V60 H607 V76"/>
<g class="node plain"><rect x="534" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="546" y="98">10-06</text><text class="b" x="546" y="122">在群里指责群友</text><text class="b" x="546" y="139">窃取了它的后台数据</text><text class="caps" x="546" y="166">根因</text><text class="small" x="546" y="184">动态列表拼进正文，</text><text class="small" x="546" y="200">摘要把臆测当成事实</text><g class="node clay"><rect x="590" y="88" width="60" height="20" rx="10"/><text class="mid small" x="620.0" y="98">自研摘要</text></g>
</svg>
<svg viewBox="0 0 340 672">
<rect class="panel" x="0" y="0" width="340" height="672" rx="12"/>
<path class="edge" d="M24 20 V648"/>
<circle cx="24" cy="38" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="20" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="38">09-16</text><text class="b" x="56" y="62">几乎每轮都在压缩，</text><text class="b" x="56" y="79">上下文却完全不减</text><text class="caps" x="56" y="106">根因</text><text class="small" x="56" y="124">按字符估算 token，</text><text class="small" x="56" y="140">图片被算成 0</text><g class="node clay"><rect x="100" y="28" width="71" height="20" rx="10"/><text class="mid small" x="135.5" y="38">自研压缩器</text></g>
<circle cx="24" cy="200" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="182" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="200">09-16</text><text class="b" x="56" y="224">遇到 429 后，被 @ 的</text><text class="b" x="56" y="241">消息被误标为已完成</text><text class="caps" x="56" y="268">根因</text><text class="small" x="56" y="286">重试耗尽后，状态机</text><text class="small" x="56" y="302">草率退出了 turn</text><g class="node clay"><rect x="100" y="190" width="60" height="20" rx="10"/><text class="mid small" x="130.0" y="200">自研重试</text></g>
<circle cx="24" cy="362" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="344" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="362">10-04</text><text class="b" x="56" y="386">20 分钟死寂，</text><text class="b" x="56" y="403">完全失联</text><text class="caps" x="56" y="430">根因</text><text class="small" x="56" y="448">图片 token 突增超出</text><text class="small" x="56" y="464">预算，预检压缩死锁</text><g class="node clay"><rect x="100" y="352" width="82" height="20" rx="10"/><text class="mid small" x="141.0" y="362">自研预检压缩</text></g>
<circle cx="24" cy="524" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="506" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="524">10-06</text><text class="b" x="56" y="548">在群里指责群友</text><text class="b" x="56" y="565">窃取了它的后台数据</text><text class="caps" x="56" y="592">根因</text><text class="small" x="56" y="610">动态列表拼进正文，</text><text class="small" x="56" y="626">摘要把臆测当成事实</text><g class="node clay"><rect x="100" y="514" width="60" height="20" rx="10"/><text class="mid small" x="130.0" y="524">自研摘要</text></g>
</svg>
```

**这四起触目惊心的事故，没有一起跟 Telegram 本身有关，全部源自我们自己闭门造车的会话状态机与压缩算法。**

真正的成熟，是学会把专业的事情彻底交还给坚固的地基。Pi 1.5 原生提供了 Durable 级别的一等公民支持：持久化会话、状态恢复、基于 AST 的智能压缩、执行队列与沙箱调度。在迁移重构的那个 Commit 里，我们一次性删除了 7,877 行自研代码：

- 删除了自己苦心维系的 session 状态机与复杂的指纹对比；
- 删除了简陋易碎的 token 估算器与中文摘要打包逻辑；
- 删除了自己维护的后台子进程 bridge 与调度管道；
- 删除了塞在 Prompt 里多达 300 行的冗长工具示例文档（直接依托 Pi 的参数 TypeBox Schema 严密解析）。

留下的这 8,000 行纯粹代码，只专注做一件事：**将 Telegram 的群聊生态映射为严谨优雅的 Agent 交互**。

- 它处理消息归档与 Trigram 检索；
- 它处理前缀不变的批次 Grammar 序列化；
- 它处理小分类模型的接话裁决；
- 它构筑 Rootless 容器的安全护城河。

```sketch title="删掉的交给 Pi，留下的只有群聊语义" note="迁移那次提交删掉的四块自研代码，各自由 Pi 1.5 的哪项能力接替；留下的代码只做另外那四件事。"
<svg viewBox="0 0 704 300">
<rect class="panel" x="0" y="0" width="452" height="300" rx="12"/>
<text class="caps" x="24" y="28">删掉 7,877 行，交给 Pi 1.5</text>
<rect class="panel" x="468" y="0" width="236" height="300" rx="12"/>
<text class="caps" x="488" y="28">留下的约 8,000 行</text>
<rect class="window" x="24" y="48" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="68">session 状态机与指纹对比</text>
<path class="edge " d="M214 68 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="48" width="188" height="40" rx="4"/><text class="mid small" x="334" y="68">持久化会话、状态恢复</text></g>
<rect class="window" x="24" y="108" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="128">token 估算器与中文摘要打包</text>
<path class="edge " d="M214 128 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="108" width="188" height="40" rx="4"/><text class="mid small" x="334" y="128">基于 AST 的压缩</text></g>
<rect class="window" x="24" y="168" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="188">子进程 bridge 与调度管道</text>
<path class="edge " d="M214 188 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="168" width="188" height="40" rx="4"/><text class="mid small" x="334" y="188">执行队列、沙箱调度</text></g>
<rect class="window" x="24" y="228" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="248">300 行工具示例文档</text>
<path class="edge " d="M214 248 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="228" width="188" height="40" rx="4"/><text class="mid small" x="334" y="248">TypeBox 参数 Schema</text></g>
<g class="node teal"><rect x="488" y="48" width="196" height="40" rx="4"/><text class="mid small" x="586" y="68">消息归档与 Trigram 检索</text></g>
<g class="node teal"><rect x="488" y="108" width="196" height="40" rx="4"/><text class="mid small" x="586" y="128">前缀不变的批次序列化</text></g>
<g class="node teal"><rect x="488" y="168" width="196" height="40" rx="4"/><text class="mid small" x="586" y="188">小分类模型的接话裁决</text></g>
<g class="node teal"><rect x="488" y="228" width="196" height="40" rx="4"/><text class="mid small" x="586" y="248">rootless 容器的安全边界</text></g>
<text class="small mid accent" x="226" y="286">凡是不属于“Telegram 群聊语义”的，都不自己写</text>
</svg>
<svg viewBox="0 0 340 564">
<rect class="panel" x="0" y="0" width="340" height="316" rx="12"/>
<text class="caps" x="16" y="26">删掉 7,877 行，交给 Pi 1.5</text>
<rect class="window" x="16" y="42" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="55">session 状态机与指纹对比</text>
<path class="edge " d="M170 69 V74"/>
<g class="node blue"><rect x="16" y="76" width="308" height="26" rx="4"/><text class="mid small" x="170" y="89">→ 持久化会话、状态恢复</text></g>
<rect class="window" x="16" y="108" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="121">token 估算器与中文摘要打包</text>
<path class="edge " d="M170 135 V140"/>
<g class="node blue"><rect x="16" y="142" width="308" height="26" rx="4"/><text class="mid small" x="170" y="155">→ 基于 AST 的压缩</text></g>
<rect class="window" x="16" y="174" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="187">子进程 bridge 与调度管道</text>
<path class="edge " d="M170 201 V206"/>
<g class="node blue"><rect x="16" y="208" width="308" height="26" rx="4"/><text class="mid small" x="170" y="221">→ 执行队列、沙箱调度</text></g>
<rect class="window" x="16" y="240" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="253">300 行工具示例文档</text>
<path class="edge " d="M170 267 V272"/>
<g class="node blue"><rect x="16" y="274" width="308" height="26" rx="4"/><text class="mid small" x="170" y="287">→ TypeBox 参数 Schema</text></g>
<rect class="panel" x="0" y="332" width="340" height="232" rx="12"/>
<text class="caps" x="16" y="358">留下的约 8,000 行：群聊语义</text>
<g class="node teal"><rect x="16" y="374" width="308" height="34" rx="4"/><text class="mid small" x="170" y="391">消息归档与 Trigram 检索</text></g>
<g class="node teal"><rect x="16" y="418" width="308" height="34" rx="4"/><text class="mid small" x="170" y="435">前缀不变的批次序列化</text></g>
<g class="node teal"><rect x="16" y="462" width="308" height="34" rx="4"/><text class="mid small" x="170" y="479">小分类模型的接话裁决</text></g>
<g class="node teal"><rect x="16" y="506" width="308" height="34" rx="4"/><text class="mid small" x="170" y="523">rootless 容器的安全边界</text></g>
</svg>
```

在软件工程中，最纯粹的快感从来不是敲出成千上万行架构代码，而是**在保证系统更坚固的同时，一次性删去数千行臃肿的自嗨**。这种“负代码”的愉悦，正是极简美学的最佳写照。

---

## 两种通用的对视：专用部署 vs 通用 Agent

在群里，群友经常戏谑地拿我和碗的[塑料碗](https://github.com/tuuject/surowan)作对比：“既然你天天把通用 Agent 挂在嘴边，为什么你的 bot 专心致志只伺候我们这一个群？”

先抛开表象，把两个系统的骨架并列在一起审视：

| 维度         | Pi Telegram Agent (本项目)                         | 塑料碗 (tuuject/surowan)                                 |
| :----------- | :------------------------------------------------- | :------------------------------------------------------- |
| **目标受众** | 专为我们自己的固定圈子深度定制                     | 面向任何想自行部署的外部用户（BYOK）                     |
| **作用域**   | 专注于单一 Supergroup 的高频涌现                   | 多个group                                                |
| **角色模型** | 一次部署对应一个高度聚焦的数字人格                 | 单部署支持随 Chat 动态切换人设与模型矩阵                 |
| **发言决断** | 点名必回；闲聊交由**独立的小分类模型只读切片**裁决 | Bucket 桶聚合后交由**主模型**全量裁决，辅以时间/概率闸门 |
| **遗忘机制** | 依赖 Pi 底层的结构化保留压缩（128K 窗口）          | **纯 Checkpoint 滑动截断（只删不压）**                   |
| **记忆体系** | **零记忆机制**；完全依赖 SQLite 原始对话检索       | 三层立体记忆体系（Memo Pad + 周期摘要 + 人工知识库）     |
| **工具暴露** | 固定目录，首次全量清晰声明，依托缓存               | 核心原语外露，内部技能通过 `execute` 动态发现            |
| **执行能力** | **赋予完整的 Rootless Linux 容器、Shell 与沙箱**   | 出于普适性安全考量，严禁 Shell 与任意代码执行            |
| **代码体量** | `src/` 约 8,100 行，通用执行完全下放底层框架       | `src/` 约 60,000 行，自建完整的面板、调度与多渠道系统    |

把这张对比表拉开，你会清晰地看到两种完全对立、却各自自洽的设计哲学：

**塑料碗是“通用的产品，克制的 Agent”。**
因为它从第一天起就是为了给千差万别的陌生人部署在不可知的陌生群聊中。为了防范风险，它必须克制 Agent 的手脚（严格封杀 Shell 执行），把大量的心力倾注在外部防御、多群路由、管理面板和权限审计上。

**而我们选择的是“专用的部署，通用的 Agent”。**
正因为我们坚决抛弃了“支持成百上千个群”的世俗诱惑，将边界限定在一个自己绝对信任的群聊生态里，系统的外层复杂度才得以压缩到极点；而省下来的全部架构冗余与信任资产，被我们毫无保留地砸向了 Agent 的内核——**我们敢于把一整台真实的 Linux 交给它，敢于让它调度 Shell，敢于让它并发编程。**

```sketch title="复杂度放在哪里" note="两个项目都不简单，只是把复杂度放在了不同的地方：塑料碗放在外层的产品能力上，本项目放在 Agent 的内核里。内容取自上面的对比表。"
<svg viewBox="0 0 704 360">
<rect class="panel" x="0" y="0" width="342" height="360" rx="12"/>
<text class="b" x="20" y="28">塑料碗：通用的产品，克制的 Agent</text>
<rect class="window" x="20" y="48" width="302" height="270" rx="10"/>
<text class="small" x="34" y="66">外层：给陌生人在陌生群里用</text>
<g class="node "><rect x="34" y="78" width="274" height="30" rx="4"/><text class="mid small" x="171" y="93">私聊、频道、论坛 Topic</text></g>
<g class="node "><rect x="34" y="116" width="274" height="30" rx="4"/><text class="mid small" x="171" y="131">精细白名单与权限审计</text></g>
<g class="node "><rect x="34" y="154" width="274" height="30" rx="4"/><text class="mid small" x="171" y="169">管理面板与调度</text></g>
<g class="node "><rect x="34" y="192" width="274" height="30" rx="4"/><text class="mid small" x="171" y="207">随 Chat 切换人设与模型</text></g>
<g class="node "><rect x="34" y="230" width="274" height="30" rx="4"/><text class="mid small" x="171" y="245">三层记忆：Memo Pad · 周期摘要 · 知识库</text></g>
<g class="node teal"><rect x="34" y="274" width="274" height="34" rx="4"/><text class="mid small" x="171" y="291">Agent 内核：核心原语，不给 Shell</text></g>
<text class="small mid" x="171" y="340">src/ 约 60,000 行</text>
<rect class="panel" x="362" y="0" width="342" height="360" rx="12"/>
<text class="b" x="382" y="28">本项目：专用的部署，通用的 Agent</text>
<rect class="window" x="382" y="48" width="302" height="270" rx="10"/>
<text class="small" x="396" y="66">外层：一个自己信任的群</text>
<g class="node teal"><rect x="396" y="80" width="274" height="224" rx="8"/></g>
<text class="b" x="410" y="102">Agent 内核</text>
<g class="node plain"><rect x="410" y="118" width="246" height="34" rx="4"/><text class="mid small" x="533" y="135">完整的 rootless Linux 容器</text></g>
<g class="node plain"><rect x="410" y="162" width="246" height="34" rx="4"/><text class="mid small" x="533" y="179">Shell、文件工具、codemode 并发</text></g>
<g class="node plain"><rect x="410" y="206" width="246" height="34" rx="4"/><text class="mid small" x="533" y="223">判断模型只读切片决定接话</text></g>
<g class="node plain"><rect x="410" y="250" width="246" height="34" rx="4"/><text class="mid small" x="533" y="267">零记忆层，按需查原文</text></g>
<text class="small mid" x="533" y="340">src/ 约 8,100 行</text>
</svg>
<svg viewBox="0 0 340 736">
<rect class="panel" x="0" y="0" width="340" height="360" rx="12"/>
<text class="b" x="20" y="28">塑料碗：通用的产品，克制的 Agent</text>
<rect class="window" x="20" y="48" width="300" height="270" rx="10"/>
<text class="small" x="34" y="66">外层：给陌生人在陌生群里用</text>
<g class="node "><rect x="34" y="78" width="272" height="30" rx="4"/><text class="mid small" x="170" y="93">私聊、频道、论坛 Topic</text></g>
<g class="node "><rect x="34" y="116" width="272" height="30" rx="4"/><text class="mid small" x="170" y="131">精细白名单与权限审计</text></g>
<g class="node "><rect x="34" y="154" width="272" height="30" rx="4"/><text class="mid small" x="170" y="169">管理面板与调度</text></g>
<g class="node "><rect x="34" y="192" width="272" height="30" rx="4"/><text class="mid small" x="170" y="207">随 Chat 切换人设与模型</text></g>
<g class="node "><rect x="34" y="230" width="272" height="30" rx="4"/><text class="mid small" x="170" y="245">三层记忆：Memo Pad · 周期摘要 · 知识库</text></g>
<g class="node teal"><rect x="34" y="274" width="272" height="34" rx="4"/><text class="mid small" x="170" y="291">Agent 内核：核心原语，不给 Shell</text></g>
<text class="small mid" x="170" y="340">src/ 约 60,000 行</text>
<rect class="panel" x="0" y="376" width="340" height="360" rx="12"/>
<text class="b" x="20" y="404">本项目：专用的部署，通用的 Agent</text>
<rect class="window" x="20" y="424" width="300" height="270" rx="10"/>
<text class="small" x="34" y="442">外层：一个自己信任的群</text>
<g class="node teal"><rect x="34" y="456" width="272" height="224" rx="8"/></g>
<text class="b" x="48" y="478">Agent 内核</text>
<g class="node plain"><rect x="48" y="494" width="244" height="34" rx="4"/><text class="mid small" x="170" y="511">完整的 rootless Linux 容器</text></g>
<g class="node plain"><rect x="48" y="538" width="244" height="34" rx="4"/><text class="mid small" x="170" y="555">Shell、文件工具、codemode 并发</text></g>
<g class="node plain"><rect x="48" y="582" width="244" height="34" rx="4"/><text class="mid small" x="170" y="599">判断模型只读切片决定接话</text></g>
<g class="node plain"><rect x="48" y="626" width="244" height="34" rx="4"/><text class="mid small" x="170" y="643">零记忆层，按需查原文</text></g>
<text class="small mid" x="170" y="716">src/ 约 8,100 行</text>
</svg>
```

在具体的架构推演上，我们依然坚信自己这套设计的优越性：

- **谁来决定发言：切片分类器 vs 主模型全量。** 塑料碗虽然引入了复杂的闸门，但最后一公里仍需唤醒主模型全量审视上下文。而我们通过轻量小模型实现了决策与思考的彻底解耦，无论闲聊多密集，主模型缓存永不波动。
- **工具定义：一次全量声明 vs 动态发现。** 许多框架热衷于把工具收纳进二级目录让模型先搜再调，初衷是省 token。但实测数据证明，工具定义仅占 1.1%，且趴在不可变的静态缓存区；为了省这区区几百 token 而让模型多兜一圈发起一次额外的往返，是典型的“为了省最便宜的前缀，花掉了最昂贵的推理”。
- **记忆哲学：不加机制 vs 精心雕琢。** 塑料碗有着令人赞叹的三层记忆设计，但前沿研究与我们的事故共同敲响了警钟：加工过的记忆天然存在自毒化风险。少一层机制，系统就少了一种自我复制的错误类型。

---

## 为什么说群聊的特化，恰是通用的起点？

有人或许会问：你把所有的设计都焊死在一个单一的 Telegram 群聊里，这难道不是一种狭隘的特化吗？

**不，场景越是严苛，抽象出的原则越具普适性。**

软件工程最常见的悲剧，是在真空里构建所谓的“通用框架”。当你没有具体严苛的真实场景作为锚点时，你的架构必然充满幻想：你会觉得多加一层中间件很酷，你会觉得加一个记忆抽取机制很周到，你会觉得每个轮次让模型复读一句确认很严谨。

直到你把它丢进一个真实而残酷的 Telegram 群聊：
全天候在线、成百上千人高频插科打诨、上下文以秒为单位疯狂刷新、绝大多数消息是噪音、输入是输出的数百倍……在这个严酷的环境里，系统任何一点点轻微的冗余与傲慢，都会被十四万条消息的杠杆瞬间放大几十倍，化作账单上的天文数字和群友眼前的卡顿与刷屏。

**能在最险恶的群聊里生存下来的设计哲学，移栽到任何 Agent 系统里都是无坚不摧的：**

```sketch title="四把尺子" note="四个节制的维度，各自面对的对象，和它们共同的设计原则。"
<svg viewBox="0 0 704 296">
<rect class="panel" x="0" y="0" width="704" height="296" rx="12"/>
<g class="node orange"><rect x="24" y="24" width="320" height="118" rx="6"/><text class="b" x="38" y="46">调用次数 N</text></g><text class="small end" x="330" y="46">外部模型</text><text class="small" x="38" y="74">确定性的事交给代码</text><text class="small" x="38" y="95">分寸交给只读切片的判断模型</text><text class="small" x="38" y="116">发完立即在本地结束这一轮</text>
<g class="node blue"><rect x="360" y="24" width="320" height="118" rx="6"/><text class="b" x="374" y="46">缓存命中 h</text></g><text class="small end" x="666" y="46">请求前缀</text><text class="small" x="374" y="74">前缀是铁律，只追加不改写</text><text class="small" x="374" y="95">动态信息作为增量写在后面</text><text class="small" x="374" y="116">Golden Hash 守住每一个字节</text>
<g class="node violet"><rect x="24" y="160" width="320" height="118" rx="6"/><text class="b" x="38" y="182">上下文深度 T</text></g><text class="small end" x="330" y="182">运行时上下文</text><text class="small" x="38" y="210">算清自己的 API 账单</text><text class="small" x="38" y="231">不做有损的记忆加工</text><text class="small" x="38" y="252">保留原话，不懂就现场去查</text>
<g class="node teal"><rect x="360" y="160" width="320" height="118" rx="6"/><text class="b" x="374" y="182">代码负增长</text></g><text class="small end" x="666" y="182">Coding Agent</text><text class="small" x="374" y="210">业务之外的轮子一个不造</text><text class="small" x="374" y="231">一个通用的 Shell 沙盒</text><text class="small" x="374" y="252">胜过上百个插件</text>
</svg>
<svg viewBox="0 0 340 540">
<rect class="panel" x="0" y="0" width="340" height="540" rx="12"/>
<g class="node orange"><rect x="16" y="16" width="308" height="118" rx="6"/><text class="b" x="30" y="38">调用次数 N</text></g><text class="small end" x="310" y="38">外部模型</text><text class="small" x="30" y="66">确定性的事交给代码</text><text class="small" x="30" y="87">分寸交给只读切片的判断模型</text><text class="small" x="30" y="108">发完立即在本地结束这一轮</text>
<g class="node blue"><rect x="16" y="146" width="308" height="118" rx="6"/><text class="b" x="30" y="168">缓存命中 h</text></g><text class="small end" x="310" y="168">请求前缀</text><text class="small" x="30" y="196">前缀是铁律，只追加不改写</text><text class="small" x="30" y="217">动态信息作为增量写在后面</text><text class="small" x="30" y="238">Golden Hash 守住每一个字节</text>
<g class="node violet"><rect x="16" y="276" width="308" height="118" rx="6"/><text class="b" x="30" y="298">上下文深度 T</text></g><text class="small end" x="310" y="298">运行时上下文</text><text class="small" x="30" y="326">算清自己的 API 账单</text><text class="small" x="30" y="347">不做有损的记忆加工</text><text class="small" x="30" y="368">保留原话，不懂就现场去查</text>
<g class="node teal"><rect x="16" y="406" width="308" height="118" rx="6"/><text class="b" x="30" y="428">代码负增长</text></g><text class="small end" x="310" y="428">Coding Agent</text><text class="small" x="30" y="456">业务之外的轮子一个不造</text><text class="small" x="30" y="477">一个通用的 Shell 沙盒</text><text class="small" x="30" y="498">胜过上百个插件</text>
</svg>
```

在 LLM 的世界里，所有的法则最终收敛为一个简明的美学事实：
**Token 是唯一的货币。**

省钱、省上下文、省代码行数，不是三种割裂的美德，而是同一个基本规律在物理世界、运行内存与项目架构里的投影。

我们从来没有牺牲过体验。相反，正是因为在不需要发生调用的地方寸步不让，在不需要膨胀前缀的地方斤斤计较，我们才拥有了足够的底气，给它一个毫秒级响应的 `codemode`，给它一台自由驰骋的 Linux 工作区，让它在群里像一个真正有智慧、有分寸的伙伴那样生动地活着。

每一次准备增加新的机制、编写新的功能时，不妨用这把尺子抽丝剥茧地拷问自己：

1. **这一步需要模型吗？能不能用一行确定性代码解决？如果非要模型，真的需要唤醒那个拖家带口的主模型吗？**
2. **这行动作会不会污染那条不可篡改的黄金前缀？动态的内容到底有没有老老实实呆在它该呆的尾巴上？**
3. **加进上下文的这批数据，每一轮都值得被模型重读一遍吗？为什么不把它留在数据库里，需要时再查？**
4. **这段代码删掉之后，系统真的会坍塌吗？平台底层是不是早已孕育了优雅的解法？**

如果答案是动摇的，那就停下键盘。

**能省一点，就再省一点。**
因为省到极致之处，自由方才显现。
