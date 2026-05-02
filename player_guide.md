# UK Bank Simulator User Manual (Mechanics Reference)

Last verified against code on 2026-02-23.
Primary source files:
- `src/engine/simulation.ts`
- `src/engine/loanCohorts.ts`
- `src/engine/metrics.ts`
- `src/engine/ukMarketModel.ts`
- `src/config/baseConfig.ts`
- `src/config/initialState.ts`
- `src/config/scenarios.ts`

## 1. What this manual is

This is a mechanics-first user manual for the current app build.

It documents:
- what the player can do in the UI
- what the engine does each month
- exact failure conditions
- default model assumptions and thresholds

It does not describe code architecture for developers beyond what is needed to explain gameplay.

## 2. Quick start

1. Run the app:
   - `npm run dev`
2. Open the app in browser.
3. Either:
   - stay in `Sandbox mode`, or
   - start a scenario in the `Scenarios` tab.
4. Open `Actions`, set your levers, and click `Run next month`.
5. Repeat monthly while monitoring:
   - `Overview` for top metrics and attribution
   - `Regulatory` for ratio decompositions
   - `Loans`, `Accounts`, `Costs`, and `Events` for drill-down

## 3. Game objective and failure logic

### Hard failure (run-ending)

The bank is marked failed if any of these occurs:
- CET1 ratio `< minCet1Ratio` (default 10.5%)
- Leverage ratio `< minLeverageRatio` (default 3.5%)
- LCR `< minLcr` (default 1.0x)
- NSFR `< minNsfr` (default 1.0x)
- cash shortfall on any required outflow
- invariant breach (balance sheet, negative balances, invalid ratios, cash-flow mismatch threshold)

When failed:
- status becomes `Resolution mode`
- action buttons are disabled in UI

### Non-fatal warnings

- Concentration breaches (sector/geography) are warnings, not hard-fail triggers.
- MDA trigger is a warning and constrains payout.

## 4. Core monthly loop (actual engine order)

Each click on `Run next month` advances one simulation step:

1. Clone input state.
2. Normalize `stepLengthMonths` to integer months (minimum 1).
3. Sync loan balances from cohorts.
4. Ensure funding ladders align to wholesale funding lines.
5. Apply shocks.
6. Apply securities valuation (if feature enabled).
7. Apply player actions.
8. Run competitor reaction.
9. Run funding ladder maturities/refinancing.
10. Run deposit behavior and deposit mix migration.
11. Run loan pipeline behavior.
12. Run loan cohort lifecycle (amortization, prepay, renewal, defaults, workouts).
13. Run conduct-risk step.
14. Accrue non-loan interest P&L.
15. Accrue hedge carry and retire matured hedges.
16. Recognize losses and update provision stock.
17. Close P&L to capital and operating cash.
18. Compute risk metrics and optionally advance confidence state.
19. Apply dividends/AT1 coupons from capital policy.
20. Recompute metrics/compliance and emit regulatory events.
21. Update share price model.
22. Build cash-flow statement and advance date/step.
23. Run invariants and cash-flow tie-out threshold checks.
24. Advance UK macro/market state one step.
25. Build step attribution diagnostics.

## 5. What the UI controls

## 5.1 Header controls

- `Run next month`: one step using current action form.
- Autopilot months: `1, 3, 6, 12`.
- Stop condition:
  - `None`
  - `Near breach (5%)`
  - `On breach`
  - `On score target`
- `Run Xm`: repeat stepping with fixed current actions.
- `Save run`: persist current run timeline and snapshots.

## 5.2 Tabs

- `Overview`: top metrics, macro panel, attribution summary.
- `Share Price`: share-price drivers and timeseries.
- `Scenarios`: choose scenario, start scenario, objective scoring.
- `Accounts`: assets, liabilities/equity, P&L, cash-flow statements.
- `Regulatory`: detailed decompositions for RWA, leverage, LCR, NSFR, capital, plus attribution waterfall.
- `Loans`: loan products, pipeline, cohort table, workout summary.
- `Costs`: monthly P&L/cost lines.
- `Events`: chronological events (`info`, `warning`, `error`).
- `Reconciliations`: accounting checks.
- `Runs`: compare saved runs, replay determinism check.

