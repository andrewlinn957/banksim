# Integrated long-horizon calibration

This calibration checks BankSim as an interacting management game rather than as a collection of individually tested mechanics. It uses the real simulation engine, real management actions, the optional fixed Three-Year Plan and the capital-markets bookbuild over a six-year economic horizon.

The Three-Year Plan itself lasts exactly 36 months. When enabled, the board supplies the quantitative mandate at the opening; the player cannot edit, negotiate or renew it. At month 36 the final plan result and Board Confidence freeze. The simulation may continue beyond that point for long-run economic calibration, but no successor mandate is created.

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

Capital issuance and wholesale funding use the live capital-markets bookbuild, not the deprecated direct-issuance replay actions. No scenario mechanics or scenario shocks are used.

## September 2026 economic reference results

The table reports means across the eight seeds from the long-horizon economic sweep. Failed unmanaged paths are measured at their failure point; managed strategies all survived the full 72 months in this matrix.

| Strategy | Survival | Cumulative net income | Loan growth | RoTE | Share-price return | Capital / funding raised |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Adaptive | 100% | £0.95bn | -16.0% | 13.9% | +149.8% | £0.18bn |
| Balanced | 100% | £0.97bn | -20.9% | 13.6% | +143.7% | £0.11bn |
| Growth | 100% | £0.86bn | -8.7% | 12.5% | +121.3% | £0.37bn |
| Levered growth | 100% | £0.90bn | -6.1% | 14.5% | +132.0% | £0.36bn |
| Profitability-focused | 100% | £0.97bn | -33.4% | 14.3% | +147.1% | £0.00bn |
| Fortress | 100% | £0.65bn | -47.1% | 10.0% | +79.4% | £0.00bn |
| Capital-markets-reliant | 100% | £0.74bn | -16.2% | 9.1% | +9.4% | £3.42bn |
| Unmanaged | 62.5% | £0.38bn | -7.7% | 8.8% | +32.4% | £0.00bn |

These outcomes show different objectives pulling in different directions rather than one strategy dominating every measure. Balanced/adaptive management produces strong shareholder outcomes. Profitability-focused management earns strongly while losing customer scale. Fortress management survives comfortably but gives up nearly half of the loan book and produces materially weaker commercial outcomes. Serial issuance remains available as a management tool, but raising roughly £3.4bn over six years is associated with weak RoTE and almost no share-price gain.

Macro dispersion remains intentional. A benign path can make an aggressive or unmanaged strategy look much better than its cross-seed mean, while adverse paths can expose liquidity or capital weaknesses. The broad regression envelopes therefore test strategy shape and relative incentives rather than pinning exact means.

## Three-Year Plan boundary

The mandate is deliberately narrow:

- it is optional and disabled by default;
- if enabled at the opening, the board supplies one fixed 36-month quantitative plan;
- progress is tracked monthly against FY1/FY2/FY3 milestones;
- Board Confidence changes only at formal quarterly reviews and only as a function of performance versus the plan;
- the plan completes at month 36 and then freezes;
- management cannot edit the targets, reweight them, negotiate an easier plan or start a successor cycle.

There is no direct Board Confidence penalty for cash, high LCR, high CET1, regulatory status, franchise strength or any other non-plan input. A cash-heavy or fortress bank is penalised only to the extent that its economic outcomes miss explicit mandate targets.

## What was not changed

The calibration work did **not** change the underlying deposit, lending, credit, accounting, prudential, treasury, share-price or capital-markets economics. It did not change the plan-scoring formula or the Board Confidence update formula.

No scenario mechanics, scenario parameters or scenario scoring were changed.

## Regression use

`src/engine/integratedCalibration.ts` contains the reusable strategy harness. `npm run test:calibration` runs the long-horizon calibration test; it can be sharded with `CALIBRATION_STRATEGY=<strategy>` for practical CI use. The test uses broad economic envelopes rather than exact expected values so legitimate model improvements can move the calibration while still detecting major incentive regressions such as unmanaged dominance, fortress dominance or free serial recapitalisation.
