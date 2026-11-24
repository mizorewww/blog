---
title: "Glance: Eight Questions in One Forward Pass—and the Nerve to Say “Not There”"
description: "Answering a batch of questions on an image in a single forward pass, with a probability on every answer—including “not present.” Plus three surprises along the way: refusal is chosen by the decoder, trustworthy “not present” comes from data, and video agents lose at seeing."
date: 2026-11-18
tag: "Tech"
tags:
  - "LLM"
  - "Vision"
  - "Grounding"
  - "Agent"
draft: false
---

```widget src="../../widgets/glance/hero.js" title="One image, eight questions, one forward pass" note="Real precomputed outputs from Glance-4B-preview; the page only filters them."
../../images/glance/w-hero-en.png | Static image: Dinner under an umbrella. Glance boxes the rainbow umbrella and the woman standing on the left; “ketchup” is present (0.976), but the probability of an accurate box is only 0.386, marked “inaccurate box”; “a dog” and “birthday cake” are answered “not present” (0.001, 0.002); “is it raining” is 0.155; “where are they eating” picks garden (0.991)
../../images/glance/w-hero-en-n.png | Same as above, mobile version
```

When an agent looks at a screen or a video, it never asks just one question—it asks a batch: Is the save dialog open? Where is the “Export” button? Is clicking “Delete All” dangerous? Is that butterfly in this clip? More importantly, **when something isn't there, the model needs the nerve to say it isn't there, and how sure it is about “not present” has to be trustworthy.**

Glance is a “single-glance” model we trained on Qwen3.5-4B[@qwen35]. If you know TypeSafe's Jev[@jev], you can think of Glance as a Jev built specifically for looking at images: its bounding boxes can say “not present,” and they can also say whether the box itself is accurate. It generates no text. It reads the image once and outputs a probability distribution for arbitrarily many questions: where the box is, yes or no, which option to pick, what score to give, and “it's not here.” Every number above is its real output. Two thresholds govern box queries: if P(present) falls below the first, it answers “not present”; if P(IoU ≥ 0.5) falls below the second, the box is flagged as “inaccurate.” Hover over the questions and drag the thresholds—several details are worth a closer look:

- “A dog” and “birthday cake” didn't just fail to produce a box; the model answered “not present” and gave a probability. Chinese and English queries land on the exact same box.
- “Ketchup” is present (0.976), yet the probability that the box is accurate is only 0.386: it knows there is ketchup on the table, but isn't sure which spot it is. Whether something is present and whether the box is accurate are two separate dials.
- For “how dangerous is clicking ‘Delete All’,” all four levels have nearly equal probability—that's the model saying “I don't know.” What a distribution gives you beyond a single answer is precisely this.
- On the animation tab, “a flying squirrel” (0.661) and “a bird” (0.347) both point to the red squirrel mid-air in the upper left: as you drag the threshold, uncertain answers appear first and vanish first.

## What Problem It Solves, and What's New

Today's agents use a generative vision-language model as their eyes. Those eyes have three flaws, each of which turns directly into agent accidents:

- **One question at a time.** Asking 8 things about the same screen means decoding 8 times, leaving the agent waiting at every step.
- **Unreliable “not there.”** When a target isn't present, the model often draws a box anyway, and the agent clicks a button that doesn't exist. On GUI queries where the target is not on the screen, the same base model with standard prompting almost never refuses (under 4%), and across every prompt we tried it tops out just over 40%.
- **The dials are locked.** Whether it says “not present” is decided for it by the decoding rule, leaving the user no way to tune it per scenario; nor does it know whether its own box is accurate.

```sketch title="Asking the same three questions: generative decodes one by one, Glance reads once" note="Schematic; P values are illustrative."
<svg viewBox="0 0 704 330">
<rect class="panel" x="0" y="0" width="344" height="330" rx="12"/>
<rect class="panel" x="360" y="0" width="344" height="330" rx="12"/>
<text class="caps" x="24" y="28">Generative VLM</text>
<g class="node clay"><rect x="82" y="48" width="180" height="30" rx="15"/><text class="mid" x="172" y="63">1 image + 3 queries</text></g>
<path class="edge" d="M172.0 78 V96" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="62" y="98" width="220" height="30" rx="4"/><text class="mid" x="172" y="113">prefill, then decode each</text></g>
<path class="edge" d="M172 128 V136 H198 V142" marker-end="url(#arrow)"/>
<text class="small" x="24" y="160">Query 1</text>
<g class="node plain"><rect x="76" y="146" width="244" height="28" rx="4"/><text class="mid mono" x="198" y="160">4 1 2 , 0 8 8 , 6 0 1 …</text></g>
<path class="edge" d="M198 174 V186" marker-end="url(#arrow)"/>
<text class="small" x="24" y="204">Query 2</text>
<g class="node plain"><rect x="76" y="190" width="244" height="28" rx="4"/><text class="mid mono" x="198" y="204">3 0 , 1 9 2 , 7 7 …</text></g>
<path class="edge" d="M198 218 V230" marker-end="url(#arrow)"/>
<text class="small" x="24" y="248">Query 3</text>
<g class="node plain"><rect x="76" y="234" width="244" height="28" rx="4"/><text class="mid mono" x="198" y="248">n o n e</text></g>
<text class="small" x="24" y="288">Decode 5–20 steps per query, then parse</text>
<text class="small accent" x="24" y="308"><tspan class="mono">none</tspan> competes with thousands of box strings</text>
<text class="caps" x="384" y="28">Glance</text>
<g class="node clay"><rect x="442" y="48" width="180" height="30" rx="15"/><text class="mid" x="532" y="63">1 image + 3 queries</text></g>
<path class="edge" d="M532.0 78 V96" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="422" y="98" width="220" height="30" rx="4"/><text class="mid" x="532" y="113">prefill: image computed once</text></g>
<path class="edge" d="M532.0 128 V138 H430.6666666666667 V148" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="384" y="150" width="93.3333" height="30" rx="4"/><text class="mid" x="430.667" y="165">Query 1</text></g>
<path class="edge" d="M430.6666666666667 180 V206" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="384" y="210" width="93.3333" height="30" rx="4"/><text class="mid" x="430.667" y="225">Absent 0.998</text></g>
<path class="edge" d="M532.0 128 V138 H532.0 V148" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="485.333" y="150" width="93.3333" height="30" rx="4"/><text class="mid" x="532" y="165">Query 2</text></g>
<path class="edge" d="M532.0 180 V206" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="485.333" y="210" width="93.3333" height="30" rx="4"/><text class="mid" x="532" y="225">IoU 0.91</text></g>
<path class="edge" d="M532.0 128 V138 H633.3333333333333 V148" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="586.667" y="150" width="93.3333" height="30" rx="4"/><text class="mid" x="633.333" y="165">Query 3</text></g>
<path class="edge" d="M633.3333333333333 180 V206" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="586.667" y="210" width="93.3333" height="30" rx="4"/><text class="mid" x="633.333" y="225">Pick A 0.99</text></g>
<text class="small" x="384" y="266">Each query branches from prefix state in isolation</text>
<text class="small" x="384" y="288">0 decoding steps; every answer is a distribution</text>
<text class="small accent" x="384" y="308">P(absent) is a single number; you set the threshold</text>
</svg>
<svg viewBox="0 0 340 670">
<rect class="panel" x="0" y="0" width="340" height="330" rx="12"/>
<rect class="panel" x="0" y="340" width="340" height="330" rx="12"/>
<text class="caps" x="24" y="28">Generative VLM</text>
<g class="node clay"><rect x="80" y="48" width="180" height="30" rx="15"/><text class="mid" x="170" y="63">1 image + 3 queries</text></g>
<path class="edge" d="M170.0 78 V96" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="60" y="98" width="220" height="30" rx="4"/><text class="mid" x="170" y="113">prefill, then decode each</text></g>
<path class="edge" d="M170 128 V136 H196 V142" marker-end="url(#arrow)"/>
<text class="small" x="24" y="160">Query 1</text>
<g class="node plain"><rect x="76" y="146" width="240" height="28" rx="4"/><text class="mid mono" x="196" y="160">4 1 2 , 0 8 8 , 6 0 1 …</text></g>
<path class="edge" d="M196 174 V186" marker-end="url(#arrow)"/>
<text class="small" x="24" y="204">Query 2</text>
<g class="node plain"><rect x="76" y="190" width="240" height="28" rx="4"/><text class="mid mono" x="196" y="204">3 0 , 1 9 2 , 7 7 …</text></g>
<path class="edge" d="M196 218 V230" marker-end="url(#arrow)"/>
<text class="small" x="24" y="248">Query 3</text>
<g class="node plain"><rect x="76" y="234" width="240" height="28" rx="4"/><text class="mid mono" x="196" y="248">n o n e</text></g>
<text class="small" x="24" y="288">Decode 5–20 steps per query, then parse</text>
<text class="small accent" x="24" y="308"><tspan class="mono">none</tspan> competes with thousands of box strings</text>
<text class="caps" x="24" y="368">Glance</text>
<g class="node clay"><rect x="80" y="388" width="180" height="30" rx="15"/><text class="mid" x="170" y="403">1 image + 3 queries</text></g>
<path class="edge" d="M170.0 418 V436" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="60" y="438" width="220" height="30" rx="4"/><text class="mid" x="170" y="453">prefill: image computed once</text></g>
<path class="edge" d="M170.0 468 V478 H70.0 V488" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="24" y="490" width="92" height="30" rx="4"/><text class="mid" x="70" y="505">Query 1</text></g>
<path class="edge" d="M70.0 520 V546" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="24" y="550" width="92" height="30" rx="4"/><text class="mid" x="70" y="565">Absent 0.998</text></g>
<path class="edge" d="M170.0 468 V478 H170.0 V488" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="124" y="490" width="92" height="30" rx="4"/><text class="mid" x="170" y="505">Query 2</text></g>
<path class="edge" d="M170.0 520 V546" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="124" y="550" width="92" height="30" rx="4"/><text class="mid" x="170" y="565">IoU 0.91</text></g>
<path class="edge" d="M170.0 468 V478 H270.0 V488" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="224" y="490" width="92" height="30" rx="4"/><text class="mid" x="270" y="505">Query 3</text></g>
<path class="edge" d="M270.0 520 V546" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="224" y="550" width="92" height="30" rx="4"/><text class="mid" x="270" y="565">Pick A 0.99</text></g>
<text class="small" x="24" y="606">Each query branches from prefix state in isolation</text>
<text class="small" x="24" y="628">0 decoding steps; every answer is a distribution</text>
<text class="small accent" x="24" y="648">P(absent) is a single number; you set the threshold</text>
</svg>
```

Glance answers these three flaws with three things:

1. **One forward pass to answer arbitrarily many typed questions.** The image is computed once; each question branches off the image state for its own readout, and the answer is directly a probability distribution. On hybrid linear-attention / full-attention models like Qwen3.5, standard attention-mask tricks let questions quietly leak into one another; our forward pass is mathematically equivalent to running each question alone. Asking 8 box questions on one image takes 45 ms, versus 134 ms for the strongest generative setup we could configure.
2. **Turning “is it there?” and “is the box accurate?” into two calibrated dials.** For telling right boxes from wrong ones, Glance reaches an AUROC of 91.6, while generative approaches top out at 79.7. Pairing the two probabilities with a cost-based threshold rule lets you tune behavior at deployment time without retraining.
3. **A reusable finding: whether a generative model boxes nonexistent objects is a setting, not a property of the model.** Across four off-the-shelf VLMs, simply changing the prompt, coordinate format, and decoder shifts the rate of boxing absent targets from 17% to 92%—and by 50–60 percentage points within a single Qwen model. Controlled experiments show why: “not present” has only one spelling, whereas “present” has thousands, and who wins depends on how votes are tallied. In Glance, “not present” is a probability that can be dialed continuously and doesn't care how the prompt is phrased.

Along the way we also ran into two other surprises: what makes “not present” trustworthy is data rather than a larger base model (and our own data accidentally taught the model a shortcut); and when video agents get an answer wrong, it's usually because they misread what they saw, not because they reasoned poorly.

What this means for agents in practice: a GUI agent gets an extra safety gate before clicking. At an operating point that falsely rejects 20% of present buttons, Glance blocks over 50% of targets that aren't on the screen at all, whereas the same base model across every prompt we tried blocks at most just over 40% (false rejection on GUIs is still higher than we'd like, as we'll discuss below). When an agent asks follow-up questions about a screen it has already looked at, each batch takes just over ten milliseconds; and the same 4B model can switch from cautious to aggressive simply by changing a threshold—setting risk to match the task rather than accepting whichever single operating point the decoder picked for it.

Compared with Jev, the difference lies in bounding boxes. Jev is a System One decision model: given a state and a list of questions, a single query returns the probability of every answer in parallel; starting in 1.14, it also experimentally supports images and a `box` question type[@jev114]. However, its box has no “not present” answer (the docs recommend asking a separate yes/no question alongside it), and carries only a single confidence score. Glance builds both directly into the box head. Later in the post we compare the two head-to-head on the exact same questions.

## One Forward Pass, Arbitrarily Many Questions

An input consists of one image followed by many questions. The image portion is computed once; each question is a short span of tokens appended after it, and the hidden state at the question's final position is read out and routed to the corresponding output head:

- **Box**: a presence gate outputs P(present); a softmax over the image's visual tokens selects the patch containing the box center; each of the four sides is a 64-bin distribution; and an IoU head estimates the probability that the predicted box achieves IoU ≥ 0.5 with the ground truth.
- **Multiple choice, yes/no, graded scoring**: we directly read the logits of the corresponding label tokens (A…Z, Yes/No) from the base language model head, plus a zero-initialized residual correction. At initialization, their outputs are identical to the base model's next-token distribution, and training merely fine-tunes from there.

```sketch title="The box head: a single readout yields the box and two probabilities"
<svg viewBox="0 0 704 330">
  <rect class="panel" x="0" y="0" width="704" height="330" rx="12"/>
  <g class="node clay"><rect x="262" y="24" width="180" height="34" rx="17"/><text class="mid" x="352" y="41">Readout h (box_start)</text></g>
  <g class="node plain"><rect x="32" y="96" width="196" height="34" rx="4"/><text class="mid" x="130" y="113">Presence gate</text></g>
  <g class="node plain"><rect x="254" y="96" width="196" height="34" rx="4"/><text class="mid" x="352" y="113">Center: patch softmax</text></g>
  <g class="node plain"><rect x="254" y="152" width="196" height="34" rx="4"/><text class="mid" x="352" y="169">4 sides: 4 × 64-bin dists</text></g>
  <g class="node plain"><rect x="476" y="152" width="196" height="34" rx="4"/><text class="mid" x="574" y="169">IoU head</text></g>
  <g class="node teal"><rect x="32" y="208" width="196" height="34" rx="4"/><text class="mid" x="130" y="225">P(present)</text></g>
  <g class="node teal"><rect x="254" y="208" width="196" height="34" rx="4"/><text class="mid" x="352" y="225">Box = expected side pos.</text></g>
  <g class="node teal"><rect x="476" y="208" width="196" height="34" rx="4"/><text class="mid" x="574" y="225">P(IoU ≥ 0.5)</text></g>
  <g class="node clay"><rect x="172" y="272" width="360" height="34" rx="17"/><text class="mid" x="352" y="289">Box confidence = P(present) × P(IoU ≥ 0.5)</text></g>
  <path class="edge" d="M352 58 V92" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 76 H130 V92" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 76 H616 V148" marker-end="url(#arrow)"/>
  <path class="edge" d="M130 130 V204" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 130 V148" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 186 V204" marker-end="url(#arrow)"/>
  <path class="edge" d="M574 186 V204" marker-end="url(#arrow)"/>
  <path class="edge dash" d="M450 113 H554 V148" marker-end="url(#arrow)"/>
  <path class="edge" d="M130 242 V289 H168" marker-end="url(#arrow)"/>
  <path class="edge" d="M574 242 V289 H536" marker-end="url(#arrow)"/>
  <text class="small mid" x="502" y="103">Selected patch</text>
</svg>
<svg viewBox="0 0 340 326">
  <rect class="panel" x="0" y="0" width="340" height="326" rx="12"/>
  <g class="node clay"><rect x="80" y="16" width="180" height="30" rx="15"/><text class="mid" x="170" y="31">Readout h</text></g>
  <g class="node plain"><rect x="28" y="70" width="126" height="30" rx="4"/><text class="mid" x="91" y="85">Presence gate</text></g>
  <g class="node teal"><rect x="186" y="70" width="126" height="30" rx="4"/><text class="mid" x="249" y="85">P(present)</text></g>
  <g class="node plain"><rect x="28" y="120" width="126" height="30" rx="4"/><text class="mid" x="91" y="135">Center patch</text></g>
  <g class="node plain"><rect x="186" y="120" width="126" height="30" rx="4"/><text class="mid" x="249" y="135">4 sides 4×64 bins</text></g>
  <g class="node teal"><rect x="186" y="170" width="126" height="30" rx="4"/><text class="mid" x="249" y="185">Box</text></g>
  <g class="node plain"><rect x="28" y="220" width="126" height="30" rx="4"/><text class="mid" x="91" y="235">IoU head</text></g>
  <g class="node teal"><rect x="186" y="220" width="126" height="30" rx="4"/><text class="mid" x="249" y="235">P(IoU ≥ 0.5)</text></g>
  <g class="node clay"><rect x="28" y="278" width="284" height="30" rx="15"/><text class="mid" x="170" y="293">Conf = P(present) · P(IoU≥0.5)</text></g>
  <path class="edge" d="M80 31 H16 V235 H24" marker-end="url(#arrow)"/>
  <path class="edge" d="M16 85 H24" marker-end="url(#arrow)"/>
  <path class="edge" d="M16 135 H24" marker-end="url(#arrow)"/>
  <path class="edge" d="M154 85 H182" marker-end="url(#arrow)"/>
  <path class="edge" d="M154 135 H182" marker-end="url(#arrow)"/>
  <path class="edge dash" d="M91 150 V216" marker-end="url(#arrow)"/>
  <text class="small" x="98" y="188">Selected patch</text>
  <path class="edge" d="M249 150 V166" marker-end="url(#arrow)"/>
  <path class="edge" d="M154 235 H182" marker-end="url(#arrow)"/>
  <path class="edge" d="M312 85 H324 V293 H316" marker-end="url(#arrow)"/>
  <path class="edge" d="M312 235 H324"/>
</svg>
```