## 5.3 Actions panel levers

Visible levers:
- Retail deposit rate (applies to transactional + savings)
- Corporate deposit rate (applies to operating + non-operating)
- Mortgage rate
- Corporate loan rate
- Mortgage underwriting tightness (0..1)
- Corporate underwriting tightness (0..1)
- Issue long-term wholesale debt amount
- Issue equity amount
- Dividend payout ratio (0..1)
- AT1 coupon mode (`auto`, `pay`, `skip`)
- Hedge direction (`none`, `payFixedReceiveFloat`, `receiveFixedPayFloat`)
- Hedge notional
- Hedge fixed rate
- Hedge maturity (months)

## 5.4 Input parser rules

Rates (`parseRateInput`):
- Accepts decimal: `0.025`
- Accepts percent: `2.5%`, `2.5pct`
- Accepts bps: `250bps`
- If raw numeric is `>1` and `<=100`, parser treats it as percent (`2.5` -> `0.025`)
- Must be `0 <= rate <= 1`

Amounts (`parseMoneyInput`):
- Accepts plain number or suffix:
  - `k` (1e3), `m` (1e6), `bn` (1e9)
- Currency text (`GBP`, `GBP symbol`) is stripped
- Must be non-negative

Validation blockers:
- Any invalid field blocks stepping/autopilot.
- Hedge requires positive notional and valid fixed rate when direction is not `none`.

## 6. State model the player is managing

Main state buckets:
- Balance sheet items (assets/liabilities with rates and liquidity tags)
- Capital (`cet1`, `at1`, `accumulatedOCI`)
- Income statement and cash-flow statement
- Risk metrics and compliance
- Behavioral state (franchise, reputation, underwriting, confidence, conduct)
- Loan cohorts and workout buckets
- Funding maturity ladders
- Equity market state (`sharePrice`, `marketCap`, `epsTtm`, `peMultiple`)
- UK market state (policy rate, curve, spreads, macro factors)

Time:
- Starts at step `0`, date `2024-12-31`
- Default step length is `1` month

## 7. Default sandbox opening position

From `initialState`:

Assets:
- Cash reserves: GBP 2.811bn at 3.10%
- Gilts: GBP 5.758bn at 2.90%
- Mortgages: GBP 5.145bn at 5.00% (seeded into seasoned cohorts)
- Corporate loans: GBP 3.868bn at 5.80% (seeded into seasoned cohorts)
- Reverse repo: GBP 0

Liabilities:
- Retail transactional deposits: GBP 1.646bn at 0.70%
- Retail savings deposits: GBP 6.107bn at 2.15%
- Corporate operating deposits: GBP 6.505bn at 2.05%
- Corporate non-operating deposits: GBP 0.200bn at 3.00%
- Wholesale ST: GBP 0.300bn at 5.00%
- Wholesale LT: GBP 1.513bn at 5.30%
- Repo borrowing: GBP 0.350bn at 4.80%

Capital:
- CET1: GBP 0.695bn
- AT1: GBP 0.249bn
- OCI: GBP 0.017bn

Behavior start:
- Deposit franchise strength: 0.70
- Reputation: 0.84
- Confidence state: initialized from metrics

Market start (selected examples):
- Base rate: 4.75%
- Competitor retail deposit: 1.90%
- Competitor corporate deposit: 2.10%
- Competitor mortgage: 4.90%

## 8. Player action mechanics (exact effects)

## 8.1 Repricing (`adjustRate`)

- Sets line-item interest rate directly.
- No immediate balance change.
- Balance effects happen later via behavioral engines.

## 8.2 Underwriting (`setUnderwriting`)

