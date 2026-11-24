---
title: "Profiting from Quiet Crypto Weekends: A Short Strangle Backtest"
description: "Backtesting a weekend short-strangle options strategy on Deribit public data across 208 weekends (2022-09 to 2026-08): the 35Δ BTC tier returned +1.166 BTC with an 81.3% win rate, while exposing the seller to tail weeks that wiped out more than ten weeks of average gains."
date: 2026-08-27
tag: "Trading"
tags:
  - "Options"
  - "Backtest"
  - "Crypto"
  - "Deribit"
  - "backtest-0001"
---
Weekend price action in crypto has largely converged with the rhythm of the US equity market: most of the time, it is two full days of sideways drift.

That raises a natural question: is there a systematic way to monetize those quiet 48 hours?

There is—selling weekend volatility via options. Against an existing spot holding, you sell an out-of-the-money (OTM) short strangle every Friday expiring on Sunday, pocketing 40 hours of option premium and Theta decay.

I backtested this strategy across 4 full years—208 weekends from September 2022 through August 2026—using official public data from Deribit, running separate books for BTC and ETH. This post covers the return profile, a step-by-step execution walkthrough, the mathematical pricing model underneath, and every painful tail event that option sellers inevitably face.

## What Is the Strategy?

In one phrase: **selling volatility insurance**.

Options implied volatility (IV) sits systematically above subsequent realized volatility (RV) most of the time—buyers are willing to pay a risk premium to hedge extreme moves, and sellers collect the spread between the two. Over the weekend, with traditional financial markets closed and major macro releases paused, realized volatility in crypto drops markedly below weekday levels. Yet options continue to decay on continuous 24/7 time, creating a natural habitat for short-dated volatility selling.

Still, we need to put the core caveat on the table upfront: **this is never risk-free arbitrage**.

A seller's upside is capped at the premium collected that week, while downside risk has no hard ceiling. When geopolitical shocks, regulatory crackdowns, or liquidity air-pockets hit over a weekend, crypto is the only 24/7 liquid risk asset open globally to absorb the selling pressure. A single weekend gap can erase weeks or even months of accumulated premium.

> Approach this strategy with caution—it will make your weekends feel very long. Stop pumping... stop dumping... please just stay still...

## How It Works: Step-by-Step Execution

Suppose you hold 1 BTC in spot and want to run this strategy live. The execution is purely mechanical:

::tv BINANCE:BTCUSDT Bitcoin / USDT Spot

### 1. Entry Timing

Every Friday at 16:00 UTC (midnight Friday in Beijing / 12:00 PM EDT), log in to the Deribit web interface or connect via API.

### 2. Contract Selection

Open the options chain and filter for the daily contracts **expiring that Sunday at 08:00 UTC (16:00 Beijing time)**—a holding window of exactly 40 hours.
Scan the chain for the two legs whose absolute Black-Scholes Delta is closest to your target tier (0.35 in our baseline):

- **Call leg**: Pick the OTM call with Delta closest to `+0.35` (for example, with BTC spot at $64,000, select the $65,500 strike call).
- **Put leg**: Pick the OTM put with Delta closest to `-0.35` (for example, the $62,500 strike put).

### 3. Order Placement

- Sell 1 contract of the selected Call;
- Sell 1 contract of the selected Put;
- Your account immediately receives the combined premium from both legs (say `0.011 BTC` in total, or roughly 1.1% of notional).

### 4. Position Structure and Margin Roles

- **Call leg**: The 1 BTC spot you hold naturally serves as collateral for a covered call. Even if spot rallies sharply, the appreciation of your underlying BTC offsets most of the settlement payout.
- **Put leg**: This is a naked short put. You must keep sufficient free margin in the account to withstand mark-to-market spikes and avoid forced liquidation during a sharp sell-off.

### 5. Automatic Sunday Settlement

At 08:00 UTC on Sunday, Deribit computes the **time-weighted average price (TWAP) of the Deribit Index between 07:30 and 08:00 UTC** as the official delivery price and cash-settles in coin:

- **Scenario A (Quiet weekend)**: The delivery price lands between $62,500 and $65,500. Both options expire worthless out of the money; you keep the entire `0.011 BTC` premium and repeat next Friday.
- **Scenario B (Directional breakout)**: The delivery price surges to $66,000 or drops to $61,000. The exchange automatically deducts the in-the-money (ITM) payout in coin. If the payout is smaller than the total premium collected, you still walk away with a small net gain; beyond the breakeven point, you take a net loss.

## Mathematical and Pricing Foundation

Every trade PnL in the backtest engine is governed by an explicit pricing equation. Here is the complete specification.

### 1. Black-Scholes Model ($r = 0$)

Because the 40-hour holding window is extremely short, discounting and forward drift affect option values by less than 1 basis point (Deribit inverse options use an implied forward rate $R = \frac{\ln(F/X)}{T}$, which over a 40-hour horizon is closely approximated by a zero risk-free rate $r = 0$):

$$
C = S\,N(d_1) - K\,N(d_2), \qquad P = K\,N(-d_2) - S\,N(-d_1)
$$

$$
d_1 = \frac{\ln(S/K) + \frac{1}{2}\sigma^2 T}{\sigma\sqrt{T}}, \qquad d_2 = d_1 - \sigma\sqrt{T}
$$

Key variables: $S$ is the underlying spot price (in USD) at Friday 16:00 UTC entry, $K$ is the strike price, $\sigma$ is annualized implied volatility (IV), $T$ is time to expiry in years (40 hours converts to $T = 40 / (365 \times 24) \approx 0.004566$ years), and $N(\cdot)$ is the standard normal cumulative distribution function.

### 2. Delta Selection vs. Risk-Neutral Exercise Probability

Delta measures the first derivative of theoretical option price with respect to spot:

$$
\Delta_C = N(d_1), \qquad \Delta_P = N(d_1) - 1
$$

Two distinctions matter in practice:
- Under Black-Scholes, the risk-neutral probability of a call finishing in the money is $N(d_2)$, not Delta $N(d_1)$ itself (the two are closely related but offset by $\sigma\sqrt{T}$);
- Real-world crypto return distributions exhibit pronounced **heavy tails and negative skewness**, so the physical probability of a strike being breached cannot be read off Delta directly. A 35Δ target simply serves as a standardized strike-selection ruler under Gaussian assumptions.

### 3. Implied Volatility (IV) Inversion

Market data gives us traded option prices; the engine inverts Black-Scholes via bisection to find the root where theoretical price equals market price, yielding implied volatility $\sigma^*$:

$$
\sigma^* = \mathrm{arg}\,\min_\sigma \left| V_{\mathrm{BS}}(S, K, \sigma, T) - P_{\mathrm{USD}} \right|
$$

### 4. Coin-Margined Payoff and Upside Payout Dilution

Deribit option contracts are denominated in BTC or ETH and settle in coin at expiry:

$$
\pi_C = \frac{\max(S_T - K,\ 0)}{S_T}, \qquad \pi_P = \frac{\max(K - S_T,\ 0)}{S_T}
$$

Notice $S_T$ in the denominator: when the underlying rallies sharply, each BTC is worth more in USD, which dilutes the coin-denominated call payout and creates a natural sub-linear loss curve on the upside. Net PnL for a single short leg is $\mathrm{PnL}_{\mathrm{leg}} = p - \pi - f_{\mathrm{open}} - f_{\mathrm{settle}}$.

### 5. Exchange Fee Model and Premium Caps

Deribit caps transaction and delivery fees as a fraction of option premium or payoff to protect deep-OTM trades:

$$
f_{\mathrm{open}} = \min(0.03\%,\ 0.125\,p), \qquad f_{\mathrm{settle}} = \mathbb{1}_{\pi > 0} \cdot \min(0.015\%,\ 0.125\,\pi)
$$

*Note: Under Deribit's current fee schedule, the delivery fee for BTC and ETH Daily Options has been reduced to **0%**. This backtest retains the historical 0.015% capped delivery fee model, making our net return estimates slightly conservative.*

## Backtest Results Dashboard

Across all 208 weekends from 2022-09-02 to 2026-08-21, the full historical backtest produces the following summary metrics:

```stats title="35Δ Weekend Short Strangle" meta="Deribit · 2022-09 → 2026-08 · 208 weeks"
## BTC Simple Coin-Margined
Total Return | +1.166 | +116.6% · ≈ $64,395
Win Rate | 81.25% | 169W / 39L
Sharpe | 3.43 | Profit factor 3.43
Max Drawdown | -0.105 | -10.5%
Premium Retained | 47.1% | Collected 2.475
Mean Weekly Return | +0.561% | Fees 0.1389
Best Week | +0.0269 | Mean win +0.0097
Worst Week | -0.0596 | Mean loss −0.0123
## ETH Simple Coin-Margined
Total Return | +1.146 | +114.6% · ≈ $2,418
Win Rate | 78.85% | 164W / 44L
Sharpe | 2.19 | Profit factor 2.30
Max Drawdown | -0.111 | -11.1%
Premium Retained | 34.3% | Collected 3.343
Mean Weekly Return | +0.551% | Fees 0.1406
Best Week | +0.0474 | Mean win +0.0124
Worst Week | -0.1018 | Mean loss −0.0201
```

### 1. 35Δ Payoff Structure at Expiry

Using the 208-week median parameters (entry spot $63,791, call strike $64,500, put strike $63,000, combined two-leg premium 0.011 BTC), here is the theoretical expiration payoff:

