# BankSim GUI parity inventory

Audit basis: repository revision `f42df91d2416a5fa499554d1e771f6c86b3206a3` (8 November 2026). The checkout contained unrelated capital markets/funding edits before this implementation; they remain outside the phase commits. No repository-local `AGENTS.md` was present. The supplied implementation brief governs this work.

This inventory covers gameplay options and information reachable in the current React game. `src/domain/actions.ts` is an engine action union, not the player interface: servicing, accounting, borrower-loan and cohort operations without GUI controls are not player powers. The machine-readable inventory in [`gui-parity.json`](./gui-parity.json) is checked against the control and report registries.

Both interfaces use shared application controls, validation, transaction drafts, session close, scenario triggers, report builders, help, previews and player export. The API returns curated presentation results; routes do not call `engine.step` directly.

## Player controls

The table below is generated from the machine-readable inventory. That inventory records exact IDs, GUI locations, fields, units, choices, limits, current/default value sources, validation, availability and operation. API rate values are annual rate ratios from 0 to 1. GUI parsing also accepts percent, pct, basis-point and formatted money strings.

| Stable ID | GUI location | Fields and constraints | Lifecycle | Agent operation |
|---|---|---|---|---|
| `policy.deposit.retail_current` | Deposits / Retail current accounts | annual rate, ratio from 0 to 1; 0–1 | Standing policy; persists | `update_decisions` |
| `policy.deposit.term_rate` | Deposits / Fixed-term savings | annual rate, ratio from 0 to 1; 0–1 | Standing policy; persists | `update_decisions` |
| `policy.deposit.term_tenor` | Deposits / Fixed-term savings / Term | months; choices: 12, 24, 36 | Standing policy; persists | `update_decisions` |
| `policy.deposit.corporate_rate` | Deposits / Business deposits | annual rate, ratio from 0 to 1; 0–1 | Standing policy; persists | `update_decisions` |
| `policy.loan.mortgage_rate` | Lending / Mortgages / New rate | annual rate, ratio from 0 to 1; 0–1 | Standing policy; persists | `update_decisions` |
| `policy.loan.mortgage_selectivity` | Lending / Mortgages / New lending selectivity | ratio; 0–1; slider step 0.05; typed intermediate values allowed | Standing policy; persists | `update_decisions` |
| `policy.loan.mortgage_ltv` | Lending / Mortgages / Maximum LTV | ratio; choices: 0.6, 0.75, 0.85, 0.9, 0.95 | Standing policy; persists | `update_decisions` |
| `policy.loan.mortgage_fixed_period` | Lending / Mortgages / Initial fixed period | months; choices: 24, 36, 60 | Standing policy; persists | `update_decisions` |
| `policy.loan.consumer_rate` | Lending / Personal credit / New rate | annual rate, ratio from 0 to 1; 0–1 | Standing policy; persists | `update_decisions` |
| `policy.loan.consumer_selectivity` | Lending / Personal credit / New lending selectivity | ratio; 0–1; slider step 0.05; typed intermediate values allowed | Standing policy; persists | `update_decisions` |
| `policy.loan.corporate_rate` | Lending / SME and business / New rate | annual rate, ratio from 0 to 1; 0–1 | Standing policy; persists | `update_decisions` |
| `policy.loan.corporate_selectivity` | Lending / SME and business / New lending selectivity | ratio; 0–1; slider step 0.05; typed intermediate values allowed | Standing policy; persists | `update_decisions` |
| `policy.capital.dividend_payout` | Finance & Capital / Share of profit paid out | ratio from 0 to 1; 0–1 | Standing policy; persists | `update_decisions` |
| `policy.capital.risk_appetite` | Finance & Capital / Board risk appetite; Risk & Regulatory | ratios and GBP EVE limit | Standing policy; persists | `set_risk_appetite` |
| `transaction.capital_markets` | Finance & Capital / Raise capital; Treasury & Funding / Wholesale funding markets | GBP, discount ratio, spread basis points, tenor months; Capital: cet1, at1, tier2; Treasury: senior | Draft until close; cleared at close | `queue_transaction, cancel_transaction` |
| `transaction.gilt` | Treasury & Funding / Gilt transaction | GBP and tenor years; giltTradeDirection: buy, sell; giltDurationYears: 2, 5, 10 | Draft until close; cleared at close | `queue_transaction, cancel_transaction` |
| `transaction.boe_funding` | Treasury & Funding / Central-bank funding | GBP; boeFacility: STR, ILTR | Draft until close; cleared at close | `queue_transaction, cancel_transaction` |
| `transaction.hedge` | Treasury & Funding / Interest-rate hedging | GBP notional and months; 0–…; hedgeDirection: payFixedReceiveFloat, receiveFixedPayFloat; hedgeMaturityMonths: 12, 24, 60 | Draft until close; cleared at close | `queue_transaction, cancel_transaction` |
| `time.advance` | Time console / month, quarter, year, continuous, pause | months per command; 1 to configured maximum (default 12); choices: month, quarter, year, continuous | Player setting / bounded time command | `advance_time, set_safety_pause` |
| `mode.scenario` | Scenarios / select and start | null = sandbox; `supervisory-review`, `wholesale-funding-reliance`, `corporate-credit-boom` | Assigned before the player starts | `admin_create_run` |
| `mode.three_year_plan` | Settings / three-year plan mode | false (default) or true; sandbox only | Assigned before the player starts | `admin_create_run` |

