---
title: "Save a Little, Then Save a Little More"
description: "A three-month ledger of 74,000+ model calls from two bots living in a Telegram group: in LLM applications, cost, context, and code size are physically the same currency. Every act of radical restraint ultimately pays off in pure freedom and user experience."
date: 2026-11-05
updated: 2026-11-10
tag: "Tech"
tags:
  - "LLM"
  - "Telegram"
  - "Prompt Caching"
  - "Agent"
  - "Architecture"
  - "Cost Optimization"
draft: false
---

Two bots live in our Telegram group.

One is [Pi Telegram Agent](https://github.com/mizorewww/pi-extension-telegram-agent), written by me; the other is [Surowan](https://github.com/tuuject/surowan) ("Plastic Bowl"), written by our group member tcdw. The two projects share not a single line of code. Their architectural philosophies, tech stacks, and even conversational personalities are polar opposites. Yet over months of real-world group chat collisions, their evolutionary trajectories converged on the exact same commandment: **save a little, then save a little more.**

Many people think "saving" is a compromise on resources—a stingy exercise in engineering self-flagellation. Quite the opposite. Over the past three months and more than 74,000 production model calls, I have become increasingly convinced: **in LLM-driven systems, frugality is the highest form of design aesthetics.**

When you peel back the flashy scaffolding of an agent system layer by layer, you discover that code, context, and cloud bills are physically projections of the exact same entity—**Tokens**—across different dimensions. Elaborate mechanisms almost always breed high entropy and fragility, whereas every act of restraint derived from strict first-principles reasoning ultimately pays off in remarkable lightness, speed, and capability.

This post is both an honest ledger postmortem from a high-frequency production environment and an exercise in stripping away appearances to reach the core.

## TL;DR

- **The Unified Currency Hypothesis:** Your cloud bill is tokens, your context window is tokens, and to a coding agent, your codebase is tokens too. They are not separate management targets, but projections of a single conservation law across different dimensions.
- **Dissecting the Lion's Share of the Bill:** 74,644 model calls reveal a brutal reality—**input is 374× larger than output**. Nearly 90% of a group chat bot's token ledger is chat history, while tool schemas account for just 1.1%. The survival of the system hangs entirely on context length and cache hit rate.
- **Decoupling Perception from Reasoning (Controlling Call Volume $N$):** Replying when explicitly mentioned is deterministic logic that requires zero intelligence. Deciding whether to chime in on ambient chatter is offloaded to a dedicated small classifier model that reads only a 6-line slice (~1,650 tokens, $0.000033 per call), never polluting the main model's context. And once a message is sent, a local primitive terminates the turn immediately—pinning non-essential round-trips down to an average of 1.13 calls per turn.
- **Byte-Level Paranoia (Guarding Cache Hit Rate $h$):** The prefix must grow monotonically and never be mutated. Dynamic stickers and asynchronous media updates are projected via read-only metadata and `beforeRequest` into `[System Note]` blocks that never enter persistent session history. Backed by 55 versions of Golden Hash regression tests, this pins our measured DeepSeek cache hit rate at 98.7%, slashing input costs to 1/30th of uncached pricing.
- **Verbatim Words Over Hallucinated Summaries (Compressing Context Depth $T$):** We abandoned all fancy multi-tier memory extraction and graph databases. Both frontier research and production scars confirm that processed summaries are not only expensive to maintain, they actively self-poison. We fixed our context window at 128K, left raw history sleeping in SQLite, and gave the bot a clean workbench to look things up on demand: literal substring search when it remembers the exact words, semantic search when it only remembers the gist—and what comes back is always the verbatim transcript.
- **Cashing Restraint In for Freedom:** The resources we saved don't just sit in a bank account; they buy extraordinary user experience. `codemode` lets the bot "speak while acting" with parallel retrieval, and a single rootless Linux container lets the model orchestrate native Unix tools better than a hundred hand-written plugins ever could.
- **Decluttering the Codebase Itself:** Not a single line of code outside "Telegram group chat semantics" is homegrown. By leaning on the underlying Pi engine, we distilled `src/` from 17,500 lines down to 8,100 lines—achieving far greater resilience through negative code.
- **Two Philosophies of Generality:** Surowan builds a *general product with a restrained agent*; I chose a *specialized deployment with a general agent*.

---

## Gazing into the Ledger: Where the Real Money Flows

All design aesthetics must rest on an unflinching gaze at physical reality.

From its launch on August 7 to the architectural overhaul on November 4, my bot recorded comprehensive telemetry for every single production model call: input size, cached tokens read, output volume, and the exact byte breakdown of each segment inside every request. After three months, the overall ledger looks like this:

```stats title="Three-Month Ledger" meta="2026-08-07 — 2026-11-04 · Two bots · One group" note="Input tokens include cache hits."
## Scale
Group messages | 144,148 | Human messages after router logging began
Model calls | 74,644 | Including 11,544 compaction calls
Public replies | 39,615 | Total send invocations
## Tokens
Input | 5.34B | Including 3.50B cache reads
Output | 14.3M | Input is 374× output
Calls per turn | 1.13 | Non-compaction calls ÷ started turns
```

**Input is 374 times output.**

This is the first reality check that hits anyone building an LLM group chat system. Our intuition from human-computer interaction tells us that "conversation" is a symmetric game of throwing out a sentence and getting one back. In a high-frequency multi-person group chat, the truth is ruthlessly asymmetric: a group member posts a casual "haha true," and the model must chew through a heavy system prompt, tool definitions, and a massive stretch of chat history—only to think through several layers and reply with two words, or choose to stay silent.

**Physically, a group chat system's bill consists almost entirely of *reading*.**

Over these three months, we rotated through three primary models: first DeepSeek V4 Flash, then Gemini Flash in late August, and finally SWE-2 in late September. Every number below was recorded across all three in production:

```echarts title="Weekly Model Calls by Primary Model" height="320" note="Excludes compaction calls. Grouped by calendar week (UTC+8), starting from the Aug 7 launch; data comes from a local snapshot taken on Nov 1 (three days shorter than the ledger above, leaving the final week partial). Another 521 trial calls to GLM, GPT mini, etc. are omitted."
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

So what exactly are those billions of tokens reading? We sampled and dissected over 40,000 real request payloads, placing them side by side with a single request captured before my earlier optimization of [Memoh](/en/posts/making-memoh-cheaper-on-telegram/):

```sketch title="What Goes Inside a Single Request" note="This project: average across 40,593 requests (93,067 tokens per call). Memoh before optimization: a single captured request, measured by byte share. Dashed boxes represent total input per request, scaled proportionally."
<svg viewBox="0 0 704 336">
<rect class="panel" x="0" y="0" width="704" height="336" rx="12"/>
<text class="caps" x="28" y="30">THIS PROJECT</text>
<text class="small" x="28" y="50">Average of 40,593 requests · 93,067 tokens</text>
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
<text class="small" x="218" y="103.832">tool schemas <tspan class="b">1.1%</tspan></text>
<path class="edge " d="M200 102.7 H210 V121.8 H214"/>
<text class="small" x="218" y="121.832">compaction summary <tspan class="b">2.1%</tspan></text>
<path class="edge " d="M200 205.5 H214"/>
<text class="small" x="218" y="205.544">chat history <tspan class="b">86.6%</tspan></text>
<text class="caps" x="372" y="30">MEMOH BEFORE</text>
<text class="small" x="372" y="50">Single captured request · by bytes</text>
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
<text class="small" x="562" y="123.532">tool schemas <tspan class="b">21.3%</tspan></text>
<path class="edge " d="M544 227.1 H558"/>
<text class="small" x="562" y="227.12">chat history <tspan class="b">68.0%</tspan></text>
<text class="small" x="562" y="245.12">compaction summary 0%</text>
</svg>
<svg viewBox="0 0 340 556">
<rect class="panel" x="0" y="0" width="340" height="556" rx="12"/>
<text class="caps" x="16" y="22">THIS PROJECT</text>
<text class="small" x="16" y="42">Average of 40,593 requests · 93,067 tokens</text>
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
<text class="small" x="170" y="93.996">tool schemas <tspan class="b">1.1%</tspan></text>
<path class="edge " d="M152 90.2 H162 V112.0 H166"/>
<text class="small" x="170" y="111.996">compaction <tspan class="b">2.1%</tspan></text>
<path class="edge " d="M152 177.1 H166"/>
<text class="small" x="170" y="177.132">chat history <tspan class="b">86.6%</tspan></text>
<text class="caps" x="16" y="294">MEMOH BEFORE</text>
<text class="small" x="16" y="314">Single captured request · by bytes</text>
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
<text class="small" x="170" y="379.846">tool schemas <tspan class="b">21.3%</tspan></text>
<path class="edge " d="M152 467.4 H166"/>
<text class="small" x="170" y="467.36">chat history <tspan class="b">68.0%</tspan></text>
<text class="small" x="170" y="485.36">compaction 0%</text>
</svg>
```

This diagram pours cold water on a lot of self-important "architectural optimizations":
People love obsessing over prompt wording, trimming two sentences from the system prompt, or shortening tool names by a few characters—yet even when you optimize tool schemas to the bone, they account for a mere 1.1% of real requests.

**The total cost of the entire system is governed by a minimalist mathematical model:**

$$
C = N \times T \times \left[(1-h) + h \times r\right]
$$

- $N$: how many times the model is woken up (call volume);
- $T$: how much context depth it must swallow each time it wakes up (input tokens);
- $h$: the fraction of context that hits the Prompt Cache (cache hit rate);
- $r$: the ratio of cached token pricing to full price (an astonishing 1/50 on DeepSeek, 1/10 on Claude).

This equation is our immovable foundation. In engineering terms, there are only three degrees of freedom where you can apply leverage:

1. **Wake it up less often (shrink $N$)**;
2. **Lock down every byte already read (maximize $h$)**;
3. **Strip away everything non-essential from each read (compress $T$)**.

Below, we will peel back our architectural choices around restraint and freedom along these three variables, one layer at a time.

---

## Layer 1: Controlling Call Volume $N$ — Never Pay Full Price for Silence and Waiting

The cheapest model call is **the one that never happens**.

The most fundamental difference between a group chat and a 1-on-1 DM is that a group chat is a public, ever-flowing torrent of information—the vast majority of which has nothing to do with the bot. And that torrent almost never stops: only between 4 a.m. and 6 a.m. does the chat go quiet, peaking in activity after 10 p.m.

```echarts title="When Group Members Talk" height="300" note="Human message count by day of week and 2-hour slot (UTC+8), totaling 141,717 messages. Taken from the local database snapshot at noon on Nov 1 (three days shorter than the Nov 4 ledger above). More orange means more messages."
{
  "tooltip": {"position": "top"},
  "grid": {"top": 8, "bottom": 4, "left": 4, "right": 8},
  "xAxis": {"type": "category", "data": ["00:00", "02:00", "04:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"], "splitArea": {"show": false}},
  "yAxis": {"type": "category", "inverse": true, "data": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]},
  "visualMap": {"show": false, "min": 0, "max": 5500},
  "series": [{
    "name": "Messages", "type": "heatmap",
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

Now look at the ruthless funnel from incoming messages to actual public replies over those three months:

```data title="From Group Messages to Model Calls" bars="Count" note="Turns started = messages marked as started by routing; model calls exclude compaction."
Stage | Count
Group messages | 144,148
Bot busy, merged into next turn | 50,532
Turns started | 55,776
Model calls | 63,100
Public replies | 39,615
```

At the bottom of the funnel sits a stark fact: out of 144,000 group chat messages, the bot spoke publicly fewer than 40,000 times. Even among the 55,776 turns where it woke up to think, in more than 16,000 of them the model read the entire context and politely chose silence.

This brings us to our first sharp contradiction:
**How does the bot know whether to chime in? And once it decides to speak, how do we end the turn as quickly as possible?**

### First Principles: Social Tact Doesn't Require a 90,000-Token Panoramic Memory

"Should I chime in?" looks like an esoteric social judgment, but when you break it down, it splits into two completely distinct scenarios:

1. **Deterministic scenarios:** A human explicitly @mentions the bot, replies to its message, or calls it by name. There is zero ambiguity here—a single line of deterministic code or regex routing can make the call. **Not a single millisecond of model inference should ever be wasted here.**
2. **Ambient scenarios:** For the remaining sea of casual chatter, what the bot needs is *social tact*.

What does social tact look like in a group chat? Watch a real human group member:

- Someone tosses a tricky technical question to the group, and it hangs unanswered for three minutes;
- Someone follows up directly on what the bot just said a moment ago;
- Two people are closely planning dinner together in a private, self-contained exchange;
- Another bot has already given a spot-on answer;
- Several bots are caught in a loop repeating each other.

**Examine these scenarios and you reach a striking conclusion: making this call doesn't require the bot to know who it is, what happened in the group three months ago, or what tools it carries in its heavy toolbox. It depends solely on the conversational flow of the last five to ten lines.**

Common off-the-shelf approaches crumble against this deduction:

- **Approach A: Let the primary model decide everything.** Waking the primary model once means hauling 93,000 tokens of baggage out of bed. If the primary model thinks for two seconds and concludes "I shouldn't interrupt," you just paid full price on nearly 100,000 tokens for that silence. Multiply that across 140,000 casual messages and your bill explodes.
- **Approach B: Rely on rules and random probability gates.** Rolling a die or matching keywords is free, but it has zero comprehension. It plays deaf when someone genuinely needs technical help, yet leaps out on a 10% roll to crack a bad joke while group members are having a serious discussion or venting frustration.

The right solution must live at the intersection of the two: **it must have semantic comprehension, but it may only read a tiny slice; it only needs to output a probability, not generate a reply.**

Follow those constraints and the answer becomes obvious: **introduce a dedicated small classifier model.**

```mermaid title="How an Incoming Group Message Decides Whether to Wake the Primary Model" note="Direct mentions take a deterministic route without touching any model; all other messages send only the last few lines to the decider model, leaving the primary model's context and cache untouched."
flowchart TD
  M[Group Message] --> Q{"@ / Reply / Name?"}
  Q -- Yes --> A["Primary Model<br/>Full context, ~93K tokens"]
  Q -- No --> D["Decider Model<br/>Last 6 lines only, ~1,650 tokens"]
  D -- "Prob ≥ Threshold" --> A
  D -- "Prob < Threshold" --> S[Stay Silent]
  A --> R[Speak or Stay Silent]
```

I chose `pplx-decider-v1.2`, a specialized small classifier model on OpenRouter (driven via Pi 1.5's native `classify` abstraction). It is dirt cheap along three irreplaceable dimensions:

1. **Fed only a slice:** It receives only the newly arrived messages plus the preceding 6 lines as background—stripping away the entire system prompt, long-range history, and tool declarations.
2. **Prefix isolation:** Its invocation is a completely independent short request. Not a single byte of the primary model's core context is touched, so **the primary model's Prompt Cache remains 100% intact**.
3. **Negligible cost:** A single decision consumes ~1,650 tokens (mostly fixed few-shot examples), costs ~$0.000033, and finishes in a few hundred milliseconds. Even if we ran every single one of the 144,000 group messages through it, the total bill would be just $4.70.

```echarts title="Tokens Read to Decide 'Should I Chime In?'" height="200" note="Primary model shows the average request from our ledger; decider model shows the measured payload including all few-shot examples. Cost per 1,000 decisions: $0.033 for the decider model vs. ~$0.26 to $1.50+ for the primary model depending on provider."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "grid": {"top": 8, "right": 64},
  "xAxis": {"type": "value", "axisLabel": {"formatter": "{value}"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["Primary (full context)", "Decider (6-line slice)"]},
  "series": [{
    "name": "Input tokens", "type": "bar", "barWidth": 24,
    "label": {"show": true, "position": "right", "formatter": "{c}", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [{"value": 93067, "label": {"formatter": "93,067"}}, {"value": 1650, "label": {"formatter": "1,650"}, "itemStyle": {"color": "var(--clay)"}}]
  }]
}
```

The decider model only went live on November 5. For the three months prior, ambient messages were gated by a probabilistic dice roll—and the ledger recorded the price of that design in plain sight: nearly every single turn was let in by the dice, forcing the primary model to read over 90,000 tokens from scratch each time.

```echarts title="What Woke the Bot Before the Decider Model Launched" height="300" note="Messages marked as started in routing logs by trigger reason, totaling 54,457 turns from the same Nov 1 local snapshot (three days shorter than the funnel table above). Over the same period, 50,362 messages arrived while the bot was busy and merged into the next turn, and 4,849 were skipped during cooldown."
{
  "tooltip": {"trigger": "item"},
  "series": [{
    "name": "Trigger Reason", "type": "pie", "radius": ["40%", "62%"], "center": ["50%", "54%"],
    "label": {"formatter": "{b}\n{d}%", "lineHeight": 16},
    "labelLine": {"length": 10, "length2": 14},
    "data": [
      {"name": "Probability Gate", "value": 52323, "itemStyle": {"color": "var(--clay)"}},
      {"name": "Replied To", "value": 1394, "itemStyle": {"color": "var(--stone)"}},
      {"name": "Called by Name", "value": 644, "itemStyle": {"color": "var(--kraft)"}},
      {"name": "@Mentioned", "value": 96, "itemStyle": {"color": "var(--sky)"}}
    ]
  }]
}
```

How do we give a small model without deep world knowledge good social judgment? **Pack it with high-density few-shot examples.**
In `src/agent/decider.ts`, we distilled 14 universal examples covering typical group chat micro-dynamics, lifting classifier recall straight from 0.53 to 0.71.

An even more interesting aesthetic insight came from tuning the **threshold**:
When we tried rewriting the prompt to sound more enthusiastic—nudging the model to "want to talk more"—we found that the entire probability curve merely shifted within the noise band while burning 20% more tokens. This validated a classic principle of cybernetics: **the classifier model is responsible for relative ranking; the threshold is responsible for projecting personality.**
Want a cool, laconic geek bot? Raise the threshold to 0.45. Want a warm, lively regular who cheers everyone on? Drop it to 0.15. The prompt never needs to be torn down and rewritten, preserving the purity of the code.

### Send and Leave: Eliminating the General Agent's Monologue

Once the primary model is woken up, another massive source of waste lurks in the action execution chain.

General-purpose agent frameworks suffer from a severe case of **compulsive reporting**:
After the model calls `send()`, the framework hands the Telegram delivery confirmation JSON back to the model as a tool result. The model then reloads all 93,000 tokens of context just to smugly report to the human: *"I have sent the message!"*

In a personal terminal assistant, that might pass for thoroughness. In a high-frequency Telegram group chat, it is an unmitigated disaster. Not only does it burn an entire extra full-context call, worse still, a group chat must never be polluted by the model's internal monologue or meta-commentary.

We laid down two iron rules:

1. **Private reasoning, explicit speech:** The model's raw Assistant text stays strictly inside the console logs; **a message only crosses into the group chat when the model explicitly calls the `send` tool**. If the model reads the context and decides not to call `send`, the turn ends silently.
2. **Terminal Send (`terminate` primitive):** The moment a single `send` call succeeds, the runtime invokes Pi's native `terminate` mechanism—**forcibly cutting off the loop and refusing to return control to the model**.

```sketch title="Send and Terminate: Never Come Back Just to Report" note="A general agent loop feeds the delivery result back to the model, forcing it to re-read the entire context just to say 'Sent!'. In our project, a successful send immediately ends the turn via Pi's terminate primitive; if the model doesn't call send, its text stays in the console."
<svg viewBox="0 0 704 404">
<rect class="panel" x="0" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="24" y="28">GENERAL AGENT LOOP</text>
<g class="node "><rect x="51" y="48" width="240" height="46" rx="4"/><text class="mid b" x="171" y="63">Primary Model</text><text class="mid small" x="171" y="80">Reads 93K tokens</text></g>
<circle class="glyph" cx="65" cy="68" r="2.4"/><circle class="glyph" cx="65" cy="74" r="2.4"/><circle class="glyph" cx="73" cy="65" r="2.4"/><circle class="glyph" cx="73" cy="71" r="2.4"/><circle class="glyph" cx="73" cy="77" r="2.4"/><circle class="glyph" cx="81" cy="68" r="2.4"/><circle class="glyph" cx="81" cy="74" r="2.4"/>
<path class="edge " d="M171 96 V118" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="81" y="122" width="180" height="30" rx="4"/><text class="mid" x="171" y="137">send</text></g>
<path class="edge " d="M171 154 V176" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="81" y="180" width="180" height="30" rx="4"/><text class="mid small" x="171" y="195">tool result: delivered</text></g>
<path class="edge " d="M171 212 V234" marker-end="url(#arrow)"/>
<g class="node "><rect x="51" y="238" width="240" height="46" rx="4"/><text class="mid b" x="171" y="253">Primary Model</text><text class="mid small" x="171" y="270">Re-reads 93K + result</text></g>
<circle class="glyph" cx="65" cy="258" r="2.4"/><circle class="glyph" cx="65" cy="264" r="2.4"/><circle class="glyph" cx="73" cy="255" r="2.4"/><circle class="glyph" cx="73" cy="261" r="2.4"/><circle class="glyph" cx="73" cy="267" r="2.4"/><circle class="glyph" cx="81" cy="258" r="2.4"/><circle class="glyph" cx="81" cy="264" r="2.4"/>
<path class="edge " d="M171 286 V308" marker-end="url(#arrow)"/>
<g class="node clay"><rect x="51" y="312" width="240" height="30" rx="4"/><text class="mid small" x="171" y="327">"I've sent the message!"</text></g>
<text class="small mid accent" x="171" y="372">1 extra full-price call + 1 useless message</text>
<rect class="panel" x="362" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="386" y="28">THIS PROJECT</text>
<g class="node "><rect x="413" y="48" width="240" height="46" rx="4"/><text class="mid b" x="533" y="63">Primary Model</text><text class="mid small" x="533" y="80">Reads 93K tokens</text></g>
<circle class="glyph" cx="427" cy="68" r="2.4"/><circle class="glyph" cx="427" cy="74" r="2.4"/><circle class="glyph" cx="435" cy="65" r="2.4"/><circle class="glyph" cx="435" cy="71" r="2.4"/><circle class="glyph" cx="435" cy="77" r="2.4"/><circle class="glyph" cx="443" cy="68" r="2.4"/><circle class="glyph" cx="443" cy="74" r="2.4"/>
<path class="edge " d="M533 96 V118" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="443" y="122" width="180" height="30" rx="4"/><text class="mid" x="533" y="137">send</text></g>
<path class="edge " d="M533 154 V176" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="413" y="180" width="240" height="46" rx="4"/><text class="mid b" x="533" y="195">terminate</text><text class="mid small" x="533" y="212">send succeeded; turn ends here</text></g>
<text class="small mid" x="533" y="262">When send is not called:</text>
<text class="small mid" x="533" y="280">assistant text stays in console,</text>
<text class="small mid" x="533" y="298">turn ends silently</text>
<text class="small mid accent" x="533" y="372">Average 1.13 calls per turn</text>
</svg>
<svg viewBox="0 0 340 824">
<rect class="panel" x="0" y="0" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="28">GENERAL AGENT LOOP</text>
<g class="node "><rect x="50" y="48" width="240" height="46" rx="4"/><text class="mid b" x="170" y="63">Primary Model</text><text class="mid small" x="170" y="80">Reads 93K tokens</text></g>
<circle class="glyph" cx="64" cy="68" r="2.4"/><circle class="glyph" cx="64" cy="74" r="2.4"/><circle class="glyph" cx="72" cy="65" r="2.4"/><circle class="glyph" cx="72" cy="71" r="2.4"/><circle class="glyph" cx="72" cy="77" r="2.4"/><circle class="glyph" cx="80" cy="68" r="2.4"/><circle class="glyph" cx="80" cy="74" r="2.4"/>
<path class="edge " d="M170 96 V118" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="80" y="122" width="180" height="30" rx="4"/><text class="mid" x="170" y="137">send</text></g>
<path class="edge " d="M170 154 V176" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="80" y="180" width="180" height="30" rx="4"/><text class="mid small" x="170" y="195">tool result: delivered</text></g>
<path class="edge " d="M170 212 V234" marker-end="url(#arrow)"/>
<g class="node "><rect x="50" y="238" width="240" height="46" rx="4"/><text class="mid b" x="170" y="253">Primary Model</text><text class="mid small" x="170" y="270">Re-reads 93K + result</text></g>
<circle class="glyph" cx="64" cy="258" r="2.4"/><circle class="glyph" cx="64" cy="264" r="2.4"/><circle class="glyph" cx="72" cy="255" r="2.4"/><circle class="glyph" cx="72" cy="261" r="2.4"/><circle class="glyph" cx="72" cy="267" r="2.4"/><circle class="glyph" cx="80" cy="258" r="2.4"/><circle class="glyph" cx="80" cy="264" r="2.4"/>
<path class="edge " d="M170 286 V308" marker-end="url(#arrow)"/>
<g class="node clay"><rect x="50" y="312" width="240" height="30" rx="4"/><text class="mid small" x="170" y="327">"I've sent the message!"</text></g>
<text class="small mid accent" x="170" y="372">1 extra full-price call + 1 useless message</text>
<rect class="panel" x="0" y="420" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="448">THIS PROJECT</text>
<g class="node "><rect x="50" y="468" width="240" height="46" rx="4"/><text class="mid b" x="170" y="483">Primary Model</text><text class="mid small" x="170" y="500">Reads 93K tokens</text></g>
<circle class="glyph" cx="64" cy="488" r="2.4"/><circle class="glyph" cx="64" cy="494" r="2.4"/><circle class="glyph" cx="72" cy="485" r="2.4"/><circle class="glyph" cx="72" cy="491" r="2.4"/><circle class="glyph" cx="72" cy="497" r="2.4"/><circle class="glyph" cx="80" cy="488" r="2.4"/><circle class="glyph" cx="80" cy="494" r="2.4"/>
<path class="edge " d="M170 516 V538" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="80" y="542" width="180" height="30" rx="4"/><text class="mid" x="170" y="557">send</text></g>
<path class="edge " d="M170 574 V596" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="50" y="600" width="240" height="46" rx="4"/><text class="mid b" x="170" y="615">terminate</text><text class="mid small" x="170" y="632">send succeeded; turn ends here</text></g>
<text class="small mid" x="170" y="682">When send is not called:</text>
<text class="small mid" x="170" y="700">assistant text stays in console,</text>
<text class="small mid" x="170" y="718">turn ends silently</text>
<text class="small mid accent" x="170" y="792">Average 1.13 calls per turn</text>
</svg>
```

It is precisely this decisive cutoff that locked our three-month average at **1.13 calls per turn**. The extra 0.13 calls exist solely for a single self-correction pass when the bot was explicitly mentioned by a user but forgot to invoke `send`.

When faced with an ambiguous network timeout, many engineers reflexively retry. On Telegram, however, sending a message is an irreversible, non-idempotent action. If the message was already created on Telegram's servers before the local connection timed out, retrying produces an embarrassing duplicate message in the group.
Our engineering rule is uncompromising: **retries are permitted only on deterministic 4xx errors where no payload was committed; every timeout or ambiguous network state is marked `no_retry` and halts immediately.**

```sketch title="When Sending Fails, Only One Case May Retry" note="Only deterministic 4xx errors before payload delivery are retried; everything else halts immediately."
<svg viewBox="0 0 704 216">
<rect class="panel" x="0" y="0" width="704" height="216" rx="12"/>
<g class="node clay"><rect x="24" y="74" width="120" height="40" rx="20"/><text class="mid" x="84" y="94">send failed</text></g>
<path class="edge " d="M146 94 H178" marker-end="url(#arrow)"/>
<g class="node "><rect x="182" y="64" width="220" height="60" rx="4"/><text class="mid b" x="292" y="86">Deterministic 4xx</text><text class="mid small" x="292" y="103">and payload not committed?</text></g>
<path class="edge " d="M404 84 H432 V52 H452" marker-end="url(#arrow)"/>
<text class="small mid" x="418" y="70">Yes</text>
<path class="edge " d="M404 104 H432 V140 H452" marker-end="url(#arrow)"/>
<text class="small mid" x="418" y="118">No</text>
<g class="node teal"><rect x="456" y="32" width="224" height="40" rx="4"/><text class="mid" x="568" y="52">Retry</text></g>
<g class="node plain"><rect x="456" y="118" width="224" height="46" rx="4"/><text class="mid b" x="568" y="133">Mark no_retry &amp; halt</text><text class="mid small" x="568" y="150">Includes timeouts &amp; network unknowns</text></g>
<text class="small accent" x="24" y="194">Sending is irreversible: if the server already posted it before a local timeout, retrying double-posts in the group.</text>
</svg>
<svg viewBox="0 0 340 352">
<rect class="panel" x="0" y="0" width="340" height="352" rx="12"/>
<g class="node clay"><rect x="110" y="20" width="120" height="40" rx="20"/><text class="mid" x="170" y="40">send failed</text></g>
<path class="edge " d="M170 62 V84" marker-end="url(#arrow)"/>
<g class="node "><rect x="40" y="88" width="260" height="60" rx="4"/><text class="mid b" x="170" y="110">Deterministic 4xx</text><text class="mid small" x="170" y="127">and payload not committed?</text></g>
<path class="edge " d="M120 150 V190" marker-end="url(#arrow)"/>
<text class="small" x="128" y="172">Yes</text>
<path class="edge " d="M220 150 V190" marker-end="url(#arrow)"/>
<text class="small" x="228" y="172">No</text>
<g class="node teal"><rect x="16" y="194" width="140" height="40" rx="4"/><text class="mid" x="86" y="214">Retry</text></g>
<g class="node plain"><rect x="164" y="194" width="160" height="62" rx="4"/><text class="mid b" x="244" y="217">no_retry &amp; halt</text><text class="mid small" x="244" y="234">Timeouts, unknowns</text></g>
<text class="small accent" x="16" y="296">Sending is irreversible: if the server already</text>
<text class="small accent" x="16" y="314">posted it before a local timeout, retrying</text>
<text class="small accent" x="16" y="332">double-posts. Better to occasionally drop one.</text>
</svg>
```

---

## Layer 2: Maximizing Cache Hit Rate $h$

If cutting call volume is our first line of defense, Prompt Caching is the core lever that determines life or death.

At their core, the caching mechanisms of all modern frontier models (DeepSeek, Anthropic, OpenAI) work via **Prefix Matching**:
As long as the prefix of your request is byte-for-byte identical to the previous turn, the price of the matched portion drops off a cliff. On DeepSeek V4 Flash, a cache hit costs amere **1/50th** of a cache miss.

Let's run the numbers on the 5.34 billion input tokens we actually processed over three months:

```echarts title="5.34B Input Tokens Priced at DeepSeek V4 Flash Rates" height="220" note="Input tokens only; 14.3M output tokens excluded. 98.7% is our measured hit rate on DeepSeek; 0% is re-reading at full price every call. Hypothetical comparison across the full 3-month volume, not my literal invoice."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "${value}"},
  "grid": {"top": 8, "right": 56},
  "xAxis": {"type": "value", "axisLabel": {"formatter": "${value}"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["No Cache (0%)", "85% Hit Rate", "98.7% Hit Rate"]},
  "series": [{
    "name": "Input Cost", "type": "bar", "barWidth": 22,
    "label": {"show": true, "position": "right", "formatter": "${c}", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [748, 125, {"value": 25, "itemStyle": {"color": "var(--clay)"}}]
  }]
}
```

Going from 85% to 98.7% looks like a modest 14-percentage-point bump on paper, yet it cuts the bill by **5×**; compared against running uncached, the difference is a staggering **30×**!

```echarts title="Cache Hit Rate Across Providers Using the Exact Same Prefix Discipline" height="240" note="Hit rate = cached read tokens ÷ total input tokens, excluding compaction calls, from the Nov 1 local snapshot. DeepSeek Official API: 3,415 calls (Aug 7–10); SWE-2 on Devin: 19,494 calls; Gemini Flash on Antigravity: 22,274 calls. DeepSeek calls routed via ollama-cloud (15,668 calls) did not report cache read metrics and are omitted."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "{value}%"},
  "grid": {"top": 8, "right": 56},
  "xAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["DeepSeek Official", "SWE-2", "Gemini Flash"]},
  "series": [{
    "name": "Cache Hit Rate", "type": "bar", "barWidth": 22,
    "label": {"show": true, "position": "right", "formatter": "{c}%", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [{"value": 98.7, "itemStyle": {"color": "var(--clay)"}}, 86.3, 58.4]
  }]
}
```

That is why we inscribed the single most important physical constraint of the entire project into `AGENTS.md`:

> **Cache invariant: Never mutate an existing provider prefix; dynamic content may only be appended as a new suffix. Every request must be a strict prefix of the next request.**

### First-Principles Derivation of Where Dynamic Information Belongs

"Keep the prefix immutable" sounds like an easy slogan, until it collides head-on with the messy reality of a live Telegram group chat.

The most classic contradiction is **Stickers**.

The bot has its own fixed catalog of favorite stickers, but group members constantly post all kinds of wild third-party stickers in daily conversation. When someone drops a particularly expressive sticker, we want to tell the bot: *"A group member just posted this sticker; if it fits the mood, you can use it this turn too."*
Clearly, this is **unpredictable, dynamic candidate data that changes every single turn**.

Where in the request payload should this dynamic list live? If we trace the engineering constraints step by step, every "convenient" shortcut gets eliminated one by one:

- **Failed Attempt 1: Stuff it into the System Prompt.**
  Intuitively the cleanest place—except the System Prompt sits at the very beginning of the context window. Change a single character there, and **all 90,000+ tokens of cache behind it shatter instantly**.
- **Failed Attempt 2: Hang it at the very end of the request, then swap it out next turn.**
  Since it represents "currently available stickers," many engineers tack it onto the tail of the current request, then snip off the old tail and attach a new one on the next turn.
  This tiny bit of laziness exacted a brutal toll in production: the tail of request $n$ vanished in request $n+1$, breaking prefix continuity right at the seam. Our measurements showed that trying to save a few dozen tokens of sticker listings caused the very next turn to miss **13,600 tokens** of cold cache right at turn entry!
- **Failed Attempt 3: Splice it directly into the chat transcript.**
  If we can only append monotonically, what if we disguise the sticker metadata as message text inside the user's chat line?
  Disaster struck immediately: upon reading it, the model earnestly concluded that *"a group member just leaked my internal sticker catalog,"* and proceeded to accuse group members of spying on its backend. Worse still, when the session hit its context limit and triggered compaction, the summarizer distilled this absurd suspicion—*"group members leaked the bot's sticker catalog"*—into an established fact, baking it permanently into the long-term summary and causing irreversible cognitive poisoning.

```sketch title="Only One Place Can Hold Dynamic Information" note="Each row shows a request after inserting a dynamic sticker list; the clay vertical line marks where prefix continuity breaks and the cache invalidates."
<svg viewBox="0 0 704 288">
<rect class="panel" x="0" y="0" width="704" height="288" rx="12"/>
<text class="caps" x="24" y="24">WHERE TO PUT THE DYNAMIC STICKER LIST</text>
<circle cx="32" cy="59" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M29 56 35 62 M35 56 29 62"/>
<text class="b" x="48" y="52">Stuff into system prompt</text>
<text class="small accent" x="48" y="70">Change 1 char and all 90K+ tokens of cache behind it invalidate</text>
<g class="node blue"><rect x="352" y="44" width="59.1" height="30" rx="4"/><text class="mid" x="381.55" y="59">system</text></g>
<g class="node orange"><rect x="414.1" y="44" width="47.3" height="30" rx="4"/><text class="mid small" x="437.75" y="59">stk</text></g>
<g class="node plain"><rect x="464.3" y="44" width="153.6" height="30" rx="4"/><text class="mid" x="541.1" y="59">history</text></g>
<g class="node plain"><rect x="620.9" y="44" width="59.1" height="30" rx="4"/><text class="mid small" x="650.45" y="59">new</text></g>
<path class="edge hot" d="M412.6 38 V80"/>
<circle cx="32" cy="119" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M29 116 35 122 M35 116 29 122"/>
<text class="b" x="48" y="112">Hang at the end, replace next turn</text>
<text class="small accent" x="48" y="130">Prefix breaks right where the old tail was swapped</text>
<g class="node blue"><rect x="352" y="104" width="57" height="30" rx="4"/><text class="mid" x="380.5" y="119">system</text></g>
<g class="node plain"><rect x="412" y="104" width="148.1" height="30" rx="4"/><text class="mid" x="486.05" y="119">history</text></g>
<g class="node plain"><rect x="563.1" y="104" width="57" height="30" rx="4"/><text class="mid small" x="591.6" y="119">new</text></g>
<g class="node orange"><rect x="623" y="104" width="57" height="30" rx="4"/><text class="mid small" x="651.5" y="119">stk</text></g>
<path class="edge hot" d="M621.5 98 V140"/>
<circle cx="32" cy="179" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M29 176 35 182 M35 176 29 182"/>
<text class="b" x="48" y="172">Mix into chat transcript</text>
<text class="small accent" x="48" y="190">Cache holds, but model thinks users said it &amp; compacts it as "fact"</text>
<g class="node blue"><rect x="352" y="164" width="57.5" height="30" rx="4"/><text class="mid" x="380.75" y="179">system</text></g>
<g class="node plain"><rect x="412.5" y="164" width="207.0" height="30" rx="4"/></g>
<text class="" x="422.5" y="179">history</text>
<g class="node orange"><rect x="559.5" y="170" width="52" height="18" rx="3"/><text class="mid small" x="585.5" y="179.0">stickers</text></g>
<g class="node plain"><rect x="622.5" y="164" width="57.5" height="30" rx="4"/><text class="mid small" x="651.25" y="179">new</text></g>
<circle cx="32" cy="239" r="8" fill="var(--teal-wash)" stroke="var(--teal)"/><path class="edge" d="M28 239 31 242 36 236" stroke="var(--teal)"/>
<text class="b" x="48" y="232">[System Note] appended after that input batch</text>
<text class="small " x="48" y="250">Append-only, immutable once written, distinct tag, excluded from session DB</text>
<g class="node blue"><rect x="352" y="224" width="59.1" height="30" rx="4"/><text class="mid" x="381.55" y="239">system</text></g>
<g class="node plain"><rect x="414.1" y="224" width="153.6" height="30" rx="4"/><text class="mid" x="490.9" y="239">history</text></g>
<g class="node plain"><rect x="570.7" y="224" width="59.1" height="30" rx="4"/><text class="mid small" x="600.25" y="239">new</text></g>
<g class="node violet"><rect x="632.7" y="224" width="47.3" height="30" rx="4"/><text class="mid" x="656.35" y="239">note</text></g>
</svg>
<svg viewBox="0 0 340 486">
<rect class="panel" x="0" y="0" width="340" height="486" rx="12"/>
<text class="caps" x="16" y="22">WHERE TO PUT DYNAMIC STICKERS</text>
<circle cx="24" cy="50" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M21 47 27 53 M27 47 21 53"/>
<text class="b" x="40" y="50">Stuff into system prompt</text>
<text class="small accent" x="40" y="70">Change 1 char and</text>
<text class="small accent" x="40" y="86">all 90K+ tokens of cache invalidate</text>
<g class="node blue"><rect x="16" y="106" width="55.4" height="28" rx="4"/><text class="mid small" x="43.7" y="120">system</text></g>
<g class="node orange"><rect x="74.4" y="106" width="44.3" height="28" rx="4"/><text class="mid small" x="96.55" y="120">stick</text></g>
<g class="node plain"><rect x="121.7" y="106" width="144" height="28" rx="4"/><text class="mid small" x="193.7" y="120">history</text></g>
<g class="node plain"><rect x="268.6" y="106" width="55.4" height="28" rx="4"/><text class="mid small" x="296.3" y="120">new</text></g>
<path class="edge hot" d="M72.9 100 V140"/>
<circle cx="24" cy="172" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M21 169 27 175 M27 169 21 175"/>
<text class="b" x="40" y="172">Hang at end, replace next turn</text>
<text class="small accent" x="40" y="192">Prefix breaks where tail is replaced</text>
<g class="node blue"><rect x="16" y="212" width="53.4" height="28" rx="4"/><text class="mid small" x="42.7" y="226">system</text></g>
<g class="node plain"><rect x="72.4" y="212" width="138.8" height="28" rx="4"/><text class="mid small" x="141.8" y="226">history</text></g>
<g class="node plain"><rect x="214.2" y="212" width="53.4" height="28" rx="4"/><text class="mid small" x="240.9" y="226">new</text></g>
<g class="node orange"><rect x="270.6" y="212" width="53.4" height="28" rx="4"/><text class="mid small" x="297.3" y="226">stick</text></g>
<path class="edge hot" d="M269.1 206 V246"/>
<circle cx="24" cy="278" r="8" fill="var(--clay-wash)" stroke="var(--clay)"/><path class="edge hot" d="M21 275 27 281 M27 275 21 281"/>
<text class="b" x="40" y="278">Mix into chat transcript</text>
<text class="small accent" x="40" y="298">Cache holds, but model thinks users</text>
<text class="small accent" x="40" y="314">said it &amp; compacts it into "fact"</text>
<g class="node blue"><rect x="16" y="334" width="53.9" height="28" rx="4"/><text class="mid small" x="42.95" y="348">system</text></g>
<g class="node plain"><rect x="72.9" y="334" width="194.1" height="28" rx="4"/></g>
<text class="small" x="82.9286" y="348">history</text>
<g class="node orange"><rect x="215.1" y="340" width="44" height="16" rx="3"/><text class="mid small" x="237.1" y="348.0">stick</text></g>
<g class="node plain"><rect x="270.1" y="334" width="53.9" height="28" rx="4"/><text class="mid small" x="297.05" y="348">new</text></g>
<circle cx="24" cy="400" r="8" fill="var(--teal-wash)" stroke="var(--teal)"/><path class="edge" d="M20 400 23 403 28 397" stroke="var(--teal)"/>
<text class="b" x="40" y="400">[System Note] after input batch</text>
<text class="small " x="40" y="420">Append-only, immutable, excluded from DB</text>
<g class="node blue"><rect x="16" y="440" width="55.4" height="28" rx="4"/><text class="mid small" x="43.7" y="454">system</text></g>
<g class="node plain"><rect x="74.4" y="440" width="144" height="28" rx="4"/><text class="mid small" x="146.4" y="454">history</text></g>
<g class="node plain"><rect x="221.3" y="440" width="55.4" height="28" rx="4"/><text class="mid small" x="249" y="454">new</text></g>
<g class="node violet"><rect x="279.7" y="440" width="44.3" height="28" rx="4"/><text class="mid small" x="301.85" y="454">note</text></g>
</svg>
```

Through those three collisions with reality, the fate of dynamic information was locked by physical law into a single narrow slot:

1. **It must be strictly append-only;**
2. **Once written, it must freeze forever at that relative position, inherited verbatim by subsequent turns without ever being edited or deleted mid-stream;**
3. **It must never be mistaken for human speech, requiring a dedicated system marker;**
4. **It must never enter the persistent session database main line, lest it pollute future compaction summaries.**

This strict derivation gave birth to our final request projection structure:

```sketch title="Append-Only Prefixes Keep the Cache Connected" note="Top: proper projection where request n+1 strictly contains request n. Bottom: hanging a dynamic list at the end and swapping it next turn breaks prefix continuity at the seam."
<svg viewBox="0 0 704 334">
<rect class="panel" x="0" y="0" width="704" height="334" rx="12"/>
<text class="caps" x="24" y="28">APPEND-ONLY: EVERY REQUEST IS A PREFIX OF THE NEXT</text>
<text class="small" x="24" y="69">Turn n</text>
<g class="node blue"><rect x="112" y="52" width="72" height="34" rx="4"/><text class="mid" x="148" y="69">system</text></g>
<g class="node plain"><rect x="188" y="52" width="236" height="34" rx="4"/><text class="mid" x="306" y="69">chat history</text></g>
<g class="node violet"><rect x="428" y="52" width="60" height="34" rx="4"/><text class="mid" x="458" y="69">note</text></g>
<g class="node teal"><rect x="492" y="52" width="64" height="34" rx="4"/><text class="mid" x="524" y="69">output</text></g>
<rect x="104" y="112" width="454" height="72" rx="8" fill="var(--clay-wash)"/>
<text class="small" x="24" y="137">Turn n+1</text>
<g class="node blue"><rect x="112" y="120" width="72" height="34" rx="4"/><text class="mid" x="148" y="137">system</text></g>
<g class="node plain"><rect x="188" y="120" width="236" height="34" rx="4"/><text class="mid" x="306" y="137">chat history</text></g>
<g class="node violet"><rect x="428" y="120" width="60" height="34" rx="4"/><text class="mid" x="458" y="137">note</text></g>
<g class="node teal"><rect x="492" y="120" width="64" height="34" rx="4"/><text class="mid" x="524" y="137">output</text></g>
<g class="node plain"><rect x="564" y="120" width="64" height="34" rx="4"/><text class="mid" x="596" y="137">new msg</text></g>
<g class="node violet"><rect x="632" y="120" width="44" height="34" rx="4"/><text class="mid" x="654" y="137">note</text></g>
<path class="edge dash" d="M558 46 V184"/>
<text class="small accent" x="112" y="172">Byte-for-byte identical: cache hit, 1/50th price on DeepSeek</text>
<text class="small mid" x="619" y="172">Added: full price</text>
<text class="caps" x="24" y="224">ANTI-PATTERN: SWAPPING THE TRAILING LIST EACH TURN</text>
<text class="small" x="24" y="271">Turn n+1</text>
<g class="node blue"><rect x="112" y="254" width="72" height="34" rx="4"/><text class="mid" x="148" y="271">system</text></g>
<g class="node plain"><rect x="188" y="254" width="236" height="34" rx="4"/><text class="mid" x="306" y="271">chat history</text></g>
<rect class="window" x="428" y="254" width="96" height="34" rx="4"/>
<text class="small mid" x="476" y="271">old stickers</text>
<circle cx="524" cy="254" r="7" fill="var(--card)" stroke="var(--clay)"/>
<path class="edge hot" d="M521 251 527 257 M527 251 521 257"/>
<g class="node plain"><rect x="528" y="254" width="64" height="34" rx="4"/><text class="mid" x="560" y="271">new msg</text></g>
<g class="node orange"><rect x="596" y="254" width="84" height="34" rx="4"/><text class="mid" x="638" y="271">new stickers</text></g>
<path class="edge hot" d="M426 246 V296"/>
<text class="small accent" x="112" y="310">Prefix breaks here; every byte after is re-read at full price (13,600 cold tokens measured)</text>
</svg>
<svg viewBox="0 0 340 348">
<rect class="panel" x="0" y="0" width="340" height="348" rx="12"/>
<text class="caps" x="16" y="28">APPEND-ONLY: STRICT PREFIXES</text>
<text class="small" x="16" y="52">Turn n</text>
<g class="node blue"><rect x="16" y="62" width="48" height="32" rx="4"/><text class="mid small" x="40" y="78">system</text></g>
<g class="node plain"><rect x="67" y="62" width="84" height="32" rx="4"/><text class="mid small" x="109" y="78">history</text></g>
<g class="node violet"><rect x="154" y="62" width="36" height="32" rx="4"/><text class="mid small" x="172" y="78">note</text></g>
<g class="node teal"><rect x="193" y="62" width="36" height="32" rx="4"/><text class="mid small" x="211" y="78">out</text></g>
<rect x="8" y="132" width="222.5" height="70" rx="8" fill="var(--clay-wash)"/>
<text class="small" x="16" y="130">Turn n+1</text>
<g class="node blue"><rect x="16" y="140" width="48" height="32" rx="4"/><text class="mid small" x="40" y="156">system</text></g>
<g class="node plain"><rect x="67" y="140" width="84" height="32" rx="4"/><text class="mid small" x="109" y="156">history</text></g>
<g class="node violet"><rect x="154" y="140" width="36" height="32" rx="4"/><text class="mid small" x="172" y="156">note</text></g>
<g class="node teal"><rect x="193" y="140" width="36" height="32" rx="4"/><text class="mid small" x="211" y="156">out</text></g>
<g class="node plain"><rect x="232" y="140" width="52" height="32" rx="4"/><text class="mid small" x="258" y="156">new</text></g>
<g class="node violet"><rect x="287" y="140" width="34" height="32" rx="4"/><text class="mid small" x="304" y="156">note</text></g>
<path class="edge dash" d="M230.5 56 V202"/>
<text class="small accent" x="16" y="190">Byte-identical: cache hit (1/50 price)</text>
<text class="small mid" x="277.25" y="190">Full price</text>
<text class="caps" x="16" y="226">ANTI-PATTERN: SWAPPING TRAILING LIST</text>
<text class="small" x="16" y="248">Turn n+1</text>
<g class="node blue"><rect x="16" y="258" width="48" height="32" rx="4"/><text class="mid small" x="40" y="274">system</text></g>
<g class="node plain"><rect x="67" y="258" width="84" height="32" rx="4"/><text class="mid small" x="109" y="274">history</text></g>
<rect class="window" x="154" y="258" width="60" height="32" rx="4"/>
<text class="small mid" x="184" y="274">old list</text>
<circle cx="214" cy="258" r="7" fill="var(--card)" stroke="var(--clay)"/>
<path class="edge hot" d="M211 255 217 261 M217 255 211 261"/>
<g class="node plain"><rect x="217" y="258" width="44" height="32" rx="4"/><text class="mid small" x="239" y="274">new</text></g>
<g class="node orange"><rect x="264" y="258" width="60" height="32" rx="4"/><text class="mid small" x="294" y="274">new list</text></g>
<path class="edge hot" d="M152.5 250 V298"/>
<text class="small accent" x="16" y="312">Prefix breaks here; everything after is full price:</text>
<text class="small accent" x="16" y="330">13,600 cold tokens missed at start of next turn</text>
</svg>
```

Inside an actual request payload, it unfolds with a clean, disciplined rhythm:

```sketch title="Anatomy of a Real Request" note="Excerpt with usernames and sticker intensity descriptions removed. The dashed box is the full input of one request, read top to bottom by the model; annotations on the right explain why each piece sits where it does."
<svg viewBox="0 0 704 382">
<rect class="panel" x="0" y="0" width="704" height="382" rx="12"/>
<text class="caps" x="24" y="26">SINGLE REQUEST, TOP TO BOTTOM</text>
<rect class="window" x="24" y="34" width="444" height="324" rx="8"/>
<text class="mono mute" x="36" y="79">system</text>
<g class="node blue"><rect x="112" y="44" width="344" height="70" rx="4"/><text class="mono" x="124" y="61">…group protocol, tool rules, persona…</text><text class="mono" x="124" y="79"># Sticker Catalog (frozen for session)</text><text class="mono" x="124" y="97">s3: 😺 smug approval  s4: 😭 crying</text></g>
<path class="edge " d="M458 79.0 H478"/>
<text class="small" x="484" y="79">Frozen: byte-identical all session</text>
<text class="mono mute" x="36" y="150">user</text>
<g class="node plain"><rect x="112" y="124" width="344" height="52" rx="4"/><text class="mono" x="124" y="141">[21:03:11] #18452 Alice: That's wild</text><text class="mono" x="124" y="159">[21:03:15] #18453 Bob: [sticker 😂]</text></g>
<path class="edge " d="M458 150.0 H478"/>
<text class="small" x="484" y="150">Group messages appended in order</text>
<text class="mono mute" x="36" y="212">user</text>
<g class="node violet"><rect x="112" y="186" width="344" height="52" rx="4"/><text class="mono" x="124" y="203">[System Note] Reusable sticker seen in</text><text class="mono" x="124" y="221">this batch: s2091 😂</text></g>
<path class="edge " d="M458 212.0 H478"/>
<text class="small" x="484" y="212">Note follows batch; stays immutable</text>
<text class="mono mute" x="36" y="265">assistant</text>
<g class="node teal"><rect x="112" y="248" width="344" height="34" rx="4"/><text class="mono" x="124" y="265">send({ message: "Truly wild", sticker: "s4" })</text></g>
<path class="edge " d="M458 265.0 H478"/>
<text class="small" x="484" y="265">Sent reply becomes prefix of next request</text>
<text class="mono mute" x="36" y="318">user</text>
<g class="node plain"><rect x="112" y="292" width="344" height="52" rx="4"/><text class="mono" x="124" y="309">[media_update #18453] [sticker: ROFL]</text><text class="mono" x="124" y="327">[21:04:02] #18460 Alice: What's next?</text></g>
<path class="edge " d="M458 318.0 H478"/>
<text class="small" x="484" y="310">Late vision result appended as new event;</text>
<text class="small" x="484" y="326">never mutates #18453 in place</text>
</svg>
<svg viewBox="0 0 340 710">
<rect class="panel" x="0" y="0" width="340" height="710" rx="12"/>
<text class="caps" x="16" y="24">SINGLE REQUEST, TOP TO BOTTOM</text>
<text class="mono mute" x="16" y="46">system</text>
<g class="node blue"><rect x="16" y="56" width="308" height="88" rx="4"/><text class="mono" x="28" y="73">…group protocol, rules, persona…</text><text class="mono" x="28" y="91"># Sticker Catalog (session-frozen)</text><text class="mono" x="28" y="109">s3: 😺 smug approval</text><text class="mono" x="28" y="127">s4: 😭 crying</text></g>
<text class="small accent" x="16" y="158">Frozen: byte-identical for the whole session</text>
<text class="mono mute" x="16" y="190">user</text>
<g class="node plain"><rect x="16" y="200" width="308" height="88" rx="4"/><text class="mono" x="28" y="217">[21:03:11] #18452 Alice:</text><text class="mono" x="28" y="235">  That's wild</text><text class="mono" x="28" y="253">[21:03:15] #18453 Bob:</text><text class="mono" x="28" y="271">  [sticker 😂]</text></g>
<text class="small accent" x="16" y="302">Group messages appended chronologically</text>
<text class="mono mute" x="16" y="334">user</text>
<g class="node violet"><rect x="16" y="344" width="308" height="70" rx="4"/><text class="mono" x="28" y="361">[System Note] Reusable sticker</text><text class="mono" x="28" y="379">seen in this batch:</text><text class="mono" x="28" y="397">s2091 😂</text></g>
<text class="small accent" x="16" y="428">Note follows batch; immutable once written</text>
<text class="mono mute" x="16" y="460">assistant</text>
<g class="node teal"><rect x="16" y="470" width="308" height="52" rx="4"/><text class="mono" x="28" y="487">send({ message: "Truly wild",</text><text class="mono" x="28" y="505">       sticker: "s4" })</text></g>
<text class="small accent" x="16" y="536">Sent reply becomes prefix of next request</text>
<text class="mono mute" x="16" y="568">user</text>
<g class="node plain"><rect x="16" y="578" width="308" height="88" rx="4"/><text class="mono" x="28" y="595">[media_update #18453]</text><text class="mono" x="28" y="613">  [sticker: ROFL]</text><text class="mono" x="28" y="631">[21:04:02] #18460 Alice:</text><text class="mono" x="28" y="649">  What's next?</text></g>
<text class="small accent" x="16" y="680">Late vision result appended; never mutates #18453</text>
</svg>
```

Even asynchronous vision analysis strictly obeys this aesthetic:
When a user first posts an image, the message line carries only a lightweight placeholder `[Photo]`. A few seconds later, when the async vision model finishes describing the image, the system **never goes back to edit the old message**. Instead, it appends an immutable incremental event to the latest input stream: `[media_update #id] [Photo: a calico cat lying on a mechanical keyboard]`.

---

## Layer 3: Compressing Context Depth $T$ — Why Verbatim Speech Outranks Processed Memory

Now we turn our gaze to the third variable, $T$ (the context depth swallowed on every call).
Even with a 98.7% cache hit rate, remember that the remaining 1.3% of uncached traffic still pays full price—and even at cached rates, hauling 90,000 tokens on every turn generates continuous friction costs.

More importantly: **a context window is not an infinitely expanding landfill.** Where do old memories go? How should long-horizon conversations settle?

### The Window Size Game: Do Your Own Math, Not the Provider's

A recent NVIDIA paper, *You don't need long context* (arXiv:2611.05306), highlighted an underlying hardware reality: under server-side Attention mechanisms, the compute cost of generating each token scales linearly with context depth. Their benchmarks on vLLM + H100 showed that a 256K window increases per-token generation cost by up to 7× compared to 16K.

Their recommendation: aggressively cap context between 16K and 48K, relying on frequent context compaction and state resets, which achieves virtually no accuracy drop on long-horizon tasks.

That is a beautiful result—but if you copy it blindly into your own application, you will walk straight into a trap. That paper models **the inference provider's cost structure**. For application developers calling cloud APIs, **cloud billing is linear per token**. Token #100,000 costs the exact same price as Token #1; the provider's internal quadratic prefill penalty does not appear on your monthly invoice.

On the application side, choosing a window size is a very different optimization game:
**Which is more expensive: reading slightly more on each call, or triggering compaction far more frequently?**

If you set a tiny window (say, 32K), avoiding overflow forces you to wake the model frequently to run Summarization (compaction).
Every compaction call exacts a heavy toll: it must read the entire old context and generate a structured summary. Worse still, **the instant compaction finishes, your old deterministic prefix is dead—meaning the very next turn suffers a 100% cold-start full-price bill**.

First, let's look at how many tokens each request actually read over our three-month run. The distribution is bimodal, with one peak around 40K–50K tokens and another around 110K; after we raised the window limit in late September, a long tail stretched out to the right:

```echarts title="Tokens Read per Request" height="280" note="Input token distribution across 54,847 non-compaction calls in 10K-token bins (40K means 40K–50K); the last bin is ≥240K (including 3 calls over 250K). Local snapshot as of Nov 1. The context cap was 131K initially and raised to 256K in late September."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "{value} calls"},
  "grid": {"top": 16},
  "xAxis": {"type": "category", "axisLabel": {"formatter": "{value}K"},
    "data": ["0", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100", "110", "120", "130", "140", "150", "160", "170", "180", "190", "200", "210", "220", "230", "≥240"]},
  "yAxis": {"type": "value"},
  "series": [{
    "name": "Calls", "type": "bar", "barCategoryGap": "8%", "itemStyle": {"color": "var(--stone)"},
    "data": [375, 1757, 1805, 2495, {"value": 8266, "itemStyle": {"color": "var(--clay)"}}, 3828, 3057, 3041, 2998, 3410, 4949, {"value": 6979, "itemStyle": {"color": "var(--clay)"}}, 2147, 1108, 1083, 924, 976, 884, 879, 797, 786, 725, 672, 557, 349]
  }]
}
```

During earlier iterations, my bot lived through both extremes of this pendulum swing:

```echarts title="Weekly Average Input Length vs. Share of Compaction Calls" height="400" note="Average input excludes compaction calls themselves. September used a homegrown compactor; in late September the window was raised from 131K to 256K."
{
  "tooltip": {"trigger": "axis"},
  "axisPointer": {"link": [{"xAxisIndex": "all"}]},
  "grid": [{"top": 28, "height": "34%", "right": 24}, {"top": "60%", "bottom": 4, "right": 24}],
  "xAxis": [
    {"type": "category", "gridIndex": 0, "boundaryGap": false, "axisLabel": {"show": false}, "data": ["08-07", "08-10", "08-17", "08-24", "08-31", "09-07", "09-14", "09-21", "09-28", "10-05", "10-12", "10-19", "10-26", "11-02"]},
    {"type": "category", "gridIndex": 1, "boundaryGap": false, "data": ["08-07", "08-10", "08-17", "08-24", "08-31", "09-07", "09-14", "09-21", "09-28", "10-05", "10-12", "10-19", "10-26", "11-02"]}
  ],
  "yAxis": [
    {"type": "value", "gridIndex": 0, "name": "Avg Input (K tokens)", "nameLocation": "end", "nameTextStyle": {"align": "left"}},
    {"type": "value", "gridIndex": 1, "name": "Compaction Share", "nameLocation": "end", "nameTextStyle": {"align": "left"}, "axisLabel": {"formatter": "{value}%"}}
  ],
  "series": [
    {"name": "Avg Input (K tokens)", "type": "line", "xAxisIndex": 0, "yAxisIndex": 0, "showSymbol": true, "symbolSize": 5, "itemStyle": {"color": "var(--stone)"}, "areaStyle": {"color": "var(--stone)", "opacity": 0.12},
      "data": [76.0, 53.4, 43.7, 85.9, 24.7, 95.8, 56.0, 76.2, 132.9, 130.0, 135.3, 123.0, 103.4, 115.4],
      "markArea": {"silent": true, "itemStyle": {"color": "var(--wash)"}, "label": {"color": "var(--muted)", "fontSize": 10}, "data": [[{"name": "256K Window", "xAxis": "09-28"}, {"xAxis": "11-02"}]]}},
    {"name": "Compaction Share", "type": "line", "xAxisIndex": 1, "yAxisIndex": 1, "showSymbol": true, "symbolSize": 5, "itemStyle": {"color": "var(--clay)"}, "areaStyle": {"color": "var(--clay)", "opacity": 0.15},
      "tooltip": {"valueFormatter": "{value}%"},
      "data": [0.1, 1.3, 12.5, 20.1, 3.6, 30.1, 34.6, 44.6, 12.3, 0.5, 0.5, 1.0, 0.8, 0.4],
      "markPoint": {"symbol": "circle", "symbolSize": 7, "label": {"position": "right", "formatter": "44.6%: nearly half of all calls were compacting", "color": "var(--clay)", "fontSize": 11}, "data": [{"type": "max"}]}}
  ]
}
```

Look at that glaring spike in late September: because our character-based token estimator mistakenly counted images as zero tokens, the system trapped itself in a nightmare loop—thinking compaction hadn't shrunk the context enough and re-triggering compaction non-stop—until **nearly 45% of all model calls were just compacting**! Then, when we mindlessly cranked the window up to 256K at the end of September, compaction calls dropped near zero, but the baseline payload of every single request ballooned to 130,000 tokens.

Our current architecture rests at a battle-tested equilibrium:
**The window is fixed at 128K**, triggering Pi's native structured compaction once context reaches 110K tokens and reliably preserving the most recent ~20K tokens verbatim. Heavy tasks (multi-step search, deep research, code debugging) are offloaded via `task` into isolated sub-sessions, bringing only the distilled answer back to the group chat. The primary session stays crystal clean—recording only *"what everyone is talking about"* and *"what I did,"* never degenerating into a bloated debugging log.

```sketch title="How Big Should the Context Window Be?" note="The color band is conceptual, not a plotted cost curve. Because cloud APIs bill linearly per token, too small a window lets compaction and cold-cache penalties outweigh smaller reads; too large a window forces every casual 'haha true' to haul a massive context. Numbers in the three cards come from the ledger above."
<svg viewBox="0 0 704 262">
<rect class="panel" x="0" y="0" width="704" height="262" rx="12"/>
<text class="caps" x="24" y="30">TOO SMALL</text>
<text class="caps mid" x="516" y="30">SWEET SPOT</text>
<text class="caps end" x="680" y="30">TOO LARGE</text>
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
<g class="node orange"><rect x="24" y="120" width="208" height="118" rx="6"/><text class="b" x="38" y="142">16K–48K</text><text class="small" x="38" y="166">Small reads, frequent compaction</text><text class="small" x="38" y="186">Each compaction reads all &amp; summarizes</text><text class="small" x="38" y="206">Prefix dies; next turn pays full price</text></g>
<circle cx="516.0" cy="59" r="6" fill="var(--card)" stroke="var(--node-line)"/>
<path class="edge " d="M516.0 65 V110 H352 V120"/>
<g class="node teal"><rect x="248" y="120" width="208" height="118" rx="6"/><text class="b" x="262" y="142">128K (Current)</text><text class="small" x="262" y="166">Compact at 110K, keep ~20K verbatim</text><text class="small" x="262" y="186">Offload search/research to sub-sessions</text><text class="small" x="262" y="206">Main session keeps only chat &amp; outcomes</text></g>
<circle cx="656.0" cy="59" r="6" fill="var(--card)" stroke="var(--node-line)"/>
<path class="edge " d="M656.0 65 V110 H576 V120"/>
<g class="node orange"><rect x="472" y="120" width="208" height="118" rx="6"/><text class="b" x="486" y="142">256K</text><text class="small" x="486" y="166">Rarely needs compaction</text><text class="small" x="486" y="186">But every request reads ~130K tokens</text><text class="small" x="486" y="206">Even for a two-word "haha true"</text></g>
</svg>
<svg viewBox="0 0 340 426">
<rect class="panel" x="0" y="0" width="340" height="426" rx="12"/>
<text class="caps" x="16" y="28">TOO SMALL</text>
<text class="caps mid" x="247" y="28">SWEET SPOT</text>
<text class="caps end" x="324" y="28">TOO LARGE</text>
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
<g class="node orange"><rect x="16" y="94" width="308" height="100" rx="6"/><text class="b" x="30" y="116">16K–48K</text><text class="small" x="30" y="140">Small reads, frequent compaction</text><text class="small" x="30" y="160">Each compaction reads all &amp; summarizes</text><text class="small" x="30" y="180">Prefix dies; next turn pays full price</text></g>
<circle cx="247.0" cy="53" r="5" fill="var(--card)" stroke="var(--node-line)"/>
<g class="node teal"><rect x="16" y="204" width="308" height="100" rx="6"/><text class="b" x="30" y="226">128K (Current)</text><text class="small" x="30" y="250">Compact at 110K, keep ~20K verbatim</text><text class="small" x="30" y="270">Offload search/research to sub-sessions</text><text class="small" x="30" y="290">Main session keeps only chat &amp; outcomes</text></g>
<circle cx="312.0" cy="53" r="5" fill="var(--card)" stroke="var(--node-line)"/>
<g class="node orange"><rect x="16" y="314" width="308" height="100" rx="6"/><text class="b" x="30" y="336">256K</text><text class="small" x="30" y="360">Rarely needs compaction</text><text class="small" x="30" y="380">But every request reads ~130K tokens</text><text class="small" x="30" y="400">Even for a two-word "haha true"</text></g>
</svg>
```

### Bursting the Bubble: Why We Completely Abandoned Memory Systems

Whenever people talk about long-term agent evolution, they obsess over building elaborate "memory systems": entity extraction, knowledge graph triples, update/forgetting mechanisms, vector semantic pipelines...

Yet another incisive empirical study, *Is Complex Agentic Memory Always Needed?* (arXiv:2610.30755), popped that bubble hard. The authors benchmarked over a dozen complex agent memory frameworks against a dead-simple **Raw-RAG** baseline (no entity extraction, no graphs, no memory mutation—just chunking raw dialogue and retrieving it structurally). Across seven rigorous benchmarks, Raw-RAG took first place on six.

```echarts title="Overall Score Drop When Replacing Raw Dialogue with Processed Memory" height="200" note="Score delta relative to retrieving raw dialogue directly. Source: Bao et al., Is Complex Agentic Memory Always Needed? (arXiv:2610.30755)."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "grid": {"top": 8, "left": 8, "right": 24},
  "xAxis": {"type": "value", "max": 0, "min": -25},
  "yAxis": {"type": "category", "inverse": true, "data": ["Atomic Facts", "Summaries", "+ Graph Expansion"], "axisLine": {"show": false}},
  "series": [{
    "name": "Score Change", "type": "bar", "barWidth": 22,
    "label": {"show": true, "position": "left", "formatter": "{c}", "color": "var(--ink)"},
    "itemStyle": {"color": "var(--stone)"},
    "data": [{"value": -19.62, "itemStyle": {"color": "var(--clay)"}}, -5.81, -5.78]
  }]
}
```

And across individual metrics, the side with *one fewer layer of processing* consistently scored higher:

```echarts title="On the Same Metric, One Less Layer of Processing Scores Higher" height="260" note="Test-Time Learning: 47.68% with raw dialogue vs. 15.37% after extracting atomic facts. Full Memory Access: 57.5% on processed memory store vs. 61.6% with raw dialogue directly. Mem0 accuracy: 69.42% after removing UPDATE / DELETE vs. 67.36% with them enabled. Source: ibid."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}, "valueFormatter": "{value}%"},
  "legend": {},
  "grid": {"top": 36, "right": 56},
  "xAxis": {"type": "value", "max": 80, "axisLabel": {"formatter": "{value}%"}},
  "yAxis": {"type": "category", "inverse": true, "data": ["Test-Time Learning", "Full Memory Access", "Mem0 Accuracy"]},
  "series": [
    {"name": "Less Processing", "type": "bar", "barWidth": 14, "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "position": "right", "formatter": "{c}%", "color": "var(--ink)"}, "data": [47.68, 61.6, 69.42]},
    {"name": "More Processing", "type": "bar", "barWidth": 14, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "{c}%", "color": "var(--ink)"}, "data": [15.37, 57.5, 67.36]}
  ]
}
```

Even more suffocating is the maintenance cost: keeping those delicate memory graphs alive on MemoryAgentBench routinely burned tens of millions of tokens and hours of compute, whereas raw retrieval finished in a dozen minutes.

This echoes our own production incidents with uncanny precision. Remember the sticker leak hallucination earlier?
**Once processed memory is subjectively distorted by a model, the next compaction pass solidifies that distortion into objective fact—inheriting and propagating it like a virus forever.**

Our architectural response is an act of radical decluttering:
**We threw out all memory middleware completely. We maintain zero fact graphs and run zero periodic reflection jobs.**

Every single message posted in our group over the past year rests untouched in a local SQLite database backed by a high-performance Trigram inverted index. When the model notices group members referencing *"that thing someone mentioned last time"* or encounters an inside joke it doesn't recognize, it wields a structured query tool called `tg_messages`. It can query **unadulterated verbatim transcripts** by nickname history, username change trails, speaker ID, reply trees, and time ranges.

```sketch title="No Memory Layer—Only Verbatim Transcripts" note="Typical memory systems extract, build graphs, mutate, and summarize on every turn. Our project skips all processing: raw transcripts sit in SQLite and are queried on demand via tg_messages across nickname history, renames, speaker ID, reply trees, and time ranges."
<svg viewBox="0 0 704 404">
<rect class="panel" x="0" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="24" y="28">MEMORY SYSTEM: PROCESSING EVERY TURN</text>
<g class="node plain"><rect x="32" y="48" width="278" height="32" rx="4"/><text class="mid" x="171" y="64">Raw Dialogue</text></g>
<path class="edge " d="M171 82 V98" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="102" width="278" height="32" rx="4"/><text class="mid" x="171" y="118">Extract Entities &amp; Atomic Facts</text></g>
<path class="edge " d="M171 136 V152" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="156" width="278" height="32" rx="4"/><text class="mid" x="171" y="172">Build Graph · Update · Forget</text></g>
<path class="edge " d="M171 190 V206" marker-end="url(#arrow)"/>
<g class="node violet"><rect x="32" y="210" width="278" height="32" rx="4"/><text class="mid" x="171" y="226">Condense into Summary</text></g>
<path class="edge " d="M171 244 V260" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="32" y="264" width="278" height="32" rx="4"/><text class="mid" x="171" y="280">Inject into Next Turn's Context</text></g>
<text class="small mid accent" x="171" y="340">Burns tokens processing on every turn;</text>
<text class="small mid accent" x="171" y="358">any hallucination gets baked in as fact</text>
<rect class="panel" x="362" y="0" width="342" height="404" rx="12"/>
<text class="caps" x="386" y="28">THIS PROJECT: VERBATIM TRANSCRIPTS ONLY</text>
<g class="node plain"><rect x="394" y="48" width="278" height="32" rx="4"/><text class="mid" x="533" y="64">Every Group Message</text></g>
<path class="edge " d="M533 82 V98" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="394" y="102" width="278" height="46" rx="4"/><text class="mid b" x="533" y="117">SQLite Raw Archive</text><text class="mid small" x="533" y="134">Trigram inverted index · not a char altered</text></g>
<path class="edge dash" d="M533 214 V150" marker-end="url(#arrow)"/>
<text class="small" x="541" y="182">Queried only on demand</text>
<g class="node orange"><rect x="394" y="218" width="278" height="64" rx="4"/><text class="mid b" x="533" y="242">tg_messages</text><text class="mid small" x="533" y="259">Aliases · Renames · Speaker · Replies · Time</text></g>
<path class="edge " d="M533 284 V300" marker-end="url(#arrow)"/>
<g class="node "><rect x="394" y="304" width="278" height="32" rx="4"/><text class="mid" x="533" y="320">Primary Model Reads Verbatim Quotes</text></g>
<text class="small mid accent" x="533" y="358">Zero tokens spent on "memory" during normal chat</text>
</svg>
<svg viewBox="0 0 340 824">
<rect class="panel" x="0" y="0" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="28">MEMORY SYSTEM: PROCESSING EVERY TURN</text>
<g class="node plain"><rect x="32" y="48" width="276" height="32" rx="4"/><text class="mid" x="170" y="64">Raw Dialogue</text></g>
<path class="edge " d="M170 82 V98" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="102" width="276" height="32" rx="4"/><text class="mid" x="170" y="118">Extract Entities &amp; Atomic Facts</text></g>
<path class="edge " d="M170 136 V152" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="156" width="276" height="32" rx="4"/><text class="mid" x="170" y="172">Build Graph · Update · Forget</text></g>
<path class="edge " d="M170 190 V206" marker-end="url(#arrow)"/>
<g class="node violet"><rect x="32" y="210" width="276" height="32" rx="4"/><text class="mid" x="170" y="226">Condense into Summary</text></g>
<path class="edge " d="M170 244 V260" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="32" y="264" width="276" height="32" rx="4"/><text class="mid" x="170" y="280">Inject into Next Turn's Context</text></g>
<text class="small mid accent" x="170" y="340">Burns tokens processing on every turn;</text>
<text class="small mid accent" x="170" y="358">any hallucination gets baked in as fact</text>
<rect class="panel" x="0" y="420" width="340" height="404" rx="12"/>
<text class="caps" x="24" y="448">THIS PROJECT: VERBATIM TRANSCRIPTS</text>
<g class="node plain"><rect x="32" y="468" width="276" height="32" rx="4"/><text class="mid" x="170" y="484">Every Group Message</text></g>
<path class="edge " d="M170 502 V518" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="32" y="522" width="276" height="46" rx="4"/><text class="mid b" x="170" y="537">SQLite Raw Archive</text><text class="mid small" x="170" y="554">Trigram inverted index · unaltered</text></g>
<path class="edge dash" d="M170 634 V570" marker-end="url(#arrow)"/>
<text class="small" x="178" y="602">Queried only on demand</text>
<g class="node orange"><rect x="32" y="638" width="276" height="64" rx="4"/><text class="mid b" x="170" y="662">tg_messages</text><text class="mid small" x="170" y="679">Aliases · Renames · Speaker · Replies · Time</text></g>
<path class="edge " d="M170 704 V720" marker-end="url(#arrow)"/>
<g class="node "><rect x="32" y="724" width="276" height="32" rx="4"/><text class="mid" x="170" y="740">Primary Model Reads Verbatim Quotes</text></g>
<text class="small mid accent" x="170" y="778">Zero tokens spent on "memory" in normal chat</text>
</svg>
```

**Leave raw context intact to time, and reserve the power of interpretation and verification for the exact moment it is needed.**
The former silently drains your compute on every single turn; the latter sparks an elegant retrieval only in the exact second a group member asks a follow-up question.

### Remembering the Gist, Forgetting the Exact Words: Adding a Semantic Path to Verbatim Transcripts

The most frequently used parameter in `tg_messages` is `text_contains`. Backed by SQLite FTS5's trigram index, it is fundamentally an **exact substring match**: you have to name the exact characters that appeared in the original message for it to hit.

Human memory never works like that. When a group member asks about *"that person who recommended a keyboard last time,"* the original conversation might not contain the word "keyboard" at all; someone might query a Chinese discussion in English; an inside joke circulating for three months has mutated through half a dozen spellings. Exact substring search isn't just "less accurate" here—it has **nowhere to grab hold**: the model is forced to guess synonyms one by one, and every wrong guess costs another retrieval round-trip.

Notice that "vector semantic retrieval" was on our list of standard memory-system ingredients at the start of this section. But looking back at that paper, what got falsified was never *vectors*—it was *lossy processing*: the Raw-RAG baseline that won six out of seven benchmarks works precisely by chunking raw dialogue and retrieving chunks semantically. So when we added a semantic path, we enforced three strict boundaries:

- **Zero processing:** No extraction, no summarization. Vectors are purely an index over raw transcripts; what comes back is always verbatim dialogue.
- **Zero extra LLM calls:** Windowing is deterministic code, and each dialogue window pays for embedding exactly once.
- **Zero new infrastructure:** No vector database, no native SQLite extensions, and no new tool definitions.

**Windowing: Deterministic chunking without a model.** Individual group chat messages are too short—computing a separate vector for *"lmao"*, *"+1"*, or *"true"* carries almost zero semantic signal. Instead, we slice consecutive messages into dialogue windows: a window closes once it reaches 800 characters (~20 messages), accumulates 40 messages, or encounters more than 30 minutes of silence between adjacent messages. Each line is formatted as `Nickname: text`, with photos and stickers carrying their already-cached visual descriptions—reusing the recognition results we already paid for in `media_update` without looking at the media again. Only **closed** windows (after 30 minutes of trailing silence) enter the index; the currently open window is the live conversation already sitting in the bot's context window.

That 800-character threshold wasn't plucked out of thin air; the experiments below moved it there from our initial 1,500-character design.

**Vectors: One dialogue window, one embedding.** We use Gemini's `gemini-embedding-2`, truncated to 768 dimensions and L2-normalized. Task type is specified via input prefix rather than a separate API flag: `title: none | text: …` at indexing time, and `task: search result | query: …` at query time. Pricing is $0.20 per million tokens. Backfilling our entire group archive with the initial 1,500-character windowing produced this ledger:

```stats title="One-Time Backfill" meta="2026-07-29 — 2026-11-10 · One group" note="Run against a read-only snapshot of the production archive DB using the initial 1,500-char windowing code. Token count converted at the measured ~0.62 tokens/char from countTokens. The v1 indexer backfilled ~1,150 windows in 37s before hitting rate limits, then retried using the API's retryDelay hints to finish the remaining 7,725 windows in 319s."
## Archive
Messages | 273,526 | ~2,600 per day
Body text | 7.1M chars | Excluding nicknames
## Backfill
Windows | 8,875 | Median 1,436 chars, 32 lines
Input | 7.2M tokens | 11.56M chars incl. nickname prefixes
Cost | $1.43 | Pre-run estimate was $1.00–$1.50
Remaining windows | 319 s | 7,725 windows, four 429s
```

The window size distribution reveals an important fact: the character cap, not silence, determines almost every boundary. The median window was 1,436 characters and the 75th percentile was already 1,478 characters—nearly every window pressed right up against the 1,500-character ceiling, with only 139 short windows under 200 characters. A busy group chat rarely stays silent for 30 minutes.

Strictly speaking, our earlier claim that *"zero tokens are spent on memory during normal chat"* now needs a footnote: every 5 minutes, a background job embeds newly closed windows. Averaged across our archive's velocity, that comes to under 70,000 tokens per day—roughly **1.4 cents**. It never enters the main context, never wakes an LLM, and never mutates a single previously written byte.

**Rate limiting: Indexing and querying share the same quota.** Backfilling exposed our first real operational issue. Gemini allows at most 100 texts per batch (101 returns HTTP 400), and Tier 1 quota caps embedding throughput at 1,000,000 tokens per minute. Our first indexer sent batches of 50 and aborted until the next 5-minute tick on any error; it hit HTTP 429 after 23 requests, which would have dragged a full backfill out to ~40 minutes while firing eight alert notifications. Worse yet, a live semantic query during the backfill also hit a 429: background indexing and foreground queries draw from the exact same quota pool.

The fix remained pure deterministic code—no queues, no extra services: batch size 100, honor the response's `retryDelay` (30–41s) on 429, and self-throttle the background indexer to 800,000 characters per minute—roughly half our quota, leaving the other half for live queries from the group.

When v1.1.8 shipped with 800-character windows, we re-ran the full backfill on the production database at this pace: 15,596 windows (averaging ~17.5 messages per window) at ~1,100 windows per minute, finishing in 14.5 minutes with **zero 429s**. Total character volume stayed the same (~7.2M tokens, ~$1.40). End-to-end queries on the packaged release took 545–1,064 ms; with `limit` set to 40, `rows` returns one to two complete conversation windows while the remaining top-ranked windows are listed in `matches` with `in_rows=false`.

Right after the backfill finished, we hit a small plot twist: the indexer cursor suddenly jumped to ~1.787 billion. Back in August, an e2e test had inserted 21 synthetic messages into the production archive with fake senders and timestamp-sized `message_id` values. Real Telegram supergroup message IDs increase monotonically, which the indexer relies on to advance its cursor. Rather than adding defensive code for an "impossible branch," we backed up the database and deleted those 21 synthetic messages along with the 4 windows they had polluted, returning the cursor to its true position. Defensive code should guard against branches that can genuinely happen in reality; when an impossible branch appears from dirty data, make it impossible again.

**Storage and retrieval: No vector database.** Vectors are stored as `float32` BLOBs in a single new table, `message_chunks`, where each row holds only the chat ID, the first and last message IDs of the window, the model name, and those 768 floats—the sole schema change in this feature. At query time, we embed the query into a vector and run an in-memory brute-force cosine scan across all windows in JavaScript: 768 dimensions × 8,875 windows is ~6.8 million multiply-adds, finishing in **14 milliseconds** including sorting. Nearly all of a query's 470–700 ms latency is spent on the single network round-trip to the embedding API. Keeping all vectors resident in memory takes 27 MB (or ~48 MB for 15,596 windows after switching to 800-character windows—still trivial). At this scale, approximate nearest-neighbor indexes like HNSW or IVF solve a problem we simply do not have. And if we ever switch embedding models, old vectors aren't comparable anyway—we just drop and rebuild.

```sketch title="Verbatim Dialogue Sliced into Windows, One Vector per Window" note="Top: every 5 minutes the background job embeds newly closed windows (split at 800 chars, 40 messages, or >30 min silence; the active tail stays unindexed). Bottom: a query costs just one embedding call, ranks windows via in-memory cosine similarity, and returns full verbatim dialogue windows. Counts shown are illustrative."
<svg viewBox="0 0 704 256">
<rect class="panel" x="0" y="0" width="704" height="256" rx="12"/>
<text class="caps" x="24" y="26">BACKGROUND: INCREMENTAL INDEXING EVERY 5 MIN</text>
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
<text class="small mid" x="136" y="118">800 chars</text>
<text class="small mid" x="272" y="118">Silence &gt;30m</text>
<text class="small mid" x="328" y="134">Still active</text>
<path class="edge" d="M68 62 V46 H460 V54" marker-end="url(#arrow)"/>
<path class="edge" d="M204 62 V46"/>
<g class="node orange"><rect x="392" y="58" width="136" height="46" rx="4"/><text class="mid b" x="460" y="73">Gemini Embed</text><text class="mid small" x="460" y="90">768-d · once/window</text></g>
<path class="edge" d="M528 81 H548" marker-end="url(#arrow)"/>
<g class="node"><rect x="552" y="58" width="128" height="46" rx="4"/><text class="mid b" x="616" y="73">message_chunks</text><text class="mid small" x="616" y="90">float32 BLOB</text></g>
<path class="edge dash" d="M616 106 V140 H416 V166" marker-end="url(#arrow)"/>
<text class="small" x="424" y="134">Resident in RAM</text>
<text class="caps" x="24" y="156">AT QUERY TIME</text>
<g class="node clay"><rect x="24" y="176" width="140" height="34" rx="17"/><text class="mid" x="94" y="193">"keyboard rec"</text></g>
<path class="edge" d="M164 193 H184" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="188" y="170" width="136" height="46" rx="4"/><text class="mid b" x="256" y="185">Gemini Embed</text><text class="mid small" x="256" y="202">Same model · query</text></g>
<path class="edge" d="M324 193 H344" marker-end="url(#arrow)"/>
<g class="node"><rect x="348" y="170" width="136" height="46" rx="4"/><text class="mid b" x="416" y="185">Cosine Scan</text><text class="mid small" x="416" y="202">Brute-force in RAM</text></g>
<path class="edge" d="M484 193 H504" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="508" y="170" width="172" height="46" rx="4"/><text class="mid b" x="594" y="185">Verbatim Windows</text><text class="mid small" x="594" y="202">+ matches scores</text></g>
<text class="small end" x="680" y="236">Model pages via before_id / after_id as needed</text>
</svg>
<svg viewBox="0 0 340 552">
<rect class="panel" x="0" y="0" width="340" height="552" rx="12"/>
<text class="caps" x="16" y="24">BACKGROUND: EVERY 5 MIN</text>
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
<text class="small mid" x="118" y="92">800 chars</text>
<text class="small mid" x="238" y="92">Idle &gt;30m</text>
<text class="small mid" x="290" y="30">Active</text>
<path class="edge" d="M58 76 V106" marker-end="url(#arrow)"/>
<path class="edge" d="M178 76 V106" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="16" y="110" width="308" height="46" rx="4"/><text class="mid b" x="170" y="125">Gemini Embed</text><text class="mid small" x="170" y="142">768-d · once per window</text></g>
<path class="edge" d="M170 158 V176" marker-end="url(#arrow)"/>
<g class="node"><rect x="16" y="180" width="308" height="46" rx="4"/><text class="mid b" x="170" y="195">message_chunks</text><text class="mid small" x="170" y="212">float32 BLOB · resident in RAM</text></g>
<text class="caps" x="16" y="258">AT QUERY TIME</text>
<g class="node clay"><rect x="16" y="270" width="308" height="34" rx="17"/><text class="mid" x="170" y="287">"that keyboard recommendation"</text></g>
<path class="edge" d="M170 306 V324" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="16" y="328" width="308" height="46" rx="4"/><text class="mid b" x="170" y="343">Gemini Embed</text><text class="mid small" x="170" y="360">Same model · query prefix</text></g>
<path class="edge" d="M170 376 V394" marker-end="url(#arrow)"/>
<g class="node"><rect x="16" y="398" width="300" height="46" rx="4"/><text class="mid b" x="166" y="413">Cosine Scan</text><text class="mid small" x="166" y="430">Brute-force scan in RAM</text></g>
<path class="edge dash" d="M324 203 H332 V421 H320" marker-end="url(#arrow)"/>
<path class="edge" d="M170 446 V464" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="16" y="468" width="308" height="46" rx="4"/><text class="mid b" x="170" y="483">Verbatim Windows</text><text class="mid small" x="170" y="500">+ matches scores</text></g>
<text class="small" x="16" y="536">Model pages via before_id / after_id as needed</text>
</svg>
```

**Interface: No new tool, just one new parameter.** Rather than registering a separate tool, we added a `semantic` parameter to `tg_messages`: pass a natural-language description of what you're looking for, and it returns the most relevant **complete conversation windows**; `matches` lists up to the top 10 windows with their `first_id`, `last_id`, similarity score, and an `in_rows` flag indicating whether that window fit into `rows`. It composes seamlessly with existing filters (`sender`, `since`, `until`, `text_contains`), keeping only windows that contain at least one matching message; once the model reads a window and wants to trace what led up to it or how it resolved, it uses the existing `before_id` / `after_id` cursors to page backward or forward.

This continues our earlier principle of declaring all tools upfront: adding a parameter expands the tool schema by ~1,200 characters (~700–800 tokens, well under 1% of an average request), sitting inside the frozen prefix where it is re-read at cached rates; adding a separate tool would force the model to learn and coordinate another tool contract. Because tool schemas are part of the cache-visible protocol, changing them follows strict discipline: `CACHE_SCHEMA_VERSION` bumped from 55 to 56 alongside an updated golden hash. The cache took a single cold start at deploy time, and remained byte-for-byte immutable thereafter.

**Verification: Test on the real archive before writing the tool description.** After writing the code, we didn't ship straight to production. Instead, we had a sub-agent run four experiments on the production server against a read-only snapshot of the archive database—without starting the daemon or touching the live service (having learned our lesson from two processes fighting over the same bot token). Once the experiments finished, both the snapshot and the temporary API key were deleted. All four experiments combined cost about $3:

1. **Full backfill:** Backfill the entire archive snapshot to measure throughput, rate limiting, window statistics, token volume, event-loop blockage, and RSS memory growth;
2. **Query latency:** Measure end-to-end semantic query latency and where the time goes;
3. **Retrieval quality:** Test 25 real topics discussed in the group **without using any original wording**—paraphrasing, querying Chinese discussions in English, combining *"person + topic"* with `sender` filters, and constraining date ranges—plus 5 negative queries for events that never happened to see where false-positive scores land;
4. **Parameter sensitivity:** Compare silence thresholds, window sizes, keeping vs. dropping the bot's own messages, and index prefixes on the most recent 30-day subset.

```stats title="Semantic Retrieval Benchmark" meta="Read-only production archive snapshot · 1,500-char windows" note="Query latency is end-to-end from query dispatch to verbatim rows returned; cosine scan includes sorting across all 8,875 windows. Event loop and memory measured during full backfill. Negative queries: top-1 score across 5 events that never happened."
## Speed
Semantic query | 470–700 ms | Almost entirely the single embedding call
Cosine scan | 14 ms | Brute-force across all windows
Literal search | 50–140 ms | text_contains baseline
## During Backfill
Event-loop lag | 11 ms | p99, max 49 ms
Vectors in RAM | 27 MB | Process RSS ~160 MB
## Quality
Paraphrased hits | 20 / 25 | Top-1 window was the exact target
Negative queries | 0.627–0.701 | Top-1 score, higher than many true hits
```

First, speed: semantic queries are several times slower than literal trigram search, but the latency lives almost entirely in the single network round-trip to the embedding API, not local compute; during the full backfill, event-loop lag peaked at just 49 ms, completely imperceptible for receiving and sending group messages.

Next, quality: out of 25 paraphrased queries, 20 returned the exact target conversation as the #1 result—covering blockchain storage, router bridging and IPTV, replacing Windows fonts, a rainy beach trip, taking a leave of absence from college, exporting an eSIM, a Minecraft iron farm, weight loss, and GPUs. Querying Chinese chat logs in English worked just as well. For niche topics (only 3–7 relevant windows in the entire archive), the #1 result was spot-on while ranks #2–#5 were mostly filler.

The queries that missed drew a crisp boundary around what semantic search cannot do:

- **Asking what a meme or slang term means:** 0 / 10. Group members use slang rather than defining it in chat; for that, pass the literal slang term to `text_contains`.
- **Proper nouns and brand names:** A paid vocabulary app or a specific quant firm is much better served by exact substring search.
- **Figurative usage drowning out literal meaning:** True discussions about typhoons were rare, whereas "typhoon" used as a metaphor appeared everywhere.
- **Key facts scattered across multiple windows:** A platform rug-pull or *"the police said it's a civil dispute"* where each window only touched a fragment.

Query phrasing matters too: a complete descriptive sentence outperforms two or three bare keywords by a wide margin. Searching just `"headphones"` returned 2 relevant windows in the top 5; writing `"comparing noise cancellation and prices of several wireless earbuds"` returned 4.

The biggest surprise was similarity scores. We originally wanted to give the model a cutoff threshold below which it should treat results as "not found." The experiment proved **no such cutoff exists**: relevant windows had a median score of 0.669 while irrelevant ones had a median of 0.658, with nearly complete overlap. Across 5 negative queries for events that never happened, the #1 score ranged from 0.627 to 0.701—a fabricated query about *"wedding photos"* scored 0.701, beating many genuine hits. Whenever the gap between #1 and #5 exceeded 0.05, the top result was always right, yet many genuine hits differed by only 0.01–0.03, indistinguishable from negative queries. So we wrote this rule directly into the tool description: similarity scores are only for relative ranking within a single query; the model must read `rows` to verify relevance, rephrase or fall back to `text_contains` if they don't match, and never assert *"the group has never discussed this"* based on scores alone.

The experiment also caught a result-shaping bug: when `limit` was set to 30–40, queries always returned only a single window—because the first window had nearly 40 messages, the second window didn't fit, and the loop broke early. Now windows that don't fit the remaining row budget are skipped rather than halting the loop, ensuring the top window is always returned while other high-ranking windows are flagged via `in_rows` in `matches` so the model can fetch them by ID if needed.

We tuned our windowing parameters on the 30-day subset:

```data title="Choosing Windowing Parameters" bars="P@1,P@5" mark="800 chars (shipped)" note="30-day subset, 21 queries plus 3 negative queries for events that never happened. Baseline is 30-min silence, 1,500 chars, 40 messages. P@1, P@5: fraction of relevant windows in top 1 and top 5; MRR: mean reciprocal rank of the first relevant window; Msg Precision: fraction of the 40-message budget landing inside relevant windows. Raising the character limit alone to 3,000 hit the 40-message cap first and changed nothing, so that row also raised the cap to 80 messages."
Config | Windows | P@1 | P@5 | MRR | Msg Precision
Baseline | 2,241 | 0.76 | 0.47 | 0.83 | 0.73
10-min silence | 2,562 | 0.76 | 0.48 | 0.83 | 0.74
800 chars (shipped) | 3,720 | 0.81 | 0.57 | 0.84 | 0.78
3,000 chars / 80 msgs | 1,145 | 0.62 | 0.46 | 0.74 | 0.62
Drop bot messages | 1,948 | 0.48 | 0.39 | 0.62 | 0.48
Drop index prefix | 2,238 | 0.71 | 0.47 | 0.77 | 0.68
```

Three takeaways jumped out. First, smaller windows are more accurate: 800 characters won on every single metric while keeping total character count—and therefore embedding token cost—completely unchanged. Second, a 10-minute vs. 30-minute silence threshold made almost no difference, confirming again that window boundaries are driven primarily by character length. Most surprising of all were the bot's own messages: they accounted for 75% of total character volume and looked like noise we should strip out, yet the bot's explanations carried the exact topical vocabulary that anchored retrieval—dropping bot messages tanked P@1 from 0.76 down to 0.48.

Finally, the examples in the tool description grew directly out of these experiments: *"someone explained how to make a custom sticker pack,"* *"comparing noise cancellation and prices of several wireless earbuds,"* the English query *"someone got liquidated on a high-leverage position,"* combining `sender` with *"plans for taking a gap year from school,"* pairing with `text_contains` to lock down a keyword, and using `after_id` / `before_id` to expand surrounding context. Every single example in the prompt is a query that actually succeeded in our benchmark, and the failure modes were documented verbatim under *"When not to use."*

In total, the feature added 552 lines and deleted 25 lines in `src/` (339 of which live in the new `semantic.ts`): one table, one parameter. It adds zero "memory layers" to the bot: when nobody asks about the past, not a single extra character enters the primary model's context; when someone does ask, what comes back is still the verbatim transcript from that day.

---

## Cashing Restraint In for Freedom: Speed and Capability Are Born from Frugality

Reading this far, someone might form a misconception: if this project counts every penny and every token with such ruthless discipline, doesn't the bot feel rigid, impoverished, and sluggish?

The reality is the exact opposite.
**All our restraint and weight-shedding was never about hoarding money in a ledger—it was about converting massive compute overhead into unprecedented agility and versatility when it actually counts.**

### Highlight 1: The Breathing Room of Codemode — Speaking While Acting

The strongest immediate impression group members report is: *"Why does your bot respond so ridiculously fast?"*
It isn't because we swapped in some ultra-low-latency model; the secret lies entirely in the interaction aesthetics of `codemode`.

Consider how a mainstream agent framework mechanically grinds through a multi-step request like *"Look up the origin of this tech meme and summarize what our group has said about it"*:

1. The model reads 90,000 tokens and decides to call `search`;
2. Long wait while the network returns search results;
3. The model **re-reads all 90,000 tokens plus pages of raw HTML snippets**, then decides to call a second tool;
4. Another wait, another full re-read of the entire context to fetch a web page;
5. After four or five heavy, full-price round-trips, users have been staring at a dead *"typing..."* indicator for half a minute;
6. Finally, several pages of unfiltered web text get welded permanently into the chat history for all subsequent turns.

In our architecture, the model uses Pi's isolated sandbox to write a short, native JavaScript program in a single turn:

```js
// 1. Speak first to break the dead silence of waiting
await tools.send({ text: "Let me check the group archive and look up that meme—one sec!" });

// 2. Dispatch in parallel and aggregate inside the sandbox
const [searchRes, historyRes] = await Promise.allSettled([
  tools.search({ query: "open source project architecture overhaul" }),
  tools.tg_messages({ text_contains: "architecture overhaul", limit: 10 }),
]);

// 3. Slice and filter in sandbox RAM so raw junk never enters the main context
const web = searchRes.status === "fulfilled" ? searchRes.value : null;
const chat = historyRes.status === "fulfilled" ? historyRes.value : null;

text({
  summary: web?.slice(0, 1000),
  discussions: chat?.rows.map(({ sender, text }) => `${sender.name}: ${text}`),
});
```

Laying the two execution models side by side makes the difference clear—look at how many times the primary model wakes up and what it has to read each time:

```sketch title="The Same Task, Run Two Ways" note="In a traditional agent loop, every tool result returns to the primary model for another full-context re-read; the diagram shows two tool calls, though real tasks often take four or five. In codemode, a sandboxed script sends an immediate heads-up, runs searches in parallel, and slices the output—waking the primary model only twice."
<svg viewBox="0 0 704 452">
<rect class="panel" x="0" y="0" width="342" height="452" rx="12"/>
<text class="caps" x="24" y="30">SEQUENTIAL TOOL CALLS</text>
<g class="node "><rect x="60" y="56" width="222" height="46" rx="4"/><text class="mid b" x="171" y="71">Primary Model</text><text class="mid small" x="171" y="88">Reads 93K tokens</text></g>
<circle class="glyph" cx="74" cy="76" r="2.4"/><circle class="glyph" cx="74" cy="82" r="2.4"/><circle class="glyph" cx="82" cy="73" r="2.4"/><circle class="glyph" cx="82" cy="79" r="2.4"/><circle class="glyph" cx="82" cy="85" r="2.4"/><circle class="glyph" cx="90" cy="76" r="2.4"/><circle class="glyph" cx="90" cy="82" r="2.4"/>
<path class="edge " d="M171 104 V121" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="100" y="124" width="142" height="30" rx="4"/><text class="mid" x="171" y="139">search</text></g>
<path class="edge " d="M171 156 V173" marker-end="url(#arrow)"/>
<g class="node "><rect x="60" y="176" width="222" height="46" rx="4"/><text class="mid b" x="171" y="191">Primary Model</text><text class="mid small" x="171" y="208">Re-reads 93K + search results</text></g>
<circle class="glyph" cx="74" cy="196" r="2.4"/><circle class="glyph" cx="74" cy="202" r="2.4"/><circle class="glyph" cx="82" cy="193" r="2.4"/><circle class="glyph" cx="82" cy="199" r="2.4"/><circle class="glyph" cx="82" cy="205" r="2.4"/><circle class="glyph" cx="90" cy="196" r="2.4"/><circle class="glyph" cx="90" cy="202" r="2.4"/>
<path class="edge " d="M171 224 V241" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="100" y="244" width="142" height="30" rx="4"/><text class="mid" x="171" y="259">fetch web page</text></g>
<path class="edge " d="M171 276 V293" marker-end="url(#arrow)"/>
<g class="node "><rect x="60" y="296" width="222" height="46" rx="4"/><text class="mid b" x="171" y="311">Primary Model</text><text class="mid small" x="171" y="328">Re-reads all + raw page text</text></g>
<circle class="glyph" cx="74" cy="316" r="2.4"/><circle class="glyph" cx="74" cy="322" r="2.4"/><circle class="glyph" cx="82" cy="313" r="2.4"/><circle class="glyph" cx="82" cy="319" r="2.4"/><circle class="glyph" cx="82" cy="325" r="2.4"/><circle class="glyph" cx="90" cy="316" r="2.4"/><circle class="glyph" cx="90" cy="322" r="2.4"/>
<path class="edge " d="M171 344 V361" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="100" y="364" width="142" height="30" rx="4"/><text class="mid" x="171" y="379">send answer</text></g>
<text class="small mid accent" x="171" y="424">Every result returns for a full-price re-read</text>
<rect class="panel" x="362" y="0" width="342" height="452" rx="12"/>
<text class="caps" x="386" y="30">CODEMODE</text>
<g class="node "><rect x="398" y="56" width="270" height="46" rx="4"/><text class="mid b" x="533" y="71">Primary Model · Call 1</text><text class="mid small" x="533" y="88">Writes a short script</text></g>
<circle class="glyph" cx="412" cy="76" r="2.4"/><circle class="glyph" cx="412" cy="82" r="2.4"/><circle class="glyph" cx="420" cy="73" r="2.4"/><circle class="glyph" cx="420" cy="79" r="2.4"/><circle class="glyph" cx="420" cy="85" r="2.4"/><circle class="glyph" cx="428" cy="76" r="2.4"/><circle class="glyph" cx="428" cy="82" r="2.4"/>
<path class="edge " d="M533 104 V128" marker-end="url(#arrow)"/>
<rect class="window" x="384" y="132" width="298" height="196" rx="8"/>
<text class="caps" x="394" y="148">SCRIPT IN SANDBOX</text>
<g class="node teal"><rect x="398" y="162" width="270" height="30" rx="4"/><text class="mid" x="533" y="177">send "Checking now, one sec!"</text></g>
<path class="edge " d="M533 194 V204 H456 V214" marker-end="url(#arrow)"/>
<path class="edge " d="M533 204 H610 V214" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="398" y="218" width="116" height="30" rx="4"/><text class="mid" x="456" y="233">search</text></g>
<g class="node orange"><rect x="552" y="218" width="116" height="30" rx="4"/><text class="mid" x="610" y="233">tg_messages</text></g>
<text class="small mid" x="533" y="233">parallel</text>
<path class="edge " d="M456 250 V260 H533 V276" marker-end="url(#arrow)"/>
<path class="edge " d="M610 250 V260 H533"/>
<g class="node plain"><rect x="398" y="280" width="270" height="34" rx="4"/><text class="mid" x="533" y="297">Slice to a few hundred chars</text></g>
<path class="edge " d="M533 330 V352" marker-end="url(#arrow)"/>
<g class="node "><rect x="398" y="356" width="270" height="46" rx="4"/><text class="mid b" x="533" y="371">Primary Model · Call 2</text><text class="mid small" x="533" y="388">Reads sliced results &amp; replies</text></g>
<circle class="glyph" cx="412" cy="376" r="2.4"/><circle class="glyph" cx="412" cy="382" r="2.4"/><circle class="glyph" cx="420" cy="373" r="2.4"/><circle class="glyph" cx="420" cy="379" r="2.4"/><circle class="glyph" cx="420" cy="385" r="2.4"/><circle class="glyph" cx="428" cy="376" r="2.4"/><circle class="glyph" cx="428" cy="382" r="2.4"/>
<text class="small mid accent" x="533" y="426">Only 2 calls; raw payloads stay in the sandbox</text>
</svg>
<svg viewBox="0 0 340 920">
<rect class="panel" x="0" y="0" width="340" height="452" rx="12"/>
<text class="caps" x="24" y="30">SEQUENTIAL TOOL CALLS</text>
<g class="node "><rect x="59" y="56" width="222" height="46" rx="4"/><text class="mid b" x="170" y="71">Primary Model</text><text class="mid small" x="170" y="88">Reads 93K tokens</text></g>
<circle class="glyph" cx="73" cy="76" r="2.4"/><circle class="glyph" cx="73" cy="82" r="2.4"/><circle class="glyph" cx="81" cy="73" r="2.4"/><circle class="glyph" cx="81" cy="79" r="2.4"/><circle class="glyph" cx="81" cy="85" r="2.4"/><circle class="glyph" cx="89" cy="76" r="2.4"/><circle class="glyph" cx="89" cy="82" r="2.4"/>
<path class="edge " d="M170 104 V121" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="99" y="124" width="142" height="30" rx="4"/><text class="mid" x="170" y="139">search</text></g>
<path class="edge " d="M170 156 V173" marker-end="url(#arrow)"/>
<g class="node "><rect x="59" y="176" width="222" height="46" rx="4"/><text class="mid b" x="170" y="191">Primary Model</text><text class="mid small" x="170" y="208">Re-reads 93K + search results</text></g>
<circle class="glyph" cx="73" cy="196" r="2.4"/><circle class="glyph" cx="73" cy="202" r="2.4"/><circle class="glyph" cx="81" cy="193" r="2.4"/><circle class="glyph" cx="81" cy="199" r="2.4"/><circle class="glyph" cx="81" cy="205" r="2.4"/><circle class="glyph" cx="89" cy="196" r="2.4"/><circle class="glyph" cx="89" cy="202" r="2.4"/>
<path class="edge " d="M170 224 V241" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="99" y="244" width="142" height="30" rx="4"/><text class="mid" x="170" y="259">fetch web page</text></g>
<path class="edge " d="M170 276 V293" marker-end="url(#arrow)"/>
<g class="node "><rect x="59" y="296" width="222" height="46" rx="4"/><text class="mid b" x="170" y="311">Primary Model</text><text class="mid small" x="170" y="328">Re-reads all + raw page text</text></g>
<circle class="glyph" cx="73" cy="316" r="2.4"/><circle class="glyph" cx="73" cy="322" r="2.4"/><circle class="glyph" cx="81" cy="313" r="2.4"/><circle class="glyph" cx="81" cy="319" r="2.4"/><circle class="glyph" cx="81" cy="325" r="2.4"/><circle class="glyph" cx="89" cy="316" r="2.4"/><circle class="glyph" cx="89" cy="322" r="2.4"/>
<path class="edge " d="M170 344 V361" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="99" y="364" width="142" height="30" rx="4"/><text class="mid" x="170" y="379">send answer</text></g>
<text class="small mid accent" x="170" y="424">Every result returns for a full-price re-read</text>
<rect class="panel" x="0" y="468" width="340" height="452" rx="12"/>
<text class="caps" x="24" y="498">CODEMODE</text>
<g class="node "><rect x="35" y="524" width="270" height="46" rx="4"/><text class="mid b" x="170" y="539">Primary Model · Call 1</text><text class="mid small" x="170" y="556">Writes a short script</text></g>
<circle class="glyph" cx="49" cy="544" r="2.4"/><circle class="glyph" cx="49" cy="550" r="2.4"/><circle class="glyph" cx="57" cy="541" r="2.4"/><circle class="glyph" cx="57" cy="547" r="2.4"/><circle class="glyph" cx="57" cy="553" r="2.4"/><circle class="glyph" cx="65" cy="544" r="2.4"/><circle class="glyph" cx="65" cy="550" r="2.4"/>
<path class="edge " d="M170 572 V596" marker-end="url(#arrow)"/>
<rect class="window" x="21" y="600" width="298" height="196" rx="8"/>
<text class="caps" x="31" y="616">SCRIPT IN SANDBOX</text>
<g class="node teal"><rect x="35" y="630" width="270" height="30" rx="4"/><text class="mid" x="170" y="645">send "Checking now, one sec!"</text></g>
<path class="edge " d="M170 662 V672 H93 V682" marker-end="url(#arrow)"/>
<path class="edge " d="M170 672 H247 V682" marker-end="url(#arrow)"/>
<g class="node orange"><rect x="35" y="686" width="116" height="30" rx="4"/><text class="mid" x="93" y="701">search</text></g>
<g class="node orange"><rect x="189" y="686" width="116" height="30" rx="4"/><text class="mid" x="247" y="701">tg_messages</text></g>
<text class="small mid" x="170" y="701">parallel</text>
<path class="edge " d="M93 718 V728 H170 V744" marker-end="url(#arrow)"/>
<path class="edge " d="M247 718 V728 H170"/>
<g class="node plain"><rect x="35" y="748" width="270" height="34" rx="4"/><text class="mid" x="170" y="765">Slice to a few hundred chars</text></g>
<path class="edge " d="M170 798 V820" marker-end="url(#arrow)"/>
<g class="node "><rect x="35" y="824" width="270" height="46" rx="4"/><text class="mid b" x="170" y="839">Primary Model · Call 2</text><text class="mid small" x="170" y="856">Reads sliced results &amp; replies</text></g>
<circle class="glyph" cx="49" cy="844" r="2.4"/><circle class="glyph" cx="49" cy="850" r="2.4"/><circle class="glyph" cx="57" cy="841" r="2.4"/><circle class="glyph" cx="57" cy="847" r="2.4"/><circle class="glyph" cx="57" cy="853" r="2.4"/><circle class="glyph" cx="65" cy="844" r="2.4"/><circle class="glyph" cx="65" cy="850" r="2.4"/>
<text class="small mid accent" x="170" y="894">Only 2 calls; raw payloads stay in the sandbox</text>
</svg>
```

Savor the aesthetic power packed into that short script:

1. **Speak first (thoughtful pacing):** Executing `send` on line 1 delivers an immediate acknowledgment to the user's client within a few hundred milliseconds. The psychological friction of "dead waiting" turns instantly into *"it's already on it."* Calling `send` inside the `codemode` sandbox does not trigger turn termination, allowing the pipeline to keep flowing in the background.
2. **True parallel execution:** Network requests should naturally run concurrently. `Promise.allSettled` collapses multiple serial round-trips into one.
3. **A context firewall:** Tens of kilobytes of raw web text and redundant metadata are distilled in place inside sandbox RAM; **only a few hundred tightly sliced characters of core signal are fed back to the primary model**.

We deliberately passed on the "native parallel tool calling" touted by model providers. Native parallel tool calls are one-way and rigid—you cannot speak a reassuring sentence first and branch dynamically on the return values within the same batch, nor can you stop the raw tool outputs from flooding your main context window. `codemode` is the unique solution that fuses instant responsiveness, dynamic control flow, and context hygiene into one.

### Highlight 2: One Complete Linux Container Beats a Hundred Fragile Plugins

Many developers measure an agent's power by the length of its plugin list: weather plugins, charting plugins, audio transcoding plugins, PDF reader plugins, web snapshot plugins...
Every plugin adds a verbose schema, thousands of lines of glue code, and a third-party boundary waiting to break. Worse still, **the model's capability ceiling is permanently locked inside the intersection of plugins the author bothered to write**. If a group member wants to extract specific frames from a video and turn them into a monochrome GIF, and the author never wrote a plugin for that, the agent can only shrug.

Our design aesthetic went to the opposite extreme: **give the model a real Linux machine.**

Through Pi's native file and shell primitives (`read` / `write` / `edit` / `bash`), the bot commands a rootless Docker container running under an isolated system user. Its workspace comes preloaded with a full modern toolchain: Python (`uv`), Node.js, `ffmpeg`, ImageMagick, `ripgrep`, Chromium, and full CJK fonts.

Magical things happen as a result:

- Want to trim video, extract audio, or compress a sticker? The model types a one-line `ffmpeg` command in the sandbox;
- Want to crunch data or render a complex heatmap? The model runs `uv run --with matplotlib python main.py` inside the container;
- When a group member asks curiously, *"How does your underlying logic actually work?"*, the bot uses `bash` to clone its own GitHub repository into `/work/src`, searches the codebase with `rg`, and explains its own implementation line by line;
- Once an artifact is ready, it pushes the output straight back to the group as native files or photo albums via `send.files`.

For all of these capabilities, **we didn't write a single line of "plugin code."** Frontier models have already been trained on humanity's entire open-source Unix ecosystem—they speak Shell natively. The only respectful thing for us to do is not to play babysitter and reinvent wheels for them, but to draw a firm security boundary and hand them a clean, isolated, always-ready general execution environment.

Around that clean container boundary, we built a defense-in-depth security perimeter:

```sketch title="A Complete Linux Machine Inside Layered Boundaries" note="The bot daemon and the container run under separate OS users; the container holds zero API keys, SSH keys, or secrets, and both model requests and outbound files pass through the daemon."
<svg viewBox="0 0 704 344">
<rect class="panel" x="0" y="0" width="704" height="344" rx="12"/>
<text class="caps" x="24" y="30">HOST MACHINE</text>
<g class="node "><rect x="24" y="104" width="160" height="64" rx="4"/><text class="mid b" x="104" y="128">Bot Daemon</text><text class="mid small" x="104" y="145">Keys &amp; tokens live here</text></g>
<g class="node clay"><rect x="24" y="250" width="160" height="40" rx="20"/><text class="mid" x="104" y="270">Model API</text></g>
<path class="edge " d="M104 170 V246" marker-end="url(#arrow)"/>
<text class="small" x="112" y="208">Proxies requests</text>
<rect class="window" x="236" y="48" width="444" height="276" rx="10"/>
<text class="small b" x="252" y="68">OS user tgbox · rootless Docker</text>
<g class="node plain"><rect x="256" y="84" width="404" height="206" rx="8"/></g>
<text class="small b" x="272" y="104">Container · uid 1000</text>
<g class="node "><rect x="272" y="120" width="120" height="28" rx="3"/><text class="mid small" x="332" y="134">Read-only rootfs</text></g>
<g class="node "><rect x="398" y="120" width="124" height="28" rx="3"/><text class="mid small" x="460" y="134">cap-drop ALL</text></g>
<g class="node "><rect x="528" y="120" width="116" height="28" rx="3"/><text class="mid small" x="586" y="134">no-new-privileges</text></g>
<g class="node "><rect x="464" y="156" width="180" height="28" rx="3"/><text class="mid small" x="554" y="170">/tmp: 256 MB tmpfs</text></g>
<g class="node "><rect x="272" y="156" width="186" height="28" rx="3"/><text class="mid small" x="365" y="170">RAM, CPU &amp; PID limits</text></g>
<g class="node teal"><rect x="272" y="202" width="372" height="72" rx="6"/><text class="mid b" x="458" y="230">/work</text><text class="mid small" x="458" y="247">Only writable persistent dir · wiped Mon 05:00</text></g>
<path class="edge " d="M186 122 H252" marker-end="url(#arrow)"/>
<text class="small mid" x="219" y="108">bash</text>
<path class="edge " d="M252 150 H188" marker-end="url(#arrow)"/>
<text class="small mid" x="219" y="166">send.files</text>
<text class="small" x="256" y="308">Network kill-switch ready; outbound files resolve realpath so symlinks cannot escape</text>
</svg>
<svg viewBox="0 0 340 452">
<rect class="panel" x="0" y="0" width="340" height="452" rx="12"/>
<text class="caps" x="16" y="26">HOST MACHINE</text>
<g class="node "><rect x="16" y="40" width="136" height="60" rx="4"/><text class="mid b" x="84" y="62">Bot Daemon</text><text class="mid small" x="84" y="79">Keys &amp; tokens here</text></g>
<g class="node clay"><rect x="220" y="50" width="104" height="40" rx="20"/><text class="mid" x="272" y="70">Model API</text></g>
<path class="edge " d="M154 70 H216" marker-end="url(#arrow)"/>
<text class="small mid" x="186" y="58">Proxies</text>
<rect class="window" x="8" y="124" width="324" height="282" rx="10"/>
<text class="small b end" x="320" y="140">OS user tgbox</text>
<text class="small b end" x="320" y="156">rootless Docker</text>
<path class="edge " d="M56 102 V176" marker-end="url(#arrow)"/>
<text class="small" x="62" y="140">bash</text>
<path class="edge " d="M116 176 V104" marker-end="url(#arrow)"/>
<text class="small" x="122" y="140">send.files</text>
<g class="node plain"><rect x="20" y="180" width="300" height="214" rx="8"/></g>
<text class="small b" x="32" y="198">Container · uid 1000</text>
<g class="node "><rect x="32" y="210" width="134" height="28" rx="3"/><text class="mid small" x="99" y="224">Read-only rootfs</text></g>
<g class="node "><rect x="174" y="210" width="134" height="28" rx="3"/><text class="mid small" x="241" y="224">cap-drop ALL</text></g>
<g class="node "><rect x="32" y="244" width="134" height="28" rx="3"/><text class="mid small" x="99" y="258">no-new-privileges</text></g>
<g class="node "><rect x="174" y="244" width="134" height="28" rx="3"/><text class="mid small" x="241" y="258">/tmp: 256 MB tmpfs</text></g>
<g class="node "><rect x="32" y="278" width="276" height="28" rx="3"/><text class="mid small" x="170" y="292">RAM, CPU &amp; PID limits</text></g>
<g class="node teal"><rect x="32" y="318" width="276" height="62" rx="6"/><text class="mid b" x="170" y="341">/work</text><text class="mid small" x="170" y="358">Only writable dir · wiped Mon 05:00</text></g>
<text class="small" x="16" y="424">Network kill-switch ready; outbound files resolve</text>
<text class="small" x="16" y="442">realpath so symlinks cannot escape</text>
</svg>
```

**One general execution environment replaced an endless parade of mediocre plugins.** That architectural convergence holds far more beauty than any micro-optimization in code.

---

## The Final Layer: Code Is Context — Distilling 17,500 Lines Down to 8,089

If we shift our gaze from the runtime model back to our own daily workflow as developers, we find the exact same physical laws governing everything.

From day one, this project was built iteratively alongside a Coding Agent. In a Coding Agent's world, **your codebase *is* its context window**. Every redundant wrapper you write, every abstraction layer reserved for hypothetical "future extensibility," and every wavering compatibility branch ruthlessly consumes the coding model's attention and comprehension in every single development session.

```echarts title="Evolution of Lines of Code in src/" height="300" note="Total lines across src/**/*.ts on each commit date; horizontal axis is scaled proportionally to calendar time."
{
  "tooltip": {"trigger": "axis", "valueFormatter": "{value} lines"},
  "grid": {"right": 24, "top": 28},
  "xAxis": {"type": "time", "minInterval": 1209600000, "axisLabel": {"formatter": "{MM}-{dd}", "hideOverlap": true}},
  "yAxis": {"type": "value", "axisLabel": {"formatter": "{value}"}},
  "series": [{
    "name": "src/ lines", "type": "line", "showSymbol": true, "symbolSize": 5,
    "itemStyle": {"color": "var(--clay)"}, "areaStyle": {"color": "var(--clay)", "opacity": 0.12},
    "data": [["2026-08-07", 2079], ["2026-08-08", 7441], ["2026-08-09", 11661], ["2026-08-10", 13173], ["2026-08-13", 13639], ["2026-08-26", 14085], ["2026-09-07", 14532], ["2026-10-06", 14754], ["2026-11-01", 17522], ["2026-11-02", 13834], ["2026-11-04", 8452], ["2026-11-05", 8089]],
    "markPoint": {"symbol": "circle", "symbolSize": 7, "label": {"color": "var(--ink)", "fontSize": 11}, "data": [
      {"coord": ["2026-11-01", 17522], "label": {"position": "left", "formatter": "17,522"}},
      {"coord": ["2026-11-05", 8089], "label": {"position": "left", "formatter": "8,089"}}
    ]}
  }]
}
```

By November 1, bogged down by homegrown schedulers, compaction-retry state machines, and sprawling prompt-assembly glue, our codebase had ballooned to 17,522 lines. Over the next four days, following a thorough philosophical reckoning, we took a scalpel to the repo and cut it straight down to **8,089 lines**.

The codebase shrank by more than half, yet production capability didn't contract—in fact, it unlocked one-command installation, native vision understanding, automatic crash recovery, and the full-featured container sandbox.

How? By enforcing one uncompromising rule:
**If it does not belong to "Telegram group chat semantics," not a single line of it should be written by us.**

Look back at four of our worst production incidents:

```sketch title="Four Production Incidents" note="Dates are in 2026. The top half of each card shows the symptom group members saw; the bottom half shows the root cause we uncovered."
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
<g class="node plain"><rect x="24" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="36" y="98">09-16</text><text class="b" x="36" y="122">Compacting every turn,</text><text class="b" x="36" y="139">context never shrinks</text><text class="caps" x="36" y="166">ROOT CAUSE</text><text class="small" x="36" y="184">Char-based token count</text><text class="small" x="36" y="200">counted images as 0</text><g class="node clay"><rect x="76" y="88" width="84" height="20" rx="10"/><text class="mid small" x="118" y="98">DIY Compactor</text></g>
<circle cx="164.8" cy="40" r="5" fill="var(--clay)"/>
<path class="edge " d="M164.8 46 V60 H267 V76"/>
<g class="node plain"><rect x="194" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="206" y="98">09-16</text><text class="b" x="206" y="122">After 429, @mentions</text><text class="b" x="206" y="139">marked as completed</text><text class="caps" x="206" y="166">ROOT CAUSE</text><text class="small" x="206" y="184">State machine exited</text><text class="small" x="206" y="200">turn when retries died</text><g class="node clay"><rect x="250" y="88" width="76" height="20" rx="10"/><text class="mid small" x="288" y="98">DIY Retries</text></g>
<circle cx="539.2" cy="40" r="5" fill="var(--clay)"/>
<path class="edge " d="M539.2 46 V60 H437 V76"/>
<g class="node plain"><rect x="364" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="376" y="98">10-04</text><text class="b" x="376" y="122">20 min dead silence,</text><text class="b" x="376" y="139">completely unresponsive</text><text class="caps" x="376" y="166">ROOT CAUSE</text><text class="small" x="376" y="184">Image token spike blew</text><text class="small" x="376" y="200">budget; pre-check locked</text><g class="node clay"><rect x="418" y="88" width="84" height="20" rx="10"/><text class="mid small" x="460" y="98">DIY Pre-check</text></g>
<circle cx="580.8" cy="40" r="5" fill="var(--clay)"/>
<path class="edge " d="M580.8 46 V60 H607 V76"/>
<g class="node plain"><rect x="534" y="80" width="146" height="150" rx="6"/></g><text class="mono accent" x="546" y="98">10-06</text><text class="b" x="546" y="122">Accused group members</text><text class="b" x="546" y="139">of stealing backend data</text><text class="caps" x="546" y="166">ROOT CAUSE</text><text class="small" x="546" y="184">Dynamic list in chat body</text><text class="small" x="546" y="200">baked into summary fact</text><g class="node clay"><rect x="586" y="88" width="84" height="20" rx="10"/><text class="mid small" x="628" y="98">DIY Summary</text></g>
</svg>
<svg viewBox="0 0 340 672">
<rect class="panel" x="0" y="0" width="340" height="672" rx="12"/>
<path class="edge" d="M24 20 V648"/>
<circle cx="24" cy="38" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="20" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="38">09-16</text><text class="b" x="56" y="62">Compacting almost every turn,</text><text class="b" x="56" y="79">yet context never shrinks</text><text class="caps" x="56" y="106">ROOT CAUSE</text><text class="small" x="56" y="124">Char-based token estimator</text><text class="small" x="56" y="140">counted images as 0</text><g class="node clay"><rect x="100" y="28" width="90" height="20" rx="10"/><text class="mid small" x="145" y="38">DIY Compactor</text></g>
<circle cx="24" cy="200" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="182" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="200">09-16</text><text class="b" x="56" y="224">After 429, @mentioned messages</text><text class="b" x="56" y="241">were falsely marked completed</text><text class="caps" x="56" y="268">ROOT CAUSE</text><text class="small" x="56" y="286">When retries ran out, the state</text><text class="small" x="56" y="302">machine exited the turn early</text><g class="node clay"><rect x="100" y="190" width="80" height="20" rx="10"/><text class="mid small" x="140" y="200">DIY Retries</text></g>
<circle cx="24" cy="362" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="344" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="362">10-04</text><text class="b" x="56" y="386">20 minutes of dead silence,</text><text class="b" x="56" y="403">completely unresponsive</text><text class="caps" x="56" y="430">ROOT CAUSE</text><text class="small" x="56" y="448">Image token spike blew budget;</text><text class="small" x="56" y="464">pre-flight compaction deadlocked</text><g class="node clay"><rect x="100" y="352" width="90" height="20" rx="10"/><text class="mid small" x="145" y="362">DIY Pre-check</text></g>
<circle cx="24" cy="524" r="5" fill="var(--clay)"/>
<g class="node plain"><rect x="44" y="506" width="280" height="150" rx="6"/></g><text class="mono accent" x="56" y="524">10-06</text><text class="b" x="56" y="548">Accused group members of</text><text class="b" x="56" y="565">stealing its backend data</text><text class="caps" x="56" y="592">ROOT CAUSE</text><text class="small" x="56" y="610">Dynamic list spliced into body;</text><text class="small" x="56" y="626">summary baked guess into fact</text><g class="node clay"><rect x="100" y="514" width="90" height="20" rx="10"/><text class="mid small" x="145" y="524">DIY Summary</text></g>
</svg>
```

**Not a single one of these four hair-raising incidents had anything to do with Telegram itself. Every one of them came from our own homegrown session state machines and compaction algorithms.**

True engineering maturity means handing specialized infrastructure back to a solid foundation. Pi 1.5 provides first-class durable primitives out of the box: persistent sessions, crash recovery, AST-aware structured compaction, execution queues, and sandbox orchestration. In a single migration commit, we deleted 7,877 lines of homegrown code:

- Deleted our painstakingly maintained session state machine and complex fingerprint diffing;
- Deleted our brittle character-based token estimator and custom summary-packing logic;
- Deleted our homegrown background child-process bridge and scheduling pipeline;
- Deleted 300 lines of verbose tool usage examples stuffed inside the system prompt (relying directly on Pi's strict TypeBox parameter schemas).

The remaining ~8,000 lines of pure code focus on doing one thing well: **mapping the Telegram group chat ecosystem into rigorous, elegant agent interactions**.

- It handles message archiving and Trigram / semantic retrieval;
- It handles prefix-invariant batch grammar serialization;
- It handles the small classifier model's chime-in decisions;
- It builds the security moat around the rootless Linux container.

```sketch title="What We Deleted Went to Pi; What Remains Is Pure Group Chat Semantics" note="The four blocks of homegrown code deleted in the migration commit and the Pi 1.5 capabilities that replaced them; the remaining ~8,000 lines do only the four jobs on the right."
<svg viewBox="0 0 704 300">
<rect class="panel" x="0" y="0" width="452" height="300" rx="12"/>
<text class="caps" x="24" y="28">DELETED 7,877 LINES → HANDED TO PI 1.5</text>
<rect class="panel" x="468" y="0" width="236" height="300" rx="12"/>
<text class="caps" x="488" y="28">REMAINING ~8,000 LINES</text>
<rect class="window" x="24" y="48" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="68">Session state &amp; fingerprinting</text>
<path class="edge " d="M214 68 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="48" width="188" height="40" rx="4"/><text class="mid small" x="334" y="68">Persistent sessions &amp; recovery</text></g>
<rect class="window" x="24" y="108" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="128">Token estimator &amp; summarizer</text>
<path class="edge " d="M214 128 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="108" width="188" height="40" rx="4"/><text class="mid small" x="334" y="128">AST-based compaction</text></g>
<rect class="window" x="24" y="168" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="188">Child-process bridge &amp; queue</text>
<path class="edge " d="M214 188 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="168" width="188" height="40" rx="4"/><text class="mid small" x="334" y="188">Execution queue &amp; sandbox</text></g>
<rect class="window" x="24" y="228" width="188" height="40" rx="4"/>
<text class="small mid" x="118" y="248">300 lines of prompt tool docs</text>
<path class="edge " d="M214 248 H236" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="240" y="228" width="188" height="40" rx="4"/><text class="mid small" x="334" y="248">TypeBox parameter schemas</text></g>
<g class="node teal"><rect x="488" y="48" width="196" height="40" rx="4"/><text class="mid small" x="586" y="68">Archive &amp; Trigram retrieval</text></g>
<g class="node teal"><rect x="488" y="108" width="196" height="40" rx="4"/><text class="mid small" x="586" y="128">Prefix-invariant serialization</text></g>
<g class="node teal"><rect x="488" y="168" width="196" height="40" rx="4"/><text class="mid small" x="586" y="188">Small classifier chime-in gate</text></g>
<g class="node teal"><rect x="488" y="228" width="196" height="40" rx="4"/><text class="mid small" x="586" y="248">Rootless container boundary</text></g>
<text class="small mid accent" x="226" y="286">Nothing outside "Telegram group chat semantics" is homegrown</text>
</svg>
<svg viewBox="0 0 340 564">
<rect class="panel" x="0" y="0" width="340" height="316" rx="12"/>
<text class="caps" x="16" y="26">DELETED 7,877 LINES → PI 1.5</text>
<rect class="window" x="16" y="42" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="55">Session state &amp; fingerprinting</text>
<path class="edge " d="M170 69 V74"/>
<g class="node blue"><rect x="16" y="76" width="308" height="26" rx="4"/><text class="mid small" x="170" y="89">→ Persistent sessions &amp; recovery</text></g>
<rect class="window" x="16" y="108" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="121">Token estimator &amp; summarizer</text>
<path class="edge " d="M170 135 V140"/>
<g class="node blue"><rect x="16" y="142" width="308" height="26" rx="4"/><text class="mid small" x="170" y="155">→ AST-based compaction</text></g>
<rect class="window" x="16" y="174" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="187">Child-process bridge &amp; queue</text>
<path class="edge " d="M170 201 V206"/>
<g class="node blue"><rect x="16" y="208" width="308" height="26" rx="4"/><text class="mid small" x="170" y="221">→ Execution queue &amp; sandbox</text></g>
<rect class="window" x="16" y="240" width="308" height="26" rx="4"/>
<text class="small mid" x="170" y="253">300 lines of prompt tool docs</text>
<path class="edge " d="M170 267 V272"/>
<g class="node blue"><rect x="16" y="274" width="308" height="26" rx="4"/><text class="mid small" x="170" y="287">→ TypeBox parameter schemas</text></g>
<rect class="panel" x="0" y="332" width="340" height="232" rx="12"/>
<text class="caps" x="16" y="358">REMAINING ~8,000 LINES: GROUP SEMANTICS</text>
<g class="node teal"><rect x="16" y="374" width="308" height="34" rx="4"/><text class="mid small" x="170" y="391">Message archive &amp; Trigram retrieval</text></g>
<g class="node teal"><rect x="16" y="418" width="308" height="34" rx="4"/><text class="mid small" x="170" y="435">Prefix-invariant batch serialization</text></g>
<g class="node teal"><rect x="16" y="462" width="308" height="34" rx="4"/><text class="mid small" x="170" y="479">Small classifier chime-in decisions</text></g>
<g class="node teal"><rect x="16" y="506" width="308" height="34" rx="4"/><text class="mid small" x="170" y="523">Rootless container security boundary</text></g>
</svg>
```

In software engineering, the purest joy is never typing out tens of thousands of lines of framework code—it is **making the system stronger while deleting thousands of lines of bloated self-indulgence in a single stroke**. That joy of "negative code" is the truest expression of minimalist aesthetics.

---

## Two Visions of Generality: Specialized Deployment vs. General Agent

In our group, members often teasingly compare my bot with tcdw's [Surowan](https://github.com/tuuject/surowan): *"If you talk about general agents all day, why does your bot single-mindedly serve only our one group?"*

Let's set surface appearances aside and lay the skeletons of both systems side by side:

| Dimension | Pi Telegram Agent (This Project) | Surowan (`tuuject/surowan`) |
| :--- | :--- | :--- |
| **Target Audience** | Deeply tailored for our own trusted circle | Built for any external user to self-host (BYOK) |
| **Scope** | High-frequency emergence inside a single Supergroup | Multi-group, multi-channel |
| **Persona Model** | One deployment = one focused digital persona | Single deployment switches personas and model matrices per chat |
| **Chime-In Decision** | Deterministic on @mention; ambient chatter judged by a **dedicated small classifier reading a slice** | Bucket-aggregated and judged by the **primary model** over full context, gated by time/probability |
| **Forgetting Mechanism** | Pi's native structured compaction (128K window) | **Pure checkpoint sliding truncation (drop without summarizing)** |
| **Memory System** | **Zero memory layers**; relies entirely on SQLite verbatim dialogue retrieval | Three-tier memory hierarchy (Memo Pad + periodic summaries + curated knowledge base) |
| **Tool Exposure** | Fixed catalog declared upfront in full, riding the prompt cache | Core primitives exposed; internal skills discovered dynamically via `execute` |
| **Execution Power** | **Full rootless Linux container, Shell, and JS sandbox** | Shell and arbitrary code execution strictly forbidden for multi-tenant safety |
| **Codebase Size** | ~8,100 lines in `src/`; general execution delegated to Pi | ~60,000 lines in `src/`; custom dashboard, scheduler, and multi-channel runtime |

Spread this comparison table open and you see two diametrically opposed yet internally consistent design philosophies:

**Surowan is a "general product with a restrained agent."**
Because it was designed from day one to be deployed by strangers across unpredictable public groups, it *must* restrain the agent's hands and feet (strictly forbidding Shell execution) to manage risk—investing massive engineering effort into outer defenses, multi-group routing, admin dashboards, and permission auditing.

**We chose a "specialized deployment with a general agent."**
Precisely because we rejected the temptation to support hundreds of arbitrary groups and bounded our deployment to a single group ecosystem we trust, we compressed outer product complexity down to almost zero. Every bit of architectural budget and trust capital we saved on the outside was poured unreservedly into the agent's core—**daring to hand it a complete Linux machine, daring to let it orchestrate Shell commands, and daring to let it write concurrent code on the fly.**

```sketch title="Where the Complexity Lives" note="Neither project is simple; they just place their complexity in opposite places: Surowan puts it in outer product capabilities, while this project puts it inside the agent kernel. Drawn from the comparison table above."
<svg viewBox="0 0 704 360">
<rect class="panel" x="0" y="0" width="342" height="360" rx="12"/>
<text class="b" x="20" y="28">Surowan: General Product, Restrained Agent</text>
<rect class="window" x="20" y="48" width="302" height="270" rx="10"/>
<text class="small" x="34" y="66">Outer layer: built for strangers across many groups</text>
<g class="node "><rect x="34" y="78" width="274" height="30" rx="4"/><text class="mid small" x="171" y="93">DMs, channels &amp; forum topics</text></g>
<g class="node "><rect x="34" y="116" width="274" height="30" rx="4"/><text class="mid small" x="171" y="131">Fine-grained allowlists &amp; permission audits</text></g>
<g class="node "><rect x="34" y="154" width="274" height="30" rx="4"/><text class="mid small" x="171" y="169">Admin dashboard &amp; scheduler</text></g>
<g class="node "><rect x="34" y="192" width="274" height="30" rx="4"/><text class="mid small" x="171" y="207">Per-chat persona &amp; model switching</text></g>
<g class="node "><rect x="34" y="230" width="274" height="30" rx="4"/><text class="mid small" x="171" y="245">3-tier memory: Memo Pad · Summaries · KB</text></g>
<g class="node teal"><rect x="34" y="274" width="274" height="34" rx="4"/><text class="mid small" x="171" y="291">Agent kernel: core primitives, no Shell</text></g>
<text class="small mid" x="171" y="340">src/ ~60,000 lines</text>
<rect class="panel" x="362" y="0" width="342" height="360" rx="12"/>
<text class="b" x="382" y="28">This Project: Specialized Deploy, General Agent</text>
<rect class="window" x="382" y="48" width="302" height="270" rx="10"/>
<text class="small" x="396" y="66">Outer layer: one trusted group</text>
<g class="node teal"><rect x="396" y="80" width="274" height="224" rx="8"/></g>
<text class="b" x="410" y="102">Agent Kernel</text>
<g class="node plain"><rect x="410" y="118" width="246" height="34" rx="4"/><text class="mid small" x="533" y="135">Complete rootless Linux container</text></g>
<g class="node plain"><rect x="410" y="162" width="246" height="34" rx="4"/><text class="mid small" x="533" y="179">Shell, file tools &amp; codemode concurrency</text></g>
<g class="node plain"><rect x="410" y="206" width="246" height="34" rx="4"/><text class="mid small" x="533" y="223">Small classifier decides chime-in on slices</text></g>
<g class="node plain"><rect x="410" y="250" width="246" height="34" rx="4"/><text class="mid small" x="533" y="267">Zero memory layer; verbatim retrieval</text></g>
<text class="small mid" x="533" y="340">src/ ~8,100 lines</text>
</svg>
<svg viewBox="0 0 340 736">
<rect class="panel" x="0" y="0" width="340" height="360" rx="12"/>
<text class="b" x="20" y="28">Surowan: General Product, Restrained Agent</text>
<rect class="window" x="20" y="48" width="300" height="270" rx="10"/>
<text class="small" x="34" y="66">Outer layer: for strangers across many groups</text>
<g class="node "><rect x="34" y="78" width="272" height="30" rx="4"/><text class="mid small" x="170" y="93">DMs, channels &amp; forum topics</text></g>
<g class="node "><rect x="34" y="116" width="272" height="30" rx="4"/><text class="mid small" x="170" y="131">Fine-grained allowlists &amp; permission audits</text></g>
<g class="node "><rect x="34" y="154" width="272" height="30" rx="4"/><text class="mid small" x="170" y="169">Admin dashboard &amp; scheduler</text></g>
<g class="node "><rect x="34" y="192" width="272" height="30" rx="4"/><text class="mid small" x="170" y="207">Per-chat persona &amp; model switching</text></g>
<g class="node "><rect x="34" y="230" width="272" height="30" rx="4"/><text class="mid small" x="170" y="245">3-tier memory: Memo Pad · Summaries · KB</text></g>
<g class="node teal"><rect x="34" y="274" width="272" height="34" rx="4"/><text class="mid small" x="170" y="291">Agent kernel: core primitives, no Shell</text></g>
<text class="small mid" x="170" y="340">src/ ~60,000 lines</text>
<rect class="panel" x="0" y="376" width="340" height="360" rx="12"/>
<text class="b" x="20" y="404">This Project: Specialized Deploy, General Agent</text>
<rect class="window" x="20" y="424" width="300" height="270" rx="10"/>
<text class="small" x="34" y="442">Outer layer: one trusted group</text>
<g class="node teal"><rect x="34" y="456" width="272" height="224" rx="8"/></g>
<text class="b" x="48" y="478">Agent Kernel</text>
<g class="node plain"><rect x="48" y="494" width="244" height="34" rx="4"/><text class="mid small" x="170" y="511">Complete rootless Linux container</text></g>
<g class="node plain"><rect x="48" y="538" width="244" height="34" rx="4"/><text class="mid small" x="170" y="555">Shell, file tools &amp; codemode concurrency</text></g>
<g class="node plain"><rect x="48" y="582" width="244" height="34" rx="4"/><text class="mid small" x="170" y="599">Small classifier decides chime-in on slices</text></g>
<g class="node plain"><rect x="48" y="626" width="244" height="34" rx="4"/><text class="mid small" x="170" y="643">Zero memory layer; verbatim retrieval</text></g>
<text class="small mid" x="170" y="716">src/ ~8,100 lines</text>
</svg>
```

On specific architectural trade-offs, we remain convinced of our choices:

- **Who decides when to speak: Slice classifier vs. full-context primary model.** Even with Surowan's sophisticated gates, the final mile still wakes the primary model to scan the full context. By decoupling perception from reasoning via a tiny classifier model, our primary model's cache never flinches no matter how noisy the chat gets.
- **Tool definitions: Full upfront declaration vs. dynamic discovery.** Many frameworks love tucking tools into secondary directories so the model searches before calling, hoping to save tokens. Yet our telemetry proves tool schemas occupy just 1.1% of the payload and sit inside the immutable cached prefix; forcing the model to make an extra full-context round-trip just to save a few hundred cached tokens is a textbook case of *"penny-wise on the cheapest prefix, pound-foolish on the most expensive inference."*
- **Memory philosophy: Zero mechanism vs. intricate curation.** Surowan's three-tier memory design is an impressive piece of engineering, but frontier research and our own production scars sound the same warning bell: processed memory inherently carries a self-poisoning risk. One less layer of mechanism is one less class of self-replicating error.

---

## Why Specialization for a Group Chat Is the True Starting Point of Generality

Someone might ask: if you welded every design decision to a single Telegram group chat, isn't that just narrow specialization?

**No—the harsher the environment, the more universal the principles distilled from surviving it.**

The most common tragedy in software engineering is building a so-called "general framework" in a vacuum. When you lack a concrete, unforgiving real-world scenario as your anchor, your architecture inevitably fills up with fantasies: adding another middleware layer feels cool, adding a memory-extraction pipeline feels thorough, and having the model repeat a confirmation turn after every tool call feels rigorous.

Until you throw it into a real, unforgiving Telegram group chat:
Online 24/7, hundreds of people firing off jokes and tangents every second, context refreshing by the second, the vast majority of messages pure noise, input outnumbering output by 374 to 1... In an environment that brutal, the slightest bit of architectural bloat or hubris gets amplified dozens of times over by the leverage of 144,000 messages—turning into astronomical cloud bills, lag, and spam in front of your users.

**A design philosophy that can survive the most hostile group chat is indestructible when transplanted into any agent system:**

```sketch title="Four Rulers of Restraint" note="The four dimensions of frugality, what each one governs, and the design principles they share."
<svg viewBox="0 0 704 296">
<rect class="panel" x="0" y="0" width="704" height="296" rx="12"/>
<g class="node orange"><rect x="24" y="24" width="320" height="118" rx="6"/><text class="b" x="38" y="46">Call Volume N</text></g><text class="small end" x="330" y="46">External Models</text><text class="small" x="38" y="74">Leave deterministic routing to code</text><text class="small" x="38" y="95">Delegate social tact to a slice classifier</text><text class="small" x="38" y="116">Terminate the turn locally right after send</text>
<g class="node blue"><rect x="360" y="24" width="320" height="118" rx="6"/><text class="b" x="374" y="46">Cache Hit Rate h</text></g><text class="small end" x="666" y="46">Request Prefix</text><text class="small" x="374" y="74">Prefix immutability is an iron law</text><text class="small" x="374" y="95">Append dynamic info as incremental notes</text><text class="small" x="374" y="116">Guard every byte with Golden Hash tests</text>
<g class="node violet"><rect x="24" y="160" width="320" height="118" rx="6"/><text class="b" x="38" y="182">Context Depth T</text></g><text class="small end" x="330" y="182">Runtime Context</text><text class="small" x="38" y="210">Optimize for your actual linear API bill</text><text class="small" x="38" y="231">Refuse lossy memory processing pipelines</text><text class="small" x="38" y="252">Keep verbatim words; query on demand</text>
<g class="node teal"><rect x="360" y="160" width="320" height="118" rx="6"/><text class="b" x="374" y="182">Negative Code</text></g><text class="small end" x="666" y="182">Coding Agent</text><text class="small" x="374" y="210">Never reinvent wheels outside domain semantics</text><text class="small" x="374" y="231">One general Shell &amp; Linux container</text><text class="small" x="374" y="252">beats a hundred fragile plugins</text>
</svg>
<svg viewBox="0 0 340 540">
<rect class="panel" x="0" y="0" width="340" height="540" rx="12"/>
<g class="node orange"><rect x="16" y="16" width="308" height="118" rx="6"/><text class="b" x="30" y="38">Call Volume N</text></g><text class="small end" x="310" y="38">External Models</text><text class="small" x="30" y="66">Leave deterministic routing to code</text><text class="small" x="30" y="87">Delegate social tact to a slice classifier</text><text class="small" x="30" y="108">Terminate the turn locally right after send</text>
<g class="node blue"><rect x="16" y="146" width="308" height="118" rx="6"/><text class="b" x="30" y="168">Cache Hit Rate h</text></g><text class="small end" x="310" y="168">Request Prefix</text><text class="small" x="30" y="196">Prefix immutability is an iron law</text><text class="small" x="30" y="217">Append dynamic info as incremental notes</text><text class="small" x="30" y="238">Guard every byte with Golden Hash tests</text>
<g class="node violet"><rect x="16" y="276" width="308" height="118" rx="6"/><text class="b" x="30" y="298">Context Depth T</text></g><text class="small end" x="310" y="298">Runtime Context</text><text class="small" x="30" y="326">Optimize for your actual linear API bill</text><text class="small" x="30" y="347">Refuse lossy memory processing pipelines</text><text class="small" x="30" y="368">Keep verbatim words; query on demand</text>
<g class="node teal"><rect x="16" y="406" width="308" height="118" rx="6"/><text class="b" x="30" y="428">Negative Code</text></g><text class="small end" x="310" y="428">Coding Agent</text><text class="small" x="30" y="456">Never reinvent wheels outside domain logic</text><text class="small" x="30" y="477">One general Shell &amp; Linux container</text><text class="small" x="30" y="498">beats a hundred fragile plugins</text>
</svg>
```

In the world of LLMs, every engineering law ultimately converges on a single aesthetic truth:
**Tokens are the only currency.**

Saving money, saving context, and saving lines of code are not three separate virtues—they are projections of the exact same fundamental law across the physical billing ledger, runtime memory, and software architecture.

We never sacrificed user experience. On the contrary, precisely because we refused to budge an inch on unnecessary model calls and fought over every byte of prefix stability, we earned the headroom to give our bot a millisecond-responsive `codemode` and a full Linux workspace where it can roam freely—living in our group chat as a genuinely sharp, tactful companion.

The next time you are tempted to add a new mechanism or write a new feature, hold this ruler up and ask yourself four questions:

1. **Does this step actually require a model, or can a single line of deterministic code settle it? And if it truly needs a model, does it really need to wake the primary model with all 90,000 tokens of baggage?**
2. **Will this action mutate the golden prefix? Is dynamic information staying obediently on the append-only tail where it belongs?**
3. **Does this batch of data deserve to be re-read by the model on every single turn, or should it sleep in the database until someone actually asks for it?**
4. **If I delete this code right now, will the system really collapse—or has the underlying platform already solved this more cleanly than I ever could?**

If the answer wavers, take your hands off the keyboard.

**Save a little, then save a little more.**
Because only where restraint reaches its limit does true freedom appear.