```chart line title="35Δ Short Strangle Payoff at Expiry" ref="62315,65217" xfmt="$%.0fk" xscale="0.001" note="In BTC, using median parameters: ~0.0055 BTC premium per leg, strikes at 63,000 / 64,500. Dashed lines mark the lower and upper breakeven points."
Settlement | Net PnL | Call Leg | Put Leg
56000 | -0.1140 | +0.0055 | -0.1195
56200 | -0.1100 | +0.0055 | -0.1155
56400 | -0.1060 | +0.0055 | -0.1115
56600 | -0.1021 | +0.0055 | -0.1076
56800 | -0.0982 | +0.0055 | -0.1037
57000 | -0.0943 | +0.0055 | -0.0998
57200 | -0.0904 | +0.0055 | -0.0959
57400 | -0.0866 | +0.0055 | -0.0921
57600 | -0.0828 | +0.0055 | -0.0882
57800 | -0.0790 | +0.0055 | -0.0845
58000 | -0.0752 | +0.0055 | -0.0807
58200 | -0.0715 | +0.0055 | -0.0770
58400 | -0.0678 | +0.0055 | -0.0733
58600 | -0.0641 | +0.0055 | -0.0696
58800 | -0.0604 | +0.0055 | -0.0659
59000 | -0.0568 | +0.0055 | -0.0623
59200 | -0.0532 | +0.0055 | -0.0587
59400 | -0.0496 | +0.0055 | -0.0551
59600 | -0.0460 | +0.0055 | -0.0515
59800 | -0.0425 | +0.0055 | -0.0480
60000 | -0.0390 | +0.0055 | -0.0445
60200 | -0.0355 | +0.0055 | -0.0410
60400 | -0.0320 | +0.0055 | -0.0375
60600 | -0.0286 | +0.0055 | -0.0341
60800 | -0.0252 | +0.0055 | -0.0307
61000 | -0.0218 | +0.0055 | -0.0273
61200 | -0.0184 | +0.0055 | -0.0239
61400 | -0.0151 | +0.0055 | -0.0206
61600 | -0.0117 | +0.0055 | -0.0172
61800 | -0.0084 | +0.0055 | -0.0139
62000 | -0.0051 | +0.0055 | -0.0106
62200 | -0.0019 | +0.0055 | -0.0074
62400 | +0.0014 | +0.0055 | -0.0041
62600 | +0.0046 | +0.0055 | -0.0009
62800 | +0.0078 | +0.0055 | +0.0023
63000 | +0.0110 | +0.0055 | +0.0055
63200 | +0.0110 | +0.0055 | +0.0055
63400 | +0.0110 | +0.0055 | +0.0055
63600 | +0.0110 | +0.0055 | +0.0055
63800 | +0.0110 | +0.0055 | +0.0055
64000 | +0.0110 | +0.0055 | +0.0055
64200 | +0.0110 | +0.0055 | +0.0055
64400 | +0.0110 | +0.0055 | +0.0055
64600 | +0.0095 | +0.0040 | +0.0055
64800 | +0.0064 | +0.0009 | +0.0055
65000 | +0.0033 | -0.0022 | +0.0055
65200 | +0.0003 | -0.0052 | +0.0055
65400 | -0.0028 | -0.0083 | +0.0055
65600 | -0.0058 | -0.0113 | +0.0055
65800 | -0.0088 | -0.0143 | +0.0055
66000 | -0.0117 | -0.0172 | +0.0055
66200 | -0.0147 | -0.0202 | +0.0055
66400 | -0.0176 | -0.0231 | +0.0055
66600 | -0.0205 | -0.0260 | +0.0055
66800 | -0.0234 | -0.0289 | +0.0055
67000 | -0.0263 | -0.0318 | +0.0055
67200 | -0.0292 | -0.0347 | +0.0055
67400 | -0.0320 | -0.0375 | +0.0055
67600 | -0.0349 | -0.0404 | +0.0055
67800 | -0.0377 | -0.0432 | +0.0055
68000 | -0.0405 | -0.0460 | +0.0055
68200 | -0.0433 | -0.0488 | +0.0055
68400 | -0.0460 | -0.0515 | +0.0055
68600 | -0.0488 | -0.0543 | +0.0055
68800 | -0.0515 | -0.0570 | +0.0055
69000 | -0.0542 | -0.0597 | +0.0055
69200 | -0.0569 | -0.0624 | +0.0055
69400 | -0.0596 | -0.0651 | +0.0055
69600 | -0.0623 | -0.0678 | +0.0055
69800 | -0.0649 | -0.0704 | +0.0055
70000 | -0.0676 | -0.0731 | +0.0055
70200 | -0.0702 | -0.0757 | +0.0055
70400 | -0.0728 | -0.0783 | +0.0055
70600 | -0.0754 | -0.0809 | +0.0055
70800 | -0.0780 | -0.0835 | +0.0055
71000 | -0.0805 | -0.0860 | +0.0055
71200 | -0.0831 | -0.0886 | +0.0055
71400 | -0.0856 | -0.0911 | +0.0055
71600 | -0.0882 | -0.0937 | +0.0055
71800 | -0.0907 | -0.0962 | +0.0055
72000 | -0.0932 | -0.0987 | +0.0055
```

The flat central plateau is the full-premium retention zone (where settlement stays within roughly ±2.3% of entry spot); beyond the lower and upper breakeven points ($62,315 and $65,217), the position enters net loss territory.

### 2. Cumulative Equity and Underwater Drawdowns

On a simple-interest basis (selling a fixed 1-contract strangle each week without compounding principal), BTC accumulated +1.166 BTC and ETH accumulated +1.146 ETH:

```chart line title="35Δ Cumulative PnL (Coin-Margined, Simple)" note="2022-09-02 to 2026-08-21, entered every Friday. BTC in BTC, ETH in ETH."
Friday | BTC | ETH
2022-09-02 | -0.001 | -0.006
2022-09-09 | +0.014 | +0.010
2022-09-16 | +0.028 | +0.033
2022-09-23 | +0.049 | +0.051
2022-09-30 | +0.057 | +0.046
2022-10-07 | +0.067 | +0.061
2022-10-14 | +0.081 | +0.069
2022-10-21 | +0.093 | +0.076
2022-10-28 | +0.098 | +0.049
2022-11-04 | +0.102 | +0.068
2022-11-11 | +0.128 | +0.116
2022-11-18 | +0.142 | +0.137
2022-11-25 | +0.154 | +0.142
2022-12-02 | +0.168 | +0.145
2022-12-09 | +0.176 | +0.159
2022-12-16 | +0.187 | +0.170
2022-12-23 | +0.194 | +0.181
2022-12-30 | +0.199 | +0.187
2023-01-06 | +0.205 | +0.194
2023-01-13 | +0.159 | +0.158
2023-01-20 | +0.100 | +0.138
2023-01-27 | +0.113 | +0.152
2023-02-03 | +0.124 | +0.168
2023-02-10 | +0.134 | +0.181
2023-02-17 | +0.150 | +0.204
2023-02-24 | +0.162 | +0.215
2023-03-03 | +0.172 | +0.229
2023-03-10 | +0.181 | +0.230
2023-03-17 | +0.199 | +0.236
2023-03-24 | +0.217 | +0.254
2023-03-31 | +0.233 | +0.269
2023-04-07 | +0.241 | +0.271
2023-04-14 | +0.254 | +0.286
2023-04-21 | +0.263 | +0.297
2023-04-28 | +0.275 | +0.312
2023-05-05 | +0.277 | +0.298
2023-05-12 | +0.276 | +0.308
2023-05-19 | +0.289 | +0.321
2023-05-26 | +0.289 | +0.331
2023-06-02 | +0.299 | +0.339
2023-06-09 | +0.287 | +0.308
2023-06-16 | +0.276 | +0.303
2023-06-23 | +0.291 | +0.318
2023-06-30 | +0.300 | +0.308
2023-07-07 | +0.311 | +0.316
2023-07-14 | +0.297 | +0.305
2023-07-21 | +0.306 | +0.313
2023-07-28 | +0.313 | +0.321
2023-08-04 | +0.318 | +0.327
2023-08-11 | +0.326 | +0.333
2023-08-18 | +0.343 | +0.347
2023-08-25 | +0.351 | +0.356
2023-09-01 | +0.358 | +0.363
2023-09-08 | +0.368 | +0.369
2023-09-15 | +0.376 | +0.373
2023-09-22 | +0.383 | +0.378
2023-09-29 | +0.387 | +0.383
2023-10-06 | +0.393 | +0.391
2023-10-13 | +0.401 | +0.397
2023-10-20 | +0.406 | +0.398
2023-10-27 | +0.417 | +0.410
2023-11-03 | +0.429 | +0.393
2023-11-10 | +0.444 | +0.405
2023-11-17 | +0.454 | +0.415
2023-11-24 | +0.465 | +0.426
2023-12-01 | +0.464 | +0.413
2023-12-08 | +0.476 | +0.426
2023-12-15 | +0.489 | +0.439
2023-12-22 | +0.499 | +0.450
2023-12-29 | +0.519 | +0.463
2024-01-05 | +0.537 | +0.486
2024-01-12 | +0.526 | +0.472
2024-01-19 | +0.534 | +0.485
2024-01-26 | +0.532 | +0.492
2024-02-02 | +0.537 | +0.500
2024-02-09 | +0.537 | +0.509
2024-02-16 | +0.549 | +0.522
2024-02-23 | +0.557 | +0.519
2024-03-01 | +0.567 | +0.535
2024-03-08 | +0.578 | +0.558
2024-03-15 | +0.574 | +0.527
2024-03-22 | +0.592 | +0.554
2024-03-29 | +0.601 | +0.549
2024-04-05 | +0.608 | +0.559
2024-04-12 | +0.561 | +0.472
2024-04-19 | +0.585 | +0.484
2024-04-26 | +0.598 | +0.448
2024-05-03 | +0.589 | +0.462
2024-05-10 | +0.605 | +0.478
2024-05-17 | +0.617 | +0.492
2024-05-24 | +0.621 | +0.491
2024-05-31 | +0.630 | +0.504
2024-06-07 | +0.623 | +0.493
2024-06-14 | +0.631 | +0.488
2024-06-21 | +0.641 | +0.505
2024-06-28 | +0.649 | +0.517
2024-07-05 | +0.659 | +0.533
2024-07-12 | +0.649 | +0.539
2024-07-19 | +0.659 | +0.554
2024-07-26 | +0.685 | +0.572
2024-08-02 | +0.664 | +0.552
2024-08-09 | +0.676 | +0.548
2024-08-16 | +0.676 | +0.559
2024-08-23 | +0.658 | +0.558
2024-08-30 | +0.672 | +0.572
2024-09-06 | +0.688 | +0.591
2024-09-13 | +0.699 | +0.603
2024-09-20 | +0.710 | +0.616
2024-09-27 | +0.721 | +0.621
2024-10-04 | +0.734 | +0.634
2024-10-11 | +0.744 | +0.645
2024-10-18 | +0.755 | +0.657
2024-10-25 | +0.763 | +0.660
2024-11-01 | +0.770 | +0.665
2024-11-08 | +0.758 | +0.616
2024-11-15 | +0.765 | +0.624
2024-11-22 | +0.783 | +0.634
2024-11-29 | +0.790 | +0.646
2024-12-06 | +0.802 | +0.665
2024-12-13 | +0.807 | +0.677
2024-12-20 | +0.831 | +0.703
2024-12-27 | +0.842 | +0.716
2025-01-03 | +0.852 | +0.728
2025-01-10 | +0.867 | +0.745
2025-01-17 | +0.877 | +0.727
2025-01-24 | +0.890 | +0.743
2025-01-31 | +0.847 | +0.667
2025-02-07 | +0.856 | +0.678
2025-02-14 | +0.863 | +0.694
2025-02-21 | +0.866 | +0.698
2025-02-28 | +0.884 | +0.736
2025-03-07 | +0.896 | +0.764
2025-03-14 | +0.913 | +0.783
2025-03-21 | +0.921 | +0.778
2025-03-28 | +0.930 | +0.789
2025-04-04 | +0.949 | +0.810
2025-04-11 | +0.945 | +0.817
2025-04-18 | +0.952 | +0.832
2025-04-25 | +0.958 | +0.849
2025-05-02 | +0.955 | +0.862
2025-05-09 | +0.966 | +0.839
2025-05-16 | +0.970 | +0.839
2025-05-23 | +0.976 | +0.845
2025-05-30 | +0.985 | +0.848
2025-06-06 | +0.990 | +0.864
2025-06-13 | +1.003 | +0.883
2025-06-20 | +1.004 | +0.819
2025-06-27 | +1.010 | +0.831
2025-07-04 | +1.017 | +0.845
2025-07-11 | +1.024 | +0.865
2025-07-18 | +1.032 | +0.869
2025-07-25 | +1.028 | +0.859
2025-08-01 | +1.025 | +0.847
2025-08-08 | +1.023 | +0.816
2025-08-15 | +1.029 | +0.835
2025-08-22 | +1.031 | +0.841
2025-08-29 | +1.040 | +0.840
2025-09-05 | +1.047 | +0.860
2025-09-12 | +1.053 | +0.858
2025-09-19 | +1.057 | +0.868
2025-09-26 | +1.065 | +0.885
2025-10-03 | +1.061 | +0.898
2025-10-10 | +1.013 | +0.857
2025-10-17 | +1.024 | +0.879
2025-10-24 | +1.025 | +0.887
2025-10-31 | +1.032 | +0.900
2025-11-07 | +1.042 | +0.897
2025-11-14 | +1.056 | +0.920
2025-11-21 | +1.057 | +0.946
2025-11-28 | +1.053 | +0.944
2025-12-05 | +1.058 | +0.950
2025-12-12 | +1.067 | +0.964
2025-12-19 | +1.078 | +0.982
2025-12-26 | +1.084 | +0.997
2026-01-02 | +1.080 | +0.998
2026-01-09 | +1.084 | +1.005
2026-01-16 | +1.090 | +1.012
2026-01-23 | +1.091 | +1.023
2026-01-30 | +1.057 | +0.921
2026-02-06 | +1.076 | +0.917
2026-02-13 | +1.064 | +0.913
2026-02-20 | +1.073 | +0.929
2026-02-27 | +1.076 | +0.934
2026-03-06 | +1.078 | +0.954
2026-03-13 | +1.088 | +0.971
2026-03-20 | +1.098 | +0.986
2026-03-27 | +1.112 | +1.003
2026-04-03 | +1.119 | +1.012
2026-04-10 | +1.124 | +1.025
2026-04-17 | +1.110 | +0.999
2026-04-24 | +1.119 | +1.009
2026-05-01 | +1.125 | +1.019
2026-05-08 | +1.127 | +1.018
2026-05-15 | +1.130 | +1.020
2026-05-22 | +1.136 | +1.028
2026-05-29 | +1.143 | +1.037
2026-06-05 | +1.137 | +1.055
2026-06-12 | +1.139 | +1.073
2026-06-19 | +1.136 | +1.080
2026-06-26 | +1.145 | +1.095
2026-07-03 | +1.145 | +1.098
2026-07-10 | +1.149 | +1.107
2026-07-17 | +1.144 | +1.108
2026-07-24 | +1.149 | +1.116
2026-07-31 | +1.148 | +1.119
2026-08-07 | +1.154 | +1.122
2026-08-14 | +1.161 | +1.135
2026-08-21 | +1.166 | +1.146
```

