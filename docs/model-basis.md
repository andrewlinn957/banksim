# Model basis: 2026 UK banking sandbox

The game uses a simplified conventional GBP domestic bank under the standardised approach. Its first year is 2026; sandbox years retain the same rules. Opening balances are inspired by Metro Bank disclosures, not a reconstruction of that bank's regulatory returns. This is not a complete PRA or IFRS reporting implementation.

## Prudential metrics

| Measure | Implementation and assumed eligibility |
| --- | --- |
| Own funds | CET1 4.5%, Tier 1 6%, total capital 8%. No Tier 2, so Tier 1 and total capital coincide. OCI is included in eligible CET1. Standardised mortgage risk weight 35% assumes qualifying exposures; corporate loans use 100%. |
| Buffers | 2.5% conservation buffer plus 2% UK CCyB. CET1 must also cover any Tier 1/total capital shortfall before meeting buffers. Internal management headroom is shown separately. |
| Distributions | Bank policy suspends distributions inside the combined buffer. This conservative policy is not the statutory MDA calculation, which uses eligible profits and buffer quartiles. |
| Leverage | 3.25% small-bank supervisory expectation. Central-bank claims are excluded only up to matching GBP customer deposits. Undrawn commitments use an assumed short-original-maturity 20% CCF. |
| LCR | Unencumbered eligible HQLA; 40% Level 2 and 15% Level 2B caps. Stable retail runoff 5%, other ordinary retail 10%, operational corporate 25%, other non-financial corporate 40%. Performing customer receipts receive a 50% factor; aggregate inflows are capped at 75% of outflows. |
| NSFR | Stable retail ASF 95%, other retail 90%, relevant corporate deposits 50%. Wholesale funding uses contractual maturity. Eligible unencumbered UK Level 1 gilts and central-bank reserves receive 0% RSF. Loan principal due within the shorter maturity band is separated from longer residual balances. Qualifying long mortgages receive 65%, other long performing loans 85%, defaults 100%. |
| Commitments | Loan pipelines contribute to off-balance-sheet capital exposure, liquidity drawdowns and 5% NSFR funding requirements. |
| Repo | Only rolling one-month gilt repos are supported. Haircuts determine pledged collateral; pledged gilts cannot be sold. The initial repo also encumbers gilts. Reverse repos assume legally and operationally reusable Level 1 collateral. |

Prescribed LCR and NSFR factors do not change with game confidence. Separate management stress estimates affect funding behaviour. Falling below a liquidity minimum prompts recovery warnings, rather than automatically ending the game. Capital minima and actual cash failure remain game-ending conditions; that is a game rule, not a representation of legal resolution conditions.

### Primary sources

- [UK CRR Article 92: own funds](https://www.legislation.gov.uk/eur/2013/575/article/92).
- [PRA LCR rules](https://www.prarulebook.co.uk/pra-rules/liquidity-coverage-ratio-crr), especially Articles 4, 17, 24–28 and 31–33.
- [PRA liquidity rules: NSFR](https://www.prarulebook.co.uk/pra-rules/liquidity-crr), especially Articles 428l–428o, 428p–428s, 428ad and 428af. UK Article 428r differs from generic Basel summaries: eligible unencumbered Level 1 securities receive 0% RSF.
- [PRA leverage rules](https://www.prarulebook.co.uk/pra-rules/leverage-ratio-crr) and [2026 scope threshold change](https://www.bankofengland.co.uk/prudential-regulation/publication/2025/november/leverage-ratio-changes-to-the-retail-deposits-threshold-policy-statement). The full framework's retail-deposit threshold is £75bn on a three-year average from January 2026; this smaller bank uses the supervisory expectation.
- [Capital buffers rules](https://www.prarulebook.co.uk/pra-rules/capital-buffers) and [UK CCyB](https://www.bankofengland.co.uk/financial-stability/the-countercyclical-capital-buffer).
- [Basel 3.1 final rules](https://www.bankofengland.co.uk/prudential-regulation/publication/2026/january/implementation-of-the-basel-3-1-final-rules-policy-statement): effective January 2027, not applied early here.

## Funded-loan accounting

Loan balances are net of a separately tracked loss allowance. Booking or releasing an allowance never changes contractual principal. Stage 1 uses defaults possible over the next twelve months, capped by remaining life; Stage 2 uses lifetime defaults following a significant relative increase in credit risk. Monthly marginal defaults, amortisation, survival and discounting enter expected losses. Three weighted scenarios represent forward-looking uncertainty.

Credit-impaired loans move to workouts. Their allowance reflects discounted expected recoveries, and interest accrues on the net carrying amount. Recovery assumptions are shared between valuation and settlement. Discount unwind is non-cash interest, and write-offs release the existing allowance without charging the same loss twice. Product allowances reconcile to total provisions and net loans; cash flow and balance-sheet checks run each month.

Basis: [IFRS 9](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ifrs9.html), notably sections 5.4 and 5.5. Coupon is used as effective interest rate because integral origination fees are not modelled.

## Deliberate limits and remaining gaps

- No firm-specific Pillar 2A, PRA buffer, MREL, IRB, SDDT election or full COREP/FINREP reporting. Ratios are monthly point-in-time estimates, not regulatory averaging returns.
- Standardised risk weights are simplified: individual LTV eligibility, past-due weights, collateral substitution and derivative/SFT counterparty add-ons are not comprehensively modelled. Generic Level 2B treatment is not a universal eligibility engine; the opening liquidity portfolio uses Level 1 assets.
- Retail categories assume the stated insurance/relationship eligibility; higher-risk deposit flags are not individually modelled. One monthly payment is a proxy for the 30-day liquidity horizon.
- Repos roll monthly; there is no full trade-level settlement or collateral substitution ledger. Unsupported tenors and collateral are rejected.
- The opening loan book has no reconstructed historical allowance. The first close recognises the model's opening ECL. Unfunded commitment ECL, debt-security impairment, fee-adjusted EIR and full hedge accounting remain outside the funded-loan accounting implementation.
- PD, LGD, scenario weights and macro sensitivities are game assumptions, not calibrated IFRS estimates for a real bank.

## Regression calibration

The old liquidity envelopes incorporated behavioural stress into regulatory ratios. Correct prescribed factors, UK gilt RSF and amortising loan maturity bands raise the new ratios. Reviewed 24-month baseline results were approximately LCR/NSFR 4.74/3.40 (retail), 5.18/3.83 (universal), and 7.23/2.77 (challenger). Finite scenario bounds were updated accordingly. These checks detect model drift; they do not establish regulatory compliance.
