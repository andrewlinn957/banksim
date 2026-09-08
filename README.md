# BankSim

BankSim is a browser-based management game about running a small UK retail bank.

You manage the bank month by month. You set deposit prices, lending policy, capital policy and Treasury strategy. The model then updates customer behaviour, loan growth, funding, profit, credit losses, capital, liquidity and market conditions.

The aim is not simply to keep every regulatory ratio as high as possible. A good strategy must balance profitability, franchise growth, funding stability and resilience.

## The bank

The default bank has about £14 billion of assets. It is funded mainly by customer deposits.

Its main assets are:

- residential mortgages
- personal loans and revolving credit
- SME and business lending
- cash and Bank of England reserves
- UK gilts held for liquidity management

Its main funding sources are:

- retail current accounts
- fixed-term retail savings
- SME and business deposits
- long-term debt

The bank starts with CET1 and AT1 capital. You can issue new CET1 equity or Tier 2 capital during the game.

## What you control

### Customers

Set the rates offered on:

- retail current accounts
- fixed-term savings
- SME and business deposits

For fixed-term savings, you also choose a term of one, two or three years.

Deposit pricing affects balance growth, churn, interest expense, deposit quality and funding confidence. Fixed-term deposits provide more stable funding, but they also create future maturity concentrations.

### Lending

Manage three lending businesses:

- mortgages
- personal credit
- SME and business lending

For each book, you set price and lending selectivity. Mortgage policy also lets you set the maximum LTV and the initial fixed-rate period for new lending.

Loan pricing affects demand and margin. Selectivity affects approvals and credit quality. Mortgage LTV and fixed periods affect loss severity and interest-rate risk.

### Treasury

Manage the liquid-asset and funding position by setting:

- the share of liquid assets held as gilts rather than reserves
- gilt portfolio duration
- long-term debt issuance
- Bank of England secured funding through STR or ILTR
- interest-rate swaps

Treasury decisions affect liquidity, funding cost, collateral encumbrance, refinancing risk and interest-rate risk in the banking book.

### Capital

Set the share of profit paid to shareholders and, when needed, raise:

- CET1 equity
- Tier 2 capital

You can also set internal risk-appetite targets for CET1, leverage, LCR and NSFR.

Retained profit builds CET1. Dividends reduce CET1 and cash. Tier 2 improves total capital but does not improve CET1 or the leverage ratio.

## The monthly close

Standing policies remain in force until you change them. One-off transactions execute once and then leave the queue.

When you close a month, the simulation broadly does the following:

1. Apply queued actions and standing policies.
2. Update deposit flows and customer behaviour.
3. Update loan demand, approvals, commitments and drawdowns.
4. Process funding maturities and Treasury actions.
5. Calculate income, expenses, provisions and credit losses.
6. Update capital and liquidity measures.
7. Apply market and scenario changes.
8. Run compliance, accounting and cash checks.

This order matters. A decision can improve one measure and weaken another. For example, a higher savings rate can improve funding while reducing net interest income.

## Core mechanics

BankSim includes simplified models of:

- deposit growth, churn and franchise strength
- fixed-term deposit maturity ladders
- loan demand, approvals and adverse selection
- mortgage LTV and fixed-rate structure
- IFRS 9 staging and expected credit loss
- defaults, workouts and recoveries
- CET1, Tier 1, total capital and leverage
- LCR and NSFR
- HQLA and collateral encumbrance
- Bank of England secured funding
- funding confidence and maturity risk
- interest-rate risk in the banking book
- securities valuation and OCI
- dividend policy and capital issuance
- conduct risk
- macroeconomic and market scenarios
- share-price and shareholder-value signals

The model is deliberately inspectable. Important changes should be traceable through Accounts, Loans, Events, attribution views and Reconciliations.

## Help

The in-game **Help** tab is the player manual.

It explains the current controls and their consequences in plain English. It uses short sections, bullets and equations where an equation helps explain the mechanic. It does not duplicate live regulatory dashboards.

Examples include:

```text
Deposit price gap = your deposit rate - competitor deposit rate

LTV = mortgage amount / property value

LCR = HQLA / [Outflows - min(Inflows, 75% × Outflows)]

NSFR = ASF / RSF

CET1 ratio = adjusted CET1 / RWA

Leverage ratio = Tier 1 capital / leverage exposure
```

## Scenarios and failure

Sandbox mode lets you manage the bank without a fixed objective. Scenario mode can change the economic path, market conditions, customer behaviour and risk environment.

Scenarios can include changes in:

- Bank Rate and the gilt curve
- unemployment and GDP
- credit spreads
- loan demand and defaults
- deposit behaviour
- funding confidence
- liquidity pressure
- sector stress

The game can end after a capital-minimum breach or an actual cash failure. A liquidity-ratio breach does not automatically end the game, but it can reduce confidence and make later decisions harder.

These are gameplay rules. They are not a legal or supervisory determination that a real bank would fail or enter resolution.

## Technology

BankSim is built with:

- React
- TypeScript
- Vite
- Chart.js
- Vitest

The game runs entirely in the browser.

## Run locally

Requirements: Node.js 20 or later.

```bash
npm ci
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

## Tests

Run the fast test suite:

```bash
npm run test:fast
```

Run the long-horizon regression suite:

```bash
npm run test:regression
```

Run type checking and a production build:

```bash
npm run typecheck
npm run build
```

GitHub Actions runs the fast tests, regression tests, type check and production build. Merges to `main` are deployed through GitHub Pages.

## Project structure

- `src/engine/` — monthly simulation, prudential metrics, loan lifecycle, funding, Treasury and accounting logic
- `src/config/` — starting bank, model parameters and scenarios
- `src/domain/` — core state and product types
- `src/components/` — React interface
- `src/content/` — Help and explanatory content
- `docs/` — design notes, model basis and supporting documentation

Useful entry points:

- `src/engine/simulation.ts` — monthly simulation step
- `src/engine/metrics.ts` — capital, leverage, liquidity and risk measures
- `src/engine/loanCohorts.ts` — loan lifecycle, IFRS 9 migration, defaults and workouts
- `src/config/baseConfig.ts` — model parameters
- `src/config/initialState.ts` — default bank
- `src/config/scenarios.ts` — scenario definitions

## Model scope

BankSim is a management game and learning tool. It is not a regulatory calculator, accounting system or forecasting model for a real bank.

The prudential and accounting mechanics are simplified representations designed to produce understandable management trade-offs. Where the game uses UK regulatory concepts, the implementation is intended to be directionally realistic rather than a substitute for the PRA Rulebook, UK CRR, supervisory guidance or professional advice.
