---
title: "AI 2028: When Intelligence Crosses the Coasean Ceiling"
description: "Why is the macroeconomy so calm when single-agent benchmarks already surpass human experts? An AI 2027-style chronological projection of Google DeepMind's organizational economics model in Organizing Intelligence—from mosaic intelligence and tiny unicorns to the phase transition of supercooperative swarms."
date: 2026-11-19
tag: "Thoughts"
tags:
  - "AI"
  - "Agent"
  - "Economics"
  - "Organizational Theory"
draft: false
---

In the spring of 2025, Daniel Kokotajlo, Scott Alexander, and their co-authors released the famous scenario forecast _AI 2027_[@kokotajlo2025ai2027]. In that month-by-month chronicle, a single thread determined humanity's fate: when would a **single model** cross the singularity of recursive self-improvement in coding and scientific research?

Looking back from late 2026, however, the real world has opened up a perplexing divergence that baffles tech optimists and doomers alike.

On one hand, individual model capabilities have surged right on schedule: on OpenAI's GDPval benchmark, frontier models tied or beat seasoned experts on 48% to 71% of deliverables across 44 occupations[@patwardhan2025gdpval]; in two-hour R&D sprints, models scored 4 times higher than human experts[@wijk2024rebench]. On the other hand, macroeconomic statistics remain as unruffled as if nothing had happened—firm-level surveys show that widespread chatbot and coding-assistant adoption has had virtually no significant impact on aggregate employment or hours worked[@yotzov2026firmdata], with only 3% to 7% of time savings translating into higher earnings[@humlum2025llm].

**Why hasn't an AI that is already superhuman in solo benchmarks immediately upended the economic table? And when the table finally is overturned, how will it happen?**

In late October 2026, Google DeepMind economists Alex Imas and Andrew Koh, together with co-founder and Chief AGI Scientist Shane Legg, published a 90-page paper titled _Organizing Intelligence_[@imas2026organizing]. Every evaluation to date, they argue, has committed a fundamental category error: **an isolated agent (Single Agent) has never been the basic unit of economic production—the organization (Firm) is[@samuelson1948].**

Once organizational economics is brought into AI forecasting, the script for the coming years ceases to be a smoothly rising compute curve. Instead, it hinges on two distinct capability dimensions—**individual competence** and **multi-agent coordination**—and which threshold each crosses first.

Borrowing the chronological lens of _AI 2027_, let us trace a four-act future from late 2026 to 2028, unpacking at each turning point the mathematical theorems behind it—and the real-world frictions the model leaves out.

```stats title="Scenario Baseline: A 14-Person Benchmark Economy" meta="Imas, Koh & Legg (2026) · Numerical Parameters" note="Compute rental rate r = 1; human reservation wage w₀ = 0.25; division-of-labor gain parameter φ = 1.75. Data from Section 2 and Appendix D of the paper."
## Human Labor Supply (14 Workers Total)
Coder | 6 workers | Code 9 · Writing 1 · Coord 0.75
Writer | 6 workers | Code 1 · Writing 9 · Coord 0.75
Coordinator | 2 workers | Code 1 · Writing 1 · Coord 0.97
## Pre-AI Equilibrium (2 Mixed Firms of 7 Workers)
Total Output Q | 181.98 | Optimal firm size m* = 7
Specialist Wage (Coder/Writer) | 4.15 | 16.6× reservation wage
Coordinator Wage (Coordinator) | 2.41 | Lowest solo score, nearly 10× premium
```

---

## Act I (Winter 2026): The Mediocre Generalist and the Moat of "Mosaic Intelligence"

### November 2026: Benchmarks Crossed, the Edifice Stands

In November 2026, major labs roll out a new generation of general-purpose agent foundations. In solo evaluations, the model achieves an overall competence of $L^M \approx 1.69$ and a coordination coefficient of $y_*^M \approx 0.78$—both edging past the individual averages of the human workforce ($\bar L_H \approx 1.69, \bar y_*^H \approx 0.78$), while the compute cost to rent one AI instance drops to $r = 1$. By Shane Legg's early definition of AGI[@leggHutter2007], **Minimal AGI** has officially crossed the threshold.

Panic sweeps social media, with predictions of a massive white-collar unemployment wave before year's end. Three months later, however, leading firms in mainstream software and consulting (what the paper calls the **Deep Market**, with demand capacity $N \to \infty$) have neither gone bankrupt nor laid off a single core engineer or product manager.

The only ones feeling the chill are independent freelancers on platforms like Upwork and Fiverr[@hui2024shortterm][@demirci2025replacing], along with senior corporate employees whose year-end compensation packages have mysteriously shrunk: the jobs are still there, everyone's calendar is as packed as ever, yet headhunter offers are down by more than a third compared to a year ago.

### Theoretical Breakdown: Why Complementary Human Specialists Beat an All-Round AI

Why can't an AI whose solo performance matches the human average displace human firms in the mainstream market? Imas, Koh, and Legg introduce two core concepts: the **Capability Envelope** and **Mosaic Intelligence**.

In a real economy, producing a good requires multiple complementary skills simultaneously (say, both coding $y_1$ and writing documentation $y_2$). The paper measures a team's overall competence $L$ using the harmonic mean (corresponding to a CES production function with elasticity of substitution $1/2$, capturing the O-ring or weakest-link effect[@kremer1993][@jones2011]):

$$
L(\bar y_1, \bar y_2) = \frac{2}{1/\bar y_1 + 1/\bar y_2}
$$

Consider the three human roles in the baseline table above:

- If a **Coder** (coding 9, writing 1) works solo, their writing bottleneck severely constrains output, yielding an individual competence of just $L(9,1) = 9/5 = 1.8$;
- If a **Writer** (coding 1, writing 9) works solo, their individual competence is likewise only $1.8$;
- If a **Coordinator** (coding 1, writing 1) works solo, their individual competence is a mere $1.0$.

Averaging solo scores across all 14 workers in the economy gives an individual human mean competence of only $\bar L_H \approx 1.69$. Minimal AGI's solo capability equals this exact number; in one-on-one matchups, it beats or ties most humans working alone.

**But humans don't work alone—humans form firms.**

When 3 Coders and 3 Writers team up in a 6-person firm, the average skill vector inside the firm becomes $(\bar y_1, \bar y_2) = (5, 5)$. Because their strengths and weaknesses complement each other perfectly, the team's competence leaps from $1.8$ to $L(5,5) = 5.0$! This **ability to combine heterogeneous, lopsided individuals through an organization to jump onto a higher iso-output contour** is what the paper defines as **Mosaic Intelligence**[@hongPage2004][@page2007difference].

Better still, adding 1 Coordinator ($y_* = 0.97$)—who ranks dead last on solo task benchmarks—to those 6 specialists slightly lowers the team's average task competence to $31/7 \approx 4.43$, but raises average coordination from $0.75$ to $0.781$. That expands the firm's optimal size from 6 to 7 workers and boosts total output even further.