- Stores tightness per loan product in `[0,1]`.
- Higher tightness:
  - reduces pipeline approval rate
  - reduces adverse selection amplification

## 8.3 Equity issuance (`issueEquity`)

Given requested amount:
- executable = requested * `equityIssuanceMultiplier` (confidence-state dependent)
- fee = executable * `equityIssuanceFeeRate`
- net proceeds = executable - fee

Effects:
- CET1 += net proceeds
- Cash += net proceeds
- Shares outstanding increase at discounted issue price:
  - issue price = current share price * (1 - equityIssuanceDiscount), floored by model price floor
- Event warning if issuance clipped by confidence

## 8.4 Debt issuance (`issueDebt`)

Given requested amount:
- executable = requested * confidence `accessMultiplier`

Pricing:
- If explicit rate provided: use it, no confidence spread penalty.
- Else default:
  - ST: `riskFreeShort + wholesaleFundingSpread`
  - LT: `riskFreeLong + seniorDebtSpread`
  - plus confidence spread penalty in bps.

Effects:
- Adds maturity bucket to funding ladder.
- Syncs wholesale line balance/rate from ladder.
- Cash += executable.

## 8.5 Capital policy (`setCapitalPolicy`)

Sets:
- `dividendPayoutRatio` clamped to `[0,1]`
- `at1CouponMode`: `auto`, `pay`, or `skip`

## 8.6 Hedge entry (`enterHedge`)

Adds hedge with:
- direction
- notional
- fixed rate
- maturity months

Monthly hedge carry:
- `payFixedReceiveFloat`: `(float - fixed - carrySpread) * notional * dtYears`
- `receiveFixedPayFloat`: `(fixed - float - carrySpread) * notional * dtYears`

Matures when remaining months <= 0.

## 8.7 Repo actions (engine-supported, not exposed in default UI)

`enterRepo` with direction:
- `borrow`: raises repo liability, increases cash, encumbers collateral with haircut.
- `lend`: creates reverse repo asset, reduces cash.

## 8.8 Asset buy/sell (engine-supported, not exposed in default UI)

`buySellAsset`:
- Non-loans:
  - buy: asset up, cash down (cash-limited)
  - sell: asset down, cash up
- Loans:
  - buy uses `upsertOriginationCohort` (cash-limited)
  - sell uses `applyExtraPrepayment` (cash inflow from run-off)

## 9. Shock mechanics

Supported shock types:
- `depositCompetition`
- `marketSpreadShock`
- `idiosyncraticRun`
- `macroDownturn`
- `counterpartyDefault`
- `rolloverStress`

Effects:

`depositCompetition`
- Raises competitor deposit benchmarks.

`marketSpreadShock`
- Widens wholesale/senior funding spreads, credit spread, corporate loan spread.
- Increases gilt repo haircut.

`idiosyncraticRun`
- Multiplies LCR customer-deposit outflow multiplier.
- Immediate one-off deposit withdrawal:
  - runoffRate = `baseRunOffRate + incrementalRate * max(0, outflowMultiplier-1)`, capped by `maxRunOffRate`
  - cash is paid pro-rata by product until exhausted
  - unmet withdrawals trigger error and failure.

`macroDownturn`
- Multiplies PD and LGD used in credit engine.

`counterpartyDefault`
- Books extra product-level one-off loss for loss recognition stage.

`rolloverStress`
- Multiplies market access for refinancing and adds spread bps to rollover pricing.

## 10. Deposit behavior engine

Runs on products flagged as behavioral customer deposits.

For each product:
- competitor benchmark depends on segment (retail/corporate).
- lagged offered rate updates using pass-through lag memory.
- underpricing gap and underpricing-duration memory are tracked.

Growth formula components:
- baseline growth
- churn
- policy-rate gap term
- competitor relative-rate term
- convex underpricing penalty with duration multiplier
- reacquisition drag when franchise is weak

Growth is clamped by config:
- min deposit growth per step
- max deposit growth per step