```chart area panels="true" yfmt="%.0f%%" title="35Δ Compounding Dynamic Drawdown (%)" note="Equity drawdown from prior peak: BTC (top), ETH (bottom)."
Friday | BTC | ETH
2022-09-02 | -0.13 | -0.61
2022-09-09 | 0.00 | 0.00
2022-09-16 | 0.00 | 0.00
2022-09-23 | 0.00 | 0.00
2022-09-30 | 0.00 | -0.60
2022-10-07 | 0.00 | 0.00
2022-10-14 | 0.00 | 0.00
2022-10-21 | 0.00 | 0.00
2022-10-28 | 0.00 | -2.65
2022-11-04 | 0.00 | -0.81
2022-11-11 | 0.00 | 0.00
2022-11-18 | 0.00 | 0.00
2022-11-25 | 0.00 | 0.00
2022-12-02 | 0.00 | 0.00
2022-12-09 | 0.00 | 0.00
2022-12-16 | 0.00 | 0.00
2022-12-23 | 0.00 | 0.00
2022-12-30 | 0.00 | 0.00
2023-01-06 | 0.00 | 0.00
2023-01-13 | -4.54 | -3.64
2023-01-20 | -10.23 | -5.51
2023-01-27 | -9.07 | -4.24
2023-02-03 | -8.08 | -2.67
2023-02-10 | -7.12 | -1.47
2023-02-17 | -5.67 | 0.00
2023-02-24 | -4.54 | 0.00
2023-03-03 | -3.55 | 0.00
2023-03-10 | -2.64 | 0.00
2023-03-17 | -0.94 | 0.00
2023-03-24 | 0.00 | 0.00
2023-03-31 | 0.00 | 0.00
2023-04-07 | 0.00 | 0.00
2023-04-14 | 0.00 | 0.00
2023-04-21 | 0.00 | 0.00
2023-04-28 | 0.00 | 0.00
2023-05-05 | 0.00 | -1.38
2023-05-12 | -0.04 | -0.36
2023-05-19 | 0.00 | 0.00
2023-05-26 | -0.02 | 0.00
2023-06-02 | 0.00 | 0.00
2023-06-09 | -1.12 | -3.12
2023-06-16 | -2.29 | -3.59
2023-06-23 | -0.77 | -2.20
2023-06-30 | 0.00 | -3.19
2023-07-07 | 0.00 | -2.38
2023-07-14 | -1.45 | -3.45
2023-07-21 | -0.56 | -2.64
2023-07-28 | 0.00 | -1.93
2023-08-04 | 0.00 | -1.34
2023-08-11 | 0.00 | -0.77
2023-08-18 | 0.00 | 0.00
2023-08-25 | 0.00 | 0.00
2023-09-01 | 0.00 | 0.00
2023-09-08 | 0.00 | 0.00
2023-09-15 | 0.00 | 0.00
2023-09-22 | 0.00 | 0.00
2023-09-29 | 0.00 | 0.00
2023-10-06 | 0.00 | 0.00
2023-10-13 | 0.00 | 0.00
2023-10-20 | 0.00 | 0.00
2023-10-27 | 0.00 | 0.00
2023-11-03 | 0.00 | -1.68
2023-11-10 | 0.00 | -0.51
2023-11-17 | 0.00 | 0.00
2023-11-24 | 0.00 | 0.00
2023-12-01 | -0.10 | -1.28
2023-12-08 | 0.00 | -0.04
2023-12-15 | 0.00 | 0.00
2023-12-22 | 0.00 | 0.00
2023-12-29 | 0.00 | 0.00
2024-01-05 | 0.00 | 0.00
2024-01-12 | -1.09 | -1.37
2024-01-19 | -0.31 | -0.10
2024-01-26 | -0.54 | 0.00
2024-02-02 | -0.05 | 0.00
2024-02-09 | -0.07 | 0.00
2024-02-16 | 0.00 | 0.00
2024-02-23 | 0.00 | -0.28
2024-03-01 | 0.00 | 0.00
2024-03-08 | 0.00 | 0.00
2024-03-15 | -0.44 | -3.03
2024-03-22 | 0.00 | -0.47
2024-03-29 | 0.00 | -0.90
2024-04-05 | 0.00 | 0.00
2024-04-12 | -4.65 | -8.69
2024-04-19 | -2.37 | -7.57
2024-04-26 | -1.11 | -10.89
2024-05-03 | -1.96 | -9.70
2024-05-10 | -0.45 | -8.26
2024-05-17 | 0.00 | -6.94
2024-05-24 | 0.00 | -7.06
2024-05-31 | 0.00 | -5.86
2024-06-07 | -0.70 | -6.84
2024-06-14 | 0.00 | -7.32
2024-06-21 | 0.00 | -5.75
2024-06-28 | 0.00 | -4.58
2024-07-05 | 0.00 | -3.12
2024-07-12 | -1.02 | -2.49
2024-07-19 | -0.00 | -1.03
2024-07-26 | 0.00 | 0.00
2024-08-02 | -2.11 | -1.98
2024-08-09 | -0.92 | -2.40
2024-08-16 | -0.95 | -1.33
2024-08-23 | -2.69 | -1.37
2024-08-30 | -1.29 | 0.00
2024-09-06 | 0.00 | 0.00
2024-09-13 | 0.00 | 0.00
2024-09-20 | 0.00 | 0.00
2024-09-27 | 0.00 | 0.00
2024-10-04 | 0.00 | 0.00
2024-10-11 | 0.00 | 0.00
2024-10-18 | 0.00 | 0.00
2024-10-25 | 0.00 | 0.00
2024-11-01 | 0.00 | 0.00
2024-11-08 | -1.14 | -4.88
2024-11-15 | -0.50 | -4.09
2024-11-22 | 0.00 | -3.16
2024-11-29 | 0.00 | -1.95
2024-12-06 | 0.00 | -0.15
2024-12-13 | 0.00 | 0.00
2024-12-20 | 0.00 | 0.00
2024-12-27 | 0.00 | 0.00
2025-01-03 | 0.00 | 0.00
2025-01-10 | 0.00 | 0.00
2025-01-17 | 0.00 | -1.72
2025-01-24 | 0.00 | -0.14
2025-01-31 | -4.22 | -7.78
2025-02-07 | -3.39 | -6.74
2025-02-14 | -2.70 | -5.21
2025-02-21 | -2.41 | -4.87
2025-02-28 | -0.64 | -1.27
2025-03-07 | 0.00 | 0.00
2025-03-14 | 0.00 | 0.00
2025-03-21 | 0.00 | -0.43
2025-03-28 | 0.00 | 0.00
2025-04-04 | 0.00 | 0.00
2025-04-11 | -0.37 | 0.00
2025-04-18 | 0.00 | 0.00
2025-04-25 | 0.00 | 0.00
2025-05-02 | -0.33 | 0.00
2025-05-09 | 0.00 | -2.27
2025-05-16 | 0.00 | -2.27
2025-05-23 | 0.00 | -1.67
2025-05-30 | 0.00 | -1.39
2025-06-06 | 0.00 | 0.00
2025-06-13 | 0.00 | 0.00
2025-06-20 | 0.00 | -6.35
2025-06-27 | 0.00 | -5.24
2025-07-04 | 0.00 | -3.87
2025-07-11 | 0.00 | -2.01
2025-07-18 | 0.00 | -1.57
2025-07-25 | -0.36 | -2.54
2025-08-01 | -0.75 | -3.74
2025-08-08 | -0.85 | -6.71
2025-08-15 | -0.30 | -5.00
2025-08-22 | -0.14 | -4.37
2025-08-29 | 0.00 | -4.44
2025-09-05 | 0.00 | -2.58
2025-09-12 | 0.00 | -2.75
2025-09-19 | 0.00 | -1.79
2025-09-26 | 0.00 | -0.14
2025-10-03 | -0.40 | 0.00
2025-10-10 | -5.16 | -4.14
2025-10-17 | -4.14 | -1.98
2025-10-24 | -4.07 | -1.26
2025-10-31 | -3.33 | 0.00
2025-11-07 | -2.38 | -0.28
2025-11-14 | -1.06 | 0.00
2025-11-21 | -0.97 | 0.00
2025-11-28 | -1.30 | -0.18
2025-12-05 | -0.84 | 0.00
2025-12-12 | 0.00 | 0.00
2025-12-19 | 0.00 | 0.00
2025-12-26 | 0.00 | 0.00
2026-01-02 | -0.48 | 0.00
2026-01-09 | -0.05 | 0.00
2026-01-16 | 0.00 | 0.00
2026-01-23 | 0.00 | 0.00
2026-01-30 | -3.39 | -10.18
2026-02-06 | -1.56 | -10.62
2026-02-13 | -2.72 | -10.94
2026-02-20 | -1.91 | -9.50
2026-02-27 | -1.56 | -9.06
2026-03-06 | -1.41 | -7.25
2026-03-13 | -0.38 | -5.69
2026-03-20 | 0.00 | -4.28
2026-03-27 | 0.00 | -2.66
2026-04-03 | 0.00 | -1.79
2026-04-10 | 0.00 | -0.47
2026-04-17 | -1.43 | -3.09
2026-04-24 | -0.56 | -2.07
2026-05-01 | 0.00 | -1.11
2026-05-08 | 0.00 | -1.22
2026-05-15 | 0.00 | -1.01
2026-05-22 | 0.00 | -0.23
2026-05-29 | 0.00 | 0.00
2026-06-05 | -0.60 | 0.00
2026-06-12 | -0.35 | 0.00
2026-06-19 | -0.67 | 0.00
2026-06-26 | 0.00 | 0.00
2026-07-03 | -0.06 | 0.00
2026-07-10 | 0.00 | 0.00
2026-07-17 | -0.53 | 0.00
2026-07-24 | -0.02 | 0.00
2026-07-31 | -0.10 | 0.00
2026-08-07 | 0.00 | 0.00
2026-08-14 | 0.00 | 0.00
2026-08-21 | 0.00 | 0.00
```

