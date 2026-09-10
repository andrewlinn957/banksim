# Three-Year Plan calibration

The optional Three-Year Plan is an accountability layer, not an automatic management system. Board Confidence is updated quarterly and is a function only of performance against plan metrics.

## Calibration basis

Targets were calibrated against 36-month runs of the real simulation engine across seeds 11, 101, 1001, 10001 and 100001. The sweep compared unmanaged, balanced/adaptive, growth, profitability and fortress management styles. Adaptive managed paths explicitly repriced deposits and raised term funding when liquidity became tight; no automatic treasury allocation was introduced.

The first sweep showed that the old long-run regression helper was not a suitable three-year benchmark: it often allowed liquidity to drift and lending to contract sharply. A second adaptive sweep was therefore used for target setting.

A final sweep ran the implemented plan itself across all five management styles and seeds. Mean month-36 Board Confidence was approximately 81.8 for balanced management, 80.2 for growth, 80.0 for profitability and 73.2 for fortress management. Four of five unmanaged paths reached month 36; their mean Board Confidence was approximately 69.2. The fifth unmanaged path failed before month 36 and is therefore excluded from that month-36 mean. Dispersion across macro seeds remains intentional. A fortress strategy can still score well in a benign path if it actually delivers the explicit plan: there is no hidden penalty for its cash balance.

## Default plan

Weights: EPS 25%, RoTE 20%, customer lending 15%, customer deposits 10%, CET1 15%, LCR 7.5%, NSFR 7.5%.

FY1/FY2/FY3 minimums: EPS 8p/9p/10p; RoTE 8%/9%/10%; customer lending 100%/99%/97% of opening; customer deposits 97%/96%/95% of opening; CET1 12%/12.5%/13%; LCR 120% throughout; NSFR 115% throughout.

Capital and liquidity have no upper target in the default plan. A cash-heavy or over-capitalised bank is therefore not penalised directly. Such a strategy affects Board Confidence only if its economics cause misses in EPS, RoTE, lending, deposits or another explicit plan target.

Metric-specific miss tolerances prevent small misses from becoming cliffs while ensuring large commercial misses receive meaningfully low scores. The plan is disabled by default and does not affect ordinary Sandbox economics.