Each visual token corresponds to 32×32 pixels. The training target for the center patch is distributed proportionally to the area of each patch covered by the ground-truth box, following GUI-Actor[@guiactor]; modeling the four sides as distributions comes from GFL[@gfl], trained with Cramér distance (the sum of squared differences between the two CDFs), with the final box taken as the expected value of each side's distribution; using a presence score to judge whether a concept is in the image is also done in SAM 3[@sam3]. None of the parts are new; what is new is putting them into a **single forward pass** that simultaneously produces bounding boxes and calibrated “not present” probabilities for many questions on one image. The IoU head reads the features at the selected patch, and the box confidence is P(present) × P(IoU ≥ 0.5). When the target is absent, only the presence gate is trained. During training we freeze the vision tower and attach LoRA (r=64) to the linear layers of the language model. The temperature for each question type is fitted on a held-out calibration split from the training distribution, never touching any evaluation set.

### On Hybrid Models, Attention Masks Don't Stop Cross-Talk

To “compute the image once and append the questions after it,” the most straightforward implementation is to concatenate the image and 8 questions into a single sequence and apply a block mask in attention so each question only attends to the image and itself. On a standard Transformer, that suffices.

But Qwen3.5 is a hybrid architecture: out of every 4 layers, 3 are Gated DeltaNet (GDN, a linear attention variant with recurrent state) and only 1 is full attention. GDN has no attention matrix to mask; its recurrent state is passed sequentially along the token stream, so whatever Question 1 writes into the state, Question 2 can still read. This cross-talk doesn't throw an error or tank benchmark scores—it just makes every answer quietly depend on the questions placed before it.

```widget src="../../widgets/glance/leak.js" title="A block mask stops full attention, not GDN's recurrent state" note="Controlled test on 27B."
../../images/glance/w-leak-en.png | Static image: Top shows concatenating the image and three questions with a block mask, where the GDN layer's recurrent state passes from Question 1 all the way to Question 3; bottom shows Glance's approach, where each question restarts from the prefix state
../../images/glance/w-leak-en-n.png | Same as above, mobile version
```

We measured how much leaks on the 27B model: a 938-token prefix followed by 8 question blocks of 25 tokens each, checking how much the hidden state of Block 4 differs from running Block 4 alone (‖concatenated − isolated‖ / ‖isolated‖). With no mask it differs by 44.1%; with a causal block mask it still differs by 39.8%; with flex attention's BlockMask it still differs by 38.7%. All three are nearly equally broken.

So we wrote our own forward pass: the prefix is computed once as usual, we snapshot the final recurrent state and last 3 conv inputs at every GDN layer, and each question block restarts from that saved state; in full-attention layers, each block attends only to the prefix and itself. Mathematically, this is identical to running every “prefix + question” pair separately, except the prefix is computed only once. Checked block-by-block against the reference implementation on a randomly initialized small Qwen3.5 config in fp32, the relative error is around 1e-7; with real 4B weights, cosine similarity is at least 0.99999.

```echarts title="Deviation from isolated execution: all three masks leak ~40%, restarting from prefix state is ~1e-7" note="First three measured on 27B; last one measured on a small config in fp32. Log scale." height="230"
{"tooltip": {"trigger": "item", "formatter": "{b}"}, "grid": {"left": 4, "right": 56, "top": 12, "bottom": 40}, "xAxis": {"type": "value", "min": -8, "max": 0, "interval": 2, "axisLabel": {"formatter": "1e{value}"}, "name": "Relative error (log)", "nameLocation": "middle", "nameGap": 26}, "yAxis": {"type": "category", "inverse": true, "axisTick": {"show": false}, "data": ["No mask", "block mask", "flex BlockMask", "Prefix state restart"]}, "series": [{"type": "scatter", "symbolSize": 13, "data": [{"name": "No mask: 44.1%", "value": [-0.3556, 0], "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "44.1%", "color": "var(--ink)", "textBorderColor": "transparent"}}, {"name": "block mask: 39.8%", "value": [-0.4001, 1], "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "39.8%", "color": "var(--ink)", "textBorderColor": "transparent"}}, {"name": "flex BlockMask: 38.7%", "value": [-0.4123, 2], "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "38.7%", "color": "var(--ink)", "textBorderColor": "transparent"}}, {"name": "Prefix state restart: ≈1e-7", "value": [-7, 3], "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "position": "right", "formatter": "≈1e-7", "color": "var(--ink)", "textBorderColor": "transparent"}}]}]}
```

### How Fast It Is, and Where the Speed Comes From

Speed has to be measured against the strongest baseline. The fastest generative setup we could configure is Qwen3.5-4B on vLLM 0.34 with prefix caching, CUDA graphs, MTP speculative decoding enabled, and FP8 weights. On the same RTX PRO 6000 and the same RefCOCO photos (up to 640 visual tokens), asking 1, 8, or 32 box questions on a single image takes 43, 45, and 61 ms with Glance versus 99, 134, and 229 ms with vLLM—making Glance 2.3×, 3.0×, and 3.8× faster; against bf16 vLLM under the same settings, it is 2.7×, 3.6×, and 4.6× faster. Both sides are timed from the resized image to receiving all answers, image preprocessing included. Glance runs in bf16 here, and agrees with the fp32 reference forward pass on presence decisions 99.78% of the time.

```echarts title="Latency per call when asking N box questions on one image" note="RTX PRO 6000, median of 50 calls." height="330"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value} ms"}, "grid": {"left": 4, "right": 124, "top": 20, "bottom": 44}, "xAxis": {"type": "category", "data": ["1", "2", "4", "8", "16", "32", "64"], "name": "Questions per image", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "axisLabel": {"formatter": "{value} ms"}}, "series": [{"name": "Glance", "type": "line", "symbolSize": 6, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [43, 43, 43, 45, 50, 61, 85]}, {"name": "vLLM best config", "type": "line", "symbolSize": 5, "itemStyle": {"color": "var(--stone)"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [99, 112, 117, 134, 166, 229, 361]}, {"name": "vLLM bf16", "type": "line", "symbolSize": 4, "itemStyle": {"color": "var(--muted)"}, "lineStyle": {"type": "dashed"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [167, 186, 202, 221, 259, 334, 481]}, {"name": "vLLM no decode", "type": "line", "symbolSize": 4, "itemStyle": {"color": "var(--sky)"}, "lineStyle": {"type": "dotted"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [39, 50, 53, 65, 87, 141, 234]}]}
```

Where does the speedup come from? When we modified vLLM to read only a single token per question without decoding (which can only answer “present or not,” without producing a box), its latency for a single question also dropped to 39 ms—the same as Glance. So the advantage comes from not decoding, not from a faster engine; what Glance achieves is producing bounding boxes without decoding. As the number of questions grows, vLLM's curve still climbs faster because each question is a separate request in vLLM.

The most common pattern for an agent is asking follow-up questions about a screen it has already viewed. With the image state already cached, asking 1, 8, or 32 more questions takes just 11, 14, and 28 ms, versus 78, 113, and 212 ms for the strongest baseline—a 7–8× speedup. On a cheaper L4 GPU the gap widens further: 2.6×, 3.2×, and 5.4× faster for 1, 8, and 32 questions on a fresh image, and 10–12× faster for follow-up questions.

There are also cases where Glance is not faster. When a call is dominated by prefill, the time saved by skipping decoding isn't enough: asking just 1 question on a large 4,096-visual-token screenshot, or 1 question per frame across 32–64 video frames, leaves Glance tied or slower (0.5–1.0×). It loses there because our research engine is slower than vLLM at prefilling long sequences and multi-image batches, not because of the readout mechanism.

```data title="Latency across workloads (ms): Glance vs. strongest generative config" bars="Speedup" mark="Follow-up 8"
Workload | Speedup | Glance | Baseline
Ask 8 boxes | 3.0× | 45 | 134
Ask 32 boxes | 3.8× | 61 | 229
Follow-up 8 | 8.3× | 14 | 113
L4, ask 32 | 5.4× | 354 | 1,909
4 types, 8 queries | 2.3× | 54 | 122
2K screenshot, 32 queries | 2.7× | 155 | 419
4K screenshot, 1 query | 0.88× | 299 | 262
64 frames, 1 query each | 0.52× | 1,161 | 609
```

## Surprise 1: Whether It Hallucinates Absent Boxes Is a Setting

What we originally set out to prove was that autoregressively generating coordinates is inherently bad at saying “not there,” and that an explicit presence gate is better. That turned out to be wrong. A generative model actually knows whether an object is present; whether it says so depends on the rule you use to turn its probabilities into a single answer. Below we first explain the mechanism, then show what it looks like on off-the-shelf models: on the exact same model, changing the prompt, coordinate format, and decoder shifts the rate of boxing absent objects by 50 to 60 percentage points.

### One Independent Candidate vs. a Vote-Splitting Party

When a generative model answers “box X,” it writes a string of text: either `none`, or four coordinates like `412,088,601,733`. “Not present” has only one spelling. “Present,” however, has thousands: `412,088,601,733` and `413,088,601,733` are practically the same box, yet to the model they are two distinct answer strings, each taking a tiny slice of probability mass.

To put numbers on it: suppose the model assigns 30% to `none` and 70% to “present,” with that 70% spread evenly across 100 nearly identical coordinate strings at 0.7% each.

- **Rule A: Pick the single complete answer with the highest probability.** This is maximum a posteriori (MAP), which beam search tries to approximate. `none` at 30% beats every individual 0.7% coordinate string, so the model answers “not present.”
- **Rule B: Look at the total probability of “present” first.** P(none) is only 30%, which is below 0.5, so the model answers “present” and then picks a box.

The exact same probability distribution yields two opposite answers. It's just like an election: an independent candidate gets 30% of the vote, and a political party gets 70%, but the party's vote is split among 100 candidates on the ballot. If you count votes per candidate, the independent wins; if you count total votes for the party, the party wins. Greedy decoding sits in between: at the very first step it compares `none` against “the first digit is 4,” which already pools together every box starting with 4, making it behave much closer to Rule B.

```sketch title="Same probabilities, two vote-counting rules, two opposite answers" note="Schematic; numbers are illustrative."
<svg viewBox="0 0 704 400">
<rect class="panel" x="0" y="0" width="704" height="400" rx="12"/>
<text class="small b" x="24" y="30">All possible answers to one query, by probability</text>
<rect x="70" y="160.0" width="56" height="90.0" rx="2" fill="var(--clay)"/>
<text class="mid b" x="98" y="148">30%</text>
<text class="mid mono" x="98" y="266">none</text>
<text class="small mid" x="98" y="284">“absent”</text>
<rect x="186.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="189.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="192.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="196.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="199.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="203.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="206.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="209.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="213.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="216.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="220.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="223.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="226.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="230.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="233.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="237.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="240.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="243.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="247.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="250.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="254.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="257.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="260.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="264.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="267.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="271.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="274.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="277.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="281.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="284.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="288.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="291.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="294.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="298.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="301.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="305.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="308.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="311.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="315.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="318.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="322.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="325.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="328.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="332.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="335.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="339.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="342.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="345.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="349.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="352.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="356.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="359.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="362.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="366.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="369.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="373.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="376.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="379.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="383.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="386.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="390.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="393.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="396.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="400.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="403.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="407.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="410.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="413.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="417.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="420.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="424.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="427.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="430.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="434.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="437.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="441.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="444.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="447.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="451.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="454.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="458.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="461.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="464.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="468.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="471.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="475.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="478.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="481.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="485.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="488.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="492.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="495.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="498.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="502.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="505.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="509.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="512.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="515.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="519.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="522.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<text class="small mid" x="356" y="232">0.7% each</text>
<text class="mid" x="356" y="266">100 coordinate strings</text>
<text class="small mid" x="356" y="284">“present,” but votes are split</text>
<rect x="550.0" y="40.0" width="44" height="210.0" rx="2" fill="var(--teal-wash)" stroke="var(--teal)" stroke-dasharray="3 3"/>
<text class="mid b" x="572" y="28">70%</text>
<text class="small mid" x="572" y="266">Total</text>
<line x1="12" y1="250" x2="692" y2="250" stroke="var(--line)"/>
<g class="node clay"><rect x="24" y="300" width="656" height="36" rx="4"/></g>
<text class="b" x="36" y="318">Rule A · Pick single highest-prob answer (MAP)</text>
<text class="small end" x="668" y="318">none (30%) beats every 0.7% string → says “absent”</text>
<g class="node teal"><rect x="24" y="344" width="656" height="36" rx="4"/></g>
<text class="b" x="36" y="362">Rule B · Check total “present” prob first (0.5)</text>
<text class="small end" x="668" y="362">Present 70% &gt; absent 30% → says “present,” gives box</text>
</svg>
<svg viewBox="0 0 340 460">
<rect class="panel" x="0" y="0" width="340" height="460" rx="12"/>
<text class="small b" x="16" y="30">All possible answers to one query, by probability</text>
<rect x="40" y="160.0" width="44" height="90.0" rx="2" fill="var(--clay)"/>
<text class="mid b" x="62" y="148">30%</text>
<text class="mid mono" x="62" y="266">none</text>
<text class="small mid" x="62" y="284">“absent”</text>
<rect x="118.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="119.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="121.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="123.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="124.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="126.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="128.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="129.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="131.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="133.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="135.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="136.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="138.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="140.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="141.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="143.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="145.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="146.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="148.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="150.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="152.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="153.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="155.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="157.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="158.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="160.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="162.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="163.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="165.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="167.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="169.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="170.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="172.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="174.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="175.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="177.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="179.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="180.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="182.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="184.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="186.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="187.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="189.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="191.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="192.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="194.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="196.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="197.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="199.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="201.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="203.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="204.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="206.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="208.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="209.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="211.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="213.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="214.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="216.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="218.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="220.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="221.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="223.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="225.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="226.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="228.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="230.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="231.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="233.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="235.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="237.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="238.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="240.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="242.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="243.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="245.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="247.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="248.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="250.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="252.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="254.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="255.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="257.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="259.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="260.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="262.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="264.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="265.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="267.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="269.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="271.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="272.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="274.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="276.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="277.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="279.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="281.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="282.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="284.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="286.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<text class="small mid" x="203" y="232">0.7% each</text>
<text class="mid" x="203" y="266">100 coordinate strings</text>
<text class="small mid" x="203" y="284">“present,” but votes are split</text>
<rect x="298.0" y="40.0" width="30" height="210.0" rx="2" fill="var(--teal-wash)" stroke="var(--teal)" stroke-dasharray="3 3"/>
<text class="mid b" x="313" y="28">70%</text>
<text class="small mid" x="313" y="266">Total</text>
<line x1="12" y1="250" x2="328" y2="250" stroke="var(--line)"/>
<g class="node clay"><rect x="16" y="304" width="308" height="56" rx="4"/></g>
<text class="b" x="28" y="322">Rule A · Pick single highest-prob (MAP)</text>
<text class="small" x="28" y="344">none (30%) beats every 0.7% string → “absent”</text>
<g class="node teal"><rect x="16" y="374" width="308" height="56" rx="4"/></g>
<text class="b" x="28" y="392">Rule B · Check total “present” prob (0.5)</text>
<text class="small" x="28" y="414">Present 70% &gt; absent 30% → “present” + box</text>
</svg>
```

This explanation yields a testable prediction: the more finely a coordinate representation splits the vote, the more often Rule A will say “not present,” while Rule B remains unaffected.

### Controlled Experiment: Changing Only the Output Head

To test this, we ran a controlled experiment: **same 4B base model, same LoRA configuration, same training data and data order, same 3,058 steps—changing only the output head**.

- **Gated**: our box head above, where P(present) is a single scalar.
- **Digits**: generates `x1,y1,x2,y2` in 0–1000, one digit per token; generates `none` when absent.
- **Hierarchical**: two new tokens per coordinate, coarse then fine, giving 32×32 = 1,024 levels[@song2025].
- **Atomic 100 / Atomic 1000**: one new token per coordinate value, quantized to 100 or 1,000 levels.

In the chart below, the x-axis is the false rejection rate—how often the target is present yet the model says “not present” (RefCOCO val, 10,834 expressions)—and the y-axis is the true rejection rate when the target is genuinely absent (gRefCOCO val no-target expressions, 8,905 expressions). Each curve sweeps all thresholds over a head's own “not present” probability: 1 − P(present) for the gated head, and P(none) for the generative heads. The dots on the curves show where specific decoding rules land. Pick a head and a rule to see what happens:

```widget src="../../widgets/glance/dial.js" title="Same digits head, different decoding rule: false rejection jumps from 0.4% to ~40%" note="Single seed."
../../images/glance/w-dial-en.png | Static image: The curves of the five output heads almost completely overlap; on the same digits head, thresholding at 0.5 falsely rejects 0.4% of present targets, while picking the highest-probability full sequence rejects ~40%
../../images/glance/w-dial-en-n.png | Same as above, mobile version
```

**Generative heads actually know whether the object is there.** All five curves lie almost on top of one another: when the threshold is set to falsely reject exactly 1% of present targets, all four coordinate-string heads reject 81–82% of no-target expressions, compared with 81.3% for the gated head; AUROCs all sit between 96.2 and 96.7. The presence gate does not win on knowing whether something is absent.

**Whether the model says so is decided by how votes are counted.** Across 21,586 present targets in RefCOCO, thresholding the digits head at P(none) ≥ 0.5 calls only 0.47% “not present,” and greedy decoding calls 0.60% “not present.” Rule A in the widget above uses an approximation: comparing the full-sequence probability of the greedily decoded coordinate string against `none`. To confirm this wasn't an artifact of the approximation, we ran exact best-first search on a sampled subset of targets to find the highest-probability complete sequence; the digits head landed at 34–41% (an interval because some queries did not terminate within the search budget), matching the approximation. Lining up all four representations side by side:

```data title="Share of present targets called “not present” (%)" bars="Exact MAP" mark="Digits" note="Sampled subset; beam: width 4, keeping none as a candidate."
Output head | Exact MAP | Beam | Greedy | Threshold
Digits | 34–41 | 39.2 | 0.6 | 0.4
Hierarchical | 23–25 | 22.6 | 0.7 | 0.4
Atomic 1000 | 12.3 | 10.4 | 1.9 | 0.6
Atomic 100 | 4.6 | 3.9 | 0.8 | 0.4
```