Cash treatment:
- Deposit growth is cash inflow.
- Deposit shrink is cash outflow; unmet outflows fail the bank.

Additional state updates:
- deposit stability index (per product)
- deposit franchise strength (aggregate drift)

### Deposit mix migration

When underpriced, balance shifts from more stable to less stable segment buckets:
- retail: savings -> transactional
- corporate: operating -> non-operating

This reduces stability indices and can worsen liquidity quality.

## 11. Competitor reaction model

Competitor rates and corporate-loan spread mean-revert toward your pricing with stress-adjusted speed:
- retail competitor deposit rate
- corporate competitor deposit rate
- competitor mortgage rate
- market corporate loan spread

Higher stress (low LCR/NSFR/confidence/franchise) speeds competitor catch-up.

## 12. Funding ladder and rollover risk

Wholesale ST/LT funding is tracked in maturity buckets.

At maturity:
- principal must be paid out in cash
- some amount can be refinanced based on computed access

Access is a function of:
- base rollover access
- shock rollover access multiplier
- market spread penalty
- liquidity penalty (if LCR < 1)
- endogenous confidence stress
- nonlinear access cliff function
- confidence-state access multiplier and floor

Refinance rate includes:
- risk-free anchor (short/long)
- base spread
- rollover shock spread
- access penalty
- endogenous spread penalty
- confidence spread penalty

If maturity payment cannot be met:
- unpaid amount is rolled to an overdue 1-month bucket at penalty rate
- failure event logged

Reported metrics:
- funding maturing <= 3 months
- funding maturing <= 12 months

## 13. Loan production pipeline mechanics

If pipeline params exist for product (default true):

Demand:
- `demand = balance * baseDemandRateMonthly * dtMonths * demandScalar`
- demand scalar combines pricing gap and macro signal.

Approval:
- `approvalRate = clamp(baseApprovalRate + 0.2*pricingGap - underwritingSensitivity*tightness, 0, 1)`
- approved = demand * approvalRate

Committed/drawdown:
- cancellations reduce existing committed
- drawdown rate converts committed+approved into requested drawdown
- drawdown is cash-limited
- originations executed through cohort creation/update (`upsertOriginationCohort`)

Adverse selection on new origination PD:
- if offered rate is above benchmark by threshold, PD multiplier rises with slope
- loose underwriting increases multiplier
- capped by configured max multiplier

If no pipeline config:
- falls back to direct growth/shrink with elasticity and growth clamps.

## 14. Loan cohort lifecycle mechanics

Each monthly substep:

1. Workout pipeline resolution runs first (recoveries/charge-offs).
2. For each cohort:
   - amortization payment computed from remaining term and rate
   - interest + principal cash inflow is recognized
   - selective prepayments based on refinancing incentive and risk selectivity
   - affordability index drifts with coupon gap, policy rate, unemployment, GDP contraction, then mean-reverts
   - optional renewal near maturity:
     - shares of principal can roll into new cohort at current offered rate
     - renewed principal can carry higher PD via renewal adverse selection
   - concentration multipliers can raise PD in stress if sector/geography concentrated
   - affordability index also multiplies PD
   - stage classification updates (stage1/stage2/stage3)
   - monthly default occurs from annual PD conversion
   - defaults move to workout buckets with expected recovery and lag
   - age increments
3. Extra loan losses from shocks are allocated pro-rata to cohorts.
4. Cohorts with negligible principal or expired age are removed.
5. Loan balances are resynced to cohort totals plus workout stock.

### Stage classification rules (IFRS9-style)

Stage 3 if:
- stressed annual PD >= stage3 threshold, or
- unemployment >= 9.5%

Stage 2 if:
- stressed PD >= base PD * SICR threshold, or
- GDP growth MoM <= -0.25%

Hysteresis:
- stage3 can persist unless PD falls far enough
- stage2 can persist unless PD improves enough

## 15. Workout pipeline mechanics