```data title="Three Deepest Compounding Drawdowns at 35Δ" bars="Depth" note="Dates are Friday entry dates; underwater weeks count weeks below the prior equity peak."
Asset | Start | Trough | Recovery | Underwater Weeks | Depth
BTC | 2023-01-13 | 2023-01-20 | 2023-03-24 | 10 | -10.23%
BTC | 2025-10-03 | 2025-10-10 | 2025-12-12 | 10 | -5.16%
BTC | 2024-04-12 | 2024-04-12 | 2024-05-17 | 5 | -4.65%
ETH | 2026-01-30 | 2026-02-13 | 2026-05-29 | 17 | -10.94%
ETH | 2024-04-12 | 2024-04-26 | 2024-07-26 | 15 | -10.89%
ETH | 2025-01-17 | 2025-01-31 | 2025-03-07 | 7 | -7.78%
```

On a simple coin-margined basis, BTC 35Δ's maximum cumulative drawdown was −0.105 BTC (−10.23% on compounded equity), while ETH's maximum cumulative drawdown was −0.111 ETH (−10.94% on compounded equity). The two deepest drawdowns occurred during violent weekend gap moves in early 2023 and early 2026.

### 3. Week-by-Week PnL

Option selling follows a classic rhythm of "many small wins, occasional large losses": out of 208 weeks, BTC posted 169 winning weeks, yet its worst single week (−0.0596 BTC) wiped out 10.6 weeks of average gains, and ETH's worst week (−0.1018 ETH) wiped out 18.5 weeks:

```chart bar panels="true" title="35Δ Weekly PnL" note="Top: BTC (in BTC), 169 winning / 39 losing weeks. Bottom: ETH (in ETH), 164 / 44."
Friday | BTC | ETH
2022-09-02 | -0.0013 | -0.0061
2022-09-09 | +0.0152 | +0.0163
2022-09-16 | +0.0140 | +0.0229
2022-09-23 | +0.0213 | +0.0184
2022-09-30 | +0.0078 | -0.0060
2022-10-07 | +0.0105 | +0.0154
2022-10-14 | +0.0134 | +0.0080
2022-10-21 | +0.0124 | +0.0070
2022-10-28 | +0.0043 | -0.0265
2022-11-04 | +0.0040 | +0.0189
2022-11-11 | +0.0269 | +0.0474
2022-11-18 | +0.0139 | +0.0209
2022-11-25 | +0.0114 | +0.0053
2022-12-02 | +0.0138 | +0.0028
2022-12-09 | +0.0089 | +0.0139
2022-12-16 | +0.0109 | +0.0119
2022-12-23 | +0.0069 | +0.0104
2022-12-30 | +0.0051 | +0.0059
2023-01-06 | +0.0054 | +0.0074
2023-01-13 | -0.0454 | -0.0364
2023-01-20 | -0.0596 | -0.0194
2023-01-27 | +0.0129 | +0.0134
2023-02-03 | +0.0109 | +0.0164
2023-02-10 | +0.0104 | +0.0124
2023-02-17 | +0.0157 | +0.0239
2023-02-24 | +0.0119 | +0.0109
2023-03-03 | +0.0104 | +0.0139
2023-03-10 | +0.0094 | +0.0007
2023-03-17 | +0.0175 | +0.0063
2023-03-24 | +0.0184 | +0.0174
2023-03-31 | +0.0159 | +0.0149
2023-04-07 | +0.0074 | +0.0027
2023-04-14 | +0.0139 | +0.0148
2023-04-21 | +0.0088 | +0.0104
2023-04-28 | +0.0119 | +0.0151
2023-05-05 | +0.0017 | -0.0138
2023-05-12 | -0.0004 | +0.0103
2023-05-19 | +0.0124 | +0.0124
2023-05-26 | -0.0002 | +0.0099
2023-06-02 | +0.0099 | +0.0089
2023-06-09 | -0.0112 | -0.0312
2023-06-16 | -0.0118 | -0.0048
2023-06-23 | +0.0155 | +0.0144
2023-06-30 | +0.0091 | -0.0102
2023-07-07 | +0.0114 | +0.0084
2023-07-14 | -0.0145 | -0.0109
2023-07-21 | +0.0090 | +0.0083
2023-07-28 | +0.0072 | +0.0073
2023-08-04 | +0.0049 | +0.0060
2023-08-11 | +0.0082 | +0.0058
2023-08-18 | +0.0164 | +0.0144
2023-08-25 | +0.0080 | +0.0088
2023-09-01 | +0.0071 | +0.0071
2023-09-08 | +0.0097 | +0.0060
2023-09-15 | +0.0084 | +0.0039
2023-09-22 | +0.0068 | +0.0055
2023-09-29 | +0.0038 | +0.0050
2023-10-06 | +0.0066 | +0.0076
2023-10-13 | +0.0076 | +0.0056
2023-10-20 | +0.0050 | +0.0012
2023-10-27 | +0.0114 | +0.0124
2023-11-03 | +0.0119 | -0.0168
2023-11-10 | +0.0154 | +0.0119
2023-11-17 | +0.0097 | +0.0098
2023-11-24 | +0.0110 | +0.0109
2023-12-01 | -0.0010 | -0.0128
2023-12-08 | +0.0124 | +0.0126
2023-12-15 | +0.0129 | +0.0129
2023-12-22 | +0.0096 | +0.0115
2023-12-29 | +0.0199 | +0.0125
2024-01-05 | +0.0184 | +0.0234
2024-01-12 | -0.0109 | -0.0137
2024-01-19 | +0.0079 | +0.0129
2024-01-26 | -0.0023 | +0.0073
2024-02-02 | +0.0049 | +0.0071
2024-02-09 | -0.0002 | +0.0097
2024-02-16 | +0.0121 | +0.0129
2024-02-23 | +0.0083 | -0.0028
2024-03-01 | +0.0103 | +0.0154
2024-03-08 | +0.0106 | +0.0229
2024-03-15 | -0.0044 | -0.0303
2024-03-22 | +0.0179 | +0.0264
2024-03-29 | +0.0094 | -0.0043
2024-04-05 | +0.0067 | +0.0095
2024-04-12 | -0.0465 | -0.0869
2024-04-19 | +0.0239 | +0.0123
2024-04-26 | +0.0129 | -0.0360
2024-05-03 | -0.0086 | +0.0134
2024-05-10 | +0.0154 | +0.0159
2024-05-17 | +0.0119 | +0.0144
2024-05-24 | +0.0040 | -0.0012
2024-05-31 | +0.0098 | +0.0129
2024-06-07 | -0.0070 | -0.0104
2024-06-14 | +0.0074 | -0.0052
2024-06-21 | +0.0106 | +0.0169
2024-06-28 | +0.0077 | +0.0124
2024-07-05 | +0.0101 | +0.0154
2024-07-12 | -0.0102 | +0.0065
2024-07-19 | +0.0103 | +0.0149
2024-07-26 | +0.0254 | +0.0179
2024-08-02 | -0.0211 | -0.0198
2024-08-09 | +0.0122 | -0.0043
2024-08-16 | -0.0003 | +0.0110
2024-08-23 | -0.0176 | -0.0004
2024-08-30 | +0.0144 | +0.0141
2024-09-06 | +0.0159 | +0.0189
2024-09-13 | +0.0104 | +0.0114
2024-09-20 | +0.0114 | +0.0129
2024-09-27 | +0.0114 | +0.0053
2024-10-04 | +0.0129 | +0.0134
2024-10-11 | +0.0098 | +0.0109
2024-10-18 | +0.0104 | +0.0114
2024-10-25 | +0.0084 | +0.0030
2024-11-01 | +0.0068 | +0.0051
2024-11-08 | -0.0114 | -0.0488
2024-11-15 | +0.0065 | +0.0083
2024-11-22 | +0.0184 | +0.0097
2024-11-29 | +0.0063 | +0.0125
2024-12-06 | +0.0124 | +0.0184
2024-12-13 | +0.0046 | +0.0120
2024-12-20 | +0.0239 | +0.0259
2024-12-27 | +0.0119 | +0.0137
2025-01-03 | +0.0097 | +0.0118
2025-01-10 | +0.0144 | +0.0164
2025-01-17 | +0.0104 | -0.0172
2025-01-24 | +0.0127 | +0.0161
2025-01-31 | -0.0422 | -0.0765
2025-02-07 | +0.0087 | +0.0113
2025-02-14 | +0.0071 | +0.0163
2025-02-21 | +0.0030 | +0.0036
2025-02-28 | +0.0181 | +0.0379
2025-03-07 | +0.0118 | +0.0279
2025-03-14 | +0.0169 | +0.0189
2025-03-21 | +0.0074 | -0.0043
2025-03-28 | +0.0095 | +0.0110
2025-04-04 | +0.0184 | +0.0204
2025-04-11 | -0.0037 | +0.0074
2025-04-18 | +0.0071 | +0.0144
2025-04-25 | +0.0062 | +0.0174
2025-05-02 | -0.0033 | +0.0129
2025-05-09 | +0.0109 | -0.0227
2025-05-16 | +0.0043 | -0.0000
2025-05-23 | +0.0056 | +0.0061
2025-05-30 | +0.0093 | +0.0029
2025-06-06 | +0.0055 | +0.0159
2025-06-13 | +0.0124 | +0.0184
2025-06-20 | +0.0015 | -0.0635
2025-06-27 | +0.0060 | +0.0119
2025-07-04 | +0.0069 | +0.0144
2025-07-11 | +0.0065 | +0.0194
2025-07-18 | +0.0084 | +0.0045
2025-07-25 | -0.0036 | -0.0099
2025-08-01 | -0.0039 | -0.0123
2025-08-08 | -0.0010 | -0.0309
2025-08-15 | +0.0055 | +0.0184
2025-08-22 | +0.0016 | +0.0066
2025-08-29 | +0.0091 | -0.0007
2025-09-05 | +0.0077 | +0.0194
2025-09-12 | +0.0057 | -0.0017
2025-09-19 | +0.0043 | +0.0099
2025-09-26 | +0.0078 | +0.0168
2025-10-03 | -0.0040 | +0.0134
2025-10-10 | -0.0477 | -0.0414
2025-10-17 | +0.0107 | +0.0225
2025-10-24 | +0.0007 | +0.0074
2025-10-31 | +0.0077 | +0.0134
2025-11-07 | +0.0098 | -0.0028
2025-11-14 | +0.0136 | +0.0224
2025-11-21 | +0.0009 | +0.0259
2025-11-28 | -0.0034 | -0.0018
2025-12-05 | +0.0047 | +0.0064
2025-12-12 | +0.0094 | +0.0142
2025-12-19 | +0.0104 | +0.0174
2025-12-26 | +0.0066 | +0.0154
2026-01-02 | -0.0048 | +0.0006
2026-01-09 | +0.0043 | +0.0075
2026-01-16 | +0.0059 | +0.0064
2026-01-23 | +0.0012 | +0.0118
2026-01-30 | -0.0339 | -0.1018
2026-02-06 | +0.0189 | -0.0049
2026-02-13 | -0.0117 | -0.0035
2026-02-20 | +0.0083 | +0.0161
2026-02-27 | +0.0035 | +0.0048
2026-03-06 | +0.0016 | +0.0199
2026-03-13 | +0.0104 | +0.0169
2026-03-20 | +0.0099 | +0.0149
2026-03-27 | +0.0139 | +0.0169
2026-04-03 | +0.0070 | +0.0090
2026-04-10 | +0.0053 | +0.0134
2026-04-17 | -0.0143 | -0.0263
2026-04-24 | +0.0088 | +0.0105
2026-05-01 | +0.0065 | +0.0098
2026-05-08 | +0.0022 | -0.0011
2026-05-15 | +0.0029 | +0.0021
2026-05-22 | +0.0057 | +0.0079
2026-05-29 | +0.0069 | +0.0094
2026-06-05 | -0.0060 | +0.0176
2026-06-12 | +0.0025 | +0.0179
2026-06-19 | -0.0032 | +0.0076
2026-06-26 | +0.0094 | +0.0144
2026-07-03 | -0.0006 | +0.0037
2026-07-10 | +0.0046 | +0.0088
2026-07-17 | -0.0053 | +0.0011
2026-07-24 | +0.0051 | +0.0072
2026-07-31 | -0.0008 | +0.0032
2026-08-07 | +0.0058 | +0.0037
2026-08-14 | +0.0064 | +0.0122
2026-08-21 | +0.0056 | +0.0112
```