Thresholding and greedy decoding barely change across representations (all under 2%); Rule A climbs from 4.6% on Atomic 100 all the way to 34–41% on Digits, tracking how much probability mass the single most likely coordinate string can hold onto: the more tokens a box takes to write and the more uncertain each step is, the smaller any single string's probability becomes, and the easier it is for `none` to win. On the present targets that Rule A calls “not present,” the model actually knows where the object is most of the time: the box greedily decoded by the digits head is correct 88% of the time.

You don't even need to change the vocabulary—changing the beam search implementation is enough. The first time we ran a standard width-4 beam search on a batch of 191 targets, only 4.7% were called “not present.” We then realized `none` wasn't making the top-4 on the very first token and was being pruned immediately (at width 4, `none` falls outside the first-step beam on 72% of present targets). Once we kept `none` alive as a complete candidate that can terminate immediately, beam widths from 4 to 16 all returned to 38–39%, matching exact search; turning on Hugging Face's default length normalization (averaging log probability per token) pushed it right back down to 1–3%. All three are called “beam search,” yet their answers differ by 40×. This is surface form competition[@holtzman2021]—except here it decides whether an agent treats a visible button on the screen as nonexistent.

Atomic 1000 exhibits an even subtler version: surface form competition also happens **inside the box**. Because a single coordinate is spread across 1,000 adjacent bin tokens, on the first token of a present target the most likely non-`none` token gets an average probability of only 0.19 (versus 0.78 for the digits head). As a result, under unconstrained greedy decoding, 24.2% of outputs aren't even well-formed coordinates, dropping RefCOCO accuracy to 73.1; adding a grammar constraint that restricts each step to valid coordinate tokens brings the exact same model right back to 93.8.

### Splitting Coordinates Without Retraining

The cleanest test doesn't touch the model at all. Take the trained Atomic 100 head and split every coordinate token into $k$ equivalent “synonym” tokens, each receiving $1/k$ of the original probability. The total probability the model assigns to “present” versus “not present” hasn't changed by a single bit—all that changed is how many ways the vote is split.

```echarts title="Same model, splitting each coordinate into k synonyms: MAP refusal climbs from 4.6% to 29.4%, threshold stays flat" note="Atomic 100 head, 1,362 sampled present targets from RefCOCO val, exact MAP." height="280"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "grid": {"left": 4, "right": 112, "top": 24, "bottom": 44}, "xAxis": {"type": "category", "data": ["1", "2", "4", "10"], "name": "Synonyms per coordinate (k)", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "max": 35, "axisLabel": {"formatter": "{value}%"}}, "series": [{"name": "Rule A (MAP)", "type": "line", "showSymbol": true, "symbolSize": 8, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}", "offset": [6, 0]}, "data": [4.6, {"value": 10.7, "label": {"offset": [-10, -2]}}, {"value": 18.1, "label": {"offset": [-10, -2]}}, 29.4]}, {"name": "Threshold 0.5", "type": "line", "showSymbol": true, "symbolSize": 6, "itemStyle": {"color": "var(--stone)"}, "label": {"show": false, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}", "offset": [6, 0]}, "data": [0.7, 0.7, 0.7, {"value": 0.7, "label": {"show": true}}]}]}
```

As $k$ goes from 1 to 10, Rule A's false rejection climbs 6× from 4.6% to 29.4%, while the threshold rule stays at 0.7%. At the same time, true rejection on no-target expressions also climbs from 85.4% to 96.6%: Rule A isn't getting “smarter”—its operating point is simply sliding wholesale toward “not present.”

### On Off-the-Shelf Models: Hallucination Is a Setting

Our controlled experiments isolated the mechanism using four coordinate heads we trained ourselves. What does this look like on off-the-shelf VLMs? We took four widely used open-weights models (Qwen3.5-4B, Qwen3-VL-4B, Qwen2.5-VL-7B, and InternVL3.5-8B) and ran them across 1,993 queries (1,000 present targets from RefCOCO val and 993 no-target expressions from gRefCOCO val) while varying their settings: three prompts that all explicitly allow saying “not there” (answer `none` if absent; put `null` in JSON; output `[-1, -1]` for point coordinates), three coordinate formats (0–1000 integers, 0–1 decimals, pixels), and six decoding methods: greedy (both vLLM and Hugging Face, which differ by at most 1.3 points), sampling, beam search, length-normalized beam search, and thinking mode (Qwen2.5-VL-7B and InternVL3.5-8B were run with greedy and sampling only). Because 0–1 decimals and pixel coordinates (outside Qwen2.5-VL-7B) mostly produced malformed outputs, we omitted them. The chart below plots the remaining 49 well-formed configurations, one dot per setting:

```echarts title="Same 1,993 queries, 49 settings: the rate of boxing absent objects ranges from 17% to 92%" note="Each dot is a model × prompt × coordinate format × decoder configuration (0% false rejection is plotted at 0.1%); the Glance curve sweeps all thresholds on the same queries. Glance saw gRefCOCO train no-target expressions during training; the other models did not." height="420"
{"tooltip": {"trigger": "item", "formatter": "{a}<br/>{b}: {c}"}, "legend": {"data": ["Glance", "Qwen3.5-4B", "Qwen3-VL-4B", "Qwen2.5-VL-7B", "InternVL3.5-8B"]}, "grid": {"left": 56, "right": 20, "top": 64, "bottom": 48}, "xAxis": {"type": "log", "min": 0.1, "max": 60, "name": "False rejection rate (log)", "nameLocation": "middle", "nameGap": 28, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "value", "min": 0, "max": 100, "name": "Absent targets given a box", "nameLocation": "middle", "nameGap": 40, "axisLabel": {"formatter": "{value}%"}}, "series": [{"name": "Qwen3.5-4B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--sky)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · beam-4", "value": [4.7, 30.1]}, {"name": "JSON · 0–1000 · beam-4 len-norm", "value": [0.1, 76.8]}, {"name": "JSON · 0–1000 · greedy", "value": [0.1, 84.1]}, {"name": "JSON · 0–1000 · HF greedy", "value": [0.1, 82.8]}, {"name": "JSON · 0–1000 · sampling", "value": [0.1, 82.6]}, {"name": "say none · 0–1000 · beam-4", "value": [2.2, 26.6]}, {"name": "say none · 0–1000 · beam-4 len-norm", "value": [2.1, 28.2]}, {"name": "say none · 0–1000 · greedy", "value": [0.8, 37.7]}, {"name": "say none · 0–1000 · HF greedy", "value": [0.8, 37.0]}, {"name": "say none · 0–1000 · sampling", "value": [1.1, 36.7]}, {"name": "say none · 0–1000 · thinking", "value": [1.1, 41.1]}, {"name": "point [-1,-1] · 0–1000 · beam-4", "value": [0.6, 41.4]}, {"name": "point [-1,-1] · 0–1000 · beam-4 len-norm", "value": [0.6, 41.4]}, {"name": "point [-1,-1] · 0–1000 · greedy", "value": [0.1, 65.4]}, {"name": "point [-1,-1] · 0–1000 · HF greedy", "value": [0.1, 65.5]}, {"name": "point [-1,-1] · 0–1000 · sampling", "value": [0.1, 65.4]}, {"name": "point [-1,-1] · 0–1000 · thinking", "value": [0.8, 56.9]}]}, {"name": "Qwen3-VL-4B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--olive)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · beam-4", "value": [0.1, 77.2]}, {"name": "JSON · 0–1000 · beam-4 len-norm", "value": [0.1, 83.5]}, {"name": "JSON · 0–1000 · greedy", "value": [0.1, 86.5]}, {"name": "JSON · 0–1000 · HF greedy", "value": [0.1, 86.6]}, {"name": "JSON · 0–1000 · sampling", "value": [0.1, 86.8]}, {"name": "say none · 0–1000 · beam-4", "value": [1.6, 34.2]}, {"name": "say none · 0–1000 · beam-4 len-norm", "value": [0.4, 57.1]}, {"name": "say none · 0–1000 · greedy", "value": [0.4, 58.0]}, {"name": "say none · 0–1000 · HF greedy", "value": [0.4, 58.3]}, {"name": "say none · 0–1000 · sampling", "value": [0.5, 56.1]}, {"name": "point [-1,-1] · 0–1000 · beam-4", "value": [2.1, 48.4]}, {"name": "point [-1,-1] · 0–1000 · beam-4 len-norm", "value": [2.1, 48.4]}, {"name": "point [-1,-1] · 0–1000 · greedy", "value": [0.1, 85.1]}, {"name": "point [-1,-1] · 0–1000 · HF greedy", "value": [0.1, 85.2]}, {"name": "point [-1,-1] · 0–1000 · sampling", "value": [0.1, 81.0]}]}, {"name": "Qwen2.5-VL-7B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--kraft)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · greedy", "value": [0.1, 91.6]}, {"name": "JSON · 0–1000 · sampling", "value": [0.1, 92.2]}, {"name": "JSON · pixels · greedy", "value": [0.7, 84.3]}, {"name": "JSON · pixels · sampling", "value": [0.9, 85.3]}, {"name": "say none · 0–1000 · greedy", "value": [0.6, 78.7]}, {"name": "say none · 0–1000 · sampling", "value": [0.4, 79.4]}, {"name": "say none · pixels · greedy", "value": [0.6, 87.8]}, {"name": "say none · pixels · sampling", "value": [0.8, 88.0]}, {"name": "point [-1,-1] · 0–1000 · greedy", "value": [4.2, 34.3]}, {"name": "point [-1,-1] · 0–1000 · sampling", "value": [4.2, 32.4]}, {"name": "point [-1,-1] · pixels · greedy", "value": [4.2, 34.7]}, {"name": "point [-1,-1] · pixels · sampling", "value": [4.1, 33.5]}]}, {"name": "InternVL3.5-8B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--fig)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · greedy", "value": [1.2, 41.7]}, {"name": "JSON · 0–1000 · sampling", "value": [2.8, 38.4]}, {"name": "say none · 0–1000 · greedy", "value": [10.7, 27.7]}, {"name": "point [-1,-1] · 0–1000 · greedy", "value": [21.4, 18.7]}, {"name": "point [-1,-1] · 0–1000 · sampling", "value": [48.0, 16.9]}]}, {"name": "Glance", "type": "line", "showSymbol": false, "smooth": false, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "data": [[0.1, 31.32], [0.2, 30.92], [0.2, 30.41], [0.2, 29.91], [0.2, 29.41], [0.2, 28.9], [0.2, 28.4], [0.4, 28.1], [0.4, 27.59], [0.4, 27.09], [0.5, 26.69], [0.5, 26.18], [0.5, 25.68], [0.6, 25.28], [0.6, 24.87], [0.6, 24.37], [0.7, 23.97], [0.7, 23.46], [0.7, 22.96], [0.8, 22.56], [0.8, 22.05], [0.8, 21.55], [0.8, 21.05], [0.8, 20.54], [0.8, 20.04], [0.8, 19.54], [0.8, 19.03], [0.8, 18.53], [1.0, 18.23], [1.2, 17.93], [1.2, 17.42], [1.3, 17.02], [1.3, 16.52], [1.3, 16.01], [1.4, 15.61], [1.4, 15.11], [1.5, 14.7], [1.6, 14.3], [1.7, 13.9], [1.7, 13.39], [1.8, 12.99], [1.9, 12.59], [1.9, 12.08], [2.2, 11.88], [2.3, 11.48], [2.4, 11.08], [2.5, 10.67], [2.5, 10.17], [2.5, 9.67], [2.5, 9.16], [2.6, 8.76], [2.8, 8.46], [2.8, 7.96], [2.9, 7.55], [3.0, 7.15], [3.3, 6.95], [3.6, 6.75], [3.8, 6.45], [3.9, 6.04], [4.3, 5.94], [4.6, 5.74], [4.8, 5.44], [5.0, 5.14], [5.1, 4.73], [5.3, 4.53], [5.6, 4.33], [5.8, 4.03], [6.6, 3.83], [7.0, 3.73], [7.4, 3.63], [7.7, 3.42], [8.1, 3.32], [8.5, 3.22], [8.9, 3.12], [9.2, 2.92], [9.5, 2.72], [9.9, 2.62], [10.3, 2.52], [11.2, 2.42], [12.6, 2.32], [13.0, 2.22], [13.4, 2.11], [14.3, 2.01], [15.2, 1.91], [18.1, 1.81], [19.0, 1.71], [19.3, 1.51], [20.7, 1.41], [22.1, 1.31], [28.9, 1.21], [29.8, 1.11], [30.7, 1.01], [33.1, 0.91], [33.5, 0.81], [42.4, 0.7], [52.7, 0.6], [59.1, 0.5]], "endLabel": {"show": false}}]}
```

The dots for the three Qwen models spread almost vertically: present targets are almost never rejected (all under 5%, with InternVL as the exception), so nearly all the variation is in how often absent objects get boxed. Across the 49 settings, that rate spans from 16.9% to 92.2%, varying by 50–60 percentage points within a single Qwen model. Two examples: under greedy decoding on Qwen3-VL-4B, prompting “say none if absent” boxes 58.0% of absent targets, switching to point coordinates boxes 85.1%, and switching to JSON boxes 86.5%; on Qwen3.5-4B with the JSON prompt, greedy decoding boxes 84.1%, whereas beam-4 drops it to 30.1% (at the cost of false rejections on present targets rising from 0% to 4.7%).

The decoder half of this spread is the election above: beam search looks for the highest-probability full sequence, compressing Qwen3.5-4B's false-box rate from 84% down to 30%. The prompt half is a different phenomenon: it changes how much probability mass the model puts on “not present” at the decision token. When Qwen3.5-4B and Qwen2.5-VL-7B are given the JSON prompt, the probability at that step barely distinguishes present from absent anymore (see next paragraph); Qwen3-VL-4B still separates them (AUROC 0.89–0.91), but the overall probability assigned to “not present” is so low that greedy decoding still draws a box 86.5% of the time. Neither effect has anything to do with whether the model “saw” the object. Whether a model “hallucinates” here is not an intrinsic property of the model—it is the operating point you picked.

To be fair, generative models do have a decent continuous dial of their own, provided two conditions hold: you have access to token probabilities at the decision step, and the prompt hasn't scrambled them. Reading the refusal token's probability at that step as a score gives the three Qwen models an AUROC of 0.93–0.95 under the “say none” prompt. Switch to the JSON prompt, however, and that score drops to 0.62–0.69 on Qwen3.5-4B and Qwen2.5-VL-7B. Glance achieves 0.985 on the same set (having seen such negative examples during training): at 1% false rejection of present targets, it boxes only 18% of absent targets, compared with 34% for the best generative dial. So Glance's advantage isn't just a better probability—it's also three practical things: immunity to prompt formatting, no need to extract logprobs, and getting both the box and the probability in the same single forward pass.

### Why This Matters

- **For agents:** When you use a generative model as an agent's eyes, whether it clicks a nonexistent button is a property of your configuration: how the prompt is worded, what coordinate format you ask for, how wide the beam is, and whether length normalization is on. Changing a prompt template—or a serving library's default decoding arguments—can swing the hallucination rate by 50–60 percentage points without changing a single model weight. And when logprobs aren't exposed, you can only jump between discrete settings; Glance gives you a continuous probability dial that doesn't depend on prompt wording.
- **For benchmarks:** Comparing two models on hallucination or refusal rates over absent-target queries without fixing the prompt, coordinate format, and decoding rule is really comparing configurations. You can see the same effect in third-party benchmarks: on RefBench-PRO[@refbenchpro], generative models refuse only 3–25% of attribute-mismatched descriptions, yet rephrasing the exact same queries as yes/no questions raises refusal to roughly 47–64%.
- **For Glance:** The presence gate outputs a single scalar, leaving the threshold up to the user. The next section explains how to set it.

## Two Dials, One Decision Rule

In our controlled experiments, a generative head trained on the same base model and data was just as accurate as the presence gate on “is it there?”, so the gate's value does not lie in “seeing presence better.” Its value lies in handing you two calibrated probabilities: **whether the target is present**, and **whether the box is accurate**. With those two numbers, you can compute whether to answer from explicit costs.

First, look at the second dial. The box head also outputs P(IoU ≥ 0.5), which separates accurate boxes from inaccurate ones on present targets with an AUROC of 91.6; generative heads, no matter which confidence score you use (full-sequence probability, length-normalized probability, or the margin between the best box and `none`), top out at 79.7. A generative model can be very sure an object is present, yet unable to tell whether the box it drew is right.

Now look at the decision rule. Suppose falsely rejecting a present target costs 1, hallucinating a box when the target is absent also costs 1, and answering with a wrong box on a present target costs $c_W$. The expected-cost-minimizing rule is:

$$
\text{Answer} \iff P(\text{present}) \cdot \big[\, 2 - c_W \, (1 - P(\text{IoU} \ge 0.5)) \,\big] > 1
$$

The larger $c_W$ is, the stricter the requirement on box accuracy. When $c_W = 5$, if P(IoU ≥ 0.5) is below 0.8, you should refuse to answer no matter how certain you are that the object is present; a rule that only checks presence (the horizontal dashed line below) cannot do this.