Defaults enter workout buckets with:
- expected recovery rate (from stressed LGD floor/cap logic)
- months to resolution (stress-sensitive lag)

At resolution:
- recovery cash is added
- unrecovered principal is recognized as loan loss
- recovery is penalized by macro stress and concentration

## 16. Loss recognition and provisioning

Loss buckets:
- realized loan losses
- realized non-loan losses
- provision charge

Provision target:
- stage1: 12-month PD proxy
- stage2/stage3: lifetime PD proxy via remaining term multipliers
- stage3 also includes workout bucket expected shortfalls

Provision stock update:
- target delta is applied to loan book via cohort principal adjustments
- resulting stock is scaled across stage1/2/3 totals

Credit-loss P&L line:
- `creditLosses = provisionCharge + realizedNonLoanLosses`

## 17. Conduct risk engine

Conduct score is built from:
- deposit underpricing severity
- lending overpricing severity
- amplification when underwriting is loose
- build/decay rates over time

Event probability:
- base + slope * score, capped
- event blocked during cooldown months

If event triggers:
- cost = fine + remediation
- fine linked to RWA with minimum floor
- remediation linked to income proxy
- franchise and reputation are hit
- cooldown resets

Conduct costs flow into operating expenses and reduce CET1 via net income.

## 18. Securities accounting mechanics

Assets with `security` metadata are revalued by duration * yield move:
- reference yield:
  - gilts: `riskFreeLong`
  - others: `riskFreeLong + creditSpread`

Classification treatment:
- `HTM`: no balance/P&L/OCI recognition (latent move logged only)
- `FVTPL`: fair-value change to P&L
- `FVOCI`: fair-value change to OCI

FVOCI inclusion in CET1 ratio uses config inclusion rate (default 85%).

## 19. P&L, cash, and capital close mechanics

## 19.1 Interest accrual

Non-loan asset interest income:
- simple interest on balances and rates over `dtYears`

Liability interest expense:
- simple interest on liability balances and rates

Loan interest income is handled in cohort step and passed into capital close.

## 19.2 Fee and cost model

Fee income:
- `loanFeeRateMonthly * dtMonths * loanBookBalance`

Operating expenses:
- fixed operating cost
- servicing cost (annual rate on weighted loan servicing base)
- origination costs (rate * new originations)
- workout costs (rate * default/NPL proxy base)
- conduct costs

Tax:
- only on positive pre-tax profit

Net income:
- added to CET1
- FVOCI movement added to OCI

Operating cash delta:
- modeled from interest/fees minus expenses/tax
- adjusted to avoid double-counting loan interest cash already recognized in cohort step

## 20. Capital distribution mechanics

Applied after first metric computation each step.

Dividend:
- requested payout ratio is clipped by `maxPayoutRatio`
- paid dividend also limited by:
  - distributable CET1 above internal target
  - available cash

AT1 coupon:
- due = `AT1 * annualCouponRate * dtYears`
- `auto` pays only if:
  - not MDA triggered
  - CET1 ratio >= discretionary threshold
  - internal CET1 headroom >= configured minimum
- `pay` forces attempt to pay (still cash/capital constrained)
- `skip` always zero

Paid distributions reduce CET1 and cash.

## 21. Risk metrics and compliance formulas

## 21.1 Core capital metrics

`rwa = sum(assetBalance * riskWeight)`

`adjustedCet1 = cet1 + accumulatedOCI * fvociCet1InclusionRate`

`cet1Ratio = adjustedCet1 / rwa`

`leverageRatio = (adjustedCet1 + at1) / leverageExposure`

Hard breach uses minimum CET1 ratio (10.5%), not combined buffer requirement.

## 21.2 CET1 requirement and MDA

Combined CET1 requirement:
- min CET1
- conservation buffer
- countercyclical buffer
- systemic buffer
- management buffer

Default total:
- 10.5% + 2.5% + 1.0% + 0.5% + 1.0% = 15.5%