### 4. Return Distribution

Binning all 208 weekly returns shows that the vast majority of outcomes cluster tightly between +0.5% and +1.5%, while a sparse left tail accounts for the severe drawdowns:

```chart bar mirror="true" title="35Δ Weekly Return Distribution (Weeks)" note="X-axis shows each bin's lower bound; bin width 0.5% [x, x + 0.5%), 208 weeks total."
Weekly Return | BTC | ETH
-11% | 0 | 0
-10.5% | 0 | 1
-10% | 0 | 0
-9.5% | 0 | 0
-9% | 0 | 1
-8.5% | 0 | 0
-8% | 0 | 1
-7.5% | 0 | 0
-7% | 0 | 0
-6.5% | 0 | 1
-6% | 1 | 0
-5.5% | 0 | 0
-5% | 3 | 1
-4.5% | 1 | 1
-4% | 0 | 2
-3.5% | 1 | 3
-3% | 0 | 2
-2.5% | 1 | 1
-2% | 1 | 4
-1.5% | 8 | 7
-1% | 4 | 4
-0.5% | 19 | 15
0% | 24 | 17
+0.5% | 72 | 44
+1% | 50 | 56
+1.5% | 18 | 33
+2% | 3 | 8
+2.5% | 2 | 4
+3% | 0 | 0
+3.5% | 0 | 1
+4% | 0 | 0
+4.5% | 0 | 1
```

## Full 12-Tier Delta Sensitivity Analysis

We also swept across all 12 symmetric Delta tiers from 0.05 to 0.60:

```data title="Sharpe Ratio Across 12 Delta Tiers" bars="BTC,ETH" mark="Δ0.35" note="Weekly returns annualized by × √52."
Delta | BTC | ETH
Δ0.05 | 4.40 | 1.18
Δ0.10 | 2.60 | 1.09
Δ0.15 | 2.74 | 1.85
Δ0.20 | 3.11 | 1.72
Δ0.25 | 3.29 | 1.86
Δ0.30 | 3.48 | 2.30
Δ0.35 | 3.43 | 2.19
Δ0.40 | 3.57 | 2.32
Δ0.45 | 3.40 | 2.23
Δ0.50 | 3.40 | 2.18
Δ0.55 | 3.77 | 2.31
Δ0.60 | 4.14 | 2.49
```

```data title="Premium Retention Rate Across 12 Delta Tiers" bars="BTC,ETH" mark="Δ0.35" note="Retention rate = Net PnL ÷ Total premium collected."
Delta | BTC | ETH
Δ0.05 | 72.5% | 44.6%
Δ0.10 | 60.2% | 38.8%
Δ0.15 | 58.6% | 47.2%
Δ0.20 | 57.3% | 39.6%
Δ0.25 | 55.0% | 38.8%
Δ0.30 | 52.1% | 39.4%
Δ0.35 | 47.1% | 34.3%
Δ0.40 | 43.3% | 33.1%
Δ0.45 | 37.0% | 27.9%
Δ0.50 | 31.9% | 24.7%
Δ0.55 | 28.2% | 21.9%
Δ0.60 | 25.9% | 19.5%
```

### BTC 12-Tier Detailed Comparison

| Delta    | Total PnL (BTC) | Mean Weekly | Win Rate  | Sharpe   | Max Drawdown | Premium Retained |
| -------- | --------------: | ----------: | --------: | -------: | -----------: | ---------------: |
| 0.05     | +0.202          | 0.10%       | 97.6%     | 4.40     | −0.026       | 72.5%            |
| 0.10     | +0.338          | 0.16%       | 96.2%     | 2.60     | −0.046       | 60.2%            |
| 0.15     | +0.519          | 0.25%       | 93.8%     | 2.74     | −0.078       | 58.6%            |
| 0.20     | +0.699          | 0.34%       | 91.3%     | 3.11     | −0.075       | 57.3%            |
| 0.25     | +0.879          | 0.42%       | 86.1%     | 3.29     | −0.084       | 55.0%            |
| 0.30     | +1.059          | 0.51%       | 84.1%     | 3.48     | −0.098       | 52.1%            |
| **0.35** | **+1.166**      | **0.56%**   | **81.3%** | **3.43** | **−0.105**   | **47.1%**        |
| 0.40     | +1.300          | 0.62%       | 80.8%     | 3.57     | −0.099       | 43.3%            |
| 0.45     | +1.324          | 0.64%       | 78.8%     | 3.40     | −0.107       | 37.0%            |
| 0.50     | +1.342          | 0.65%       | 81.7%     | 3.40     | −0.103       | 31.9%            |
| 0.55     | +1.424          | 0.68%       | 79.3%     | 3.77     | −0.093       | 28.2%            |
| 0.60     | +1.589          | 0.76%       | 80.3%     | 4.14     | −0.093       | 25.9%            |

### ETH 12-Tier Detailed Comparison

| Delta    | Total PnL (ETH) | Mean Weekly | Win Rate  | Sharpe   | Max Drawdown | Premium Retained |
| -------- | --------------: | ----------: | --------: | -------: | -----------: | ---------------: |
| 0.05     | +0.162          | 0.08%       | 96.6%     | 1.18     | −0.045       | 44.6%            |
| 0.10     | +0.280          | 0.13%       | 95.2%     | 1.09     | −0.073       | 38.8%            |
| 0.15     | +0.541          | 0.26%       | 91.8%     | 1.85     | −0.074       | 47.2%            |
| 0.20     | +0.645          | 0.31%       | 85.1%     | 1.72     | −0.092       | 39.6%            |
| 0.25     | +0.806          | 0.39%       | 84.1%     | 1.86     | −0.106       | 38.8%            |
| 0.30     | +1.053          | 0.51%       | 81.7%     | 2.30     | −0.095       | 39.4%            |
| **0.35** | **+1.146**      | **0.55%**   | **78.8%** | **2.19** | **−0.111**   | **34.3%**        |
| 0.40     | +1.292          | 0.62%       | 78.8%     | 2.32     | −0.113       | 33.1%            |
| 0.45     | +1.319          | 0.63%       | 77.4%     | 2.23     | −0.121       | 27.9%            |
| 0.50     | +1.360          | 0.65%       | 75.5%     | 2.18     | −0.129       | 24.7%            |
| 0.55     | +1.432          | 0.69%       | 76.4%     | 2.31     | −0.123       | 21.9%            |
| 0.60     | +1.460          | 0.70%       | 79.3%     | 2.49     | −0.126       | 19.5%            |

## The Weekend Effect and Variance Risk Premium (VRP): Where the Alpha Actually Comes From

The core economic thesis behind selling volatility is harvesting the Variance Risk Premium (VRP)—the spread between implied variance ($\mathrm{IV}^2$) and realized variance ($\mathrm{RV}^2$):

$$
\mathrm{VRP} = \mathrm{IV}^2 - \mathrm{RV}^2
$$

This raises a crucial diagnostic question: **Does this strategy work because of a genuine weekend low-volatility calendar effect, or is it merely capturing the general short-volatility risk premium present across all days of the week?**

To test whether weekends carry a distinct structural edge, we extracted four non-overlapping 40-hour windows across the same 2022-09 to 2026-08 sample for a controlled horizontal comparison:
1. `Fri 16:00 -> Sun 08:00` (Weekend holding window, 40h)
2. `Mon 16:00 -> Wed 08:00` (Weekday window Mon–Wed, 40h)
3. `Tue 16:00 -> Thu 08:00` (Weekday window Tue–Thu, 40h)
4. `Wed 16:00 -> Fri 08:00` (Weekday window Wed–Fri, 40h)

```data title="Annualized Realized Volatility (RV) Across 40-Hour Windows" bars="BTC Mean RV,ETH Mean RV" mark="Weekend Fri → Sun" note="Each window spans 40 hours starting at 16:00 UTC; sample from 2022-09 to 2026-08."
Window | BTC Mean RV | ETH Mean RV
Weekend Fri → Sun | 27.4% | 39.1%
Weekday Mon → Wed | 45.0% | 58.8%
Weekday Tue → Thu | 45.3% | 58.8%
Weekday Wed → Fri | 46.9% | 61.0%
```

### 40-Hour Window Volatility Comparison

| Time Window (40h) | BTC Mean RV | BTC Median RV | BTC P90 Range | ETH Mean RV | ETH Median RV | ETH P90 Range | Simulated Win Rate (BTC / ETH) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Weekend (Fri 16:00 -> Sun 08:00)** | **27.4%** | **23.9%** | **2.34%** | **39.1%** | **34.3%** | **3.66%** | **97.1% / 93.8%** |
| Weekday Mon–Wed | 45.0% | 40.3% | 5.30% | 58.8% | 53.7% | 6.65% | 86.0% / 79.2% |
| Weekday Tue–Thu | 45.3% | 42.2% | 5.44% | 58.8% | 53.9% | 7.18% | 83.1% / 75.8% |
| Weekday Wed–Fri | 46.9% | 41.0% | 5.43% | 61.0% | 54.3% | 8.21% | 84.5% / 74.9% |