```sketch title="Two probabilities, one rule: the costlier a wrong box, the more box accuracy is required" note="Shaded region shows where the model should answer when c_W = 5."
<svg viewBox="0 0 704 330">
<rect class="panel" x="0" y="0" width="704" height="330" rx="12"/>
<path d="M388.0 40.0 L388.0 40.0 L389.9 49.3 L391.8 58.3 L393.7 66.7 L395.6 74.8 L397.5 82.6 L399.4 90.0 L401.3 97.1 L403.2 103.9 L405.1 110.4 L407.0 116.7 L408.9 122.7 L410.8 128.5 L412.7 134.0 L414.6 139.4 L416.5 144.5 L418.4 149.5 L420.3 154.3 L422.2 159.0 L424.1 163.4 L426.0 167.8 L427.9 172.0 L429.8 176.0 L431.7 179.9 L433.6 183.8 L435.5 187.4 L437.4 191.0 L439.3 194.5 L441.2 197.8 L443.1 201.1 L445.0 204.3 L446.9 207.4 L448.8 210.4 L450.7 213.3 L452.6 216.1 L454.5 218.9 L456.4 221.6 L458.3 224.2 L460.2 226.8 L462.1 229.2 L464.0 231.7 L464.0 40.0 Z" fill="var(--clay-wash)" stroke="none"/>
<line x1="84.0" y1="40" x2="84.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="84" y="284">0</text>
<line x1="179.0" y1="40" x2="179.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="179" y="284">0.25</text>
<line x1="274.0" y1="40" x2="274.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="274" y="284">0.5</text>
<line x1="369.0" y1="40" x2="369.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="369" y="284">0.75</text>
<line x1="464.0" y1="40" x2="464.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="464" y="284">1</text>
<line x1="84" y1="270.0" x2="464" y2="270.0" stroke="var(--grid)"/>
<text class="small end" x="78" y="270">0.4</text>
<line x1="84" y1="193.3" x2="464" y2="193.3" stroke="var(--grid)"/>
<text class="small end" x="78" y="193.333">0.6</text>
<line x1="84" y1="116.7" x2="464" y2="116.7" stroke="var(--grid)"/>
<text class="small end" x="78" y="116.667">0.8</text>
<line x1="84" y1="40.0" x2="464" y2="40.0" stroke="var(--grid)"/>
<text class="small end" x="78" y="40">1</text>
<text class="small mid" x="274" y="304">P(accurate box): P(IoU ≥ 0.5)</text>
<text class="small mid" x="54" y="155" transform="rotate(-90 54 155.0)">P(present)</text>
<line x1="84" y1="231.7" x2="464" y2="231.7" stroke="var(--muted)" stroke-dasharray="4 3"/>
<text class="small" x="92" y="243.667">Presence only: answer if P(present) &gt; 0.5</text>
<path d="M84.0 40.0 L85.9 41.9 L87.8 43.8 L89.7 45.7 L91.6 47.5 L93.5 49.3 L95.4 51.2 L97.3 53.0 L99.2 54.7 L101.1 56.5 L103.0 58.3 L104.9 60.0 L106.8 61.7 L108.7 63.4 L110.6 65.1 L112.5 66.7 L114.4 68.4 L116.3 70.0 L118.2 71.7 L120.1 73.3 L122.0 74.8 L123.9 76.4 L125.8 78.0 L127.7 79.5 L129.6 81.1 L131.5 82.6 L133.4 84.1 L135.3 85.6 L137.2 87.1 L139.1 88.5 L141.0 90.0 L142.9 91.4 L144.8 92.9 L146.7 94.3 L148.6 95.7 L150.5 97.1 L152.4 98.5 L154.3 99.8 L156.2 101.2 L158.1 102.6 L160.0 103.9 L161.9 105.2 L163.8 106.5 L165.7 107.8 L167.6 109.1 L169.5 110.4 L171.4 111.7 L173.3 112.9 L175.2 114.2 L177.1 115.4 L179.0 116.7 L180.9 117.9 L182.8 119.1 L184.7 120.3 L186.6 121.5 L188.5 122.7 L190.4 123.9 L192.3 125.0 L194.2 126.2 L196.1 127.3 L198.0 128.5 L199.9 129.6 L201.8 130.7 L203.7 131.8 L205.6 132.9 L207.5 134.0 L209.4 135.1 L211.3 136.2 L213.2 137.3 L215.1 138.3 L217.0 139.4 L218.9 140.4 L220.8 141.5 L222.7 142.5 L224.6 143.5 L226.5 144.5 L228.4 145.6 L230.3 146.6 L232.2 147.6 L234.1 148.5 L236.0 149.5 L237.9 150.5 L239.8 151.5 L241.7 152.4 L243.6 153.4 L245.5 154.3 L247.4 155.3 L249.3 156.2 L251.2 157.1 L253.1 158.1 L255.0 159.0 L256.9 159.9 L258.8 160.8 L260.7 161.7 L262.6 162.6 L264.5 163.4 L266.4 164.3 L268.3 165.2 L270.2 166.1 L272.1 166.9 L274.0 167.8 L275.9 168.6 L277.8 169.5 L279.7 170.3 L281.6 171.1 L283.5 172.0 L285.4 172.8 L287.3 173.6 L289.2 174.4 L291.1 175.2 L293.0 176.0 L294.9 176.8 L296.8 177.6 L298.7 178.4 L300.6 179.2 L302.5 179.9 L304.4 180.7 L306.3 181.5 L308.2 182.2 L310.1 183.0 L312.0 183.8 L313.9 184.5 L315.8 185.2 L317.7 186.0 L319.6 186.7 L321.5 187.4 L323.4 188.2 L325.3 188.9 L327.2 189.6 L329.1 190.3 L331.0 191.0 L332.9 191.7 L334.8 192.4 L336.7 193.1 L338.6 193.8 L340.5 194.5 L342.4 195.2 L344.3 195.8 L346.2 196.5 L348.1 197.2 L350.0 197.8 L351.9 198.5 L353.8 199.2 L355.7 199.8 L357.6 200.5 L359.5 201.1 L361.4 201.8 L363.3 202.4 L365.2 203.0 L367.1 203.7 L369.0 204.3 L370.9 204.9 L372.8 205.5 L374.7 206.1 L376.6 206.8 L378.5 207.4 L380.4 208.0 L382.3 208.6 L384.2 209.2 L386.1 209.8 L388.0 210.4 L389.9 211.0 L391.8 211.5 L393.7 212.1 L395.6 212.7 L397.5 213.3 L399.4 213.9 L401.3 214.4 L403.2 215.0 L405.1 215.6 L407.0 216.1 L408.9 216.7 L410.8 217.2 L412.7 217.8 L414.6 218.3 L416.5 218.9 L418.4 219.4 L420.3 220.0 L422.2 220.5 L424.1 221.0 L426.0 221.6 L427.9 222.1 L429.8 222.6 L431.7 223.2 L433.6 223.7 L435.5 224.2 L437.4 224.7 L439.3 225.2 L441.2 225.7 L443.1 226.2 L445.0 226.8 L446.9 227.3 L448.8 227.8 L450.7 228.3 L452.6 228.7 L454.5 229.2 L456.4 229.7 L458.3 230.2 L460.2 230.7 L462.1 231.2 L464.0 231.7" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="89.9" y="32">c_W = 1</text>
<path d="M274.0 40.0 L275.9 43.8 L277.8 47.5 L279.7 51.2 L281.6 54.7 L283.5 58.3 L285.4 61.7 L287.3 65.1 L289.2 68.4 L291.1 71.7 L293.0 74.8 L294.9 78.0 L296.8 81.1 L298.7 84.1 L300.6 87.1 L302.5 90.0 L304.4 92.9 L306.3 95.7 L308.2 98.5 L310.1 101.2 L312.0 103.9 L313.9 106.5 L315.8 109.1 L317.7 111.7 L319.6 114.2 L321.5 116.7 L323.4 119.1 L325.3 121.5 L327.2 123.9 L329.1 126.2 L331.0 128.5 L332.9 130.7 L334.8 132.9 L336.7 135.1 L338.6 137.3 L340.5 139.4 L342.4 141.5 L344.3 143.5 L346.2 145.6 L348.1 147.6 L350.0 149.5 L351.9 151.5 L353.8 153.4 L355.7 155.3 L357.6 157.1 L359.5 159.0 L361.4 160.8 L363.3 162.6 L365.2 164.3 L367.1 166.1 L369.0 167.8 L370.9 169.5 L372.8 171.1 L374.7 172.8 L376.6 174.4 L378.5 176.0 L380.4 177.6 L382.3 179.2 L384.2 180.7 L386.1 182.2 L388.0 183.8 L389.9 185.2 L391.8 186.7 L393.7 188.2 L395.6 189.6 L397.5 191.0 L399.4 192.4 L401.3 193.8 L403.2 195.2 L405.1 196.5 L407.0 197.8 L408.9 199.2 L410.8 200.5 L412.7 201.8 L414.6 203.0 L416.5 204.3 L418.4 205.5 L420.3 206.8 L422.2 208.0 L424.1 209.2 L426.0 210.4 L427.9 211.5 L429.8 212.7 L431.7 213.9 L433.6 215.0 L435.5 216.1 L437.4 217.2 L439.3 218.3 L441.2 219.4 L443.1 220.5 L445.0 221.6 L446.9 222.6 L448.8 223.7 L450.7 224.7 L452.6 225.7 L454.5 226.8 L456.4 227.8 L458.3 228.7 L460.2 229.7 L462.1 230.7 L464.0 231.7" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="279.9" y="32">c_W = 2</text>
<path d="M388.0 40.0 L389.9 49.3 L391.8 58.3 L393.7 66.7 L395.6 74.8 L397.5 82.6 L399.4 90.0 L401.3 97.1 L403.2 103.9 L405.1 110.4 L407.0 116.7 L408.9 122.7 L410.8 128.5 L412.7 134.0 L414.6 139.4 L416.5 144.5 L418.4 149.5 L420.3 154.3 L422.2 159.0 L424.1 163.4 L426.0 167.8 L427.9 172.0 L429.8 176.0 L431.7 179.9 L433.6 183.8 L435.5 187.4 L437.4 191.0 L439.3 194.5 L441.2 197.8 L443.1 201.1 L445.0 204.3 L446.9 207.4 L448.8 210.4 L450.7 213.3 L452.6 216.1 L454.5 218.9 L456.4 221.6 L458.3 224.2 L460.2 226.8 L462.1 229.2 L464.0 231.7" fill="none" stroke="var(--clay)" stroke-width="2"/>
<text class="small accent" x="392" y="32">c_W = 5</text>
<text class="mid b accent" x="437.4" y="86">Answer</text>
<text class="mid" fill="var(--muted)" x="243.6" y="193.333">Refuse</text>
<text class="small" x="484" y="62">Costs: refuse present target = 1,</text>
<text class="small" x="484" y="82">hallucinate absent box = 1,</text>
<text class="small" x="484" y="102">wrong box = c_W.</text>
<text class="small" x="484" y="142">Answer if and only if</text>
<text class="small b" x="484" y="162">P(pres)·[2 − c_W·(1 − P(acc))] &gt; 1</text>
<text class="small" x="484" y="202">Larger c_W pushes curve right:</text>
<text class="small" x="484" y="222">at c_W = 5, if P(acc) &lt; 0.8,</text>
<text class="small" x="484" y="242">refuse even when P(pres) = 1.</text>
</svg>
<svg viewBox="0 0 340 500">
<rect class="panel" x="0" y="0" width="340" height="500" rx="12"/>
<path d="M264.0 32.0 L264.0 32.0 L265.3 40.9 L266.6 49.5 L267.9 57.6 L269.2 65.3 L270.5 72.7 L271.8 79.8 L273.1 86.6 L274.4 93.1 L275.7 99.3 L277.0 105.3 L278.3 111.1 L279.6 116.6 L280.9 121.9 L282.2 127.1 L283.5 132.0 L284.8 136.8 L286.1 141.4 L287.4 145.8 L288.7 150.1 L290.0 154.2 L291.3 158.2 L292.6 162.1 L293.9 165.9 L295.2 169.5 L296.5 173.0 L297.8 176.4 L299.1 179.8 L300.4 183.0 L301.7 186.1 L303.0 189.1 L304.3 192.1 L305.6 195.0 L306.9 197.8 L308.2 200.5 L309.5 203.1 L310.8 205.7 L312.1 208.2 L313.4 210.6 L314.7 213.0 L316.0 215.3 L316.0 32.0 Z" fill="var(--clay-wash)" stroke="none"/>
<line x1="56.0" y1="32" x2="56.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="56" y="266">0</text>
<line x1="121.0" y1="32" x2="121.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="121" y="266">0.25</text>
<line x1="186.0" y1="32" x2="186.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="186" y="266">0.5</text>
<line x1="251.0" y1="32" x2="251.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="251" y="266">0.75</text>
<line x1="316.0" y1="32" x2="316.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="316" y="266">1</text>
<line x1="56" y1="252.0" x2="316" y2="252.0" stroke="var(--grid)"/>
<text class="small end" x="50" y="252">0.4</text>
<line x1="56" y1="178.7" x2="316" y2="178.7" stroke="var(--grid)"/>
<text class="small end" x="50" y="178.667">0.6</text>
<line x1="56" y1="105.3" x2="316" y2="105.3" stroke="var(--grid)"/>
<text class="small end" x="50" y="105.333">0.8</text>
<line x1="56" y1="32.0" x2="316" y2="32.0" stroke="var(--grid)"/>
<text class="small end" x="50" y="32">1</text>
<text class="small mid" x="186" y="286">P(accurate box): P(IoU ≥ 0.5)</text>
<text class="small mid" x="30" y="142" transform="rotate(-90 30 142.0)">P(present)</text>
<line x1="56" y1="215.3" x2="316" y2="215.3" stroke="var(--muted)" stroke-dasharray="4 3"/>
<text class="small" x="64" y="227.333">Presence only: answer if P(present) &gt; 0.5</text>
<path d="M56.0 32.0 L57.3 33.8 L58.6 35.6 L59.9 37.4 L61.2 39.2 L62.5 40.9 L63.8 42.7 L65.1 44.4 L66.4 46.1 L67.7 47.8 L69.0 49.5 L70.3 51.1 L71.6 52.8 L72.9 54.4 L74.2 56.0 L75.5 57.6 L76.8 59.2 L78.1 60.7 L79.4 62.3 L80.7 63.8 L82.0 65.3 L83.3 66.8 L84.6 68.3 L85.9 69.8 L87.2 71.3 L88.5 72.7 L89.8 74.2 L91.1 75.6 L92.4 77.0 L93.7 78.4 L95.0 79.8 L96.3 81.2 L97.6 82.6 L98.9 83.9 L100.2 85.3 L101.5 86.6 L102.8 87.9 L104.1 89.2 L105.4 90.5 L106.7 91.8 L108.0 93.1 L109.3 94.4 L110.6 95.6 L111.9 96.9 L113.2 98.1 L114.5 99.3 L115.8 100.6 L117.1 101.8 L118.4 103.0 L119.7 104.2 L121.0 105.3 L122.3 106.5 L123.6 107.7 L124.9 108.8 L126.2 110.0 L127.5 111.1 L128.8 112.2 L130.1 113.3 L131.4 114.4 L132.7 115.5 L134.0 116.6 L135.3 117.7 L136.6 118.8 L137.9 119.8 L139.2 120.9 L140.5 121.9 L141.8 123.0 L143.1 124.0 L144.4 125.0 L145.7 126.1 L147.0 127.1 L148.3 128.1 L149.6 129.1 L150.9 130.0 L152.2 131.0 L153.5 132.0 L154.8 133.0 L156.1 133.9 L157.4 134.9 L158.7 135.8 L160.0 136.8 L161.3 137.7 L162.6 138.6 L163.9 139.5 L165.2 140.5 L166.5 141.4 L167.8 142.3 L169.1 143.1 L170.4 144.0 L171.7 144.9 L173.0 145.8 L174.3 146.7 L175.6 147.5 L176.9 148.4 L178.2 149.2 L179.5 150.1 L180.8 150.9 L182.1 151.8 L183.4 152.6 L184.7 153.4 L186.0 154.2 L187.3 155.0 L188.6 155.8 L189.9 156.6 L191.2 157.4 L192.5 158.2 L193.8 159.0 L195.1 159.8 L196.4 160.6 L197.7 161.3 L199.0 162.1 L200.3 162.9 L201.6 163.6 L202.9 164.4 L204.2 165.1 L205.5 165.9 L206.8 166.6 L208.1 167.3 L209.4 168.1 L210.7 168.8 L212.0 169.5 L213.3 170.2 L214.6 170.9 L215.9 171.6 L217.2 172.3 L218.5 173.0 L219.8 173.7 L221.1 174.4 L222.4 175.1 L223.7 175.8 L225.0 176.4 L226.3 177.1 L227.6 177.8 L228.9 178.4 L230.2 179.1 L231.5 179.8 L232.8 180.4 L234.1 181.1 L235.4 181.7 L236.7 182.3 L238.0 183.0 L239.3 183.6 L240.6 184.2 L241.9 184.9 L243.2 185.5 L244.5 186.1 L245.8 186.7 L247.1 187.3 L248.4 187.9 L249.7 188.5 L251.0 189.1 L252.3 189.7 L253.6 190.3 L254.9 190.9 L256.2 191.5 L257.5 192.1 L258.8 192.7 L260.1 193.3 L261.4 193.8 L262.7 194.4 L264.0 195.0 L265.3 195.5 L266.6 196.1 L267.9 196.6 L269.2 197.2 L270.5 197.8 L271.8 198.3 L273.1 198.8 L274.4 199.4 L275.7 199.9 L277.0 200.5 L278.3 201.0 L279.6 201.5 L280.9 202.1 L282.2 202.6 L283.5 203.1 L284.8 203.6 L286.1 204.1 L287.4 204.7 L288.7 205.2 L290.0 205.7 L291.3 206.2 L292.6 206.7 L293.9 207.2 L295.2 207.7 L296.5 208.2 L297.8 208.7 L299.1 209.2 L300.4 209.7 L301.7 210.1 L303.0 210.6 L304.3 211.1 L305.6 211.6 L306.9 212.1 L308.2 212.5 L309.5 213.0 L310.8 213.5 L312.1 213.9 L313.4 214.4 L314.7 214.9 L316.0 215.3" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="61.3" y="24">c_W = 1</text>
<path d="M186.0 32.0 L187.3 35.6 L188.6 39.2 L189.9 42.7 L191.2 46.1 L192.5 49.5 L193.8 52.8 L195.1 56.0 L196.4 59.2 L197.7 62.3 L199.0 65.3 L200.3 68.3 L201.6 71.3 L202.9 74.2 L204.2 77.0 L205.5 79.8 L206.8 82.6 L208.1 85.3 L209.4 87.9 L210.7 90.5 L212.0 93.1 L213.3 95.6 L214.6 98.1 L215.9 100.6 L217.2 103.0 L218.5 105.3 L219.8 107.7 L221.1 110.0 L222.4 112.2 L223.7 114.4 L225.0 116.6 L226.3 118.8 L227.6 120.9 L228.9 123.0 L230.2 125.0 L231.5 127.1 L232.8 129.1 L234.1 131.0 L235.4 133.0 L236.7 134.9 L238.0 136.8 L239.3 138.6 L240.6 140.5 L241.9 142.3 L243.2 144.0 L244.5 145.8 L245.8 147.5 L247.1 149.2 L248.4 150.9 L249.7 152.6 L251.0 154.2 L252.3 155.8 L253.6 157.4 L254.9 159.0 L256.2 160.6 L257.5 162.1 L258.8 163.6 L260.1 165.1 L261.4 166.6 L262.7 168.1 L264.0 169.5 L265.3 170.9 L266.6 172.3 L267.9 173.7 L269.2 175.1 L270.5 176.4 L271.8 177.8 L273.1 179.1 L274.4 180.4 L275.7 181.7 L277.0 183.0 L278.3 184.2 L279.6 185.5 L280.9 186.7 L282.2 187.9 L283.5 189.1 L284.8 190.3 L286.1 191.5 L287.4 192.7 L288.7 193.8 L290.0 195.0 L291.3 196.1 L292.6 197.2 L293.9 198.3 L295.2 199.4 L296.5 200.5 L297.8 201.5 L299.1 202.6 L300.4 203.6 L301.7 204.7 L303.0 205.7 L304.3 206.7 L305.6 207.7 L306.9 208.7 L308.2 209.7 L309.5 210.6 L310.8 211.6 L312.1 212.5 L313.4 213.5 L314.7 214.4 L316.0 215.3" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="191.3" y="24">c_W = 2</text>
<path d="M264.0 32.0 L265.3 40.9 L266.6 49.5 L267.9 57.6 L269.2 65.3 L270.5 72.7 L271.8 79.8 L273.1 86.6 L274.4 93.1 L275.7 99.3 L277.0 105.3 L278.3 111.1 L279.6 116.6 L280.9 121.9 L282.2 127.1 L283.5 132.0 L284.8 136.8 L286.1 141.4 L287.4 145.8 L288.7 150.1 L290.0 154.2 L291.3 158.2 L292.6 162.1 L293.9 165.9 L295.2 169.5 L296.5 173.0 L297.8 176.4 L299.1 179.8 L300.4 183.0 L301.7 186.1 L303.0 189.1 L304.3 192.1 L305.6 195.0 L306.9 197.8 L308.2 200.5 L309.5 203.1 L310.8 205.7 L312.1 208.2 L313.4 210.6 L314.7 213.0 L316.0 215.3" fill="none" stroke="var(--clay)" stroke-width="2"/>
<text class="small accent" x="268" y="24">c_W = 5</text>
<text class="small end b accent" x="312" y="50">Answer</text>
<text class="mid" fill="var(--muted)" x="165.2" y="178.667">Refuse</text>
<text class="small" x="16" y="334">Costs: refuse present target = 1,</text>
<text class="small" x="16" y="356">hallucinate box = 1, wrong box = c_W.</text>
<text class="small" x="16" y="378">Answer if and only if</text>
<text class="small b" x="16" y="400">P(pres)·[2 − c_W·(1 − P(acc))] &gt; 1</text>
<text class="small" x="16" y="422">At c_W = 5, if P(acc) &lt; 0.8, refuse</text>
<text class="small" x="16" y="444">no matter how sure it is present.</text>
</svg>
```