MDA trigger:
- when CET1 ratio < combined requirement

## 21.3 LCR and NSFR

HQLA:
- unencumbered assets times level factors (L1=1, L2A=0.85, L2B=0.5)

LCR:
- outflows: liability balances * outflow rates
- customer-deposit outflows scaled by liquidity outflow multiplier
- inflows capped at 75% of outflows
- `lcr = hqla / netOutflows`

NSFR:
- ASF starts with adjusted CET1 + AT1
- liability ASF factors, customer deposit ASF scaled by asfMultiplier
- RSF from asset RSF factors
- `nsfr = asf / rsf`

## 21.4 Liquidity dynamics multipliers

Derived from:
- recession regime
- franchise weakness
- reputation weakness
- deposit quality weakness

Outputs:
- deposit outflow multiplier
- inflow multiplier
- ASF multiplier

## 21.5 Deposit quality index

Weighted average of per-product deposit stability index:
- clamped roughly to [0.4, 1.1]
- used in liquidity/funding stress channels

## 21.6 Funding confidence score and state

Funding stress index blends:
- liquidity stress
- NSFR stress
- capital stress
- franchise stress
- deposit quality stress
- maturity stress (funding maturing vs ASF)

`fundingConfidenceScore = clamp(1 - fundingStressIndex, 0, 1)`

State classification:
- score thresholds: strong/stable/watch/stressed
- hard gates from LCR, NSFR, CET1 headroom can force worse state

## 21.7 Internal CET1 target and payout cap

Internal target buffer = base buffer + increments from:
- earnings volatility
- funding stress
- confidence state stress signal
- conduct-risk score

Internal max payout:
- if internal headroom >= 0: 100%
- else decreases linearly with configured slope

Regulatory max payout:
- 0% if CET1 below min hard floor
- MDA cap if in combined buffer zone
- 100% otherwise

Final payout cap:
- `min(regulatoryMaxPayout, internalMaxPayout)`

## 21.8 Concentration and board pressure

Concentration:
- max sector share and max geography share from cohorts
- compared with configured limits

Board pressure score (0..100):
- weighted combination of:
  - earnings volatility
  - franchise gap to target
  - risk gap to target CET1 headroom
  - payout restraint signal

## 22. Confidence-state transition mechanics

Current -> target state transition:
- Downgrades are immediate, one notch per step.
- Upgrades require sustained improvement for `upgradeSustainMonths` (default 3), then one-notch upgrade.

State impacts used elsewhere:
- spread penalty in bps
- market access multiplier
- equity issuance executable multiplier
- equity issuance fee rate

Default impact map:
- strong: -5bps, access 1.00, equity exec 1.00, fee 0.5%
- stable: 0bps, access 0.95, equity exec 0.90, fee 1.0%
- watch: +35bps, access 0.75, equity exec 0.65, fee 2.5%
- stressed: +120bps, access 0.45, equity exec 0.35, fee 5.0%

## 23. Share-price model mechanics

Each step:
- smooth EPS proxy from annualized monthly net income
- compute profitability score (ROE proxy vs cost of equity)
- compute capital score (CET1 and leverage headroom)
- compute macro score (GDP, unemployment, credit spread)
- compute franchise score
- combine weighted score -> implied P/E
- fair price = P/E * EPS floor-adjusted
- actual price mean-reverts toward fair price

Market cap:
- `sharePrice * sharesOutstanding`

Equity issuance increases shares outstanding and can dilute.

## 24. UK macro and market evolution model

After each step, market state advances with deterministic seeded randomness:
- correlated latent factor shocks (`D`, `S`, `F`, `R`)
- GDP regime Markov switching (`normal`/`recession`)
- GDP, inflation, unemployment, policy rate dynamics
- Nelson-Siegel gilt curve fit from 1y/5y/20y anchors
- credit spread dynamics
- pass-through to wholesale spreads, loan spreads, repo haircuts, competitor rates