### Shared validation and lifecycle rules

- `update_decisions` accepts only registered standing-policy IDs. Transactions use typed `queue_transaction` requests; raw form field names and raw engine actions are rejected. `policy.deposit.corporate_rate` applies one offer to both corporate operating and non-operating deposits, matching the GUI grouping.
- The GUI underwriting sliders use a 0.05 range step, while adjacent number inputs accept intermediate values in 0–1. The API accepts the same intermediate values. The step is presentation guidance, not a validation increment.
- One draft of each transaction kind is available at a time. Queueing changes a draft and does not execute it. A valid monthly close executes drafts; closing clears one-off transaction drafts and pending risk appetite while standing policies persist. Cancellation clears only the selected transaction draft.
- Capital/debt eligibility and tenor come from the current capital-market catalogue. Capital area permits CET1, AT1 and Tier 2; Treasury permits senior debt. Gilt sales are bounded by unencumbered gilts. BoE drawings are bounded by GUI collateral/funding headroom. The shared GUI action builder sets hedge fixed rate from the current market rate; the API does not accept a hidden fixed-rate field.
- Treasury ticket limits are extracted to `src/presentation/treasuryLimits.ts` and used by both interfaces. The existing GUI passes `baseConfig` for haircut/headroom even in scenarios; the API mirrors that behaviour. This is recorded as existing GUI behaviour and a possible game bug, not corrected only for the API.
- Risk-appetite targets are validated against current prudential floors, queued for the next close and then persist. `targets: null` restores automatic targets. The controls response supplies current targets, floors and ceilings.
- Monthly closes are the only simulation transitions. `advance_time` accepts a finite month count (API maximum 12 by default, configurable lower). The controls response gives months to the next quarter/year boundary. Horizon, bank failure and safety pause stop advancement. A remote client can pause between closes; browser-tab visibility pause has no remote equivalent. Invalid commands do not close a month.

## Player information surfaces

Every report registered in `src/presentation/reportRegistry.ts` has a shared builder consumed by the GUI and API. `GET /reports` discovers the reports; `GET /reports/{reportId}` returns the builder output with the current revision. Query schemas provide bounded pagination and the history/portfolio choices exposed by the GUI.

| Stable ID | GUI location | Availability | API operation | Shared-source notes |
|---|---|---|---|---|
| `report.overview` | Bank / Boardroom | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/overview.ts |
| `report.department.customers` | Deposits management | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/game/departments.ts, src/presentation/playerPreviews.ts |
| `report.department.lending` | Lending management | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/game/departments.ts, src/presentation/playerPreviews.ts |
| `report.department.treasury` | Treasury & Funding management | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/game/departments.ts, src/presentation/quotes.ts, src/presentation/playerPreviews.ts |
| `report.department.capital` | Finance & Capital management | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/game/departments.ts, src/presentation/quotes.ts, src/presentation/playerPreviews.ts |
| `report.dashboard.risk` | Risk & Regulatory / Risk overview | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/risk.ts |
| `report.regulatory.capital` | Risk & Regulatory / Capital | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/capital.ts, src/presentation/reports/regulatory.ts |
| `report.regulatory.rwa` | Risk & Regulatory / RWA | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/rwa.ts |
| `report.regulatory.leverage` | Risk & Regulatory / Leverage | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/leverage.ts |
| `report.regulatory.lcr` | Risk & Regulatory / LCR | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/lcr.ts |
| `report.regulatory.nsfr` | Risk & Regulatory / NSFR | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/nsfr.ts |
| `report.capital_history` | Risk & Regulatory / Capital history | history | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; query: unit, selected, years; source: src/presentation/reports/capitalHistory.ts |
| `report.performance` | Performance | history | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; query: periodMonths; source: src/presentation/reports/performance.ts |
| `report.accounts` | Accounts | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/accounts.ts |
| `report.share_price` | Share Price | history | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/sharePrice.ts |
| `report.loans` | Lending / Loan portfolio | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | All displayed cohort/product details are returned; GUI sorting/filtering changes visible row selection only.; query: portfolio; source: src/presentation/reports/loans.ts |
| `report.credit_losses` | Lending / Credit losses | history | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/creditLosses.ts |
| `report.costs` | Finance & Capital / Costs | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/costs.ts |
| `report.events` | Settings / Event log | active-run | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; query: offset, limit; source: src/components/EventLog.tsx, src/application/playerSession.ts |
| `report.reconciliations` | Settings / Reconciliations | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/reconciliations.ts |
| `report.scenario` | Scenarios | scenario | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/reports/scenario.ts, src/game/scenarioBriefing.ts, src/game/scenarioDebrief.ts |
| `report.help` | Help | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/help.ts |
| `report.preview` | Management areas / Next close | valid-draft | `POST /api/v1/runs/{runId}/preview` | Returns only fields displayed by the GUI next-close preview.; query: department; source: src/presentation/playerPreviews.ts |
| `report.player_export` | Masthead / Export run | active-run | `GET /api/v1/runs/{runId}/export` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/application/playerExport.ts |
| `report.past_games` | Past games | history | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; query: offset, limit; source: src/ui/useRunSession.ts |
| `report.quote` | Finance & Capital / Treasury ticket | valid-draft | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/presentation/quotes.ts |
| `report.validation` | Management controls | always | `GET /api/v1/runs/{runId}/reports/{reportId}` | Use the shared presentation builder; preserve GUI labels, units, history and displayed precision.; source: src/application/playerControls.ts |