On the controlled-experiment models (gRefCOCO val plus RefCOCO val, where 45% of expressions are absent), we calibrated Glance and the digits head the exact same way and plugged both into the same decision rule, without tuning any threshold on the evaluation set:

```echarts title="Expected cost per query: the costlier a wrong box, the more the second dial saves" note="Cost ×100, with false rejection and hallucination both costing 1; gated model and digits head from the controlled experiment, identically calibrated." height="300"
{"tooltip": {"trigger": "axis"}, "grid": {"left": 4, "right": 148, "top": 20, "bottom": 44}, "xAxis": {"type": "value", "min": 0, "max": 5, "interval": 1, "name": "Cost of a wrong box c_W", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "min": 6, "max": 21, "interval": 3}, "series": [{"name": "Two dials", "type": "line", "showSymbol": true, "symbolSize": 7, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "endLabel": {"show": true, "formatter": "{a} {@[1]}", "color": "var(--clay)", "textBorderColor": "transparent"}, "data": [[0, 7.06], [1, 9.16], [2, 10.75], [5, 14.06]]}, {"name": "Presence only", "type": "line", "showSymbol": true, "symbolSize": 6, "itemStyle": {"color": "var(--stone)"}, "endLabel": {"show": true, "formatter": "{a} {@[1]}", "color": "var(--muted)", "textBorderColor": "transparent", "offset": [0, 8]}, "data": [[0, 7.06], [1, 9.32], [2, 11.59], [5, 18.38]]}, {"name": "Generative", "type": "line", "showSymbol": true, "symbolSize": 6, "itemStyle": {"color": "var(--sky)"}, "lineStyle": {"type": "dashed"}, "endLabel": {"show": true, "formatter": "{a} {@[1]}", "color": "var(--sky)", "textBorderColor": "transparent", "offset": [0, -8]}, "data": [[0, 6.95], [1, 9.52], [2, 12.0], [5, 18.74]]}]}
```

When a wrong box is free ($c_W = 0$), all three tie, with the generative head slightly ahead (6.95 vs. 7.06, confidence interval includes 0). The higher the cost of a wrong box, the more the second dial saves: at $c_W = 5$, Glance's expected cost per query is 14.06 versus 18.38 for using presence alone—a 24% reduction; against the identically calibrated two-score generative head at 18.74, it saves 25%. The generative head's second score barely helps at all (18.74 vs. 19.51 with a single score), because its box-accuracy signal can't tell right boxes from wrong ones in the first place. In a scenario closer to the training prior (25% absent queries), with thresholds tuned on a calibration split from the training distribution, using two dials reduces expected cost relative to presence-only by 4%, 13%, and 33% at $c_W = 1, 2, 5$.

### Making Probabilities Tell the Truth: A Training-Free Fix

For two dials to be used directly as thresholds, their probabilities have to be well calibrated. Out of the box, v1's box confidence had an ECE of 1.8–5.0% across the 8 RefCOCO splits. One reason is prior shift: during training, nearly 30% of natural-image queries were absent, whereas in RefCOCO 0% are absent, causing the model to systematically overestimate the probability of “not present.”

Fixing this requires no retraining. First we fit Platt scaling on held-out data from the training distribution; then we run EM on unlabeled model outputs at deployment time to estimate the fraction of present queries (on RefCOCO it estimates 0.999) and shift the logits accordingly. Across all 8 splits, ECE drops to 0.6–1.6%. Because gRefCOCO val already has over a third absent expressions—close to the training prior—the gain there is smaller (3.8% → 3.2%).

### Turning Probabilities into Guarantees

A calibrated score can be turned into a switch with a statistical guarantee: set the threshold on one half of the images to guarantee that on the other half, the error rate among answered queries does not exceed 5% (at 90% confidence). The fraction of queries the model is allowed to answer is its coverage. Here an error counts boxing an absent object, drawing an inaccurate box, or clicking the wrong spot. Comparing P(present) alone against P(present) × P(accurate box):

```echarts title="How many queries can be answered while keeping the error rate ≤ 5%" note="v1; threshold calibrated on half the images and evaluated on the other half, averaged over multiple splits; nominal confidence 90%." height="250"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "legend": {"data": ["P(present) only", "P(present) × P(acc)"]}, "grid": {"left": 4, "right": 56, "top": 36, "bottom": 28}, "xAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "inverse": true, "axisTick": {"show": false}, "data": ["RefCOCO val", "gRefCOCO val", "ScreenSpot-v2"]}, "series": [{"name": "P(present) only", "type": "bar", "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "formatter": "{c}%", "fontSize": 10.5}, "data": [83.4, 0.2, {"value": 4, "label": {"formatter": "4.0%"}}]}, {"name": "P(present) × P(acc)", "type": "bar", "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "formatter": "{c}%", "fontSize": 10.5}, "data": [93.8, 39.5, 50.4]}]}
```

On gRefCOCO and ScreenSpot-v2, relying on presence alone certifies almost zero queries you can safely answer: P(present) is blind to localization errors where the target is present but the box lands in the wrong place. Adding the second dial certifies 40–50% coverage at the same 5% error cap (though on the harder gRefCOCO testB split, neither certifies nonzero coverage). On difficult GUI benchmarks like VenusBench, neither score certifies any coverage yet—our “not present” signal on GUIs is still not sharp enough, as we discuss below.

## Surprise 2: What Makes “Not There” Trustworthy Is Data, Not Scale

The controlled experiments above also yielded a corollary: **hallucination is governed primarily by the fraction of negative examples in the training data, largely independent of the output head.** Cutting absent queries during training from 25% down to 5% raises the false-box rate on no-target expressions by about 11 percentage points across all three readouts, the presence gate included.

```echarts title="Cutting negative examples from 25% to 5% adds ~11 points of hallucination across all three readouts" height="280" note="Hollow dots: the 5%-negatives model after shifting logits back to the 25% training prior."
{"tooltip": {"trigger": "item"}, "legend": {"data": ["25% negatives", "5% negatives", "5% + prior shift"]}, "grid": {"left": 4, "right": 50, "top": 56, "bottom": 40}, "xAxis": {"type": "value", "min": 15, "max": 40, "name": "False-box rate (%)", "nameLocation": "middle", "nameGap": 26, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "data": ["Gated", "Digits · thresh", "Digits · greedy"], "inverse": true, "axisTick": {"show": false}}, "series": [{"type": "bar", "stack": "d", "silent": true, "itemStyle": {"color": "transparent"}, "data": [24.3, 24.2, 22.0], "tooltip": {"show": false}}, {"type": "bar", "stack": "d", "silent": true, "barWidth": 3, "itemStyle": {"color": "var(--line)"}, "data": [11.4, 10.8, 10.8], "tooltip": {"show": false}}, {"name": "25% negatives", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--stone)"}, "z": 3, "label": {"show": true, "position": "top", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["24.3", 0], ["24.2", 1], ["22.0", 2]], "tooltip": {"formatter": "{a}: {@[0]}%"}}, {"name": "5% negatives", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--clay)"}, "z": 4, "label": {"show": true, "position": "right", "formatter": "{@[0]}%", "color": "var(--ink)", "textBorderColor": "transparent"}, "data": [["35.7", 0], ["35.0", 1], ["32.8", 2]], "tooltip": {"formatter": "{a}: {@[0]}%"}}, {"name": "5% + prior shift", "type": "scatter", "symbolSize": 10, "itemStyle": {"color": "var(--paper)", "borderColor": "var(--clay)", "borderWidth": 2}, "z": 5, "label": {"show": true, "position": "bottom", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["27.3", 0], ["24.6", 1]], "tooltip": {"formatter": "{a}: {@[0]}%"}}]}
```

When the prior changes, you can correct for it after the fact by shifting the logits (the hollow dots in the chart): the gated head drops from 35.7% back to 27.3%, and applying the exact same shift to the digits head's P(none) threshold drops it to 24.6%—so the gate has no edge here either, while greedy decoding has no threshold to shift. That pushed our focus squarely back onto the data.

Our first version (v0) was trained exclusively on the COCO family: RefCOCO, RefCOCO+, RefCOCOg, the no-target expressions from gRefCOCO[@grefcoco], plus expressions borrowed from other images as easy negatives—24,462 images and 355,385 queries in total. Its boxes were sharp, averaging 92.8 Acc@0.5 across the 8 RefCOCO evaluation splits. Yet it was overconfident on genuinely hard negatives: gRefCOCO's no-target expressions look like “there is a dog in the image, just not ‘the white dog on the left,’” and v0 correctly said “not present” on only 77.0% of them.

