# Model basis: 2026 UK banking sandbox

The game uses a simplified conventional GBP domestic bank under the standardised approach. Its first year is 2026; sandbox years retain the same rules. Opening balances are inspired by Metro Bank disclosures, not a reconstruction of that bank's regulatory returns. This is not a complete PRA or IFRS reporting implementation.

## Prudential metrics

| Measure | Implementation and assumed eligibility |
| --- | --- |
| Own funds | CET1 4.5%, Tier 1 6%, total capital 8%. Pillar 2A is reassessed every 24 months from the modelled bank's credit-risk benchmark shortfall, credit concentration and IRRBB, then held as a percentage of RWA until the next SREP. A scenario may impose a higher manual P2A floor. BankSim retains a simplified capital-quality assumption of at least 56.25% CET1 and 75% Tier 1 for P2A; the public Pillar 2 methodology and PS15/20 used for the periodic assessment do not themselves provide that complete composition rule. OCI is included in eligible CET1. Standardised mortgage risk weight 35% assumes qualifying exposures; corporate loans use 100%. |
| Buffers | The combined CET1 buffer is calculated dynamically: 2.5% capital conservation buffer + institution-specific CCyB + any O-SII buffer. The current UK CCyB rate is 2%; because all modelled lending geographies are UK regions, the opening institution-specific rate is also 2%. O-SII is growth-triggered from annual average quarter-end UK leverage exposure. CET1 must also cover any Tier 1/total capital shortfall before meeting buffers. A configured PRA buffer sits above the combined buffer and informs the internal target. PRA-buffer use prompts recovery warnings but does not itself trigger MDA or failure. Internal management headroom is shown separately. |
| Distributions | Bank policy suspends distributions inside the combined buffer. This conservative policy is not the statutory MDA calculation, which uses eligible profits and buffer quartiles. |
| Leverage | 3.25% small-bank supervisory expectation. Central-bank claims are excluded only up to matching GBP customer deposits. Undrawn commitments use an assumed short-original-maturity 20% CCF. |
| LCR | Unencumbered eligible HQLA; 40% Level 2 and 15% Level 2B caps. Stable retail runoff 5%, other ordinary retail 10%, operational corporate 25%, other non-financial corporate 40%. Performing customer receipts receive a 50% factor; aggregate inflows are capped at 75% of outflows. |
| NSFR | Stable retail ASF 95%, other retail 90%, relevant corporate deposits 50%. Wholesale funding uses contractual maturity. Eligible unencumbered UK Level 1 gilts and central-bank reserves receive 0% RSF. Loan principal due within the shorter maturity band is separated from longer residual balances. Qualifying long mortgages receive 65%, other long performing loans 85%, defaults 100%. |
| Commitments | Loan pipelines contribute to off-balance-sheet capital exposure, liquidity drawdowns and 5% NSFR funding requirements. Expected losses on undrawn offers are recognised as a separate non-cash provision liability. |
| Repo | Only rolling one-month gilt repos are supported. Haircuts determine pledged collateral; pledged gilts cannot be sold. The initial repo also encumbers gilts. Reverse repos assume legally and operationally reusable Level 1 collateral. |

Prescribed LCR and NSFR factors do not change with game confidence. Separate management stress estimates affect funding behaviour. Falling below a liquidity minimum prompts recovery warnings, rather than automatically ending the game. Capital minima and actual cash failure remain game-ending conditions; that is a game rule, not a representation of legal resolution conditions.

### Primary sources