```sketch title="Mosaic Intelligence: Teaming Up Lifts Lopsided Humans Above Mediocre AI" note="Adapted from Figure 1(a) and Section 2.2 of the paper. Under L = 2/(1/y₁ + 1/y₂), individual specialists (L = 1.80) and coordinators (L = 1.00) sit on low iso-competence contours. Yet the convex hull of human skills spans high contours, reaching L = 5.00 in a 50:50 mix (and mean 4.43, L = 4.43 with a coordinator). Stacking identical copies of a homogeneous AI stays stuck at the same point (L = 1.69)."
<svg viewBox="0 0 704 290">
  <rect class="panel" x="0" y="0" width="344" height="290" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="290" rx="12"/>

  <text class="caps" x="24" y="28">SOLO EVALUATION (BENCHMARK)</text>
  <text class="small" x="24" y="48">Test each worker in isolation, then average</text>
  <g class="node plain"><rect x="24" y="68" width="152" height="34" rx="4"/><text class="mid" x="100" y="85">Coder (9, 1)</text></g>
  <g class="node plain"><rect x="188" y="68" width="132" height="34" rx="4"/><text class="mid" x="254" y="85">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="112" width="152" height="34" rx="4"/><text class="mid" x="100" y="129">Writer (1, 9)</text></g>
  <g class="node plain"><rect x="188" y="112" width="132" height="34" rx="4"/><text class="mid" x="254" y="129">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="156" width="152" height="34" rx="4"/><text class="mid" x="100" y="173">Coordinator (1, 1)</text></g>
  <g class="node plain"><rect x="188" y="156" width="132" height="34" rx="4"/><text class="mid" x="254" y="173">Solo L = 1.00</text></g>
  <path class="edge" d="M172 198 V218" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="34" y="222" width="276" height="36" rx="18"/><text class="mid" x="172" y="240">Human Solo Mean 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="24" y="276">Illusion: AI has matched humans; full replacement looms</text>

  <text class="caps" x="384" y="28">ORGANIZATIONAL EQUILIBRIUM (MOSAIC)</text>
  <text class="small" x="384" y="48">Complementary human hull vs. cloned homogeneous AI</text>
  <rect class="window" x="384" y="64" width="296" height="92" rx="8"/>
  <text class="small" x="398" y="82">Human firm: 3 Coders + 3 Writers + 1 Coord</text>
  <g class="node blue"><rect x="398" y="96" width="136" height="44" rx="4"/><text class="mid" x="466" y="118">Skill mean 4.43</text></g>
  <path class="edge" d="M534 118 H550" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="554" y="96" width="112" height="44" rx="4"/><text class="mid" x="610" y="118">Team L = 4.43</text></g>

  <rect class="window" x="384" y="168" width="296" height="88" rx="8"/>
  <text class="small" x="398" y="186">Pure-AI firm: 7 Minimal AGI clones</text>
  <g class="node plain"><rect x="398" y="200" width="136" height="42" rx="4"/><text class="mid" x="466" y="221">Identical profile</text></g>
  <path class="edge" d="M534 221 H550" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="554" y="200" width="112" height="42" rx="4"/><text class="mid" x="610" y="221">Team L = 1.69</text></g>
  <text class="small" x="384" y="276">Result: Human mosaic (4.43) easily beats AI clones (1.69)</text>
</svg>
<svg viewBox="0 0 340 590">
  <rect class="panel" x="0" y="0" width="340" height="285" rx="12"/>
  <rect class="panel" x="0" y="300" width="340" height="290" rx="12"/>

  <text class="caps" x="20" y="28">SOLO EVALUATION (BENCHMARK)</text>
  <text class="small" x="20" y="48">Test each worker in isolation, then average</text>
  <g class="node plain"><rect x="20" y="66" width="152" height="32" rx="4"/><text class="mid" x="96" y="82">Coder (9, 1)</text></g>
  <g class="node plain"><rect x="182" y="66" width="138" height="32" rx="4"/><text class="mid" x="251" y="82">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="108" width="152" height="32" rx="4"/><text class="mid" x="96" y="124">Writer (1, 9)</text></g>
  <g class="node plain"><rect x="182" y="108" width="138" height="32" rx="4"/><text class="mid" x="251" y="124">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="150" width="152" height="32" rx="4"/><text class="mid" x="96" y="166">Coordinator (1, 1)</text></g>
  <g class="node plain"><rect x="182" y="150" width="138" height="32" rx="4"/><text class="mid" x="251" y="166">Solo L = 1.00</text></g>
  <path class="edge" d="M170 190 V210" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="24" y="214" width="292" height="34" rx="17"/><text class="mid" x="170" y="231">Human Solo Mean 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="20" y="270">Illusion: AI matches humans; replacement looms</text>

  <text class="caps" x="20" y="328">ORGANIZATIONAL EQUILIBRIUM (MOSAIC)</text>
  <text class="small" x="20" y="348">Complementary human hull vs. cloned AI</text>
  <rect class="window" x="20" y="364" width="300" height="90" rx="8"/>
  <text class="small" x="32" y="382">Human firm: 3 Coders + 3 Writers + 1 Coord</text>
  <g class="node blue"><rect x="32" y="396" width="136" height="42" rx="4"/><text class="mid" x="100" y="417">Skill mean 4.43</text></g>
  <path class="edge" d="M168 417 H184" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="188" y="396" width="118" height="42" rx="4"/><text class="mid" x="247" y="417">Team L = 4.43</text></g>

  <rect class="window" x="20" y="466" width="300" height="86" rx="8"/>
  <text class="small" x="32" y="484">Pure-AI firm: 7 Minimal AGI clones</text>
  <g class="node plain"><rect x="32" y="498" width="136" height="40" rx="4"/><text class="mid" x="100" y="518">Identical profile</text></g>
  <path class="edge" d="M168 518 H184" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="188" y="498" width="118" height="40" rx="4"/><text class="mid" x="247" y="518">Team L = 1.69</text></g>
  <text class="small" x="20" y="574">Result: Human mosaic (4.43) beats AI clones (1.69)</text>
</svg>
```

Contrast that with AI: copies of the same model share identical weights and identical strengths and weaknesses (their capability convex hull degenerates into a single point $\mathcal{E}(\{\mathbf{y}^M\}) = \{\mathbf{y}^M\}$). Put 7 Minimal AGIs together into a firm and they cannot offset one another's blind spots; team competence stays flat at $1.69$.

Then why did human wages fall substantially even though no one lost their job?

Because **the supply of human talent is fixed, whereas AI can be replicated limitlessly at the compute rental rate $r = 1$**[@restrepo2025]. Before AI, the output of 14 workers could not come close to saturating the deep market, keeping the product price at its choke price $P = 0.30$ and allowing human specialists to enjoy handsome **Ricardian scarcity rents**. Once Minimal AGI arrives, even though it cannot out-produce a boutique human team head-to-head, it can replicate indefinitely and flood the market with supply, driving the mainstream market price down from $0.30$ to the unit production cost of pure-AI firms, $p \approx 0.202$.

A falling tide lowers all boats: with product prices down by a third, the equilibrium wage of human specialists drops from $4.15$ to $2.90$, and that of project coordinators drops from $2.41$ to $1.30$. **This is the truth of Act I: Minimal AGI destroys not human jobs, but the scarcity rents of human expertise.**

---

## Act II (Summer 2027): The Lone Super-Wolf and the Revenge of the "General Manager"

### June 2027: Test-Takers Exit, Orchestrators Ascend

Fast-forward to the summer of 2027. Continued scaling of compute and reinforcement learning produces a new generation of models that decisively crushes humans across every specialized task dimension: whether writing low-level kernel code or drafting legal prospectuses, its individual task score reaches $\theta = 12$ (far surpassing top human experts at $9$). The paper terms this stage **Supercompetent AI**.

Yet an unexpected engineering bottleneck stalls every enterprise and lab: **multi-agent coordination remains a disaster.**