Retraining on the exact same data with a much larger Qwen3.8-27B base model made the boxes even sharper (averaging 94.1), while “not present” barely budged. What made it move was the data recipe in v1: adding GUI screenshots, PixMo pointing and counting data, and deliberately constructing **hard negatives**—things that exist in the same image or domain but fail to match the description (for GUIs, button names from the same class of software that don't appear on the current screen).

```data title="Adding hard negatives is what made “not present” trustworthy" bars="N-acc" mark="v1 4B"
Model | N-acc | AUROC | ECE
v0 4B | 77.0 | 0.964 | 0.075
v0 27B | 77.5 | 0.968 | 0.074
v1 4B | 87.4 | 0.979 | 0.024
```

N-acc is the percentage of gRefCOCO val no-target expressions correctly called “not present”; AUROC and ECE evaluate the presence gate across gRefCOCO val plus RefCOCO val (25,063 expressions total). Note that the 27B run used Qwen3.8-27B, so model scale and base model version changed together.

The exact same story played out on GUIs. After training v0 on COCO, evaluating it on ScreenSpot-v2[@screenspotv2] gave just 28.6, compared with 93.4 for the generative base model. At first we blamed resolution: v0 used at most 640 visual tokens. Yet raising v0's visual token budget to 4,000 on ScreenSpot-Pro[@screenspotpro] only moved it from 0.9% to 1.8%. The newly added box head had only ever seen natural-image objects; resolution wasn't the culprit. Once v1 added GUI screenshots to the training mix, ScreenSpot-v2 jumped right back to 89.4.

### We Accidentally Taught It a Shortcut

v1 looked great on standard benchmarks—until a human phrased the question differently. For each target in a validation subset, we wrote several phrasings: the original expression, a Chinese translation, a paraphrase, a function-only description (“something that holds a hot drink”), and a hypernym-only description (“that appliance”), pairing every phrasing with a verified “not present” counterpart. Original, Chinese, and paraphrased queries worked fine; on function-only and hypernym-only queries, however, v1 called 19% of present targets “not present,” compared with just 3–8% for the generative base model. On a separate independently written set, vague relational descriptions (“the one next to the table”) were falsely rejected even more often, reaching 40%.

The culprit was inside v1's negative examples. Our “easy negatives” were descriptions borrowed from other images on the condition that their object category didn't appear in the current image; our hard negatives were mostly the same category with a swapped color word. Both types of negative examples hinged on a single mismatched word: a category noun or a color adjective. So the model learned a shortcut: if any keyword in the prompt has no match in the image, say “not present.” And to a model looking for a category noun, a sentence that doesn't mention a category noun at all looks like it has a missing noun.

```sketch title="The negatives we gave the model could be spotted by a single mismatched word" note="Examples drawn from the two negative types in v1."
<svg viewBox="0 0 704 266">
<rect class="panel" x="0" y="0" width="704" height="266" rx="12"/>
<text class="caps" x="24" y="28">Negatives in training</text>
<text class="caps" x="264" y="28">Rule it learned</text>
<text class="caps" x="484" y="28">When given a nounless query</text>
<g class="node plain"><rect x="24" y="48" width="200" height="34" rx="4"/><text class="mid mono" x="124" y="65">a red bicycle</text></g>
<text class="small" x="24" y="96">Borrowed: no bicycle in image</text>
<g class="node plain"><rect x="24" y="116" width="200" height="34" rx="4"/><text class="mid mono" x="124" y="133">the gray cat</text></g>
<text class="small" x="24" y="164">Swapped color: cat is there, not gray</text>
<g class="node violet"><rect x="254" y="70" width="200" height="70" rx="4"/><text class="mid" x="354" y="92">A word has no match</text><text class="mid" x="354" y="118">in the image ⇒ absent</text></g>
<path class="edge" d="M224 65 H240 V105 H250" marker-end="url(#arrow)"/>
<path class="edge" d="M224 133 H240 V105"/>
<g class="node plain"><rect x="484" y="48" width="196" height="34" rx="4"/><text class="mid mono" x="582" y="65">something to drink from</text></g>
<text class="small" x="484" y="96">Cup is on table, but no word “cup”</text>
<path class="edge hot" d="M454 105 H470 V65 H480" marker-end="url(#arrow)"/>
<path class="edge hot" d="M582 104 V118" marker-end="url(#arrow)"/>
<g class="node clay"><rect x="484" y="122" width="196" height="34" rx="17"/><text class="mid" x="582" y="139">Says “absent”: 19%</text></g>
<g class="node teal"><rect x="24" y="202" width="656" height="40" rx="4"/><text class="mid" x="352" y="222">Fix: pair functional/hypernym queries with absent cases so missing nouns stop leaking</text></g>
</svg>
<svg viewBox="0 0 340 426">
<rect class="panel" x="0" y="0" width="340" height="426" rx="12"/>
<text class="caps" x="16" y="20">Negatives in training</text>
<g class="node plain"><rect x="16" y="38" width="150" height="30" rx="4"/><text class="mid mono" x="91" y="53">a red bicycle</text></g>
<g class="node plain"><rect x="174" y="38" width="150" height="30" rx="4"/><text class="mid mono" x="249" y="53">the gray cat</text></g>
<text class="small" x="16" y="82">Borrowed: no bike</text>
<text class="small" x="174" y="82">Swapped color</text>
<path class="edge" d="M170 92 V112" marker-end="url(#arrow)"/>
<text class="caps" x="16" y="130">Rule it learned</text>
<g class="node violet"><rect x="16" y="144" width="308" height="34" rx="4"/><text class="mid" x="170" y="161">Unmatched word in image ⇒ absent</text></g>
<path class="edge hot" d="M170 178 V198" marker-end="url(#arrow)"/>
<text class="caps" x="16" y="216">When given a nounless query</text>
<g class="node plain"><rect x="16" y="230" width="308" height="30" rx="4"/><text class="mid mono" x="170" y="245">something to drink from</text></g>
<text class="small" x="16" y="274">Cup is on table, but no word “cup”</text>
<path class="edge hot" d="M170 282 V296" marker-end="url(#arrow)"/>
<g class="node clay"><rect x="16" y="300" width="308" height="30" rx="15"/><text class="mid" x="170" y="315">Says “absent”: 19%</text></g>
<g class="node teal"><rect x="16" y="348" width="308" height="56" rx="4"/><text class="mid" x="170" y="366">Fix: pair functional &amp; hypernym queries</text><text class="mid" x="170" y="388">with absent versions so nouns don't leak</text></g>
</svg>
```

A corroborating piece of evidence: on verified “not present” function-only descriptions, that same v1 model got 99.2% right. It wasn't judging whether the object was there—it was judging whether the sentence contained a concrete noun it recognized.

The fix is to block the shortcut: add function-only and hypernym-only descriptions to training, **each paired with a verified “not present” counterpart**, so the absence of a concrete noun no longer leaks the answer; and add a consistency loss pulling together the presence gates and boxes across different phrasings of the same target.

```echarts title="Accuracy on present targets when described only by function or hypernym" note="Acc@0.5, requiring P(present) ≥ 0.5; “novel” counts only phrasings never seen in training." height="340"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "legend": {"data": ["Generative base", "v1", "v1 + fix"]}, "grid": {"left": 4, "right": 48, "top": 40, "bottom": 28}, "xAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "inverse": true, "axisTick": {"show": false}, "data": ["Function", "Hypernym", "Function (novel)", "Hypernym (novel)"]}, "series": [{"name": "Generative base", "type": "bar", "barGap": "18%", "barCategoryGap": "34%", "itemStyle": {"color": "var(--sky)"}, "label": {"show": true, "color": "var(--muted)", "textBorderColor": "transparent", "position": "right", "fontSize": 10, "formatter": "{c}%"}, "data": [{"value": 79, "label": {"formatter": "79.0%"}}, 53.8, 78.9, {"value": 50, "label": {"formatter": "50.0%"}}]}, {"name": "v1", "type": "bar", "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "fontSize": 10, "formatter": "{c}%"}, "data": [59.2, 43.5, 58.4, 40.2]}, {"name": "v1 + fix", "type": "bar", "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "fontSize": 10, "formatter": "{c}%"}, "data": [83.3, 69.8, 83.5, 62.7]}]}
```

On function-only queries, box accuracy jumps from 59.2% to 83.3% while false rejection drops from 19.2% to 3.0%; on hypernym-only queries, accuracy jumps from 43.5% to 69.8% while false rejection drops from 19.0% to 2.2%. The share of targets where the model gets every single phrasing right climbs from 24.3% to 63.0%, surpassing the generative base model. That gain isn't completely free: true rejection on absent queries dips by 2–4 points (gRefCOCO N-acc goes from 87.3 to 85.2), though on absent function-only descriptions it still gets 98.7% right, whereas the generative base model gets only 63.5% of absent descriptions right. On novel sentences never seen during training, the improvement is nearly as large. Scores on RefCOCO, GUI benchmarks, and OpenDecisions stay level with the control. Training only the output head while freezing LoRA recovers only a fraction of the gap (65.0% on function-only queries)—the shortcut lives in the backbone's representations, not just in the head.

### A 1.83-Million-Question Checkup

Once you patch one shortcut, the natural next question is how many more are hiding. Teammates in our group built a much larger dataset, Glance-Data: 24,406 COCO images and 1.83 million questions. Every ground-truth answer is computed programmatically from annotations (boxes, counts, and presence are exact), while an LLM is only responsible for phrasing the questions naturally; in a manual audit of 112 items, 101 were completely error-free. It comes with a 300-image, 23,578-question diagnostic suite—half Chinese, half English—which gave us a comprehensive checkup of v1:

```echarts title="v1 on the Glance-Data diagnostic suite, by question type" note="English subset; “Unique object + spatial” is our supplemental set (382 queries each in EN and ZH). Present queries report Acc@0.5 (requiring P(present) ≥ 0.5); “Absent · …” rows report true rejection rate." height="400"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "grid": {"left": 4, "right": 48, "top": 8, "bottom": 28}, "xAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "inverse": true, "axisTick": {"show": false}, "data": ["Short desc", "Medium desc", "Long desc", "Colloquial", "Category only", "Function only", "Unique + spatial", "Absent · near cat.", "Absent · wrong pos.", "Absent · wrong count", "Absent · wrong attr.", "Absent · wrong rel."]}, "series": [{"type": "bar", "barWidth": 14, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "formatter": "{c}%", "fontSize": 10}, "data": [{"value": 78.2, "itemStyle": {"color": "var(--stone)"}}, {"value": 81.4, "itemStyle": {"color": "var(--stone)"}}, {"value": 81.8, "itemStyle": {"color": "var(--stone)"}}, {"value": 79.6, "itemStyle": {"color": "var(--stone)"}}, {"value": 55.2, "itemStyle": {"color": "var(--stone)"}}, {"value": 44.9, "itemStyle": {"color": "var(--clay)"}}, {"value": 24.6, "itemStyle": {"color": "var(--clay)"}}, {"value": 95.3, "itemStyle": {"color": "var(--stone)"}}, {"value": 90.7, "itemStyle": {"color": "var(--stone)"}}, {"value": 69.0, "itemStyle": {"color": "var(--stone)"}, "label": {"formatter": "69.0%"}}, {"value": 68.4, "itemStyle": {"color": "var(--stone)"}}, {"value": 40.7, "itemStyle": {"color": "var(--clay)"}}]}]}
```

Everyday descriptions—short, long, or colloquial—all sit at 78–82%. Three weak spots stand out: function-only descriptions (44.9%, the shortcut from the previous section); relation-mismatched absent queries, where true rejection is only 40.7% (30.1% in Chinese); and weirdest of all, **a unique object paired with a spatial term**, at just 24.6%.

We verified that last failure mode separately on COCO images: when there is only a single cat in the image and you ask for “the leftmost cat,” v1 calls it “not present” 86.5% of the time—even though its predicted box lands right on the cat. Even a spatially true phrase like “the cat on the left” is falsely rejected 64% of the time. Again, the cause is in the data: in RefCOCO, spatial qualifiers only appear when there are same-category distractors to disambiguate against, so the model learned that “saying ‘leftmost’ implies there's more than one.” Glance-Data was missing this case too. We programmatically generated 63,190 positive examples of “unique object + spatial term,” balanced 1:1 with 63,198 “wrong spatial side” negatives so that the mere presence of a spatial word no longer biases the answer either way.

## Head-to-Head with Jev 1.14

Because Jev has no published bounding-box benchmarks, we ran a head-to-head evaluation ourselves: calling Jev 1.14 via OpenRouter on the exact same questions as Glance, and pairing every box query with a parallel yes/no presence question in the same request as recommended by Jev's documentation. Roughly 22,000 requests completed with zero failures for $11.

| Same evaluation set | Jev 1.14 | Glance v1 |
| --- | --- | --- |
| Box accuracy: average Acc@0.5 across 8 RefCOCO splits | 73.0 | **90.8** |
| Saying “not present” when target is absent (gRefCOCO, 8,905 queries) | 87.4 | 87.4 |
| True rejection of absent targets at 1% false rejection of present targets | 72.5 | **84.5** |
| Calibration of presence probability (ECE, lower is better) | 15.5 | **2.4** |
| Knowing when its own box is wrong (AUROC, RefCOCO val) | 75.7 | **90.1** |
| Separating present from absent on GUIs (VenusBench AUROC) | **90.2** | 73.8 |
| False acceptance when the count in the description is wrong | **1.3%** | 14.1% |
| Calling “the leftmost X” absent when only one X is in the image | **38%** | 86% |
| GUI clicking: ScreenSpot-v2 | 89.7 | 89.4 |
| Text decision-making: OpenDecisions capability | **80.9** | 67.7 |
| Latency: 1 / 8 / 32 questions on one image | 180 / 212 / 380 ms | 43 / 45 / 61 ms |

On natural images, raw rejection accuracy at the default threshold is identical, but the trade-off curve tells the real story: if you require the model to falsely reject only 1% of present objects, Jev catches 72.5% of absent targets while Glance catches 84.5%; Jev's raw probabilities also have a larger calibration gap (ECE 15.5), meaning you need to calibrate them yourself before using them to set thresholds. Glance's boxes are 18 points more accurate, and Glance knows when its own box is wrong. Conversely, Jev is clearly stronger in three places: presence separation on GUI screenshots, descriptions with mismatched counts, and spatial terms applied to a unique object—the latter two being the exact gaps uncovered by our Glance-Data checkup that v1.2 is addressing—while text decision-making is Jev's home turf. Jev slows down as you ask more questions per image whereas Glance stays nearly flat; note that Jev's latency was measured over the public OpenRouter API (including network overhead, where a nearly empty request takes 127 ms) while Glance was timed locally on a GPU, so only the scaling trend across 1 / 8 / 32 questions is directly comparable.

## Under Official Protocols: GREC and VenusBench

Most of the numbers above come from our own evaluation harness. For two benchmarks that have official scoring scripts and specifically test “not present,” we re-ran everything strictly under their official protocols.

**GREC**[@grec] is the detection counterpart to gRefCOCO. Its rule is strict: the model outputs all boxes with confidence ≥ 0.7, and a query is scored correct only if those boxes match every ground-truth target with F1 = 1 (Pr@F1=1); on no-target queries, not a single box may remain (N-acc). v1 achieves an N-acc of 91.4, 85.4, and 81.9 on val, testA, and testB. On val, this beats every published result we could find; on testA and testB it trails only CRS (87.3, 84.0), whose Pr@F1=1 is far lower than Glance's (56.3 vs. 71.6 on val).

```echarts title="GREC val: getting both “not present” and whole-query detection right" note="Numbers outside Glance are taken from the GREC technical report and the RC-GRPO paper." height="340"
{"tooltip": {"trigger": "item", "formatter": "{b}"}, "grid": {"left": 4, "right": 20, "top": 34, "bottom": 44}, "xAxis": {"type": "value", "min": 30, "max": 100, "name": "N-acc: zero boxes on no-target queries", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "min": 40, "max": 80, "name": "Pr@F1=1", "nameLocation": "end", "nameTextStyle": {"align": "left"}}, "series": [{"type": "scatter", "data": [{"name": "Glance v1", "value": [91.4, 71.6], "symbolSize": 14, "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "position": "bottom", "offset": [-4, 2], "formatter": "{b}", "color": "var(--ink)", "fontSize": 12, "textBorderColor": "transparent"}}, {"name": "RC-GRPO-II", "value": [85.3, 75.7], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "top", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "Qwen3-VL-4B", "value": [77.2, 72.4], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "bottom", "offset": [-22, 2], "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "CRS", "value": [89.5, 56.3], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "left", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "InstanceVG", "value": [72.8, 73.5], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "top", "offset": [-6, 0], "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "HieA2G", "value": [60.3, 67.8], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "left", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "Qwen3-VL-235B", "value": [65.7, 59.5], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "bottom", "offset": [8, 0], "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "UNINEXT", "value": [50.6, 58.2], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "top", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "MDETR", "value": [36.3, 42.7], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}]}]}
```

Glance's Pr@F1=1 (71.6) trails the top multi-box models by a few points for a simple reason: its head outputs at most one box per query. On single-target queries it gets 90.4% right, whereas on multi-target queries it gets 0% right because a single box can never achieve F1 = 1 against multiple ground-truth boxes. That is what our upcoming multi-box head is built to solve.

**VenusBench-GD**[@venusbench] is a cross-platform GUI grounding benchmark spanning mobile, web, and desktop, including 899 queries where the target is not on the screen at all. Scored faithfully with the official script (where saying “not present” forfeits any click coordinate), v1 gets 81.8% on refusal queries—higher than every model in the paper's table, though below our measurement of Jev (87.5%)—yet its overall score is only 40.1:

```data title="VenusBench-GD, official evaluation script" mark="Glance v1"
Model | Basic | Refusal | Overall
Glance v1 | 42.4 | 81.8 | 40.1
Glance v1.1 | 40.7 | 83.8 | 40.7
Qwen3-VL-4B | 72.5 | 31.6 | 56.2
Qwen3-VL-8B | 77.0 | 63.8 | 62.3
UI-Venus-Ground-7B | 68.7 | 0.0 | 49.0
UI-Venus-1.5-2B | 81.4 | 76.3 | 67.3
```

Nearly the entire gap is on present-target (Basic) queries, and a large chunk of it is self-inflicted by the presence gate: if we don't gate out clicks when P(present) < 0.5, v1's basic score is 60.4, which the gate cuts down to 42.4. In other words, on GUIs Glance is far too quick to call a present button “not present.” Its presence AUROC on GUIs is 73.8, versus 97.9 on natural images. This is currently its biggest weakness on GUIs, and as before, the cause lies in the data: v1's GUI negatives were simply “other button names from the same software domain that don't appear on this screen,” which were too easy. For comparison, reading the decision-token refusal probability from the same base model on GUIs (with the “say none” prompt) gives an AUROC of 0.73–0.78, no worse than Glance's 0.75; Glance's remaining edge on GUIs right now is not depending on prompt wording or logprob access.

### v1.1

v1.1 uses the same architecture on an expanded 810K-query training set with heavier GUI coverage:

```data title="From v1 to v1.1" mark="ScreenSpot-Pro zoom-in"
Benchmark | v1 | v1.1
RefCOCO 8-split average | 90.8 | 92.8
gRefCOCO val N-acc | 87.4 | 86.0
ScreenSpot-v2 | 89.4 | 89.2
ScreenSpot-Pro single pass | 29.3 | 46.8
ScreenSpot-Pro zoom-in | – | 59.9
VenusBench present click (our eval) | 47.3 | 55.2
VenusBench refusal (our eval) | 81.5 | 82.2
VenusBench overall (official) | 40.1 | 40.7
```

Boxes got sharper across the board, and high-resolution professional software screenshots improved substantially. Note that the two ScreenSpot-Pro numbers aren't a pure apples-to-apples comparison: v1 read screenshots with at most 2,048 visual tokens while v1.1 uses up to 4,096; “zoom-in” runs a first pass to get a coarse box, then crops a 40% window around it for a second pass. Even so, VenusBench's official overall score barely moved: clicks on present targets got more accurate, but the presence gate still blocks too many present buttons. Our Glance-Data checkup also caught a regression in v1.1 on wrong-count queries (where true rejection dropped from 69.0% to 49.1%).

### What v1.2 Is Doing

v1.2 is built specifically to fix the gaps exposed by the checkup and benchmarks above. It switches to the converted Glance-Data mix (1.89 million queries, providing every target's box on multi-target queries) plus our supplemental unique-object spatial positives, paired with a multi-box output head. The targets we've set for it: cut false rejection on unique-object + spatial queries from 64% to under 10% while keeping false acceptance on genuinely wrong spatial sides below 5%; hold steady on functional and relational phrasings; and reliably say “not present” when counts don't match.

## Taking It to Video

A bounding box that knows how to say “not present” turns a video into a time series: sample a frame every few seconds, ask “is the rabbit there?” or “is there a butterfly?”, and the intervals where $P(t)$ crosses the threshold tell you when it appears, while the number of connected intervals tells you how many times. Below are the first 8 minutes of *Big Buck Bunny* (0–476 s), sampled every 4 seconds for 120 frames in total. On every frame, a single forward pass asks 5 questions at once—4 box queries and 1 yes/no query—with the 4 box queries plotted below. “Flying squirrel” refers specifically to Frank the flying squirrel, excluding his two rodent sidekicks. The gray bars beneath each curve show our manual frame-by-frame ground-truth labels. Drag across the timeline to inspect any frame:

```widget src="../../widgets/glance/video.js" title="Presence over time becomes a curve" note="Video © 2008 Blender Foundation, www.bigbuckbunny.org, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/), frames downscaled."
../../images/glance/w-video-en.png | Static image: At the 2:16 frame, Glance boxes the rabbit (0.996), the butterfly (0.992), and the red squirrel in the upper left (flying squirrel 0.661); below are the four P(t) curves and manual ground-truth bars
../../images/glance/w-video-en-n.png | Same as above, mobile version
```

At a 0.5 threshold, agreement with our manual labels is 111/113 for the rabbit, 111/115 for the flying squirrel, and 115/118 for the butterfly, while “a red car” is never called present across all 120 frames. Ambiguous frames were excluded from the denominator; and because the annotator could see the model's predictions while labeling, these agreement numbers lean optimistic. Still, some apparent “false positives” turned out to be things we missed: on the opening title frame at 0:28, the model said there was a butterfly (0.99)—and zooming in revealed one actually perched on the title lettering.

Frame-by-frame scanning is a “many images, a few questions per image” workload—the prefill-dominated regime mentioned earlier where Glance has no latency edge over vLLM; what it contributes here is a calibrated presence probability on every frame. Even so, this is still an object detector answering frame by frame, and what actually trips up video agents is harder than that.

## Surprise 3: Video Agents Lose at Seeing

To figure out what Glance should provide as a tool for video agents, we first read the public execution traces of 21 agents across the 144 questions of Video-Index[@videoindex] v1.1. From the wrong or unanswered runs of the top four agents (Opus 5.5, Opus 5, Gemini 4 Argon, and GPT-6-Astra), we drew a stratified sample across agent × capability group—3 traces per cell, 48 traces in total—and labeled each trace against a pre-registered rubric. Perceptual failures (the first three rows) account for 27 of the 48 failures, or 56% (95% CI: 42%–69%; single annotator, so intervals are slightly optimistic).

```data title="Across 48 failed runs, more than half failed at seeing" bars="Share" mark="Misread frame"
Failure type | Share | Count
Misread frame | 43.8% | 21
Missed frame | 10.4% | 5
Wrong time window | 2.1% | 1
Reasoning or knowledge | 16.7% | 8
Timeout or harness error | 14.6% | 7
Questionable ground truth | 12.5% | 6
```

Pure reasoning errors accounted for only 8 failures. By far the largest category was **misreading the frame**: the agent found the right scene, then misidentified a color, miscounted repetitions, or read a direction backward. In the two examples below, the answers come directly from each agent's trace, and the notes are our annotations from reading the logs. Because Video-Index videos are licensed strictly for benchmark evaluation, no video frames are shown here.

```cases title="Found the right scene and misread it; or scanned 1,100 thumbnails and missed it" note="Public traces from Video-Index v1.1."
## ALLVB_2121 Movie · 87 min · Perception
tag: Misread frame
q: … a woman is seen tending to a wounded person and later crawling through the muddy terrain while holding a gun. … What is the color of the woman's shirt in the scene?
Answer | ok | (E) Purple
Claude Opus 5.5 | bad | (B) Red
Note | note | Found the exact right scene, but called the maroon shirt red; 9 of 21 agents picked Red
## ALLVB_429 Movie · 132 min · Spatial
tag: Missed frame
q: What is the movement path of the prescription Elizabeth receives from her doctor?
Answer | ok | (C) From the doctor's hand to the trash can outside the office
Claude Opus 5 | bad | (B) From the doctor's hand to Elizabeth's purse
Note | note | Scanned 1,100 shot thumbnails, missed the moment the prescription was thrown away, and concluded the doctor never appeared on screen
```

Telling “missed the frame” apart from “saw the frame and misread it” requires plotting exactly which timestamps the agent inspected. The counting question below comes from a 319-second first-person video asking “How many times did I point at the Lego box?” The ground-truth answer is 5, and only 4 of the 21 agents got it right. Gemini 4 Argon counted 3.

The dataset doesn't provide per-instance timestamps, so the 5 numbered markers in the diagram below come from GPT-6-Astra's correct trace, which explicitly reported “around 129, 132, 134, 232, and 249 seconds”; the dark outlines mark the 3 pointing intervals Argon wrote down. The colored bars plot the time span and frame rate of every frame-extraction command in each agent's trace (Codex traces don't log image-viewing events separately, so Astra's row reflects extracted frames rather than confirmed views). When you overlay them, both of the pointing events Argon missed fall squarely inside windows that Argon inspected at 6 frames per second: it looked right at them, and still miscounted. That is precisely the kind of question a per-clip $P(t)$ curve asking “is the hand pointing right now?” can answer directly.

```sketch title="Argon inspected both missed pointing events at high frame rate—it just didn't count them" note="S-EMBER_7291. Plotted from trace timestamps only; contains no video frames."
<svg viewBox="0 0 704 412">
<rect class="panel" x="0" y="0" width="704" height="412" rx="12"/>
<text class="small b" x="24" y="30">Full video · 319 s</text>
<line class="edge" x1="176" y1="144" x2="680" y2="144"/>
<line class="edge" x1="176" y1="141" x2="176" y2="147"/><text class="small mid" x="176" y="158">0 s</text>
<line class="edge" x1="334" y1="141" x2="334" y2="147"/><text class="small mid" x="334" y="158">100 s</text>
<line class="edge" x1="492" y1="141" x2="492" y2="147"/><text class="small mid" x="492" y="158">200 s</text>
<line class="edge" x1="650" y1="141" x2="650" y2="147"/><text class="small mid" x="650" y="158">300 s</text>
<text class="small" x="24" y="62">Events reported by correct agent</text>
<text x="24" y="92">Argon: answered 3</text>
<text x="24" y="120">Astra: answered 5 ✓</text>
<line x1="176" y1="92" x2="680" y2="92" stroke="var(--line)"/>
<rect x="176" y="89" width="504" height="6" rx="2" fill="var(--stone)"/>
<rect x="207.6" y="85" width="14.2" height="14" rx="2" fill="var(--blue)"/>
<rect x="376.7" y="85" width="25.3" height="14" rx="2" fill="var(--blue)"/>
<rect x="539.4" y="85" width="11.1" height="14" rx="2" fill="var(--blue)"/>
<rect x="567.8" y="85" width="9.5" height="14" rx="2" fill="var(--blue)"/>
<line x1="176" y1="120" x2="680" y2="120" stroke="var(--line)"/>
<rect x="176" y="117" width="504" height="6" rx="2" fill="var(--stone)"/>
<rect x="176" y="117" width="504" height="6" rx="2" fill="var(--stone)"/>
<rect x="378.2" y="113" width="22.1" height="14" rx="2" fill="var(--blue)"/>
<rect x="539.4" y="117" width="36.3" height="6" rx="2" fill="var(--stone)"/>
<rect x="378.5" y="83" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="383.3" y="83" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="568.9" y="83" width="5.2" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="379.8" y1="66" x2="379.8" y2="128" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="379.8" cy="62" r="3.5" fill="var(--teal)"/>
<line x1="384.6" y1="66" x2="384.6" y2="128" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="384.6" cy="62" r="3.5" fill="var(--teal)"/>
<line x1="387.7" y1="66" x2="387.7" y2="128" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="387.7" cy="62" r="3.5" fill="var(--clay)"/>
<line x1="542.5" y1="66" x2="542.5" y2="128" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="542.5" cy="62" r="3.5" fill="var(--clay)"/>
<line x1="569.4" y1="66" x2="569.4" y2="128" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="569.4" cy="62" r="3.5" fill="var(--teal)"/>

<text class="small b" x="24" y="210">Zoomed in: 120–145 s</text>
<line class="edge" x1="80" y1="324" x2="340" y2="324"/>
<line class="edge" x1="80" y1="321" x2="80" y2="327"/><text class="small mid" x="80" y="338">120 s</text>
<line class="edge" x1="204.8" y1="321" x2="204.8" y2="327"/><text class="small mid" x="204.8" y="338">132 s</text>
<line class="edge" x1="340" y1="321" x2="340" y2="327"/><text class="small mid" x="340" y="338">145 s</text>
<line x1="80" y1="270" x2="340" y2="270" stroke="var(--line)"/>
<rect x="80" y="267" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="152.8" y="263" width="166.4" height="14" rx="2" fill="var(--blue)"/>
<line x1="80" y1="300" x2="340" y2="300" stroke="var(--line)"/>
<rect x="80" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="80" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="163.2" y="293" width="145.6" height="14" rx="2" fill="var(--blue)"/>
<rect x="165.3" y="261" width="10.4" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="196.5" y="261" width="10.4" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="173.6" y1="246" x2="173.6" y2="308" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="173.6" cy="238" r="8"/><text class="mid" x="173.6" y="238" font-size="11">1</text></g>
<line x1="204.8" y1="246" x2="204.8" y2="308" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="204.8" cy="238" r="8"/><text class="mid" x="204.8" y="238" font-size="11">2</text></g>
<line x1="225.6" y1="246" x2="225.6" y2="308" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="225.6" cy="238" r="8"/><text class="mid" x="225.6" y="238" font-size="11">3</text></g>
<text class="small" x="24" y="270">Argon</text><text class="small" x="24" y="300">Astra</text>
<text class="small b" x="364" y="210">Zoomed in: 225–258 s</text>
<line class="edge" x1="420" y1="324" x2="680" y2="324"/>
<line class="edge" x1="420" y1="321" x2="420" y2="327"/><text class="small mid" x="420" y="338">225 s</text>
<line class="edge" x1="538.2" y1="321" x2="538.2" y2="327"/><text class="small mid" x="538.2" y="338">240 s</text>
<line class="edge" x1="680" y1="321" x2="680" y2="327"/><text class="small mid" x="680" y="338">258 s</text>
<line x1="420" y1="270" x2="680" y2="270" stroke="var(--line)"/>
<rect x="420" y="267" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="459.4" y="263" width="55.2" height="14" rx="2" fill="var(--blue)"/>
<rect x="601.2" y="263" width="47.3" height="14" rx="2" fill="var(--blue)"/>
<line x1="420" y1="300" x2="680" y2="300" stroke="var(--line)"/>
<rect x="420" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="420" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="459.4" y="297" width="181.2" height="6" rx="2" fill="var(--stone)"/>
<rect x="606.7" y="261" width="26" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="475.2" y1="246" x2="475.2" y2="308" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="475.2" cy="238" r="8"/><text class="mid" x="475.2" y="238" font-size="11">4</text></g>
<line x1="609.1" y1="246" x2="609.1" y2="308" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="609.1" cy="238" r="8"/><text class="mid" x="609.1" y="238" font-size="11">5</text></g>
<text class="small" x="364" y="270">Argon</text><text class="small" x="364" y="300">Astra</text>
<rect x="24" y="356" width="18" height="6" rx="2" fill="var(--stone)"/><text class="small" x="48" y="359">≤1 fps full-video scan</text>
<rect x="176" y="352" width="18" height="14" rx="2" fill="var(--blue)"/><text class="small" x="200" y="359">2–6 fps dense window</text>
<rect x="340" y="351" width="16" height="16" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/><text class="small" x="362" y="359">Pointing counted by Argon</text>
<circle cx="30" cy="386" r="5" fill="var(--teal)"/><text class="small" x="42" y="386">Reported by correct agent &amp; counted by Argon</text><circle cx="300" cy="386" r="5" fill="var(--clay)"/><text class="small" x="312" y="386">Inside Argon's dense window, yet missed</text>
</svg>
<svg viewBox="0 0 340 606">
<rect class="panel" x="0" y="0" width="340" height="606" rx="12"/>
<text class="small b" x="16" y="28">Full video · 319 s</text>
<line class="edge" x1="96" y1="138" x2="320" y2="138"/>
<line class="edge" x1="96" y1="135" x2="96" y2="141"/><text class="small mid" x="96" y="152">0 s</text>
<line class="edge" x1="201.3" y1="135" x2="201.3" y2="141"/><text class="small mid" x="201.3" y="152">150 s</text>
<line class="edge" x1="306.7" y1="135" x2="306.7" y2="141"/><text class="small mid" x="306.7" y="152">300 s</text>
<text class="small" x="16" y="56">Reported events</text>
<text x="16" y="86">Argon: 3</text>
<text x="16" y="114">Astra: 5 ✓</text>
<line x1="96" y1="86" x2="320" y2="86" stroke="var(--line)"/>
<rect x="96" y="83" width="224" height="6" rx="2" fill="var(--stone)"/>
<rect x="110" y="79" width="6.3" height="14" rx="2" fill="var(--blue)"/>
<rect x="185.2" y="79" width="11.2" height="14" rx="2" fill="var(--blue)"/>
<rect x="257.5" y="79" width="4.9" height="14" rx="2" fill="var(--blue)"/>
<rect x="270.1" y="79" width="4.2" height="14" rx="2" fill="var(--blue)"/>
<line x1="96" y1="114" x2="320" y2="114" stroke="var(--line)"/>
<rect x="96" y="111" width="224" height="6" rx="2" fill="var(--stone)"/>
<rect x="185.9" y="107" width="9.8" height="14" rx="2" fill="var(--blue)"/>
<rect x="257.5" y="111" width="16.2" height="6" rx="2" fill="var(--stone)"/>
<rect x="186" y="77" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="188.1" y="77" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="270.6" y="77" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="186.6" y1="60" x2="186.6" y2="122" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="186.6" cy="56" r="3.5" fill="var(--teal)"/>
<line x1="188.7" y1="60" x2="188.7" y2="122" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="188.7" cy="56" r="3.5" fill="var(--teal)"/>
<line x1="190.1" y1="60" x2="190.1" y2="122" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="190.1" cy="56" r="3.5" fill="var(--clay)"/>
<line x1="258.9" y1="60" x2="258.9" y2="122" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="258.9" cy="56" r="3.5" fill="var(--clay)"/>
<line x1="270.8" y1="60" x2="270.8" y2="122" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="270.8" cy="56" r="3.5" fill="var(--teal)"/>

<text class="small b" x="16" y="196">Zoomed in: 120–145 s</text>
<line class="edge" x1="72" y1="312" x2="320" y2="312"/>
<line class="edge" x1="72" y1="309" x2="72" y2="315"/><text class="small mid" x="72" y="326">120 s</text>
<line class="edge" x1="191" y1="309" x2="191" y2="315"/><text class="small mid" x="191" y="326">132 s</text>
<line class="edge" x1="320" y1="309" x2="320" y2="315"/><text class="small mid" x="320" y="326">145 s</text>
<line x1="72" y1="258" x2="320" y2="258" stroke="var(--line)"/>
<rect x="72" y="255" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="141.4" y="251" width="158.7" height="14" rx="2" fill="var(--blue)"/>
<line x1="72" y1="288" x2="320" y2="288" stroke="var(--line)"/>
<rect x="72" y="285" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="151.4" y="281" width="138.9" height="14" rx="2" fill="var(--blue)"/>
<rect x="153.3" y="249" width="9.9" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="183.1" y="249" width="9.9" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="161.3" y1="234" x2="161.3" y2="296" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="161.3" cy="226" r="8"/><text class="mid" x="161.3" y="226" font-size="11">1</text></g>
<line x1="191" y1="234" x2="191" y2="296" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="191" cy="226" r="8"/><text class="mid" x="191" y="226" font-size="11">2</text></g>
<line x1="210.9" y1="234" x2="210.9" y2="296" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="210.9" cy="226" r="8"/><text class="mid" x="210.9" y="226" font-size="11">3</text></g>
<text class="small" x="16" y="258">Argon</text><text class="small" x="16" y="288">Astra</text>
<text class="small b" x="16" y="362">Zoomed in: 225–258 s</text>
<line class="edge" x1="72" y1="478" x2="320" y2="478"/>
<line class="edge" x1="72" y1="475" x2="72" y2="481"/><text class="small mid" x="72" y="492">225 s</text>
<line class="edge" x1="184.7" y1="475" x2="184.7" y2="481"/><text class="small mid" x="184.7" y="492">240 s</text>
<line class="edge" x1="320" y1="475" x2="320" y2="481"/><text class="small mid" x="320" y="492">258 s</text>
<line x1="72" y1="424" x2="320" y2="424" stroke="var(--line)"/>
<rect x="72" y="421" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="109.6" y="417" width="52.6" height="14" rx="2" fill="var(--blue)"/>
<rect x="244.8" y="417" width="45.1" height="14" rx="2" fill="var(--blue)"/>
<line x1="72" y1="454" x2="320" y2="454" stroke="var(--line)"/>
<rect x="72" y="451" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="109.6" y="451" width="172.8" height="6" rx="2" fill="var(--stone)"/>
<rect x="250.1" y="415" width="24.8" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="124.6" y1="400" x2="124.6" y2="462" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="124.6" cy="392" r="8"/><text class="mid" x="124.6" y="392" font-size="11">4</text></g>
<line x1="252.4" y1="400" x2="252.4" y2="462" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="252.4" cy="392" r="8"/><text class="mid" x="252.4" y="392" font-size="11">5</text></g>
<text class="small" x="16" y="424">Argon</text><text class="small" x="16" y="454">Astra</text>
<rect x="16" y="506" width="18" height="6" rx="2" fill="var(--stone)"/><text class="small" x="40" y="509">≤1 fps scan</text>
<rect x="170" y="502" width="18" height="14" rx="2" fill="var(--blue)"/><text class="small" x="194" y="509">2–6 fps dense view</text>
<rect x="16" y="530" width="16" height="16" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/><text class="small" x="40" y="538">Pointing counted by Argon</text>
<circle cx="24" cy="564" r="5" fill="var(--teal)"/><text class="small" x="40" y="564">Reported &amp; counted by Argon</text><circle cx="24" cy="588" r="5" fill="var(--clay)"/><text class="small" x="40" y="588">In Argon's dense window, missed</text>
</svg>
```

We previously built a frame-by-frame version for agents to call, and it exposed the exact limit of single-frame perception: for an **action** like “a hand pulling a wet wipe from a box,” a single-frame detector says “present” on every frame where the hand and the box appear together, causing it to count 64 occurrences on a question whose answer was 5. So what Glance should provide as a video tool is the perceptual primitives where agents most often stumble: counting occurrences accurately, verifying whether something is present in a segment, and localizing where it is—while actions have to be judged over short video clips rather than isolated frames.

### Frame-by-Frame Scoring Runs Backward on This Benchmark

We also tried something even more direct: skipping the agent altogether and having Glance answer the multiple-choice questions on its own. We uniformly sampled 32 frames, had each frame independently answer the multiple-choice question, averaged the option probabilities across the 32 frames, and picked the highest-scoring option. Across the 144 questions of Video-Index v1.1, it got only 2.1% right—versus 24.8% for random guessing. Picking the **lowest**-probability option instead got 66.7% right.

That isn't a bug in our code. We verified the entire pipeline on synthetic videos (getting 63/63 right) and reversed the option ordering, confirming that the model's preference follows the option text rather than option letters or positions. The explanation lies in how the benchmark was constructed: candidate questions in Video-Index pass through an adversarial filter that discards any question a frame-level model can answer with high confidence (whether from 1 frame, 32 frames, 32 shuffled frames, or text alone); the surviving questions are then sorted and released in order of how low a probability the frame-level model assigns to the ground-truth answer. By construction, whichever option a frame-level model favors is almost guaranteed to be a distractor.

```echarts title="Frame-by-frame scoring: picking the most likely option almost always fails; picking the least likely usually wins" note="Glance v1, 32 uniformly sampled frames scored independently. v1.0 is a random 155-question sample." height="270"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "legend": {"data": ["Pick highest prob", "Pick lowest prob", "Random guess"]}, "grid": {"left": 4, "right": 16, "top": 56, "bottom": 44}, "xAxis": {"type": "category", "data": ["v1.0", "v1.1"], "name": "Video-Index", "nameLocation": "middle", "nameGap": 26}, "yAxis": {"type": "value", "max": 80, "axisLabel": {"formatter": "{value}%"}}, "series": [{"name": "Pick highest prob", "type": "bar", "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%", "fontSize": 10}, "data": [3.2, 2.1]}, {"name": "Pick lowest prob", "type": "bar", "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%"}, "data": [{"value": 69.0, "label": {"formatter": "69.0%"}}, 66.7]}, {"name": "Random guess", "type": "bar", "itemStyle": {"color": "var(--faint)", "opacity": 0.6}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%", "fontSize": 10}, "data": [{"value": 30.0, "label": {"formatter": "30.0%"}}, 24.8]}]}
```

v1.0 is the unranked pool released right after filtering, and the phenomenon is identical: across 155 random questions, picking the highest probability gets 3.2%, picking the lowest gets 69.0%, and random guessing gets 30.0%. Running Qwen3.5-4B directly on the full video is inverted in the exact same way (picking the highest gets only 3–5/144 right, while picking the lowest gets 53–59%), showing that this isn't an artifact of looking at single frames—it's that the shared priors of this model family were filtered out. That is a natural property of an adversarially filtered benchmark, not a flaw: it specifically retains the questions where frame-level priors are misled. You just need to know it's happening before using the benchmark to evaluate a frame-scoring tool, and pair it with an unfiltered control set.

While reading those traces we also noticed two benchmark quirks unrelated to vision: 41.0% of the questions in v1.1 have the last option as the ground-truth answer, so a dummy policy that “always picks the last option” would rank 5th on the 21-agent leaderboard; and in 51 of Codex's 52 `technical_error` runs, the agent had already written its final answer in the last message—24 of them correct—which would lift GPT-6-Astra from 35.4 to 41.0 if counted. Both are worth correcting for when comparing results on v1.1.

## Where It Still Fails

Glance still makes mistakes, and its mistakes follow clear patterns. For every category below, we know the cause and have a corresponding fix in flight.

**Rephrasing a query can flip the answer.** On a clean image, almost any phrasing works; on the cluttered dinner table under the umbrella, “ketchup” scores 0.976, “the ketchup bottle” drops to 0.362, and “something to drink” in front of a table full of cups and bottles says “not present” (0.135). Most consequential are software UIs: “the Export button” is boxed cleanly, yet rephrasing it as “the button that saves the picture as a PNG” flips to “not present” (0.11); and asking for “the button that keeps my edits” confidently (0.93) boxes “Don't Save.” In the widget below, all phrasings for each image are asked together in a single forward pass; the vertical line marks the 0.5 threshold, and phrasings that fall below it are drawn with dashed boxes labeled “says not present.”

```widget src="../../widgets/glance/phrasing.js" title="Same target, different phrasing" note="Photos: Walter Lim, “Ice capuccino and durian durian cake for #tea”; Peter Moons, “Dinner under the umbrella.”, both CC BY 2.0 (COCO val2017). UI: examples/gui_mock.html from the Glance repository, Apache-2.0."
../../images/glance/w-phrasing-en.png | Static image: On the iced coffee and cake photo, dessert, 甜点, something sweet, and 甜的东西 all score above 0.98; on the dinner under the umbrella photo, ketchup scores 0.976, 番茄酱 0.851, and the ketchup bottle 0.362; on the software UI, the button that saves the picture as a PNG scores only 0.11
../../images/glance/w-phrasing-en-n.png | Same as above, mobile version
```

Chinese versus English—“甜点” versus “dessert”—works fine on these images; what breaks is describing a target by its function, which happens to be how users often instruct agents (“save the picture” rather than “click Export”). That is the exact noun shortcut analyzed earlier, and its fix is the one described above.

**Relational “not present.”** “The cup next to the laptop” when the cup is actually across the table: on relation-mismatched negatives like this, v1 gets only 41% right (30% in Chinese). It spots the cup, and fails to verify “next to.”

**Multiple targets, single box.** Ask for “two people in red” and Glance will box one of them (hitting at least one target on 73.6% of gRefCOCO multi-target queries), but its box covers all targets on only 41.3%. That is the ceiling of a single-box head, and the reason it scores 0% on multi-target queries in GREC.

**Too quick to say “not present” on GUIs.** On VenusBench, the presence gate blocks 18 percentage points of valid clicks on present targets, and its GUI presence AUROC is only 73.8.

There is also an explicit trade-off on the table: v1 traded a bit of raw box precision on single-domain benchmarks for GUI capability and trustworthy refusal—RefCOCO val dipped from 95.0 to 93.2, and false rejection on multi-target expressions rose from 1.2% to 5.1%—before v1.1 recovered that box precision.

## What's Next

- **v1.2.** Retraining on Glance-Data to patch spatial qualifiers on unique objects, counts, and relational negatives.
- **Multi-box head.** Alongside the center-patch softmax, we are adding a per-patch “an object center is here” head: the number of peaks gives the count, and each peak reuses the existing four-side distribution readout. Asking “does this description refer to more than one object?” in the same forward pass already reaches 0.89 AUROC zero-shot, giving a third dial: is it there, is the box accurate, and is there only one.
- **Glance-Video.** Instead of asking about objects frame by frame, answering “did this action happen?” over short multi-second clips and counting state transitions. That counting query where single-frame detection counted 64 wet-wipe pulls instead of 5 is its first test.
- **One query across N clips.** What a video agent needs most is a tool that scans an entire video with a single question in one pass—telling it “at 3:12,” or telling it with calibrated confidence, “not once in these two hours.”

```sketch title="A scanning tool for video agents: one query, N clips, one forward pass" note="Schematic; curve is illustrative."
<svg viewBox="0 0 704 276">
<rect class="panel" x="0" y="0" width="704" height="276" rx="12"/>
<g class="node clay"><rect x="24" y="24" width="220" height="32" rx="16"/><text class="mid" x="134" y="40">Query: “Did anyone fall?”</text></g>
<g class="node plain"><rect x="24" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="54" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="84" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="114" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="144" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="174" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="204" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="234" y="76" width="24" height="18" rx="2"/></g>
<text class="small" x="268" y="85">… N clips</text>
<path class="edge" d="M134 56 V70" marker-end="url(#arrow)"/>
<path class="edge" d="M134 94 V118" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="24" y="120" width="300" height="34" rx="4"/><text class="mid" x="174" y="137">One pass: clips branch from shared state</text></g>
<path class="edge" d="M324 137 H360" marker-end="url(#arrow)"/>
<line x1="380" y1="150" x2="676" y2="150" stroke="var(--line)"/>
<line x1="380" y1="100.0" x2="676" y2="100.0" stroke="var(--muted)" stroke-dasharray="4 3"/>
<path d="M380.0 142.7 L382.5 141.8 L384.9 142.7 L387.4 143.0 L389.9 141.7 L392.3 140.6 L394.8 142.1 L397.3 145.0 L399.7 146.5 L402.2 145.8 L404.7 145.0 L407.1 145.8 L409.6 147.1 L412.1 146.3 L414.5 143.4 L417.0 141.4 L419.5 141.7 L421.9 142.9 L424.4 142.6 L426.9 141.3 L429.3 141.5 L431.8 144.1 L434.3 146.6 L436.7 146.7 L439.2 145.4 L441.7 145.1 L444.1 146.3 L446.6 146.5 L449.1 144.4 L451.5 141.6 L454.0 140.9 L456.5 142.2 L458.9 143.1 L461.4 142.2 L463.9 141.6 L466.3 143.2 L468.8 146.1 L471.3 147.4 L473.7 146.3 L476.2 144.9 L478.7 145.3 L481.1 146.1 L483.6 145.1 L486.1 142.3 L488.5 140.5 L491.0 141.3 L493.5 142.9 L495.9 143.1 L498.4 142.2 L500.9 142.7 L503.3 145.3 L505.8 147.5 L508.3 147.2 L510.7 145.3 L513.2 144.5 L515.7 145.3 L518.1 145.3 L520.6 143.2 L523.1 140.7 L525.5 140.4 L528.0 142.3 L530.5 143.6 L532.9 143.2 L535.4 142.8 L537.9 144.4 L540.3 147.0 L542.8 147.8 L545.3 144.6 L547.7 125.4 L550.2 90.6 L552.7 67.0 L555.1 57.6 L557.6 53.5 L560.1 52.0 L562.5 53.3 L565.0 55.5 L567.5 56.5 L569.9 59.2 L572.4 73.3 L574.9 106.5 L577.3 139.0 L579.8 146.8 L582.3 144.7 L584.7 143.5 L587.2 144.1 L589.7 144.2 L592.1 142.3 L594.6 140.3 L597.1 140.5 L599.5 142.9 L602.0 144.6 L604.5 144.4 L606.9 143.9 L609.4 145.2 L611.9 147.4 L614.3 147.7 L616.8 145.6 L619.3 143.3 L621.7 143.1 L624.2 143.8 L626.7 143.1 L629.1 141.0 L631.6 140.2 L634.1 142.0 L636.5 144.5 L639.0 145.3 L641.5 144.6 L643.9 144.7 L646.4 146.5 L648.9 147.8 L651.3 146.5 L653.8 143.7 L656.3 142.4 L658.7 143.0 L661.2 143.4 L663.7 141.9 L666.1 140.4 L668.6 141.2 L671.1 143.9 L673.5 145.8 L676.0 145.5" fill="none" stroke="var(--clay)" stroke-width="1.75"/>
<rect x="550.2" y="154" width="23.7" height="6" rx="2" fill="var(--clay)"/>
<text class="small" x="380" y="32">P(t): one calibrated probability per clip</text>
<text class="small end" x="676" y="90">Threshold</text>
<text class="small mid" x="562.04" y="174">At 3:12–3:40</text>
<g class="node teal"><rect x="24" y="196" width="300" height="34" rx="4"/><text class="mid" x="174" y="213">Answer: “At 3:12–3:40,” and box who</text></g>
<g class="node teal"><rect x="380" y="196" width="296" height="34" rx="4"/><text class="mid" x="528" y="213">Or: “Absent throughout,” FPR ≤ α</text></g>
<text class="small" x="24" y="254">Target: &lt; 100 ms per pass; “absent throughout” calibrated at the clip-set level</text>
</svg>
<svg viewBox="0 0 340 428">
<rect class="panel" x="0" y="0" width="340" height="428" rx="12"/>
<g class="node clay"><rect x="16" y="16" width="308" height="30" rx="15"/><text class="mid" x="170" y="31">Query: “Did anyone fall?”</text></g>
<g class="node plain"><rect x="16" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="42" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="68" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="94" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="120" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="146" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="172" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="198" y="62" width="20" height="16" rx="2"/></g>
<text class="small" x="228" y="70">… N clips</text>
<path class="edge" d="M170 46 V58" marker-end="url(#arrow)"/>
<path class="edge" d="M170 82 V94" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="16" y="98" width="308" height="32" rx="4"/><text class="mid" x="170" y="114">One pass: clips branch from shared state</text></g>
<path class="edge" d="M170 130 V150" marker-end="url(#arrow)"/>
<line x1="24" y1="260" x2="316" y2="260" stroke="var(--line)"/>
<line x1="24" y1="215.0" x2="316" y2="215.0" stroke="var(--muted)" stroke-dasharray="4 3"/>
<text class="small end" x="316" y="205">Threshold</text>
<path d="M24.0 253.5 L26.4 252.6 L28.9 253.4 L31.3 253.7 L33.7 252.5 L36.2 251.6 L38.6 252.8 L41.0 255.5 L43.5 256.8 L45.9 256.2 L48.3 255.5 L50.8 256.3 L53.2 257.4 L55.6 256.6 L58.1 254.1 L60.5 252.2 L62.9 252.6 L65.4 253.6 L67.8 253.3 L70.2 252.1 L72.7 252.4 L75.1 254.7 L77.5 256.9 L80.0 257.1 L82.4 255.9 L84.8 255.6 L87.3 256.6 L89.7 256.9 L92.1 254.9 L94.6 252.4 L97.0 251.8 L99.4 253.0 L101.9 253.8 L104.3 253.0 L106.7 252.4 L109.2 253.9 L111.6 256.5 L114.0 257.7 L116.5 256.6 L118.9 255.4 L121.3 255.8 L123.8 256.5 L126.2 255.6 L128.6 253.1 L131.1 251.4 L133.5 252.1 L135.9 253.6 L138.4 253.8 L140.8 253.0 L143.2 253.4 L145.7 255.7 L148.1 257.8 L150.5 257.5 L153.0 255.8 L155.4 255.1 L157.8 255.8 L160.3 255.8 L162.7 253.9 L165.1 251.6 L167.6 251.4 L170.0 253.0 L172.4 254.3 L174.9 253.9 L177.3 253.5 L179.7 254.9 L182.2 257.3 L184.6 258.1 L187.0 255.1 L189.5 237.8 L191.9 206.5 L194.3 185.3 L196.8 176.9 L199.2 173.2 L201.6 171.8 L204.1 173.0 L206.5 175.0 L208.9 175.9 L211.4 178.2 L213.8 191.0 L216.2 220.8 L218.7 250.1 L221.1 257.1 L223.5 255.3 L226.0 254.2 L228.4 254.7 L230.8 254.8 L233.3 253.1 L235.7 251.2 L238.1 251.5 L240.6 253.6 L243.0 255.2 L245.4 255.0 L247.9 254.5 L250.3 255.7 L252.7 257.7 L255.2 258.0 L257.6 256.0 L260.0 254.0 L262.5 253.8 L264.9 254.4 L267.3 253.8 L269.8 251.9 L272.2 251.1 L274.6 252.8 L277.1 255.1 L279.5 255.8 L281.9 255.1 L284.4 255.2 L286.8 256.9 L289.2 258.0 L291.7 256.8 L294.1 254.3 L296.5 253.1 L299.0 253.7 L301.4 254.0 L303.8 252.8 L306.3 251.4 L308.7 252.1 L311.1 254.5 L313.6 256.2 L316.0 256.0" fill="none" stroke="var(--clay)" stroke-width="1.75"/>
<rect x="191.9" y="264" width="23.4" height="6" rx="2" fill="var(--clay)"/>
<text class="small" x="24" y="160">P(t): one calibrated probability per clip</text>
<text class="small mid" x="203.58" y="282">At 3:12–3:40</text>
<g class="node teal"><rect x="16" y="296" width="308" height="32" rx="4"/><text class="mid" x="170" y="312">Answer: “At 3:12–3:40,” and box who</text></g>
<g class="node teal"><rect x="16" y="336" width="308" height="32" rx="4"/><text class="mid" x="170" y="352">Or: “Absent throughout,” FPR ≤ α</text></g>
<text class="small" x="16" y="388">Target: &lt; 100 ms per pass</text>
<text class="small" x="16" y="408">“Absent throughout” calibrated at clip-set level</text>
</svg>
```

The hard part isn't the forward pass—it's making the statement “absent throughout the entire video” trustworthy. Even if the per-clip false positive rate is just 1%, across 64 independent clips the probability of at least one false alarm is roughly 47%, and across 256 clips it reaches 92%. As soon as a single clip fires a false alarm, you can no longer say “absent throughout.” Calibration therefore has to happen at the level of the entire set of clips: setting a threshold on the maximum probability across all clips so that the family-wise probability of saying “present” when the event never occurred is bounded by $\alpha$. That way, when an event truly isn't in the video, the model can say “absent throughout” with $1 - \alpha$ confidence without being derailed by a stray per-clip false positive. Our target is a single forward pass under 100 ms that returns both a $P(t)$ curve and a set-level calibrated “absent throughout.”

**Open release.** The code is available at [Vision-Decision/Glance](https://github.com/Vision-Decision/Glance) (Apache-2.0), and the 4B preview weights (v1 in this post) are on Hugging Face at [Vision-Decision/Glance-4B-preview](https://huggingface.co/Vision-Decision/Glance-4B-preview) (CC BY-NC 4.0, as gRefCOCO in the training mix is non-commercial). A single `pip install` runs it on CUDA, Apple Silicon, or CPU.

Looking back, the most valuable takeaways weren't any particular benchmark score, but the three times reality contradicted our expectations: generative models aren't bad at knowing when something is absent—whether they hallucinate is an operating point chosen for them by the prompt and decoder; a larger, newer base model didn't learn to say “not present,” whereas hard negatives did, and our own negatives quietly taught the model a noun shortcut; and video agents lose at seeing, not at thinking. Every single time, the lesson pushed us away from “swap the model or architecture” and back toward “data and interfaces.”

## Where the Numbers Come From

- Latencies were all measured on a single RTX PRO 6000 (with an additional set on an L4), running one warmup pass followed by the median of 50 calls (20 on L4); both sides are timed from the resized image to receiving all answers, including image preprocessing and excluding JPEG decoding. Jev latencies were measured over OpenRouter and include network transit.
- All interactive widgets on this page display real precomputed outputs from Glance-4B-preview; the browser only filters and interpolates between them.
- Numbers marked “official” use the benchmark authors' scoring scripts; the rest use our evaluation harness. All thresholds and temperatures are fitted on held-out splits from the training distribution, without touching any evaluation set.

## References

- [@qwen35] Qwen Team (2026). [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5). _Qwen blog_, February 2026.
- [@jev] Almeida, D. (2026). [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev). _TypeSafe AI blog_, September 2026.
- [@jev114] TypeSafe AI (2026). [Jev 1.14](https://typesafe.ai/blog/jev-1-14). _TypeSafe AI blog_, October 2026. For details on the `box` question type, see the [TypeSafe documentation](https://docs.typesafe.ai/primitives/box.md).
- [@guiactor] Wu, Q., Cheng, K., Yang, R., et al. (2025). [GUI-Actor: Coordinate-Free Visual Grounding for GUI Agents](https://arxiv.org/abs/2506.03143). _Advances in Neural Information Processing Systems 38 (NeurIPS 2025)_.
- [@gfl] Li, X., Wang, W., Wu, L., et al. (2020). [Generalized Focal Loss: Learning Qualified and Distributed Bounding Boxes for Dense Object Detection](https://arxiv.org/abs/2006.04388). _Advances in Neural Information Processing Systems 33 (NeurIPS 2020)_.
- [@sam3] Carion, N., Gustafson, L., Hu, Y.-T., et al. (2026). [SAM 3: Segment Anything with Concepts](https://arxiv.org/abs/2511.16719). _International Conference on Learning Representations (ICLR 2026)_.
- [@song2025] Song, X., & Bahri, D. (2025). [Decoding-based Regression](https://arxiv.org/abs/2501.19383). _Transactions on Machine Learning Research_.
- [@holtzman2021] Holtzman, A., West, P., Shwartz, V., Choi, Y., & Zettlemoyer, L. (2021). [Surface Form Competition: Why the Highest Probability Answer Isn't Always Right](https://doi.org/10.18653/v1/2021.emnlp-main.564). _Proceedings of EMNLP 2021_, 7038–7051.
- [@refbenchpro] Gao, T., Li, H., Fang, H., Wei, X., et al. (2025). [RefBench-PRO: Perceptual and Reasoning Oriented Benchmark for Referring Expression Comprehension](https://arxiv.org/abs/2512.06276). _arXiv preprint arXiv:2512.06276_.
- [@grefcoco] Liu, C., Ding, H., & Jiang, X. (2023). [GRES: Generalized Referring Expression Segmentation](https://arxiv.org/abs/2306.00968). _IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR 2023)_.
- [@screenspotv2] Wu, Z., Wu, Z., Xu, F., et al. (2025). [OS-ATLAS: A Foundation Action Model for Generalist GUI Agents](https://arxiv.org/abs/2410.23218). _International Conference on Learning Representations (ICLR 2025)_. ScreenSpot-v2 is the revised benchmark introduced in this paper.
- [@screenspotpro] Li, K., Meng, Z., Lin, H., et al. (2025). [ScreenSpot-Pro: GUI Grounding for Professional High-Resolution Computer Use](https://arxiv.org/abs/2504.07981). _Proceedings of the 33rd ACM International Conference on Multimedia (MM '25)_.
- [@grec] He, S., Ding, H., Liu, C., & Jiang, X. (2023). [GREC: Generalized Referring Expression Comprehension](https://arxiv.org/abs/2308.16182). _arXiv preprint arXiv:2308.16182_. MLLM results on GREC are taken from Yang, X., Ling, J., Huang, T., et al. (2026). [Teaching MLLMs to Say No: Generalized Referring Expression Comprehension via Refusal Calibrated GRPO](https://arxiv.org/abs/2608.04698). _arXiv preprint arXiv:2608.04698_.
- [@venusbench] Zhou, B., Huang, Z., Guo, Y., et al. (2025). [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501). _arXiv preprint arXiv:2512.16501_. UI-Venus-1.5 results are taken from its technical report [arXiv:2602.09082](https://arxiv.org/abs/2602.09082).
- [@videoindex] Song, E., Xu, Y., Yang, S., Chai, W., & Gu, J. (2026). [Video-Index: A Curated Meta-Benchmark for Video Understanding](https://arxiv.org/abs/2610.00960). _arXiv preprint arXiv:2610.00960_.
