# BankSim

BankSim is a React/Vite banking simulator game. You run a UK bank month by month, adjust commercial and balance-sheet levers, and try to survive scenario pressure while keeping the franchise profitable, liquid, and well capitalised.

The simulator models banking mechanics at a management-game level: deposits, loan growth, funding, liquidity ratios, regulatory capital, credit losses, conduct risk, securities marks, scenario shocks, and an equity price signal.

Start at Headquarters: set standing policies in Customers, Lending, Capital and Treasury, then run to quarter end, year end or continuously on auto. The time controls remain visible and pause when buffers need attention. Quarterly and annual reports show the bank developing over time; first-year stars and badges are optional goals and do not end the career.

The interface uses a generated Threadneedle Street bank illustration, four actionable department entrances and an adjacent management workspace. The profit timeline and first-year challenges live under Reports. See [management interface](docs/management-interface.md) and [career pacing](docs/career-pacing.md) for the design and calibration evidence. Try “The supervisory review” for a fictional Pillar 2A/PRA-buffer challenge.

See [model basis and remaining gaps](docs/model-basis.md) for the 2026 PRA assumptions and funded-loan IFRS 9 treatment, and [art direction](docs/art-direction.md) for the image prompt.

## Gameplay

Each turn advances the bank by one month. The player sets rates, underwriting standards and payout policies, and can queue funding, equity and hedge transactions.

The challenge is to keep the bank alive without simply hiding in a defensive posture. Growth can improve earnings and market confidence, but it consumes capital and liquidity. Pulling back can protect ratios, but it may weaken the franchise, reduce profit, and leave the bank behind competitors.

## Objective

Your job is to manage a working bank through normal conditions and stress scenarios. A strong run usually balances four goals:

- earn sustainable profit
- maintain capital and liquidity buffers
- preserve deposit and lending franchise strength
- keep market confidence high enough to support the share price

The game ends on capital-minimum or actual cash failures. This is a gameplay condition, not a legal resolution assessment. Liquidity breaches prompt recovery warnings. Warnings and weak metrics do not always end the game immediately, but they usually make future turns harder.

## Standing policies and transactions

Policies continue until you change them. Debt, equity and swap transactions execute once and clear from the plan. Typical decisions include:

- setting retail and corporate deposit rates
- setting mortgage and corporate lending rates
- tightening or loosening underwriting standards
- issuing long-term debt or equity
- changing dividend payouts
- managing hedges and balance-sheet risk

The game rewards understanding second-order effects. For example, raising deposit rates can stabilise funding but compress net interest margin. Cutting loan rates may improve growth but can attract weaker borrowers if underwriting is loose. Issuing equity can save a stressed bank but dilutes existing shareholders.

## Scenarios

Sandbox mode lets you experiment freely. Scenario mode gives the bank a defined macro path and objectives. Scenarios can alter interest rates, spreads, credit losses, funding pressure, deposit behaviour, market confidence, and sector stress.

Scenario goals are scored against the run, so survival alone may not be enough. A good result usually requires handling the stress while still protecting franchise value and shareholder outcomes.

## Share Price

The share price is a game signal, not a random ticker. It responds to profitability, capital strength, liquidity, credit quality, macro conditions, franchise momentum, and dilution.

The model uses earnings and common-equity book value as anchors. A profitable, well-capitalised bank can earn a stronger valuation multiple. A weak or failing bank is discounted sharply, and monthly price moves are capped so the game remains playable rather than swinging unrealistically from one turn to the next.

## Risk And Failure

The most important constraints are:

- CET1 ratio
- leverage ratio
- liquidity coverage ratio
- net stable funding ratio
- cash availability
- accounting and balance-sheet invariants

Some risks build gradually. Credit quality can deteriorate through the loan book. Deposit confidence can weaken. Funding costs can rise. Conduct issues can create losses. Concentrations can create warnings before they become a serious strategic problem.

## Learning The Model

The in-app Help tab explains the main mechanics while you play. Events, attribution, reconciliations, and regulatory panels are meant to make the simulation inspectable rather than opaque. When a metric moves, the game should give you enough trail to understand why.

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

## Verification

Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. CI runs tests, source type checking and the production build.