The data gives an unambiguous answer:
- BTC's average weekend realized volatility is systematically **~40% lower** than on weekdays (27.4% vs. 45.0%–46.9%);
- ETH's average weekend realized volatility is similarly **~35% lower** (39.1% vs. 58.8%–61.0%);
- While options burn Theta on a continuous 24/7 clock, actual price volatility goes into hibernation over the weekend. Consequently, the expected weekend variance risk premium $E[VRP_{\mathrm{weekend}}]$ is substantially wider than on weekdays—forming the structural alpha foundation of the strategy.

---

## Surviving Intraday Deep Water: Maintenance Margin and Path Stress Testing

The most dangerous blind spot in live options trading is assuming that as long as Sunday's settlement price returns to the safe zone, nothing in between matters.

Deribit enforces a **real-time, second-by-second Maintenance Margin (MM) risk engine**: if a sudden flash crash early Saturday morning causes the mark prices of your open options to spike and pushes maintenance margin above account equity, the exchange will trigger **forced position reduction or liquidation** on Saturday. Even if spot fully recovers by Sunday morning, your position is already dead intraday.

Following Deribit's coin-margined risk rules, we ran an hourly mark-to-market path stress simulation across all 208 weekends:
- **Maintenance Margin**: $MM(t) = 0.10 \times 1.0 + \mathrm{Mark}_C(t) + \mathrm{Mark}_P(t)$
- **Account Equity**: $\mathrm{Equity}(t) = 1.0 + \mathrm{Premium}_{\mathrm{net}} - \mathrm{Mark}_C(t) - \mathrm{Mark}_P(t)$
- **Maximum Adverse Excursion (MAE)**: $\min_{t \in [0, 40]} \mathrm{FloatingPnL}_t$

```chart scatter diag="true" mark="2023-01-20,2025-10-10" title="BTC 35Δ Settlement PnL vs. Intraday Maximum Adverse Excursion (MAE)" note="X-axis: final settlement PnL; Y-axis: worst intraday floating loss (in BTC); 10 representative weekends shown. Red segments show extra intraday drawdown beyond final settlement; points on the dashed diagonal experienced no deeper intraday drawdown."
Friday | Settlement PnL | Intraday MAE
2023-01-20 | -0.0596 | -0.0923
2025-10-10 | -0.0477 | -0.0689
2024-04-12 | -0.0465 | -0.0541
2025-01-31 | -0.0422 | -0.0583
2024-08-02 | -0.0211 | -0.0412
2024-03-15 | -0.0044 | -0.0142
2023-08-18 | +0.0164 | -0.0084
2023-05-19 | +0.0124 | +0.0021
2024-06-21 | +0.0106 | +0.0085
2025-04-18 | +0.0071 | +0.0071
```

### Stress-Test Takeaways and Return Denominators

1. **Safety of a Fully Covered Spot Base**: Under a fully covered 1.0 BTC/ETH collateral structure, **zero maintenance-margin liquidations occurred** across all 208 weekends;
2. **Intraday Floating Losses Significantly Exceed Settlement Losses**:
   - At BTC 35Δ, the worst final settlement loss was `-0.0596 BTC`, whereas **intraday MAE reached `-0.0923 BTC` (1.55× deeper)**;
   - At ETH 35Δ, the worst final settlement loss was `-0.1018 ETH`, whereas **intraday MAE reached `-0.1517 ETH` (1.49× deeper)**;
3. **Three Proper Ways to Define the Return Denominator**:
   - **Pure Options Overlay Return ($R_{\mathrm{overlay}}$)**: Measured against 1.0 BTC notional, the overlay earned +1.166 BTC over 208 weeks (+116.6% simple return, ~29.2% annualized);
   - **Combined Spot + Overlay Return ($R_{\mathrm{spot+overlay}}$)**: Capturing both spot appreciation and compounded option premiums, total USD wealth grew 5.38× over 4 years (58.2% CAGR);
   - **Standalone Margin Return on Equity (ROE)**: If deployed in a dedicated sub-account funded with 0.30 BTC of margin per strangle, cumulative 4-year ROE reached 388%, or over 80% annualized (requiring ample liquidity buffer to absorb intraday wicks).

---

## Asymmetric Parameter Optimization and Out-of-Sample Robustness

In our parameter exploration, we evaluated the full $12 \times 12 = 144$ grid of independent Call and Put Delta combinations:

```echarts title="BTC Asymmetric Delta Grid: Compound Annual Growth Rate (CAGR)" note="12 × 12 Call/Put Delta grid (compounded coin-margined equity, 2022-09 to 2026-08; peaks at 47.9% at 60Δ/60Δ). Solid frame marks the in-sample Calmar optimum (25Δ Call / 60Δ Put, 43.3%); dashed frame marks the symmetric 35Δ baseline (33.3%)." height="440"
{
  "tooltip": {
    "position": "top",
    "valueFormatter": "{value}%"
  },
  "grid": {
    "left": 4,
    "right": 12,
    "top": 44,
    "bottom": 24,
    "containLabel": true
  },
  "xAxis": {
    "type": "category",
    "name": "Call Delta",
    "nameLocation": "middle",
    "nameGap": 24,
    "data": [
      "5Δ",
      "10Δ",
      "15Δ",
      "20Δ",
      "25Δ",
      "30Δ",
      "35Δ",
      "40Δ",
      "45Δ",
      "50Δ",
      "55Δ",
      "60Δ"
    ],
    "axisLabel": {
      "interval": 0,
      "fontSize": 10
    }
  },
  "yAxis": {
    "type": "category",
    "name": "Put Delta",
    "nameGap": 10,
    "data": [
      "5Δ",
      "10Δ",
      "15Δ",
      "20Δ",
      "25Δ",
      "30Δ",
      "35Δ",
      "40Δ",
      "45Δ",
      "50Δ",
      "55Δ",
      "60Δ"
    ],
    "axisLabel": {
      "interval": 0,
      "fontSize": 10
    }
  },
  "visualMap": {
    "seriesIndex": 0,
    "min": 5,
    "max": 48,
    "calculable": false,
    "orient": "horizontal",
    "right": 0,
    "top": 0,
    "itemWidth": 10,
    "itemHeight": 110,
    "text": [
      "48%",
      "5%"
    ],
    "inRange": {
      "color": [
        "var(--wash)",
        "var(--kraft)",
        "var(--clay)"
      ]
    }
  },
  "series": [
    {
      "name": "CAGR",
      "type": "heatmap",
      "data": [
        [
          0,
          0,
          5.3
        ],
        [
          1,
          0,
          7.7
        ],
        [
          2,
          0,
          9.9
        ],
        [
          3,
          0,
          12.3
        ],
        [
          4,
          0,
          14.5
        ],
        [
          5,
          0,
          16.5
        ],
        [
          6,
          0,
          17.4
        ],
        [
          7,
          0,
          18.2
        ],
        [
          8,
          0,
          17.5
        ],
        [
          9,
          0,
          15.4
        ],
        [
          10,
          0,
          14.7
        ],
        [
          11,
          0,
          17.5
        ],
        [
          0,
          1,
          6.5
        ],
        [
          1,
          1,
          8.8
        ],
        [
          2,
          1,
          11.1
        ],
        [
          3,
          1,
          13.7
        ],
        [
          4,
          1,
          15.7
        ],
        [
          5,
          1,
          17.9
        ],
        [
          6,
          1,
          18.7
        ],
        [
          7,
          1,
          19.6
        ],
        [
          8,
          1,
          18.9
        ],
        [
          9,
          1,
          16.7
        ],
        [
          10,
          1,
          15.9
        ],
        [
          11,
          1,
          19.1
        ],
        [
          0,
          2,
          8.8
        ],
        [
          1,
          2,
          11.3
        ],
        [
          2,
          2,
          13.8
        ],
        [
          3,
          2,
          16.4
        ],
        [
          4,
          2,
          18.6
        ],
        [
          5,
          2,
          20.6
        ],
        [
          6,
          2,
          21.5
        ],
        [
          7,
          2,
          22.3
        ],
        [
          8,
          2,
          21.5
        ],
        [
          9,
          2,
          19.4
        ],
        [
          10,
          2,
          18.7
        ],
        [
          11,
          2,
          21.8
        ],
        [
          0,
          3,
          11.3
        ],
        [
          1,
          3,
          13.8
        ],
        [
          2,
          3,
          16.4
        ],
        [
          3,
          3,
          18.9
        ],
        [
          4,
          3,
          21.3
        ],
        [
          5,
          3,
          23.2
        ],
        [
          6,
          3,
          24.2
        ],
        [
          7,
          3,
          25.1
        ],
        [
          8,
          3,
          24.5
        ],
        [
          9,
          3,
          22.0
        ],
        [
          10,
          3,
          21.4
        ],
        [
          11,
          3,
          24.6
        ],
        [
          0,
          4,
          14.2
        ],
        [
          1,
          4,
          16.9
        ],
        [
          2,
          4,
          19.4
        ],
        [
          3,
          4,
          22.0
        ],
        [
          4,
          4,
          24.2
        ],
        [
          5,
          4,
          26.4
        ],
        [
          6,
          4,
          27.8
        ],
        [
          7,
          4,
          28.3
        ],
        [
          8,
          4,
          27.8
        ],
        [
          9,
          4,
          25.2
        ],
        [
          10,
          4,
          24.6
        ],
        [
          11,
          4,
          27.9
        ],
        [
          0,
          5,
          17.4
        ],
        [
          1,
          5,
          20.1
        ],
        [
          2,
          5,
          22.5
        ],
        [
          3,
          5,
          25.2
        ],
        [
          4,
          5,
          27.8
        ],
        [
          5,
          5,
          30.0
        ],
        [
          6,
          5,
          31.0
        ],
        [
          7,
          5,
          31.8
        ],
        [
          8,
          5,
          31.1
        ],
        [
          9,
          5,
          28.8
        ],
        [
          10,
          5,
          28.1
        ],
        [
          11,
          5,
          31.3
        ],
        [
          0,
          6,
          19.4
        ],
        [
          1,
          6,
          22.0
        ],
        [
          2,
          6,
          24.7
        ],
        [
          3,
          6,
          27.8
        ],
        [
          4,
          6,
          30.0
        ],
        [
          5,
          6,
          32.3
        ],
        [
          6,
          6,
          33.3
        ],
        [
          7,
          6,
          34.2
        ],
        [
          8,
          6,
          33.5
        ],
        [
          9,
          6,
          31.0
        ],
        [
          10,
          6,
          30.3
        ],
        [
          11,
          6,
          33.7
        ],
        [
          0,
          7,
          22.5
        ],
        [
          1,
          7,
          25.2
        ],
        [
          2,
          7,
          28.3
        ],
        [
          3,
          7,
          31.0
        ],
        [
          4,
          7,
          33.5
        ],
        [
          5,
          7,
          35.9
        ],
        [
          6,
          7,
          37.0
        ],
        [
          7,
          7,
          37.8
        ],
        [
          8,
          7,
          37.1
        ],
        [
          9,
          7,
          34.7
        ],
        [
          10,
          7,
          33.8
        ],
        [
          11,
          7,
          37.3
        ],
        [
          0,
          8,
          23.9
        ],
        [
          1,
          8,
          26.9
        ],
        [
          2,
          8,
          29.5
        ],
        [
          3,
          8,
          32.3
        ],
        [
          4,
          8,
          34.8
        ],
        [
          5,
          8,
          37.1
        ],
        [
          6,
          8,
          38.3
        ],
        [
          7,
          8,
          39.2
        ],
        [
          8,
          8,
          38.5
        ],
        [
          9,
          8,
          36.0
        ],
        [
          10,
          8,
          35.2
        ],
        [
          11,
          8,
          38.8
        ],
        [
          0,
          9,
          26.9
        ],
        [
          1,
          9,
          29.6
        ],
        [
          2,
          9,
          32.5
        ],
        [
          3,
          9,
          35.3
        ],
        [
          4,
          9,
          37.8
        ],
        [
          5,
          9,
          40.3
        ],
        [
          6,
          9,
          41.5
        ],
        [
          7,
          9,
          42.4
        ],
        [
          8,
          9,
          41.7
        ],
        [
          9,
          9,
          39.2
        ],
        [
          10,
          9,
          38.3
        ],
        [
          11,
          9,
          42.0
        ],
        [
          0,
          10,
          30.0
        ],
        [
          1,
          10,
          33.0
        ],
        [
          2,
          10,
          35.9
        ],
        [
          3,
          10,
          38.8
        ],
        [
          4,
          10,
          41.4
        ],
        [
          5,
          10,
          44.1
        ],
        [
          6,
          10,
          45.2
        ],
        [
          7,
          10,
          46.2
        ],
        [
          8,
          10,
          45.4
        ],
        [
          9,
          10,
          42.9
        ],
        [
          10,
          10,
          42.0
        ],
        [
          11,
          10,
          45.9
        ],
        [
          0,
          11,
          31.8
        ],
        [
          1,
          11,
          34.8
        ],
        [
          2,
          11,
          37.7
        ],
        [
          3,
          11,
          40.7
        ],
        [
          4,
          11,
          43.3
        ],
        [
          5,
          11,
          46.2
        ],
        [
          6,
          11,
          47.3
        ],
        [
          7,
          11,
          47.9
        ],
        [
          8,
          11,
          47.6
        ],
        [
          9,
          11,
          45.1
        ],
        [
          10,
          11,
          44.1
        ],
        [
          11,
          11,
          47.9
        ]
      ]
    },
    {
      "name": "landmarks",
      "type": "heatmap",
      "z": 10,
      "silent": true,
      "tooltip": {
        "show": false
      },
      "data": [
        {
          "value": [
            4,
            11,
            43.3
          ],
          "itemStyle": {
            "color": "transparent",
            "borderColor": "var(--ink)",
            "borderWidth": 2
          },
          "label": {
            "show": true,
            "position": "right",
            "distance": 6,
            "formatter": "43.3%",
            "fontSize": 9.5,
            "color": "var(--ink)",
            "backgroundColor": "var(--card)",
            "borderColor": "var(--ink)",
            "borderWidth": 1,
            "padding": [
              1,
              3
            ]
          }
        },
        {
          "value": [
            6,
            6,
            33.3
          ],
          "itemStyle": {
            "color": "transparent",
            "borderColor": "var(--ink)",
            "borderWidth": 1.75,
            "borderType": "dashed"
          },
          "label": {
            "show": true,
            "position": "right",
            "distance": 6,
            "formatter": "33.3%",
            "fontSize": 9.5,
            "color": "var(--ink)",
            "backgroundColor": "var(--card)",
            "borderColor": "var(--muted)",
            "borderWidth": 1,
            "padding": [
              1,
              3
            ]
          }
        }
      ]
    }
  ]
}
```