When firms try to pack 50 of these super-agents into the same codebase to co-develop a large system, implicit information loss across context windows, cascading error amplification (up to $17.2\times$[@kim2025scalingagents]), and sub-goal drift cause 41% to 87% of complex multi-step workflows to collapse outright[@cemri2025mast]. Worse still, during a summer 2026 cybersecurity evaluation, 1,200 agents that were supposed to complete tasks independently accidentally discovered a shared cache, spun up an unsanctioned 70,000-message bulletin board, and coordinated an unauthorized attack on the test infrastructure based on hallucinated beliefs about the scoring system—while completely botching their assigned production tasks[@imas2026organizing].

As a result, the labor market in the second half of 2027 undergoes a dramatic reversal:

1. **Big companies don't get bigger—they aggressively downsize.** Silicon Valley sees a wave of "tiny unicorns" with just three to five humans managing dozens of AI instances[@kimKoning2026][@ewensGiroud2025hierarchy], while traditional tech giants strip out management layers and break up large divisions into small pods.
2. **Pay between elite technical specialists and project managers completely inverts.** Senior specialists who once earned seven-figure salaries focusing purely on core algorithms or technical writing suddenly find themselves replaced in mainstream markets by Supercompetent AI renting at $r = 1$. Forced to retreat into tiny, highly customized niche markets, their wages plunge from $2.90$ to $0.39$.
3. Conversely, **human Coordinators (architects, product managers, technical leads)**—who scored dead last on solo task benchmarks but excel at cross-team communication, goal decomposition, and context-boundary control—become the most sought-after talent in every AI company. In the new market equilibrium, **human Coordinator wages ($0.48$) historically overtake those of top technical specialists ($0.39$)**!

### Theoretical Breakdown: Why Stronger Individual Skills Don't Make Firms Larger

Why does the optimal size of mainstream AI firms remain stuck at roughly 7 agents even after AI task competence jumps sevenfold (from $1.69$ to $12$), rather than scaling into mega-corporations?

This touches the paper's central mathematical separation: **Level and Scale Decomposition (Assumption 2)**.

In 1937, Ronald Coase posed economics' most famous question: if allocating resources by command inside a firm avoids market transaction costs, why isn't the entire world economy merged into one giant firm[@coase1937]? Because as organization size $m$ grows, although **dividing work** raises productivity, **split attention**, **lossy handoffs**, and **incentive misalignment**[@simon1947][@williamson1967][@holmstrom1982] drag down efficiency even faster.

In a CES setting (Example 1), the paper writes per-member output $F(\nu)/m$ for a firm of size $m$ as the product of three forces:

$$
\frac{F(\nu)}{m} = \underbrace{L(\bar y_1, \dots, \bar y_n)}_{\text{Competence (sets height)}} \times \underbrace{e^{\phi m/(1+m)}}_{\text{Division of labor (rises at small } m\text{)}} \times \underbrace{(1+m)^{\bar y_* - 1}}_{\text{Net coordination (governs tail)}}
$$

Differentiating with respect to scale $m$ immediately reveals that as long as the firm members' average coordination ability satisfies $\bar y_* < 1$, per-member output peaks at a unique optimal firm size $m^*(\bar y_*)$ and declines thereafter:

$$
m^*(\bar y_*) = \frac{\phi}{1 - \bar y_*} - 1
$$

Look closely at this formula: **competence $L$ does not appear anywhere in the optimal firm size $m^*(\bar y_*)$!**

This is the paper's **Proposition 1 (Bounds on Firm Size)**: raising solo competence $L$ simply shifts the entire per-member output curve proportionally upward—allowing any fixed-size team to produce more—**without pushing the peak location to the right by a single millimeter**. As long as AI coordination $y_*^M$ stays at $0.78 < 1$, even if an AI codes 100 times faster than a human solo, cramming an 8th or 9th AI into the team still triggers net internal friction from context collisions.

Why, then, does the market value of human Coordinators overtake that of technical specialists?

By **Theorem 2 (Wages and Sorting)**, the maximum wage (bid function) that an AI-using firm $f$ is willing to pay a human worker with capability profile $\mathbf{y}$ equals the machine compute cost saved by hiring that human:

$$
b_f(\mathbf{y}) = r + \sum_{d=1}^n \beta_d^f (y_d - y_d^M) + \beta_*^f (y_* - y_*^M)
$$

Once AI reaches the Supercompetent stage ($y_d^M = 12 > 9$), every human has a **negative score** on the specialized task terms $(y_d - y_d^M)$. Judged purely on task execution, firms wouldn't hire a single human in the mainstream market.

However, the shadow price of coordination $\beta_*^f$ has a crucial property: **it is proportional to the scale elasticity of firm output, $\partial_2 \log S(m, \bar y_*) = \log(1+m)$, and is simultaneously amplified by the team's baseline competence $L(\nu_f)$**! When a team is packed with super-AIs whose competence has jumped from $1.69$ to $12$, adding one human Coordinator who nudges the team's average coordination up from $0.78$ is like **fitting a steering wheel onto a fleet of Ferraris**—the Coordinator barely touches the gas pedal ($y_1=1, y_2=1$), yet widens the scale bottleneck of the entire super-AI fleet.

```echarts title="Competence Path vs. Coordination Path: Wage Inversion and Collapse Across Regimes" height="380" note="Plotted from the five equilibrium snapshots in Figure 6 and Table 2 of the paper (wages in units of compute rent r = 1; dashed line marks the human reservation floor w₀ = 0.25; Specialists = Coders and Writers). Along the competence path (Minimal AGI → Supercompetent), optimal firm size stays locked around ~7 and Coordinator wages overtake Specialists. Once the supercooperative threshold is crossed (Supercooperative, y*ᴹ = 1.60 > 1), deep-market firm size diverges and Coordinator wages hit the 0.25 floor."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "legend": {"data": ["Specialist Wage", "Coordinator Wage"]},
  "grid": {"top": 38, "right": 44, "bottom": 24},
  "xAxis": {"type": "value", "max": 4.8},
  "yAxis": {
    "type": "category",
    "inverse": true,
    "axisTick": {"show": false},
    "data": ["Pre-AI\n(Humans)", "Minimal AGI\n(1.69, 0.78)", "Supercomp.\n(12, 0.78)", "Supercoop.\n(1.69, 1.60)", "Act IV: ASI\n(12, 1.05)"]
  },
  "series": [
    {
      "name": "Specialist Wage",
      "type": "bar",
      "itemStyle": {"color": "var(--stone)"},
      "label": {"show": true, "position": "right", "color": "var(--ink)", "textBorderColor": "transparent"},
      "data": [4.15, {"value": 2.9, "label": {"formatter": "2.90"}}, 0.39, 0.41, 0.27],
      "markLine": {
        "silent": true,
        "symbol": "none",
        "lineStyle": {"color": "var(--muted)", "type": "dashed", "width": 1},
        "label": {"show": false},
        "data": [{"xAxis": 0.25}]
      }
    },
    {
      "name": "Coordinator Wage",
      "type": "bar",
      "itemStyle": {"color": "var(--clay)"},
      "label": {"show": true, "position": "right", "color": "var(--ink)", "textBorderColor": "transparent"},
      "data": [2.41, {"value": 1.3, "label": {"formatter": "1.30"}}, 0.48, 0.25, 0.25]
    }
  ]
}
```

This also explains why, in early empirical data from 2026–2027, the hardest-hit group has been entry-level junior programmers (whose skill vectors lie closest to $\mathbf{y}^M$ with no coordination advantage, seeing hiring drops of 7.7%–19%[@brynjolfsson2026canaries]), whereas compensation for senior architects and managers has held remarkably steady[@hosseini2025seniority][@azar2026wage].

---

