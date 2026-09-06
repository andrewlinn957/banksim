# Career pacing calibration

The default career uses a fictional operating cost base of £18m per month, plus separately charged servicing, origination, workout and conduct costs. This matches the fixed cost already used by the universal and retail-heavy calibration packs. It is not an estimate of Metro Bank's current expenses. The former £50m fixed cost, added to those other costs, made the opening career structurally loss-making. Named calibration packs retain their own explicit cost overrides.

Two behavioural defects amplified short-term changes:

- The bank-wide franchise index summed each deposit product's change. It now weights changes by opening deposit balances. Product segmentation therefore cannot multiply reputational damage; persistent underpricing still erodes franchise and customer balances.
- A single monthly GDP decline of 0.25% automatically moved the entire performing loan book to Stage 2. Staging now uses credit deterioration relative to origination, including macro conditions through stressed PD and borrower affordability. Existing Stage 2 cure criteria and Stage 3 treatment remain in place. There is no delayed recognition or earnings smoothing.

IFRS 9's SICR assessment concerns changes in default risk since initial recognition and reasonable, supportable forward-looking information. Its illustrative examples distinguish affected groups of borrowers. A mechanical GDP cutoff for the whole bank does not model that assessment. The simulator's relative annual-PD threshold remains a disclosed simplification, not a complete lifetime SICR model. Sources: [IFRS 9, 5.5.9 and B5.5.9–14](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ifrs-9-financial-instruments.pdf), [IFRS 9 illustrative examples, collective assessment](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2024/issued/ifrs9-ie.html).

## Reproducible checks

Default initial state and seed, no player actions or added shocks:

| Measure | Result |
| --- | --- |
| Old career failure | Month 25 |
| Revised career | Still operating at month 60 |
| First month net income | £7.0m |
| CET1 accounting capital, year 1 | £845m |
| CET1 accounting capital, year 5 | £625m |
| Year 5 final month net income | −£7.6m |

This is a development horizon, not a guarantee of success. Unmanaged pricing and funding can still erode earnings over several years. Changing market yields still revalue FVOCI gilts immediately, so reported prudential capital can move even while customer business changes gradually.

An immediate macro downturn of 3.5× PD and 2× LGD still recognises approximately £632m of provision charges and reduces accounting CET1 to £188m in the first month. Prudential thresholds, risk weights, liquidity factors, recognition rules and the severity of explicit shocks have not been relaxed.

`careerPacing.test.ts` checks the five-year default trajectory, franchise aggregation, selective SICR and immediate severe-stress recognition. Existing regression tests also cover archetype trajectories, random seeds and an exploit strategy over 120 months. The challenger NSFR upper calibration guard moves from 2.8 to 2.9 following the corrected franchise calculation (observed 24-month value 2.814); this guard is not a regulatory maximum.