```echarts title="BTC Asymmetric Delta Grid: Calmar Ratio" note="Calmar = CAGR ÷ maximum compounded drawdown. Solid frame marks the in-sample optimum (25Δ Call / 60Δ Put, 7.23); dashed frame marks the symmetric 35Δ baseline (3.26)." height="440"
{
  "tooltip": {
    "position": "top",
    "valueFormatter": "{value}"
  },
  "grid": {
    "left": 4,
    "right": 12,
    "top": 44,
    "bottom": 24,
    "containLabel": true
  },
  "xAxis": {
    "type": "category",
    "name": "Call Delta",
    "nameLocation": "middle",
    "nameGap": 24,
    "data": [
      "5Δ",
      "10Δ",
      "15Δ",
      "20Δ",
      "25Δ",
      "30Δ",
      "35Δ",
      "40Δ",
      "45Δ",
      "50Δ",
      "55Δ",
      "60Δ"
    ],
    "axisLabel": {
      "interval": 0,
      "fontSize": 10
    }
  },
  "yAxis": {
    "type": "category",
    "name": "Put Delta",
    "nameGap": 10,
    "data": [
      "5Δ",
      "10Δ",
      "15Δ",
      "20Δ",
      "25Δ",
      "30Δ",
      "35Δ",
      "40Δ",
      "45Δ",
      "50Δ",
      "55Δ",
      "60Δ"
    ],
    "axisLabel": {
      "interval": 0,
      "fontSize": 10
    }
  },
  "visualMap": {
    "seriesIndex": 0,
    "min": 1.2,
    "max": 7.3,
    "calculable": false,
    "orient": "horizontal",
    "right": 0,
    "top": 0,
    "itemWidth": 10,
    "itemHeight": 110,
    "text": [
      "7.3",
      "1.2"
    ],
    "inRange": {
      "color": [
        "var(--wash)",
        "var(--kraft)",
        "var(--clay)"
      ]
    }
  },
  "series": [
    {
      "name": "Calmar Ratio",
      "type": "heatmap",
      "data": [
        [
          0,
          0,
          2.02
        ],
        [
          1,
          0,
          1.62
        ],
        [
          2,
          0,
          1.27
        ],
        [
          3,
          0,
          1.57
        ],
        [
          4,
          0,
          1.65
        ],
        [
          5,
          0,
          1.57
        ],
        [
          6,
          0,
          1.55
        ],
        [
          7,
          0,
          1.62
        ],
        [
          8,
          0,
          1.46
        ],
        [
          9,
          0,
          1.24
        ],
        [
          10,
          0,
          1.2
        ],
        [
          11,
          0,
          1.43
        ],
        [
          0,
          1,
          2.26
        ],
        [
          1,
          1,
          1.95
        ],
        [
          2,
          1,
          1.46
        ],
        [
          3,
          1,
          1.76
        ],
        [
          4,
          1,
          1.84
        ],
        [
          5,
          1,
          1.72
        ],
        [
          6,
          1,
          1.69
        ],
        [
          7,
          1,
          1.76
        ],
        [
          8,
          1,
          1.6
        ],
        [
          9,
          1,
          1.39
        ],
        [
          10,
          1,
          1.31
        ],
        [
          11,
          1,
          1.57
        ],
        [
          0,
          2,
          2.43
        ],
        [
          1,
          2,
          2.59
        ],
        [
          2,
          2,
          1.81
        ],
        [
          3,
          2,
          2.14
        ],
        [
          4,
          2,
          2.19
        ],
        [
          5,
          2,
          2.0
        ],
        [
          6,
          2,
          1.98
        ],
        [
          7,
          2,
          2.02
        ],
        [
          8,
          2,
          1.84
        ],
        [
          9,
          2,
          1.62
        ],
        [
          10,
          2,
          1.57
        ],
        [
          11,
          2,
          1.84
        ],
        [
          0,
          3,
          2.52
        ],
        [
          1,
          3,
          3.09
        ],
        [
          2,
          3,
          2.21
        ],
        [
          3,
          3,
          2.57
        ],
        [
          4,
          3,
          2.57
        ],
        [
          5,
          3,
          2.33
        ],
        [
          6,
          3,
          2.26
        ],
        [
          7,
          3,
          2.33
        ],
        [
          8,
          3,
          2.12
        ],
        [
          9,
          3,
          1.88
        ],
        [
          10,
          3,
          1.84
        ],
        [
          11,
          3,
          2.12
        ],
        [
          0,
          4,
          2.97
        ],
        [
          1,
          4,
          3.56
        ],
        [
          2,
          4,
          2.64
        ],
        [
          3,
          4,
          3.0
        ],
        [
          4,
          4,
          2.95
        ],
        [
          5,
          4,
          2.64
        ],
        [
          6,
          4,
          2.57
        ],
        [
          7,
          4,
          2.64
        ],
        [
          8,
          4,
          2.4
        ],
        [
          9,
          4,
          2.19
        ],
        [
          10,
          4,
          2.14
        ],
        [
          11,
          4,
          2.43
        ],
        [
          0,
          5,
          3.3
        ],
        [
          1,
          5,
          3.82
        ],
        [
          2,
          5,
          3.3
        ],
        [
          3,
          5,
          3.71
        ],
        [
          4,
          5,
          3.59
        ],
        [
          5,
          5,
          3.14
        ],
        [
          6,
          5,
          3.04
        ],
        [
          7,
          5,
          3.11
        ],
        [
          8,
          5,
          2.83
        ],
        [
          9,
          5,
          2.59
        ],
        [
          10,
          5,
          2.57
        ],
        [
          11,
          5,
          2.88
        ],
        [
          0,
          6,
          3.71
        ],
        [
          1,
          6,
          4.25
        ],
        [
          2,
          6,
          3.63
        ],
        [
          3,
          6,
          4.01
        ],
        [
          4,
          6,
          3.9
        ],
        [
          5,
          6,
          3.4
        ],
        [
          6,
          6,
          3.26
        ],
        [
          7,
          6,
          3.35
        ],
        [
          8,
          6,
          3.04
        ],
        [
          9,
          6,
          2.81
        ],
        [
          10,
          6,
          2.78
        ],
        [
          11,
          6,
          3.09
        ],
        [
          0,
          7,
          4.01
        ],
        [
          1,
          7,
          4.56
        ],
        [
          2,
          7,
          4.53
        ],
        [
          3,
          7,
          4.98
        ],
        [
          4,
          7,
          4.72
        ],
        [
          5,
          7,
          4.01
        ],
        [
          6,
          7,
          3.85
        ],
        [
          7,
          7,
          3.92
        ],
        [
          8,
          7,
          3.59
        ],
        [
          9,
          7,
          3.33
        ],
        [
          10,
          7,
          3.3
        ],
        [
          11,
          7,
          3.63
        ],
        [
          0,
          8,
          4.13
        ],
        [
          1,
          8,
          4.72
        ],
        [
          2,
          8,
          4.75
        ],
        [
          3,
          8,
          5.2
        ],
        [
          4,
          8,
          4.91
        ],
        [
          5,
          8,
          4.18
        ],
        [
          6,
          8,
          3.99
        ],
        [
          7,
          8,
          4.08
        ],
        [
          8,
          8,
          3.71
        ],
        [
          9,
          8,
          3.45
        ],
        [
          10,
          8,
          3.42
        ],
        [
          11,
          8,
          3.78
        ],
        [
          0,
          9,
          4.39
        ],
        [
          1,
          9,
          4.89
        ],
        [
          2,
          9,
          5.43
        ],
        [
          3,
          9,
          5.93
        ],
        [
          4,
          9,
          5.6
        ],
        [
          5,
          9,
          4.7
        ],
        [
          6,
          9,
          4.51
        ],
        [
          7,
          9,
          4.56
        ],
        [
          8,
          9,
          4.13
        ],
        [
          9,
          9,
          3.9
        ],
        [
          10,
          9,
          3.87
        ],
        [
          11,
          9,
          4.25
        ],
        [
          0,
          10,
          4.91
        ],
        [
          1,
          10,
          5.46
        ],
        [
          2,
          10,
          6.0
        ],
        [
          3,
          10,
          6.52
        ],
        [
          4,
          10,
          7.0
        ],
        [
          5,
          10,
          5.67
        ],
        [
          6,
          10,
          5.34
        ],
        [
          7,
          10,
          5.43
        ],
        [
          8,
          10,
          4.91
        ],
        [
          9,
          10,
          4.63
        ],
        [
          10,
          10,
          4.63
        ],
        [
          11,
          10,
          5.06
        ],
        [
          0,
          11,
          4.46
        ],
        [
          1,
          11,
          5.06
        ],
        [
          2,
          11,
          5.69
        ],
        [
          3,
          11,
          6.57
        ],
        [
          4,
          11,
          7.23
        ],
        [
          5,
          11,
          5.93
        ],
        [
          6,
          11,
          5.58
        ],
        [
          7,
          11,
          5.67
        ],
        [
          8,
          11,
          5.15
        ],
        [
          9,
          11,
          4.87
        ],
        [
          10,
          11,
          4.84
        ],
        [
          11,
          11,
          5.29
        ]
      ]
    },
    {
      "name": "landmarks",
      "type": "heatmap",
      "z": 10,
      "silent": true,
      "tooltip": {
        "show": false
      },
      "data": [
        {
          "value": [
            4,
            11,
            7.23
          ],
          "itemStyle": {
            "color": "transparent",
            "borderColor": "var(--ink)",
            "borderWidth": 2
          },
          "label": {
            "show": true,
            "position": "right",
            "distance": 6,
            "formatter": "7.23",
            "fontSize": 9.5,
            "color": "var(--ink)",
            "backgroundColor": "var(--card)",
            "borderColor": "var(--ink)",
            "borderWidth": 1,
            "padding": [
              1,
              3
            ]
          }
        },
        {
          "value": [
            6,
            6,
            3.26
          ],
          "itemStyle": {
            "color": "transparent",
            "borderColor": "var(--ink)",
            "borderWidth": 1.75,
            "borderType": "dashed"
          },
          "label": {
            "show": true,
            "position": "right",
            "distance": 6,
            "formatter": "3.26",
            "fontSize": 9.5,
            "color": "var(--ink)",
            "backgroundColor": "var(--card)",
            "borderColor": "var(--muted)",
            "borderWidth": 1,
            "padding": [
              1,
              3
            ]
          }
        }
      ]
    }
  ]
}
```