- [UK CRR Article 92: own funds](https://www.legislation.gov.uk/eur/2013/575/article/92).
- [PRA Statement of Policy: The PRA's methodologies for setting Pillar 2 capital](https://www.bankofengland.co.uk/prudential-regulation/publication/2015/the-pras-methodologies-for-setting-pillar-2-capital), especially the credit-risk, credit-concentration and IRRBB methodologies.
- [PS15/20: Pillar 2A — Reconciling capital requirements and macroprudential buffers](https://www.bankofengland.co.uk/prudential-regulation/publication/2020/pillar-2a-reconciling-capital-requirements-and-macroprudential-buffers).
- [PRA LCR rules](https://www.prarulebook.co.uk/pra-rules/liquidity-coverage-ratio-crr), especially Articles 4, 17, 24–28 and 31–33.
- [PRA liquidity rules: NSFR](https://www.prarulebook.co.uk/pra-rules/liquidity-crr), especially Articles 428l–428o, 428p–428s, 428ad and 428af. UK Article 428r differs from generic Basel summaries: eligible unencumbered Level 1 securities receive 0% RSF.
- [PRA leverage rules](https://www.prarulebook.co.uk/pra-rules/leverage-ratio-crr) and [2026 scope threshold change](https://www.bankofengland.co.uk/prudential-regulation/publication/2025/november/leverage-ratio-changes-to-the-retail-deposits-threshold-policy-statement). The full framework's retail-deposit threshold is £75bn on a three-year average from January 2026; this smaller bank uses the supervisory expectation.
- [Capital buffers rules](https://www.prarulebook.co.uk/pra-rules/capital-buffers) and [UK CCyB](https://www.bankofengland.co.uk/financial-stability/the-countercyclical-capital-buffer).
- [FPC O-SII buffer framework response, July 2025](https://www.bankofengland.co.uk/paper/2025/fpc-response-2024-o-sii-buffer-framework-review) and [PRA O-SII rates](https://www.bankofengland.co.uk/prudential-regulation/publication/2025/november/o-sii-buffer-rates-for-ring-fenced-banks-and-large-building-societies).
- [Basel 3.1 final rules](https://www.bankofengland.co.uk/prudential-regulation/publication/2026/january/implementation-of-the-basel-3-1-final-rules-policy-statement): effective January 2027, not applied early here.

## Capital buffer framework

BankSim models the capital conservation buffer (CCoB), institution-specific countercyclical capital buffer (CCyB) and Other Systemically Important Institution (O-SII) buffer. The G-SIB buffer is deliberately not modelled. The combined buffer is the sum of these three rates and is met with CET1 above Pillar 1 and Pillar 2A minima.

The CCoB is fixed at 2.5% of total RWA. The current UK CCyB rate is 2%. The regulatory institution-specific CCyB is a geographic weighted average across relevant credit exposures. All current BankSim cohort geographies are UK regions, so 100% of relevant credit RWA maps to the UK and the sandbox institution-specific CCyB is therefore 2%. The engine exposes the geographic share explicitly so international products can later supply non-UK rates without changing the combined-buffer calculation.

O-SII is growth-triggered. The generic bank enters the game's domestic-systemic scope proxy once core deposits exceed £35bn. If trading assets are below 10% of Tier 1 capital it is classified as a large domestic bank; otherwise BankSim treats it as a ring-fenced-bank proxy. This is a game implementation of the current scope architecture rather than a complete legal ring-fencing test, and building societies are not separately modelled.

The O-SII rate is assessed annually from the trailing four quarter-end UK leverage exposure measures (LEM). BankSim's UK LEM proxy excludes central-bank reserves, replaces the derivative book with the prudential derivative exposure and includes committed but undrawn credit facilities. Because the current bank is domestic, the whole proxy is treated as UK exposure. For the 2026 rate schedule the O-SII buckets are: 0% below £190bn; 1% from £190bn; 1.5% from £365bn; 2% from £540bn; 2.5% from £715bn; and 3% from £890bn. From the published 2027 framework the thresholds are £205bn, £390bn, £575bn, £760bn and £945bn respectively. BankSim uses that published 2027 schedule for later years until a future framework update is modelled.

The PRA sets O-SII rates at least annually using the FPC framework and real-world publication/application lags. For gameplay, BankSim applies the newly assessed rate immediately at its annual review. That preserves the important lag from balance-sheet growth to a higher systemic buffer while avoiding a second administrative lag. The O-SII buffer applies to all RWA once set. A legacy configured `systemicBuffer` value is treated only as a manual floor for scenarios; the base game uses the calculated O-SII rate.

## Pillar 2A 24-month SREP assessment

BankSim runs a Pillar 2A assessment at the opening date and then every twenty-four monthly closes. The assessed variable P2A percentage is frozen until the next review. Its nominal amount is not frozen: current P2A capital equals the assessed rate multiplied by current RWA. This deliberately reproduces the supervisory-review lag as a game mechanic rather than recalculating the requirement from the balance sheet every month.

### Credit risk

For performing standardised loan cohorts, the engine compares Pillar 1 RWA with the PRA's Table A2 IRB benchmark excluding expected losses. Mortgages use the published LTV bands; personal loans use 77.5%; BankSim SME/business corporate lending uses 59.8%, while cohorts explicitly classed as large corporate use 46.3%. The comparison is made in aggregate, so benchmark over-capitalisation in one portfolio can offset a benchmark shortfall in another. Any remaining benchmark RWA shortfall is multiplied by 8% to express the additional own-funds amount. This is a transparent implementation of the published benchmark comparison, not a reproduction of supervisory judgement around benchmark ranges or portfolio quality.

### Credit concentration

The engine follows the PRA's published HHI structure for single-name, sector and international geographic concentration. HHI shares are based on the relevant portfolio's RWA. Single-name and sector assessments use the wholesale corporate book; geographic concentration uses non-mortgage credit. The capital add-on uses the midpoint of the applicable published Figure 1 range, consistent with the PRA statement that the midpoint is the starting point for supervisory judgement, and the three concentration components are summed.

BankSim does not yet track named corporate obligors. Single-name HHI therefore assumes equal-sized obligors within each wholesale cohort, with a representative £5m exposure per obligor. Existing BankSim corporate sectors are mapped into the PRA sector set: commercial real estate remains CRE, large corporate maps to manufacturing, SME maps to services/other and the residual category maps to wholesale/retail trade. The game currently models a domestic UK bank, so its UK regional cohort labels all map to the PRA's United Kingdom international-geography bucket. These mappings and the equal-obligor assumption are game abstractions, not PRA policy.

### IRRBB

For a smaller/less-complex bank the PRA standard methodology reviews internal policy limits, most commonly based on the economic effect of a 200bp interest-rate shift. BankSim therefore calculates the absolute ±200bp EVE loss from its duration model and compares it with the board's IRRBB EVE policy limit. The greater amount is the supervisory risk measure. The public policy does not publish a simple mechanical conversion from that policy limit to a Pillar 2A capital amount, so BankSim applies an explicit 20% capitalisation scalar. The scalar is a game calibration and is shown in the dashboard rather than presented as a PRA rule. Swaps, mortgage fixing periods, gilt duration and funding duration can therefore change the next 24-month IRRBB assessment.

### PS15/20 offset

The gross variable P2A rate is reduced using the PS15/20 structural-CCyB logic. BankSim calculates a UK CCyB pass-through proxy as UK credit RWA divided by total credit RWA. The initial reduction is 50% of the one percentage point structural UK CCyB increase multiplied by that pass-through. The current sandbox assumes the small bank is low-risk and that MREL equals TCR, because it does not yet contain a full MREL or supervisory-categorisation engine; it therefore applies the potential additional 50% reduction subject to the PS15/20 rule that the additional reduction cannot take variable P2A below 1%. If the initial reduction alone takes P2A below 1%, the additional reduction is zero. The offset is tied to the structural standard-risk CCyB change and does not move mechanically with the live cyclical CCyB setting between SREPs.

## Funded-loan accounting

Loan balances are net of a separately tracked loss allowance. Booking or releasing an allowance never changes contractual principal. Stage 1 uses defaults possible over the next twelve months, capped by remaining life; Stage 2 uses lifetime defaults following a significant relative increase in credit risk. Monthly marginal defaults, amortisation, survival and discounting enter expected losses. Three weighted scenarios represent forward-looking uncertainty.

Credit-impaired loans move to workouts. Their allowance reflects discounted expected recoveries, and interest accrues on the net carrying amount. Recovery assumptions are shared between valuation and settlement. Discount unwind is non-cash interest, and write-offs release the existing allowance without charging the same loss twice. Product allowances reconcile to total provisions and net loans; cash flow and balance-sheet checks run each month.

Basis: [IFRS 9](https://www.ifrs.org/content/dam/ifrs/publications/html-standards/english/2025/issued/ifrs9.html), notably sections 5.4 and 5.5. Coupon is used as effective interest rate because integral origination fees are not modelled.

## Opening accounts and defaulted exposures

Opening allowances are now established before play. Seasoned gross principal is scaled to preserve the supplied net loan balance, cash and total equity. This is a synthetic opening estimate, not a claim to reproduce historical Metro allowances. Scenario overrides receive the same treatment; funding ladders scale with funding stocks and cash balances the opening books. Two legacy scenarios used hundreds of billions of exposures against the newer small-bank balance sheet; those amounts now match the bank's scale.

Undrawn offer ECL uses the loan term, probability-weighted PD paths and effective interest discounting, with expected take-up derived from competing monthly drawdown and cancellation rates. The prudential CCF is not used as an IFRS drawdown estimate. The pipeline is still pooled: SICR is a relative portfolio PD signal, not borrower-level origination tracking. Movement in the provision liability enters profit, not cash, and is released as offers leave the pipeline. Funded-loan provisions remain separately reconciled.

Under [UK CRR Article 127](https://www.legislation.gov.uk/eur/2013/575/article/127/data.html), qualifying defaulted mortgages receive 100% risk weight on net exposure. Unsecured corporate defaults receive 150% below 20% provision coverage and 100% at or above it. Individual model ECL weights allocate the booked product allowance to cohorts and workouts. Stage 3/workout status is the model's default proxy; it does not reproduce every Article 178 test.

Pillar 2A is now generated by the periodic methodology above. The `supervisory-review` scenario retains a fictional 1.5% manual P2A floor and a 1% PRA-buffer input as scenario design choices; they are not published requirements for a real bank.

## Deliberate limits and remaining gaps

- No MREL eligibility engine, IRB permission, SDDT election or full COREP/FINREP reporting. For PS15/20 gameplay the domestic small bank is assumed low-risk with MREL equal to TCR; this is explicit model configuration, not an inferred regulatory status.
- Standardised risk weights are simplified: individual LTV eligibility, collateral substitution and SFT counterparty exposure and credit valuation adjustment capital are not comprehensively modelled. The supported vanilla swap calculation is described below. Generic Level 2B treatment is not a universal eligibility engine; the opening liquidity portfolio uses Level 1 assets.
- Retail categories assume the stated insurance/relationship eligibility; higher-risk deposit flags are not individually modelled. One monthly payment is a proxy for the 30-day liquidity horizon.
- Repos roll monthly; there is no full trade-level settlement or collateral substitution ledger. Unsupported tenors and collateral are rejected.
- Integral origination fees, designated hedge accounting, CVA capital, collateralised derivatives and a complete instrument-level bond ledger remain outside scope. No integral fees or hedge designations are assumed. General service and origination operating costs are expensed.
- PD, LGD, scenario weights and macro sensitivities are game assumptions, not calibrated IFRS estimates for a real bank.

## Regression calibration

The old liquidity envelopes incorporated behavioural stress into regulatory ratios. Correct prescribed factors, UK gilt RSF and amortising loan maturity bands raise the new ratios. Reviewed 24-month baseline results were approximately LCR/NSFR 4.74/3.40 (retail), 5.18/3.83 (universal), and 7.23/2.77 (challenger). Finite scenario bounds were updated accordingly. These checks detect model drift; they do not establish regulatory compliance.

## Gameplay and verification

Quarterly badges recognise actual customer, earnings, capital and shareholder outcomes, frozen at each three-month deadline. They create no accounting gains or regulatory relief. When internal capital headroom is negative, a real equity-raising proposal replaces aggressive growth; dilution and issuance costs still apply. The supervisory-review scenario combines a disclosed capital decision with competition and credit shocks.

Targeted checks cover opening balances, commitment booking/release, non-cash reconciliation, 24-month P2A assessment and PS15/20 offsets, PRA-buffer/MDA separation, default risk weights, scenario consistency and quarterly deadlines. The existing deterministic and long-run regression suites remain in place.

## Securities and treasury

The gilt portfolio now carries a Stage 1 expected-loss estimate under the low-credit-risk assumption. Amortised-cost securities deduct the allowance from assets; FVOCI securities stay at fair value with an offsetting OCI allowance. FVTPL instruments do not receive a separate ECL allowance. Opening FVOCI allowances reclassify an equal amount between CET1 retained earnings and OCI, preserving total equity. Coupon income uses the tracked amortised-cost basis, so a market price fall does not mechanically reduce contractual coupon receipts. Partial sales reduce that basis and allowance proportionately. Accumulated FVOCI gain/loss, including the disposed allowance reserve, is recycled to profit on disposal. The existing P&L field `fvtplValuationImpact` includes this realised securities result as well as fair-value changes.

Swaps are **undesignated FVTPL derivatives**, with separate asset and liability balances. Off-market coupons require the corresponding model fair-value upfront cash payment or receipt. Mark changes go to profit, monthly coupons settle in cash, and value unwinds at maturity. The valuation assumes a flat forward/discount rate at the current short rate; it is not an IFRS 13 market-calibrated multi-curve valuation and has no CVA/DVA adjustment. A hedge is therefore a real trade-off, not a free choice of profitable coupon.

For the supported unmargined, spot-starting vanilla GBP swaps, one trade is one netting set. [PRA CCR Articles 274, 278, 279b/c and 280a](https://www.prarulebook.co.uk/pra-rules/counterparty-credit-risk-crr) supply the 1.4 alpha, supervisory duration, 0.5% interest-rate factor, maturity factor and PFE multiplier. A configured 100% counterparty risk weight is assumed. The [leverage calculation](https://www.prarulebook.co.uk/pra-rules/leverage-ratio-crr) replaces derivative book assets with exposure using a PFE multiplier of one. No cross-trade netting or collateral relief is claimed.

LCR includes each swap's net monthly coupon at a 100% inflow/outflow factor, with the existing aggregate inflow cap. NSFR uses positive aggregate net derivative assets at 100%, plus 5% of gross negative fair values, under Articles 428d, 428s and 428ah of the [liquidity rules](https://www.prarulebook.co.uk/pra-rules/liquidity-crr). There is no margin agreement, initial margin or variation-margin ledger in this supported contract type. The board offers a hedge proposal when interest-rate sensitivity is material and liquidity permits it; the threshold is a game trigger, not the supervisory outlier test.
