# BankSim

BankSim is a React/Vite banking simulator game. You run a UK bank month by month, adjust commercial and balance-sheet levers, and try to survive scenario pressure while keeping the franchise profitable, liquid, and well capitalised.

The simulator models banking mechanics at a management-game level: deposits, loan growth, funding, liquidity ratios, regulatory capital, credit losses, conduct risk, securities marks, scenario shocks, and an equity price signal.

## Quick Start

```powershell
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Useful Commands

```powershell
npm run dev              # start the development server
npm run build            # create a production build
npm test                 # run the full Vitest suite
npm run test:fast        # run tests excluding the slower regression suite
npm run test:regression  # run the model regression tests
```

## Gameplay

Each turn advances the bank by one month. The player can adjust rates, underwriting tightness, funding, equity issuance, dividends, cost actions, hedge actions, and related management levers.

The main tabs are:

- `Overview`: headline financial, regulatory, and attribution metrics.
- `Share Price`: market-cap, EPS, P/E, price-to-book, and fair-value signals.
- `Scenarios`: scenario setup and objective tracking.
- `Accounts`: balance sheet and income statement detail.
- `Regulatory`: CET1, leverage, LCR, NSFR, and compliance diagnostics.
- `Loans`: pipeline, cohorts, defaults, workouts, and credit migration.
- `Costs`: operating cost, conduct risk, and payout controls.
- `Events`: monthly model events and warning trail.
- `Reconciliations`: accounting and cash-flow checks.
- `Past games`: run history and comparisons.
- `Help`: in-app mechanics reference.

## Model Areas

Core simulation code lives under `src/engine`.

Important entry points:

- `src/engine/simulation.ts`: monthly simulation step.
- `src/engine/metrics.ts`: regulatory and financial metrics.
- `src/engine/loanCohorts.ts`: loan lifecycle, credit migration, defaults, and workouts.
- `src/config/baseConfig.ts`: global model assumptions and tunable parameters.
- `src/config/initialState.ts`: initial bank state.
- `src/config/scenarios.ts`: scenario definitions and step payloads.

Domain types live under `src/domain`, UI components under `src/components`, and explanatory content under `src/content`.

## Testing

The project uses Vitest. The suite includes focused unit tests for mechanics such as capital policy, funding confidence, loan pipelines, liquidity, conduct risk, share price behaviour, replay determinism, and model regression.

Before pushing model changes, run:

```powershell
npm test
npm run build
```

## Repo Hygiene

Generated output and local dependencies are intentionally ignored:

- `node_modules/`
- `dist/`
- Vite/Vitest caches
- local logs and environment files
- ad hoc generated reports such as PDFs and extracted report text

Keep durable model documentation in tracked markdown files such as `player_guide.md` and `mechanics_exposure_plan.md`.