### Information parity decisions

- Dashboards, statement tables, history series, hover values, units, labels and precision use the same presentation builders as React. Graphs are represented as labelled series and annotations. The registry test verifies every registered report has a builder; rendered component tests confirm representative GUI screens consume shared builders. These checks cannot discover future screens that have not been registered.
- `report.preview` and `POST /preview` return only fields rendered by the current GUI preview, including its baseline/stress or scenario projection where applicable. Full preview `BankState`, internal paths, RNG state and extra scenario diagnostics stay server-side. Read/preview tests verify no authoritative revision or bank-state hash changes.
- `report.validation` is always discoverable and reports the current draft parse state. Rejected mutations return structured player-safe issues and make no partial session change. `report.quote` is available only when a valid capital-markets draft selects an instrument.
- `report.loans` returns the GUI-visible portfolio categories and supports portfolio selection. Sorting/filtering changes visible rows; the API returns complete data rather than separate sort/filter query operations.
- `report.past_games` returns only the assigned run's decision timeline and summary snapshots. It cannot list other runs or restore/rewind state. Browser-local Past games may include attempts from that browser profile.
- `GET /export` reuses the GUI player extract builder. The shared export excludes seed/RNG fields, future scheduled shocks and non-displayed IFRS 9/share-price configuration snapshots. Hidden-marker checks cover player routes. Historical shocks, intentional briefings, forecasts and player-visible diagnostics remain available. The administrator audit bundle is separate and is not exposed to model tools.
- Theme, animation speed, chart-series selection, table sort/filter and browser visibility pause are presentation-only. Meaningful safety-pause and time-boundary behaviour remains represented; see `presentationOnlyExclusions` in the JSON inventory.

## Scenario, seed and privacy boundaries

- Run creation fixes scenario, mode, seed, engine release, start date and finite horizon before issuing a player token. Players cannot create/reset runs, change seeds/configuration, inject shocks or request counterfactual runs. A restart is a new run ID and logged attempt.
- The current Pages build imports `src/config/scenarios.ts`; the current catalogue is public browser data. Briefings and deliberate forecasts are player-visible, but future schedules and private scenario implementations cannot be called confidential until moved into server-only configuration.
- Full session state, configuration, seed/RNG state, other-run data and audit exports remain admin-side. Player routes are token-scoped to one run; identifiers alone grant no access.
- Simulation event IDs and timestamps derive from run ID, close step, logical event order and simulation date. Request timestamps remain operational audit metadata and are excluded from canonical state hashes.

The administrator supplies the required `engineVersion`, `scenarioId`, `seed` and `horizonMonths` through `POST /admin/v1/runs`. `startDate` is optional and the shared scenario factory supplies it when omitted. Three-year-plan mode defaults to off and is available only for a sandbox. The default client budgets are 1,000 model turns and 5,000 tool calls; these limits belong to the evaluation harness and do not change game rules. The full machine-readable setup schema is under `episodeAdministration` in `gui-parity.json`.

## Current acceptance evidence and unresolved work

Phase D evidence in `server/app.test.ts` covers player/admin separation and run isolation, hidden-field rejection, grouped corporate deposits, transaction draft/cancel/close, preview state isolation, matching GUI/API opening and close hashes, concurrent revisions, idempotency, restart after a committed monthly checkpoint, replay hashes and build pinning. `src/application/playerParityInventory.test.ts` checks registry coverage and report builders. Rendered GUI checks from Phase B are recorded in [`implementation-status.md`](./implementation-status.md).

Open items are listed in `knownUnresolved` in [`gui-parity.json`](./gui-parity.json): the standalone client and joined transcript collection remain; the scenario catalogue is public; table sort/filter interactions are not separate API commands; production/VPS checks remain undone; and new UI features require parity review. The module is not ready for controlled evaluation until the client, joined audit workflow and final parity review are complete.
