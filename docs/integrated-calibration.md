# Integrated long-horizon calibration

This calibration checks BankSim as an interacting management game rather than as a collection of individually tested mechanics. It uses the real simulation engine, real management actions, the optional Three-Year Plan, plan renewal and the capital-markets bookbuild over a six-year horizon.

The harness is diagnostic rather than an optimiser. Its strategy archetypes are deliberately simple standing policies intended to expose incentive problems, degenerate strategies and accidental dominance. They are not claims about the best way to run a real bank.

## Matrix

The reference matrix runs eight deterministic macro seeds (`11`, `101`, `1001`, `10001`, `100001`, `2026`, `271828`, `314159`) for 72 monthly closes across eight management styles:

- unmanaged;
- balanced;
- growth;
- profitability-focused;
- fortress;
- capital-markets-reliant;
- levered growth;
- adaptive management.

The plan is enabled for the calibration and a successor plan is agreed after the first 36-month cycle. Capital issuance and wholesale funding use the live capital-markets bookbuild, not the deprecated direct-issuance replay actions. No scenario mechanics or scenario shocks are used.

## September 2026 reference results

The table reports means across the eight seeds after the plan-agreement corrections described below. Failed unmanaged paths are measured at their failure point; managed strategies all survived the full 72 months in this matrix.

| Strategy | Survival | Cumulative net income | Loan growth | RoTE | Share-price return | Final Board Confidence | Capital / funding raised |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Adaptive | 100% | £0.95bn | -16.0% | 13.9% | +149.8% | 86.9 | £0.18bn |
| Balanced | 100% | £0.97bn | -20.9% | 13.6% | +143.7% | 84.3 | £0.11bn |
| Growth | 100% | £0.86bn | -8.7% | 12.5% | +121.3% | 91.7 | £0.37bn |
| Levered growth | 100% | £0.90bn | -6.1% | 14.5% | +132.0% | 93.1 | £0.36bn |
| Profitability-focused | 100% | £0.97bn | -33.4% | 14.3% | +147.1% | 78.9 | £0.00bn |
| Fortress | 100% | £0.65bn | -47.1% | 10.0% | +79.4% | 82.7 | £0.00bn |
| Capital-markets-reliant | 100% | £0.74bn | -16.2% | 9.1% | +9.4% | 76.9 | £3.42bn |
| Unmanaged | 62.5% | £0.38bn | -7.7% | 8.8% | +32.4% | 79.3 | £0.00bn |

These outcomes show different objectives pulling in different directions rather than one strategy dominating every measure. Balanced/adaptive management produces the strongest shareholder outcomes among the broadly managed styles. Growth and levered-growth policies score best against the explicit commercial plan, but do not dominate shareholder returns. Profitability-focused management earns strongly while losing customer scale and therefore disappoints the board. Fortress management survives comfortably but gives up nearly half of the loan book and produces materially weaker commercial outcomes. Serial issuance remains available as a management tool, but raising roughly £3.4bn over six years is associated with weak RoTE and almost no share-price gain.

Macro dispersion remains intentional. A benign path can make an aggressive or unmanaged strategy look much better than its cross-seed mean, while adverse paths can expose liquidity or capital weaknesses. The broad regression envelopes therefore test strategy shape and relative incentives rather than pinning exact means.

## Exploit found: self-set trivial plans

The first six-year sweep found that editable Three-Year Plans could be gamed. On seed `1001`, the same unmanaged bank economics produced Cycle 1 Board Confidence of about `59.9` under the calibrated plan but about `99.0` under a deliberately trivial self-set plan; by month 72 the trivial plan was effectively at `100/100` confidence. Nothing about the bank itself had improved.

The correction is a **board-agreement gate**, not a new Board Confidence input. Management may still set and reweight its plan, but an agreed plan must:

- contain the seven supported measures;
- have weights summing to 100%;
- give every measure at least 2.5% weight;
- allocate at least 35% to EPS/RoTE, 20% to lending/deposits and 25% to capital/liquidity;
- retain FY1/FY2/FY3 milestones; and
- meet minimum ambition floors relative to the calibrated board reference plan.

The current ambition floors allow some negotiation: EPS/RoTE may be set as low as 80% of the calibrated reference and lending/deposit targets as low as 95% of the reference. The calibrated capital/liquidity minima cannot be weakened. These constraints apply only when the board agrees the plan. Once a plan is agreed, its score and Board Confidence use exactly the existing plan-only mechanism.

## Exploit found: renewal ratchet-down

The first two-cycle sweep also showed that a bank which shrank materially in Cycle 1 could obtain an easier Cycle 2 simply because successor lending and deposit targets were rebased to its smaller current balance sheet. This allowed weak commercial performance to be partly defined away at renewal.

For successor plans, the live trajectory still starts from the bank's actual current position, but the commercial milestone reference is now at least the first-cycle opening scale. A bank that has shrunk therefore gets a recovery trajectory rather than a permanently lower ambition base. If it has grown beyond the original scale, the current larger position becomes the reference instead.

## What was not changed

This phase did **not** change the underlying deposit, lending, credit, accounting, prudential, treasury, share-price or capital-markets economics. It did not change the plan-scoring formula or the Board Confidence update formula. There is still no direct Board Confidence penalty for cash, high LCR, high CET1, regulatory status, franchise strength or any other non-plan input. A fortress bank is penalised only to the extent that its strategy misses explicit plan objectives.

No scenario mechanics, scenario parameters or scenario scoring were changed.

## Regression use

`src/engine/integratedCalibration.ts` contains the reusable strategy harness. `npm run test:calibration` runs the long-horizon calibration test; it can be sharded with `CALIBRATION_STRATEGY=<strategy>` for practical CI use. The test uses broad envelopes rather than exact expected values so legitimate model improvements can move the calibration while still detecting major incentive regressions such as unmanaged dominance, fortress dominance, free serial recapitalisation or renewed trivial-plan gaming.