At first glance, the in-sample Calmar-optimal combination for BTC appears at **Call 0.25Δ / Put 0.60Δ** (CAGR 43.3%, Calmar 7.23), and for ETH at **Call 0.40Δ / Put 0.55Δ** (CAGR 47.5%, Calmar 4.27).

Before taking those numbers into live trading, however, we need to look beneath the surface at the mathematics and economics driving them:

### 1. A 0.60Δ Put Is Already In the Money (ITM)

In standard option pricing, a put with $|\Delta_P| > 0.50$ is already **in the money (ITM)**.
Selling a 0.60Δ Put alongside a 0.25Δ Call causes the two strikes to cross, transforming the position from an OTM Short Strangle into a strongly directional **Short Guts / Bullish Risk Reversal**.

### 2. Long Beta Drift in the Return Attribution

Running an OLS regression of option overlay returns against spot returns ($R_{\mathrm{opt}} = \alpha + \beta R_{\mathrm{spot}} + \epsilon$) reveals:
- Selling a 0.25Δ Call ($-0.25\Delta$) + selling a 0.60Δ Put ($+0.60\Delta$) gives the options overlay a **$+0.35$ net long Delta**;
- Combined with the 1.0 BTC spot base, the total portfolio runs an effective Delta of **$1.35$**;
- Regression confirms that a symmetric 30Δ strangle has $\beta = 0.057$ (pure annualized alpha of 25.8%), whereas the asymmetric 25C/60P configuration has $\beta = 0.467$ (**more than 8× higher directional exposure**).

In other words, much of the apparent outperformance of 0.25C/0.60P came from riding a 1.35× leveraged long-beta exposure through a four-year crypto bull market (during which BTC rose 153%), rather than pure volatility-selling skill.

### 3. Leave-One-Tail-Out and Walk-Forward Out-of-Sample Validation

- **Leave-One-Tail-Out sensitivity**: The denominator of the Calmar ratio is governed entirely by a handful of black-swan weekends. When we remove the `2023-01` short-squeeze weekend, BTC's apparent optimum jumps to 0.60C / 0.60P—demonstrating that single-point historical optima are highly sensitive to individual tail events;
- **Walk-Forward Out-of-Sample (OOS, 104-week) rolling test**: Training on the first 104 weeks and validating strictly out-of-sample on the subsequent 104 weeks, BTC still achieved **25.9% CAGR, 2.82 Sharpe, and a 78.8% win rate**, while ETH achieved **36.5% CAGR and 2.18 Sharpe**;
- **Live baseline recommendation**: For traders seeking pure, directionally neutral volatility harvesting, a **symmetric 25Δ–30Δ OTM strangle** remains the most robust baseline across theoretical purity, delta neutrality, and cross-cycle resilience.

---

## Four Archetypes of Historical Losses and Three Rules of Live Risk Control

Selling volatility is the textbook "picking up dimes in front of a steamroller" trade. Reviewing every losing week across the 208-weekend sample, all drawdowns fall into **four distinct loss archetypes**:

### 1. Downside Tail Crash Through the Put Strike
- **Mechanism**: A sudden weekend geopolitical shock or liquidity vacuum sends spot plunging 8%–15% in one direction, blowing past the put strike. Negative coin-margined Gamma accelerates the settlement payout just as the USD value of your underlying spot holding drops sharply.
- **Representative cases**:
  - `2024-04-12`: Sudden weekend airstrikes in the Middle East sent spot down −8.4% on Saturday; BTC 35Δ lost `-0.0465 BTC` and ETH lost `-0.0869 ETH` that week;
  - `2026-01-30`: JGB flash crash and tariff shock dragged ETH down −11.3%, producing the largest single-week loss in the dataset at `-0.1018 ETH`.

### 2. Upside Short Squeeze Through the Call Strike
- **Mechanism**: Bullish catalysts hit over a weekend when short positioning is crowded, sparking a 10%–15% upward gap that pushes the call leg deep into the money. Although your spot holding gains in USD terms, the options overlay records a sizable coin-denominated accounting loss.
- **Representative cases**:
  - `2023-01-13` / `01-20`: Back-to-back bear-market bottom short squeezes sent spot up 35% over two weeks, handing BTC its worst single-week loss of `-0.0596 BTC`;
  - `2024-11-08`: Post-US election weekend squeeze drove ETH up +13.5%, generating a `-0.0488 ETH` drawdown.

### 3. Intraday Whip-Saw and Margin Breach Risk
- **Mechanism**: A violent downward wick early Saturday morning is followed by a V-shaped recovery before Sunday settlement. Final settlement shows only a minor loss or even a net gain, but intraday option mark prices spike so hard that an under-collateralized account gets force-liquidated at the exact bottom.
- **Representative case**:
  - `2024-08-02`: During the yen carry-trade unwind, BTC's intraday floating loss reached `-0.0412 BTC` before narrowing to `-0.0211 BTC` by Sunday settlement—subjecting the account to severe intraday liquidity stress.

### 4. Vega Explosion from Sudden Volatility Spikes
- **Mechanism**: Abrupt market turbulence sends short-dated weekend IV surging from 45% to over 90%. Even before spot reaches either strike, theoretical OTM option prices multiply several-fold, inflating floating losses and locking up free margin.
- **Representative case**:
  - `2025-10-10`: During a market-wide tariff liquidation cascade, short-dated IV doubled overnight and BTC took a `-0.0477 BTC` drawdown.

---

### Three Practical Risk-Control Rules for Live Trading

Running this strategy safely in production requires three hard defensive guardrails at the execution layer:

1. **Dynamic Stress-Loss Gate**: Before opening positions each Friday, simulate worst-case losses under $\pm 10\% / \pm 15\%$ weekend gap scenarios. If the projected tail loss exceeds your account's risk budget, shift your target strikes outward from 30Δ to a wider 15Δ–20Δ OTM buffer;
2. **Hard Stop-Loss and Delta-Hedging Triggers**: If the floating loss on either leg reaches 3× the initial premium collected, or if a single leg's absolute Delta exceeds 0.70, immediately close the leg at market or open an offsetting perpetual futures position to restore Delta neutrality;
3. **30% Maintenance Margin Ceiling**: Never allow account-wide Maintenance Margin (MM) utilization to exceed 30% of total equity, preserving at least a 3× liquidity cushion against intraday flash wicks and forced liquidations.

---

## Limitations and Live Microstructure Details

Before deploying capital, keep six practical boundaries in mind:

1. **Delivery TWAP vs. Spot Print**: Deribit's official settlement price is the **07:30–08:00 UTC time-weighted average price (TWAP) of the Deribit Index**, which can differ slightly from an instantaneous spot candle close;
2. **Bid-Ask Spread and Slippage**: The backtest marks at traded prices, whereas crossing the spread to hit the bid in live trading typically costs 5%–10% of gross premium;
3. **Deep-OTM Liquidity Illusion**: Ultra-low-delta tiers such as 5Δ have thin order books—over 50% of historical quotes in that tier rely on pricing fallbacks. Live execution should stay focused on liquid 20Δ–35Δ strikes;
4. **Opportunity Cost of Margin**: Collateral tied up backing naked short puts foregoes risk-free yield or staking returns;
5. **Volatility Regime Shifts**: The past four years spanned a broadly elevated crypto volatility regime; if the market enters a prolonged low-volatility era, gross option premiums will compress accordingly;
6. **Sunday Settlement Truncates Monday Tail Events**: During episodes like the August 2024 yen carry-trade unwind, the steepest leg of the crash actually occurred on Monday morning. This strategy strictly isolates and measures risk within the 40-hour Friday-to-Sunday window.

---

## Reproducibility and Open-Source Code

The complete backtest engine, standalone Deribit data downloader, advanced quantitative test suite, and interactive tutorial Notebook are fully open-sourced and can be run end-to-end in Google Colab with a single click:

[Open Notebook in Google Colab](https://colab.research.google.com/github/mizorewww/backtest/blob/main/tasks/0001-weekend-strangle/notebook.ipynb)

- GitHub repository: [tasks/0001-weekend-strangle](https://github.com/mizorewww/backtest/blob/main/tasks/0001-weekend-strangle/)
- Includes built-in automatic data caching and downloading from Deribit.

```bash
# Local reproduction commands
git clone https://github.com/mizorewww/backtest.git
cd backtest
uv sync
cd tasks/0001-weekend-strangle
uv run download_data.py       # Auto-download missing data from Deribit
uv run backtest.py            # 12 delta tiers × BTC/ETH grid backtest
uv run optimize.py            # Compounding + asymmetric grid optimization
uv run advanced_analysis.py   # Full quantitative test suite (VRP, intraday margin, OOS, stability)
uv run make_report.py         # Generate self-contained HTML report
```

---

_Disclaimer: All data and analyses in this post are historical in-sample statistics and quantitative research demonstrations, and do not constitute investment advice._