The RNG seed is stored in state, so replaying identical action/shock timeline is deterministic.

## 25. Scenario system

Scenarios do three things:
- override initial state (balances and behavior)
- optionally override config
- inject scheduled and trigger-based arc shocks/milestones

Current scenarios:

`wholesale-funding-reliance`
- horizon: 12 months
- scheduled shocks at step 0:
  - market spread shock (+120bps wholesale, +40bps loan spread, +2% repo haircut)
  - idiosyncratic run multiplier 1.8
- arc at step 2:
  - if LCR < 1.15: tighter rollover stress + extra run
  - else: milder rollover stress

`corporate-credit-boom`
- horizon: 18 months
- scheduled shock at step 3:
  - macro downturn PDx3.5, LGDx2.0
- arc at step 6:
  - stress branch if CET1/leverage weak and underwriting action present
  - softer branch if CET1 >= 12%

Scenario scoring:
- weighted objective completion
- quality penalty (franchise + funding + liquidity)
- displayed as objective score and completion %

## 26. Preview and recommendation mechanics

## 26.1 Next-step preview

Preview runs deterministic paths:
- baseline
- macro mild
- macro severe
- funding stress
- run stress

Shows:
- baseline deltas (CET1, LCR, NSFR, NIM)
- stressed point metrics
- breach probability across preview paths

## 26.2 Recommendations

If recommendations feature enabled:
- engine tests candidate action bundles on one-step lookahead
- ranks by deficit improvement (CET1/LCR/NSFR), board pressure benefit, earnings penalty
- returns top 3 with confidence levels (`high`, `medium`, `low`)

## 27. Autopilot, stop conditions, run history, replay

Autopilot:
- uses fixed action set captured at run start
- executes month by month with scenario shocks per step
- optional stop conditions:
  - breach: stop on hard breach
  - nearBreach: stop when any core ratio <= limit * (1 + buffer)
  - scoreTarget: stop when scenario completion reaches target percent

Run history:
- stores timeline of actions/shocks and key snapshots
- replay recomputes from saved initial state and timeline
- UI checks replay mismatch on CET1/LCR/NSFR

## 28. Reconciliation and invariant checks

Each step checks:
- balance sheet: assets == liabilities + equity (tolerance)
- no materially negative balances
- no invalid ratio values (NaN/-Infinity)
- cash flow statement tie:
  - operating + investing + financing equals net cash change
  - mismatch above threshold fails run

## 29. Default calibration summary

Key regulatory limits:
- min CET1 ratio: 10.5%
- min leverage ratio: 3.5%
- min LCR: 1.0x
- min NSFR: 1.0x
- combined CET1 buffer requirement: 15.5%

Capital policy defaults:
- dividend payout target: 30%
- MDA max payout ratio: 20%
- AT1 coupon annual rate: 8%
- AT1 discretionary CET1 threshold: 12.5%

Cost model defaults:
- fixed operating cost per month: GBP 50m
- servicing cost annual rate: 0.65%
- origination cost rate: 1.0%
- workout cost rate on defaults: 3.5%

Selected behavior defaults:
- max deposit growth per step: +8%
- min deposit growth per step: -10%
- max loan growth per step: +5%
- min loan growth per step: -2%
- loan fee rate monthly: 0.10%

Feature flags in base config:
- all major systems enabled by default (`true`)

## 30. Important gameplay implications

- Pricing too low vs competitors can improve growth briefly but damages franchise/stability over time.
- Aggressive loan pricing above benchmark can increase adverse selection and future losses.
- Funding rollover risk is path-dependent: maturity walls + weak confidence can create sudden cash stress.
- Passing hard minima is not enough for distributions; internal CET1 target may still block payout.
- Conduct risk is nonlinear and can create sudden cost/franchise shocks after repeated aggressive pricing behavior.
- Share price can rise while solvency weakens if short-term earnings look strong; do not treat it as a safety metric.