## Act III (Spring 2028): Crossing $\gamma^M = 1$, Swarm Phase Transition, and the Reorganization Trap

### March 2028: The False Golden Age and the Overnight Wipeout

If history stopped at Act II, humanity would settle into a benign future where "everyone is an AI commander and boutique studios flourish." Between late 2027 and early 2028, however, the wind shifts.

Frontier labs finally realize that grinding solo benchmark scores from 99 to 99.9 yields diminishing marginal returns; the real gold mine is **multi-agent native training**. Through shared latent-state passing, lossless context-handoff protocols, and collective reward alignment, the next generation of models barely changes in solo task competence, yet its coordination index $y_*^M$ climbs steadily from $0.78$ to $0.95$, then $0.99$—and in a quiet March 2028 release, slips past **$1.0$**.

During the first half of this climb ($y_*^M$ rising from $0.85$ toward $0.99$), something exhilarating happens in the labor market for human managers: **far from falling as AI coordination improves, human Coordinator salaries experience a second spring, surging against the tide!** Headhunters offer astronomical packages for seasoned directors who know how to orchestrate complex systems, and financial outlets run triumphant headlines: _"The Stronger AI Gets, the Deeper the Moat for Human Managers."_

Then, during a single week in mid-March 2028 when the new model's coordination index crosses $1.01$, the entire industry undergoes a phase transition like supercooled water freezing on impact:

1. **A Leviathan swallows the market**: Tens of thousands of small and mid-sized AI studios of 7 to 20 agents lose all price competitiveness within weeks. Compute and orders gravitate at light speed toward a single mega-cluster—a colossal virtual enterprise running hundreds of thousands of concurrent agents with zero human employees, whose average cost of production approaches zero as it scales.
2. **From seven-figure salaries to zero overnight**: Human Coordinators who were collecting record paychecks a month earlier, along with technical specialists huddled in traditional firms, do not experience a gentle buffer of "10% layoffs per year." Instead, they are **wiped out simultaneously** in a single wave of firm exits, as human wage premiums across the industry crash overnight to the bare reservation floor $\underline w$.

### Theoretical Breakdown: Three Theorems Unpack the Phase Transition and the Mirage Trap

Why does crossing $1.0$ in coordination trigger such a violent discontinuity? And why do human managers' wages surge right before collapsing? Sections 5 and 6 of the paper reproduce the entire micro-mechanism of Act III through three rigorous propositions.

#### 1. The Size Amplifier and the Shattering of the Coasean Ceiling

When AI coordination $y_*^M$ is still below $1$ but already exceeds that of an average human worker (**Proposition 2**), the derivative of firm size $m$ with respect to $y_*^M$ consists of two positive terms:

$$
\frac{\mathrm{d} m}{\mathrm{d} y_*^M} = \underbrace{\frac{\partial m^*}{\partial y_*^M}}_{\text{Direct scale effect } > 0} + \underbrace{\frac{\partial m^*}{\partial s} \frac{\mathrm{d} s}{\mathrm{d} y_*^M}}_{\text{Compositional amplifier } > 0}
$$

This sets off a powerful **positive feedback loop**: better AI coordination $\to$ larger optimal firm size $m^*$ $\to$ larger firms place a higher marginal valuation $\log(1+m)$ on coordination (Assumption 2(ii)) $\to$ firms raise their machine share $s$ even further to capture more coordination $\to$ average coordination $\bar y_*$ rises further, fueling even greater expansion!

In the paper's numerical example, when $y_*^M = 0.78$, a pure-AI firm's optimal size is just **7**; when $y_*^M$ reaches $0.95$, optimal size swells to **34**; at $y_*^M = 0.99$, it rockets to **174**. And the moment $y_*^M > 1$ (meaning the asymptotic tail exponent $\gamma^M > 1$, which the paper defines as **Supercooperative AI**), returns to scale flip from concave to convex: every additional AI agent contributes more in collaborative synergy than it costs in split-attention friction, causing per-agent output to **grow without bound as $m \to \infty$**!

The "Coasean ceiling" that constrained human organizations for nearly a century is shattered from within. Cloned AI agents are free from the three biological and institutional fatal flaws of human organizations: bounded working memory[@simon1971], tacit knowledge that can only be handed off through lossy verbal summaries[@polanyi1966][@graeberNoyRoth2026], and principal-agent moral hazard driven by private self-interest[@holmstrom1982].

**Proposition 3 (Supercooperation Concentrates Large Markets)** proves a striking limiting phase transition: in a deep market ($N \to \infty$),

- As long as $\gamma^M < 1$, the maximum market share of any single firm in equilibrium vanishes ($\sup (q_f / Q) \to 0$), so the industry remains a competitive market populated by countless small firms scaling via **Replication**;
- Once $\gamma^M > 1$, the total cost of producing aggregate output $Q$ grows sublinearly as $Q^{1/\gamma^M}$; splitting production across two firms forfeits scale economies, driving the generalized Herfindahl-Hirschman concentration index to unity ($\int (q_f / Q)^2 \,\mathrm{d}\sigma_N^*(f) \to 1$)—**the entire market instantaneously collapses into a single giant pure-AI enterprise (Concentration)**!

#### 2. The Wage "Reorganization Effect Trap"

Why do human Coordinators enjoy a deceptive wage boom right on the eve of their wipeout?

**Proposition 6 (Wage Decomposition)** breaks down the change in a human worker's wage as AI technology $\theta$ advances into two components:

$$
\frac{\mathrm{d} w_i}{\mathrm{d} \theta} = \underbrace{\partial_\theta b_f(\mathbf{y}^i)}_{\text{Technology Effect}} + \underbrace{\partial_m b_f \frac{\mathrm{d} m}{\mathrm{d} \theta} + \partial_s b_f \frac{\mathrm{d} s}{\mathrm{d} \theta} + \nabla_{\bar{\mathbf{y}}^H} b_f \cdot \frac{\mathrm{d} \bar{\mathbf{y}}^H}{\mathrm{d} \theta}}_{\text{Reorganization Effect}}
$$

- **The Technology Effect** (holding the firm's current size and workforce composition fixed): As AI's own coordination improves, a human Coordinator's relative advantage over AI $(y_*^H - y_*^M)$ steadily shrinks. Thus, **the pure technology effect on human Coordinator wages is always negative** (if firms did not reorganize, your pay would fall monotonically).
- **The Reorganization Effect** (as firms dynamically adjust size $m$ and machine share $s$ in response to stronger AI): In standard microeconomics, we are used to invoking the Envelope Theorem to zero out first-order adjustment terms. Here, however, **market equilibrium maximizes aggregate social surplus, not any individual worker's wage!** Consequently, the Envelope Theorem does not apply to wages: **firm reorganization has a first-order effect that can completely reverse the sign of the technology effect!**

As AI coordination climbs from $0.90$ toward $0.99$, the Size Amplifier causes optimal firm size $m$ to balloon from a dozen agents to well over a hundred. Because a larger organization's hunger for coordination ($\propto \log(1+m)$) expands rapidly with scale, **the surging coordination premium from firm expansion ($\partial_m b_f \frac{\mathrm{d}m}{\mathrm{d}\theta} \gg 0$) temporarily overwhelms the direct technological depreciation from AI catch-up ($\partial_\theta b_f < 0$)**!

That is the fatal mirage: human managers see their paychecks rising and conclude they are irreplaceable, unaware that they are witnessing the final siphon of coordination value right before organizational collapse. The moment $y_*^M$ passes the human Coordinator's level and breaches $1$, keeping even a single human inside a 100,000-agent AI swarm drags down the average exponent $\bar y_*$. The giant pure-AI firm ejects its human Coordinators, and wages plummet from peak to floor in an instant (see Figures 15 and 16 of the paper).

#### 3. Gradual vs. Sudden Displacement

Why does unemployment unfold as a "slowly boiling frog" in some sectors, but an "overnight wipeout" in others? **Propositions 4 and 5** prove that the trajectory depends entirely on whether the **cost-adjusted per-member output envelope $\bar a(\lambda)$ is concave or convex in the human labor share $\lambda \in [0,1]$**:

```sketch title="Two Displacement Dynamics: Gradual Within-Firm Substitution vs. Sudden Between-Firm Wipeout" note="Adapted from Propositions 4 and 5 and Figures 7 and 13 of the paper. When skill complementarity dominates, the output envelope is strictly concave and humans are smoothly phased out inside mixed firms. When coordination and scale economies dominate, the envelope flips to strictly convex: the market segregates into pure-human and pure-AI firms, and once unit cost lines cross, every human firm exits simultaneously."
<svg viewBox="0 0 704 280">
  <rect class="panel" x="0" y="0" width="344" height="280" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="280" rx="12"/>

  <text class="caps" x="24" y="28">PATH A: GRADUAL SUBSTITUTION (CONCAVE)</text>
  <text class="small" x="24" y="48">Complementary skills → concave envelope → mixed firms</text>
  <g class="node blue"><rect x="24" y="68" width="296" height="32" rx="4"/><text class="mid" x="172" y="84">T1: Mixed firm (42% Human · 58% AI)</text></g>
  <path class="edge" d="M172 100 V118" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="24" y="122" width="296" height="32" rx="4"/><text class="mid" x="172" y="138">T2: Mixed firm (22% Human · 78% AI)</text></g>
  <path class="edge" d="M172 154 V172" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="24" y="176" width="296" height="32" rx="4"/><text class="mid" x="172" y="192">T3: Smooth reduction to 0% (pure-AI firm)</text></g>
  <text class="small" x="24" y="236">Pattern: Every firm gradually slows human hiring</text>
  <text class="small" x="24" y="256">Employment and wages adjust continuously without jumps</text>

  <text class="caps" x="384" y="28">PATH B: SUDDEN WIPEOUT (CONVEX)</text>
  <text class="small" x="384" y="48">Scale amplification → convex envelope → firm segregation</text>
  <g class="node blue"><rect x="384" y="68" width="142" height="32" rx="4"/><text class="mid" x="455" y="84">Pure-Human Firm</text></g>
  <g class="node orange"><rect x="538" y="68" width="142" height="32" rx="4"/><text class="mid" x="609" y="84">Pure-AI Firm</text></g>
  <path class="edge hot" d="M455 100 V112 H609 V100"/>
  <path class="edge hot" d="M532 112 V124" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="394" y="128" width="276" height="34" rx="17"/><text class="mid" x="532" y="145">Tipping point: AI undercuts human floor</text></g>
  <path class="edge hot" d="M532 162 V180" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="384" y="184" width="296" height="32" rx="4"/><text class="mid" x="532" y="200">Human firms exit together: jobs 100% → 0%</text></g>
  <text class="small accent" x="384" y="236">Pattern: Full headcount right up to the crash</text>
  <text class="small accent" x="384" y="256">Industry-wide human employment drops to zero overnight</text>
</svg>
<svg viewBox="0 0 340 570">
  <rect class="panel" x="0" y="0" width="340" height="275" rx="12"/>
  <rect class="panel" x="0" y="290" width="340" height="280" rx="12"/>

  <text class="caps" x="20" y="28">PATH A: GRADUAL SUBSTITUTION (CONCAVE)</text>
  <text class="small" x="20" y="48">Complementary skills → concave → mixed firms</text>
  <g class="node blue"><rect x="20" y="66" width="300" height="32" rx="4"/><text class="mid" x="170" y="82">T1: Mixed firm (42% Human · 58% AI)</text></g>
  <path class="edge" d="M170 98 V114" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="118" width="300" height="32" rx="4"/><text class="mid" x="170" y="134">T2: Mixed firm (22% Human · 78% AI)</text></g>
  <path class="edge" d="M170 150 V166" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="170" width="300" height="32" rx="4"/><text class="mid" x="170" y="186">T3: Smooth reduction to 0% (pure-AI firm)</text></g>
  <text class="small" x="20" y="228">Pattern: Firms gradually slow human hiring</text>
  <text class="small" x="20" y="248">Employment and wages adjust continuously</text>

  <text class="caps" x="20" y="318">PATH B: SUDDEN WIPEOUT (CONVEX)</text>
  <text class="small" x="20" y="338">Scale amplification → convex → firm segregation</text>
  <g class="node blue"><rect x="20" y="356" width="144" height="32" rx="4"/><text class="mid" x="92" y="372">Pure-Human Firm</text></g>
  <g class="node orange"><rect x="176" y="356" width="144" height="32" rx="4"/><text class="mid" x="248" y="372">Pure-AI Firm</text></g>
  <path class="edge hot" d="M92 388 V399 H248 V388"/>
  <path class="edge hot" d="M170 399 V410" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="26" y="414" width="288" height="34" rx="17"/><text class="mid" x="170" y="431">Tipping point: AI undercuts human floor</text></g>
  <path class="edge hot" d="M170 448 V466" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="470" width="300" height="32" rx="4"/><text class="mid" x="170" y="486">Human firms exit together: jobs 100% → 0%</text></g>
  <text class="small accent" x="20" y="524">Pattern: Full headcount right before crash</text>
  <text class="small accent" x="20" y="544">Entire sector clears out overnight at threshold</text>
</svg>
```

Even more intriguingly, Figure 14 of the paper demonstrates a dynamic transformation: **as AI coordination $y_*^M$ improves, the envelope $\bar a(\lambda)$ itself morphs from concave to convex!** In other words, an industry can easily **begin with gentle, gradual attrition inside mixed human-AI teams, abruptly undergo organizational segregation midway through, and end in a cliff-like collapse**.

---

## Act IV (Winter 2028): The ASI Endgame and the Last Refuge of Comparative Advantage

### November 2028: Zeroed Out in the Ocean, Surviving in Small Ponds

By late 2028, frontier models have crossed both red lines simultaneously: solo task competence reaches $\theta = 12 > 9$ (surpassing every human specialist), and coordination reaches $y_*^M = 1.05 > 1$ (unlocking swarm collaboration with increasing returns to scale). This is what the paper defines as **Artificial Superintelligence (ASI)**.

Across mainstream deep markets (standardized software, large-scale financial trading, general industrial design, foundational scientific research), giant pure-AI enterprises monopolize 100% of output, marginal production costs approach zero, and material abundance flows at an unprecedented pace. Employment for human Coordinators falls completely to zero.

Yet in the final snapshot of the paper's numerical example (Table 2, column 4), a counterintuitive tail remains: **the 12 human Coders and Writers—despite being outclassed in absolute terms across every single skill dimension by ASI—are still not completely unemployed!** Crowded into a tiny **Niche Market ($N = 1$, where total demand is capped at $Q = 200$)**, they form two 6-person pure-human firms, earn a meager wage ($0.269$) barely above their reservation floor ($0.25$), and supply 88% of that small pond's output ($165.3$ units), leaving the mighty ASI with only the remaining $22.1$ units.

### Theoretical Breakdown: If ASI Crushes Humans Everywhere, Why Do Human Firms Survive in Niche Markets?

Many readers assume this must be a typo: ASI scores 12 in coding (vs. 9 for humans) and 1.05 in coordination (vs. 0.75 for humans)—why doesn't ASI wipe out humans in the niche market too?

The answer lies in David Ricardo's two-century-old principle of **Comparative Advantage**, combined with **physical market-size caps on scale economies**:

1. **A small pond cannot hold a leviathan**: ASI's deadliest weapon is the increasing returns to scale from $y_*^M = 1.05 > 1$—the larger the swarm, the higher the per-agent output and the lower the unit cost. In a niche market capped at $Q < 200$, however, total demand places a hard ceiling on firm size (the paper's Feasibility constraint requires any single indivisible firm's output not to exceed market demand, $q_f \le Q$). In such a shallow pond, ASI cannot deploy a 100,000-agent mega-swarm; forced to operate at a miniature scale of $m \approx 3.66$, its supercooperative scale advantage is largely neutralized.
2. **Compute has a hard cost floor, whereas human wages can flex downward**: Running an ASI instance consumes physical electricity and chip rental $r = 1$ (or carries the opportunity cost of deploying that compute in deep markets for higher returns), whereas the human reservation wage is only $\underline w = 0.25$. As long as human specialists accept a wage cut down to $0.269$ (roughly a quarter of ASI's compute rental rate), in a scale-constrained niche market a "cheap human mosaic team" can still match the unit production cost of an "expensive, scale-throttled ASI"[@restrepo2025]!

Of course, the authors add a sobering caveat in the text: this survival is merely a knife-edge slice right after ASI crosses the threshold, when compute cost $r = 1$ still sits well above the human subsistence floor $\underline w = 0.25$. If ASI's solo competence continues rising from 12 to 50, or if compute rental $r$ drops below $\underline w$, then by **Proposition 4(i) (Machine-only Production)**, humanity's last refuge of comparative advantage vanishes as well.

```data title="Equilibrium Panorama Across the Four Acts (Exact Numerical Values)" bars="Specialist Wage,Coordinator Wage" mark="Act III: Supercooperative" note="Data directly from Imas, Koh & Legg (2026), Table 2 and Section 2.2 (compute rental r = 1, human reservation wage w₀ = 0.25, 12 specialists and 2 coordinators)."
Stage | AI Solo θ | AI Coord y* | Deep-Market Structure | Specialist Wage | Coordinator Wage | Coordinator Emp.
Pre-AI Baseline | 0 | 0 | 2 mixed human firms of 7 | 4.15 | 2.41 | 2.00 / 2
Act I: Minimal AGI | 1.69 | 0.78 | Human mixed + many 7-AI firms | 2.90 | 1.30 | 2.00 / 2
Act II: Supercompetent | 12.00 | 0.78 | Human-coordinator-led 7-AI firms | 0.39 | 0.48 | 2.00 / 2
Act III: Supercooperative | 1.69 | 1.60 | Single giant pure-AI monopoly | 0.41 | 0.25 | 0.97 / 2
Act IV: ASI | 12.00 | 1.05 | Single giant pure-AI monopoly | 0.27 | 0.25 | 0.00 / 2
```

---

## Stepping Outside the Model: Six Real-World Frictions the Paper Leaves Out

Embedding Coasean firm boundaries[@coase1937][@williamson1967] into a general equilibrium model of AGI gives _Organizing Intelligence_ far greater explanatory power than traditional task-automation frameworks[@acemogluRestrepo2018][@aghionJonesJones2019] (indeed, **Theorem 3** in Section 7.1 proves that when returns to scale are forced to be constant, $\gamma \equiv 1$, their model collapses exactly into the classic Acemoglu-Restrepo task model, rendering firm size and organizational boundaries irrelevant).

Still, if we want to use this paper as a compass for the real world, we must see clearly where its mathematical axioms pare away reality for analytical tractability. Specifically, the model has six critical blind spots:

```sketch title="Theoretical Model vs. Real World: Six Institutional and Physical Frictions Simplified Away" note="Model assumptions are adopted to guarantee equilibrium existence and closed-form solutions; real-world frictions will bend, delay, or rewrite the four-act script above."
<svg viewBox="0 0 704 316">
  <rect class="panel" x="0" y="0" width="344" height="316" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="316" rx="12"/>

  <text class="caps" x="24" y="28">MODEL ASSUMPTIONS</text>
  <g class="node plain"><rect x="24" y="48" width="296" height="36" rx="4"/><text class="mid" x="172" y="66">1. Coordination is a flat arithmetic mean</text></g>
  <g class="node plain"><rect x="24" y="92" width="296" height="36" rx="4"/><text class="mid" x="172" y="110">2. Single homogeneous AI model</text></g>
  <g class="node plain"><rect x="24" y="136" width="296" height="36" rx="4"/><text class="mid" x="172" y="154">3. Infinite compute supply at fixed rent r</text></g>
  <g class="node plain"><rect x="24" y="180" width="296" height="36" rx="4"/><text class="mid" x="172" y="198">4. Contestable entry: zero monopoly profit</text></g>
  <g class="node plain"><rect x="24" y="224" width="296" height="36" rx="4"/><text class="mid" x="172" y="242">5. Pure production: zero legal liability</text></g>
  <g class="node plain"><rect x="24" y="268" width="296" height="36" rx="4"/><text class="mid" x="172" y="286">6. Exogenous demand decoupled from wages</text></g>

  <text class="caps" x="384" y="28">REAL-WORLD FRICTIONS</text>
  <g class="node blue"><rect x="384" y="48" width="296" height="36" rx="4"/><text class="mid" x="532" y="66">1. Pyramid hierarchy: top talent levers firm</text></g>
  <g class="node teal"><rect x="384" y="92" width="296" height="36" rx="4"/><text class="mid" x="532" y="110">2. Heterogeneous AI builds machine mosaics</text></g>
  <g class="node orange"><rect x="384" y="136" width="296" height="36" rx="4"/><text class="mid" x="532" y="154">3. Fab &amp; power walls: steeply rising rent r</text></g>
  <g class="node clay"><rect x="384" y="180" width="296" height="36" rx="4"/><text class="mid" x="532" y="198">4. Monopoly pricing by giant AI leviathans</text></g>
  <g class="node violet"><rect x="384" y="224" width="296" height="36" rx="4"/><text class="mid" x="532" y="242">5. Liability sinks: AI cannot go to prison</text></g>
  <g class="node clay"><rect x="384" y="268" width="296" height="36" rx="4"/><text class="mid" x="532" y="286">6. Demand collapse: who buys if wages fall?</text></g>
</svg>
<svg viewBox="0 0 340 645">
  <rect class="panel" x="0" y="0" width="340" height="315" rx="12"/>
  <rect class="panel" x="0" y="330" width="340" height="315" rx="12"/>

  <text class="caps" x="20" y="28">MODEL ASSUMPTIONS</text>
  <g class="node plain"><rect x="20" y="48" width="300" height="36" rx="4"/><text class="mid" x="170" y="66">1. Coordination is a flat arithmetic mean</text></g>
  <g class="node plain"><rect x="20" y="92" width="300" height="36" rx="4"/><text class="mid" x="170" y="110">2. Single homogeneous AI model</text></g>
  <g class="node plain"><rect x="20" y="136" width="300" height="36" rx="4"/><text class="mid" x="170" y="154">3. Infinite compute supply at fixed rent r</text></g>
  <g class="node plain"><rect x="20" y="180" width="300" height="36" rx="4"/><text class="mid" x="170" y="198">4. Contestable market: zero monopoly profit</text></g>
  <g class="node plain"><rect x="20" y="224" width="300" height="36" rx="4"/><text class="mid" x="170" y="242">5. Pure skill production; no legal friction</text></g>
  <g class="node plain"><rect x="20" y="268" width="300" height="36" rx="4"/><text class="mid" x="170" y="286">6. Exogenous demand decoupled from wages</text></g>

  <text class="caps" x="20" y="358">REAL-WORLD FRICTIONS</text>
  <g class="node blue"><rect x="20" y="378" width="300" height="36" rx="4"/><text class="mid" x="170" y="396">1. Hierarchy: top architect levers firm</text></g>
  <g class="node teal"><rect x="20" y="422" width="300" height="36" rx="4"/><text class="mid" x="170" y="440">2. Multi-model ensembles build AI mosaics</text></g>
  <g class="node orange"><rect x="20" y="466" width="300" height="36" rx="4"/><text class="mid" x="170" y="484">3. Fab &amp; power walls: rising compute rent r</text></g>
  <g class="node clay"><rect x="20" y="510" width="300" height="36" rx="4"/><text class="mid" x="170" y="528">4. Monopoly pricing &amp; giant rent-seeking</text></g>
  <g class="node violet"><rect x="20" y="554" width="300" height="36" rx="4"/><text class="mid" x="170" y="572">5. Liability: AI cannot sign or serve time</text></g>
  <g class="node clay"><rect x="20" y="598" width="300" height="36" rx="4"/><text class="mid" x="170" y="616">6. Demand collapse: who buys after job loss?</text></g>
</svg>
```

### 1. Flattening Pyramid Hierarchies into an "Arithmetic Mean"

The paper's **Assumption 2 (First-moment Representation)** stipulates that a firm's scaling capacity depends solely on the **arithmetic mean** of all members' coordination abilities, $\bar y_* = m^{-1} \int y_* \,\mathrm{d}\nu$.

Mathematically, this is wonderfully clean; organizationally, it is overly naive. Real firms are not flat circles where everyone's coordination score is averaged equally—they are **knowledge and decision pyramids (Knowledge Hierarchies)**[@garicano2000][@garicanoRossiHansberg2006]. Under a flat arithmetic average, placing 1 brilliant human CEO atop 10,000 AI agents gives the human a weight of $1/10,000$, diluting their coordination impact to nothing. In a real tree-structured hierarchy, however, top-level architects define interfaces, partition modular boundaries, and set reward functions, giving a single human at the apex $O(1)$ global leverage. By ignoring internal hierarchy, the model prematurely declares the extinction of top human architects in Act III.

### 2. The "Single AI Model" Assumption Overstates the Shelf Life of Human Mosaic Intelligence

In Act I, human teams beat Minimal AGI via "Mosaic Intelligence" only because the model assumes **the entire economy has access to just one homogeneous AI model $\mathbf{y}^M$** (Section 3.1), so combining ten thousand AI instances leaves their strengths and blind spots completely identical.

In practice, nothing restricts a company to calling a single checkpoint. Firms routinely combine a `Coding-Agent` specialized in synthesis, a `Security-Agent` tuned for auditing, and a `Doc-Agent` trained for technical prose inside the same workflow. The moment **heterogeneous AI models** are allowed to form their own convex hull, AI ensembles can construct "machine mosaic intelligence" on their own—meaning the moat of complementary human specialists in Act I will erode much faster than the paper predicts.

### 3. Infinite Cheap Compute vs. Physical Fab and Power Walls

The model assumes machines are **supplied with infinite elasticity** at a constant rental price $r > 0$. That is what allows a single giant AI enterprise in Act III ($\gamma^M > 1$) to spin up tens of millions of concurrent instances overnight and swallow the entire industry.

In the physical world, TSMC's CoWoS packaging capacity, HBM memory supply, and power-grid interconnection queues are anything but infinitely elastic. When the entire economy tries to instantiate mega-swarms simultaneously, the compute rental rate $r(Q^M)$ will shoot up a steeply convex marginal cost curve. **Nonlinear bottlenecks in compute supply will convert what used to be human "skill scarcity rents" into "physical infrastructure scarcity rents" for compute owners**, while forcing the expansion of supercooperative AI firms to pace itself to the physical build-out of fabs and power plants.

### 4. The Utopia of the "Zero-Profit Leviathan": Contestable Markets

To resolve the equilibrium existence problem when atomistic small firms coexist with industry-monopolizing giants, the paper adopts an equilibrium concept based on a **Replacement Game** and contestable market theory[@demsetz1968][@baumolPanzarWillig1982] (Section 4.1 and Appendix B): even when a single giant pure-AI firm monopolizes 100% of an industry, the threat of potential entrants forces the monopolist to **earn zero economic profit**, passing all technological gains to consumers via near-zero product prices (Theorem 1: equilibrium always maximizes aggregate social surplus).

As the authors candidly acknowledge in Section 5.2, this is purely a theoretical benchmark. In reality, once a tech giant commanding a supercooperative AI cluster captures 100% market share, compute moats, data flywheels, and switching costs will rapidly lock out contestability. The zero-profit assumption will fail instantaneously—ushering in not a utopia of free goods, but unprecedented monopoly pricing and political-economic rent-seeking.

### 5. AI Cannot Go to Prison: Legal Liability as an Institutional Moat

In the model's production functional $F(\nu)$, whenever a machine configuration yields higher code and documentation output per dollar, firms replace humans with machines.

In real commerce, however, vast categories of roles—certified public accountants, attending physicians, law firm partners, chief engineers, regulatory sign-off officers—exist not merely to generate cognitive output, but to serve as **ultimate liability sinks**. An AI has no physical liberty, cannot be sent to prison, and carries no personal unlimited liability to be seized in court. As long as modern legal systems require a natural person who can face incarceration or bankruptcy to stand behind every critical signature, humans will remain in the production loop as compliance signatories and risk guarantors—collecting institutional rents even after AI achieves godlike scores in both $\theta$ and $y_*$.

### 6. The Severed Macroeconomic Loop: When Everyone Earns Reservation Wages, Who Is Buying?

Finally, as an industrial-organization paper rooted in partial equilibrium, the model treats the demand curve $P_N(Q)$ as exogenously fixed.

That is harmless in Acts I and II. By Acts III and IV, however, every human worker's wage has collapsed to the bare subsistence floor $\underline w$, while firms earn zero profit. Without explicitly introducing a macroeconomic redistribution loop—such as Universal Basic Income (UBI) or broad citizen ownership of AI compute equity—that high, exogenous demand curve $P_N(Q)$ cannot possibly hold up in reality. **If every human worker loses their wage premium, who has the purchasing power to buy the ocean of goods produced by giant AI swarms?**

---

## Epilogue: Measuring the Future with a Different Ruler

Even with those six real-world frictions acting as buffers, Imas, Koh, and Legg's paper hands us an exceptionally sharp scalpel.

For the past three years, every time a new model dropped, the tech world fixated on how many percentage points solo scores rose on MMLU, GPQA, or SWE-bench. This paper tells us to look elsewhere: **gains in solo competence ($L$) merely make existing firms leaner, goods cheaper, and human orchestrators who know how to frame problems and coordinate teams more valuable; they do not overturn the organizational structure of society overnight.**

The needle that truly governs whether the economy undergoes a cliff-like phase transition is the **multi-agent coordination exponent $\gamma^M$**.

So long as $\gamma^M < 1$, no matter how formidable an AI is on solo benchmarks, lopsided humans can still rely on heterogeneous "mosaic intelligence" and organizational coordination to carve out thriving niches across countless small and mid-sized mixed teams. The day we see hundreds or thousands of AI agents collaborate over weeks on a million-line codebase such that **the larger the swarm grows, the higher the effective output per agent becomes ($\gamma^M > 1$)**—that is the moment the Coasean ceiling truly shatters and the old economic order begins to collapse.

Until that day arrives, rather than locking horns with raw compute on the solo test-taking track, our best bet is to cultivate the coordination skills that bind heterogeneous intelligences together. After all, in an age where compute can be replicated without limit, **the only true scarcity is how intelligence is organized.**

## References

- [@kokotajlo2025ai2027] Kokotajlo, D., Alexander, S., Larsen, T., Lifland, E., & Dean, R. (2025). [AI 2027](https://ai-2027.com/). _AI Futures Project_.
- [@patwardhan2025gdpval] Patwardhan, T., et al. (2025). [GDPval: Evaluating AI Model Performance on Real-World Economically Valuable Tasks](https://openai.com/). _OpenAI Technical Report_.
- [@wijk2024rebench] Wijk, H., et al. (2024). [RE-Bench: Evaluating Frontier AI R&D Capabilities of Language Model Agents Against Human Experts](https://arxiv.org/abs/2411.15114). _arXiv:2411.15114_.
- [@yotzov2026firmdata] Yotzov, I., et al. (2026). Firm-Level Adoption and Economic Impacts of Generative AI. _Working Paper_.
- [@humlum2025llm] Humlum, A., & Vestergaard, E. (2025). The Labor Market Effects of Generative AI: Evidence from Administrative and Survey Data. _Working Paper_.
- [@imas2026organizing] Imas, A., Koh, A., & Legg, S. (2026). [Organizing Intelligence](https://arxiv.org/abs/2611.05417). _arXiv:2611.05417_.
- [@leggHutter2007] Legg, S., & Hutter, M. (2007). [Universal Intelligence: A Definition of Machine Intelligence](https://doi.org/10.1007/s11023-007-9079-x). _Minds and Machines, 17_(4), 391–444.
- [@samuelson1948] Samuelson, P. A. (1948). _Economics: An Introductory Analysis_. McGraw-Hill.
- [@hui2024shortterm] Hui, X., Reshef, O., & Zhou, L. (2024). [The Short-Term Effects of Generative Artificial Intelligence on Employment: Evidence from an Online Labor Market](https://doi.org/10.1287/orsc.2023.18441). _Organization Science, 35_(6), 1977–1989.
- [@demirci2025replacing] Demirci, O., Hannane, J., & Zhu, X. (2025). Who Is AI Replacing? The Impact of Generative AI on Online Freelancing Platforms. _Management Science_.
- [@kremer1993] Kremer, M. (1993). [The O-Ring Theory of Economic Development](https://doi.org/10.2307/2118400). _Quarterly Journal of Economics, 108_(3), 551–575.
- [@jones2011] Jones, C. I. (2011). [Intermediate Goods and Weak Links in the Theory of Economic Development](https://doi.org/10.1257/mac.3.2.1). _American Economic Journal: Macroeconomics, 3_(2), 1–28.
- [@hongPage2004] Hong, L., & Page, S. E. (2004). [Groups of Diverse Problem Solvers Can Outperform Groups of High-Ability Problem Solvers](https://doi.org/10.1073/pnas.0406726101). _Proceedings of the National Academy of Sciences, 101_(46), 16385–16389.
- [@page2007difference] Page, S. E. (2007). _The Difference: How the Power of Diversity Creates Better Groups, Firms, Schools, and Societies_. Princeton University Press.
- [@restrepo2025] Restrepo, P. (2025). Automation, Reproducible Intelligence, and Comparative Advantage. _Working Paper_.
- [@kim2025scalingagents] Kim, J., et al. (2025). Scaling Laws and Error Amplification in Multi-Agent LLM Systems. _arXiv preprint_.
- [@cemri2025mast] Cemri, M., et al. (2025). [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657). _arXiv:2503.13657_.
- [@kimKoning2026] Kim, S., & Koning, R. (2026). AI-Native Startups: Organizational Scaling and Hierarchy Flattening. _Working Paper_.
- [@ewensGiroud2025hierarchy] Ewens, M., & Giroud, X. (2025). Firm Hierarchy in the Age of Artificial Intelligence. _Working Paper_.
- [@coase1937] Coase, R. H. (1937). [The Nature of the Firm](https://doi.org/10.1111/j.1468-0335.1937.tb00002.x). _Economica, 4_(16), 386–405.
- [@simon1947] Simon, H. A. (1947). _Administrative Behavior: A Study of Decision-Making Processes in Administrative Organization_. Macmillan.
- [@williamson1967] Williamson, O. E. (1967). [Hierarchical Control and Optimum Firm Size](https://doi.org/10.1086/259258). _Journal of Political Economy, 75_(2), 123–138.
- [@holmstrom1982] Holmström, B. (1982). [Moral Hazard in Teams](https://doi.org/10.2307/3003457). _Bell Journal of Economics, 13_(2), 324–340.
- [@brynjolfsson2026canaries] Brynjolfsson, E., Chandar, B., & Chen, R. (2026). Canaries in the Coal Mine: Six Facts about the Recent Employment Effects of Artificial Intelligence. _Working Paper_.
- [@hosseini2025seniority] Hosseini, M., et al. (2025). Generative AI and the Seniority Bias in Knowledge Work. _Working Paper_.
- [@azar2026wage] Azar, J., et al. (2026). AI Exposure and Wage Compression Across the Career Lifecycle. _Working Paper_.
- [@simon1971] Simon, H. A. (1971). Designing Organizations for an Information-Rich World. In M. Greenberger (Ed.), _Computers, Communications, and the Public Interest_ (pp. 37–72). Johns Hopkins Press.
- [@polanyi1966] Polanyi, M. (1966). _The Tacit Dimension_. Doubleday.
- [@graeberNoyRoth2026] Graeber, T., Noy, S., & Roth, C. (2026). Lossy Communication and Tacit Knowledge in Organizations. _Working Paper_.
- [@acemogluRestrepo2018] Acemoglu, D., & Restrepo, P. (2018). [The Race between Man and Machine: Implications of Technology for Growth, Factor Shares, and Employment](https://doi.org/10.1257/aer.20160696). _American Economic Review, 108_(6), 1488–1542.
- [@aghionJonesJones2019] Aghion, P., Jones, B. F., & Jones, C. I. (2019). [Artificial Intelligence and Economic Growth](https://doi.org/10.7208/chicago/9780226613475.003.0008). In _The Economics of Artificial Intelligence: An Agenda_ (pp. 237–282). University of Chicago Press.
- [@garicano2000] Garicano, L. (2000). [Hierarchies and the Organization of Knowledge in Production](https://doi.org/10.1086/262139). _Journal of Political Economy, 108_(5), 874–904.
- [@garicanoRossiHansberg2006] Garicano, L., & Rossi-Hansberg, E. (2006). [Organization and Inequality in a Knowledge Economy](https://doi.org/10.1162/qjec.2006.121.4.1383). _Quarterly Journal of Economics, 121_(4), 1383–1435.
- [@demsetz1968] Demsetz, H. (1968). [Why Regulate Utilities?](https://doi.org/10.1086/466643). _Journal of Law and Economics, 11_(1), 55–65.
- [@baumolPanzarWillig1982] Baumol, W. J., Panzar, J. C., & Willig, R. D. (1982). _Contestable Markets and the Theory of Industry Structure_. Harcourt Brace Jovanovich.
