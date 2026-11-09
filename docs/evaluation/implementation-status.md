# BankSim API evaluation implementation status

Last updated: 9 November 2026

## Baseline and branch

- Repository: `andrewlinn957/banksim`
- Audited source revision: `f42df91d2416a5fa499554d1e771f6c86b3206a3` (`Model CET1 issuance using investor returns`)
- Working branch: `feature/api-evaluation-v1`
- Pre-existing uncommitted capital-markets/funding work was present in the checkout. It is being preserved outside the evaluation commits, including the owner's edits in `src/engine/simulation.ts`, `src/components/DepartmentOffice.tsx`, related capital/funding files, and `test-results/`.
- No repository-local `AGENTS.md` was found. The supplied BankSim implementation brief is the task specification.

## Phase gates

| Phase | State | Evidence / limitations |
|---|---|---|
| A — Audit and contracts | Complete | `gui-parity.md`, `gui-parity.json` and `api-design.md` record the source audit, all registered controls and reports, current player semantics, data classes, boundaries and known gaps. Existing Pages scenarios are confirmed public browser-bundled data. |
| B — Shared player/session layer | Complete | React and API share form/control parsing, action construction, corporate deposit grouping, transaction drafts/cancellation, Treasury dynamic limits, month close, scenario triggers, safe previews, quotes, reports, help and the player export. Representative rendered React checks ran in Vitest. Browser Playwright could not launch because the configured Chromium executable is absent. |
| C — Deterministic lifecycle | Complete for the pinned Node release | Seeded opening factory applies `banksim-seed-v1` before cohort generation; explicit session codecs, deterministic event identity, canonical hashes and checkpoint continuation/replay are implemented. Preview and action-count tests verify isolated exogenous draws. Cross-runtime bit-identical results are not promised. |
| D — Durable API service | Complete for a single-process/single-VPS version 1 | Fastify/TypeBox routes and OpenAPI, hashed scoped bearer tokens, SQLite migrations/WAL/checkpoints/audit, per-run serialization, expected revisions, idempotency, recovery of interrupted month advances, build pinning, replay and separate player/admin exports are implemented. The player overview exposes run-assigned client budgets; commit `5851788` added that contract. Integration tests and TCP smoke checks passed. Commit `8a3223b` narrows runtime transaction schemas to the shared GUI area, instrument, pricing and tenor choices and rejects extra ticket fields. The admin bundle explicitly marks client transcripts as not yet joined. |
| E — Standalone model client | Complete | `evaluation-client/` builds and packs independently, contains no engine/server sources, has a player-only tool loop whose live schemas follow current GUI controls, OpenAI-compatible Chat Completions adapter, deterministic mock, exact prompt hashing, resumable transcripts, CLI/batch commands and VS Code examples. The scripted clean-directory checks cover assigned budget caps and recovery after a committed command response is lost. |
| F — Joined exports and operator workflow | Implemented; container checks pending | `server/auditBundle.ts` adds versioned hashes and offline replay verification; `scripts/collect-audit.ts` joins the owner export with exact local client records; `scripts/verify-audit.ts` detects altered decisions/checkpoints. The compressed one-month mock bundle is checked in as an example. Dockerfile, Compose, environment template and operator/backup/rollback guide are prepared. Focused audit/API tests and the clean-directory audit/replay smoke passed. Docker is unavailable in this workspace, so image build and Compose validation remain unverified. |
| G — Final parity and end-to-end review | Not started | Phase D checks are substantive but do not satisfy the final controlled-evaluation gate. Full inventory review and later client/export/deployment evidence remain required. |

## Phase D implementation

- `server/app.ts` serves `/health`, generated `/openapi.json`, scoped player routes, authenticated admin run/credential/stop/export/replay routes and player command polling.
- `server/store.ts` persists runs, credentials, commands, month checkpoints and append-only audit records in SQLite. Each committed month records its full encoded session and canonical BankState hash. Failed/interrupted advances preserve partial progress.
- `src/contracts/playerApi.ts` contains runtime TypeBox request schemas. The command contract accepts registered standing-control IDs and explicit transaction/risk/pause/time operations; raw actions and state patches are rejected. Contract version `banksim-player-tools-v2` narrows capital-market area/instrument/pricing/tenor combinations and separates gilt buys from proportional sells.
- Player reads and previews use shared presentation builders and the player export. The API does not return private config, seed/RNG state, full preview states, other-run data or the admin bundle.
- Active runs are pinned to engine version, server build digest and dependency-lock hash. A process refuses to start over active runs pinned to another release. Replay checks each recorded monthly close against the canonical hash.
- `.nvmrc` and package engines pin Node `24.22.x`. `npm run server:build` produces the production server bundle. The server defaults to loopback and requires a configured admin token.
- `docs/evaluation/gui-parity.json` now matches the shared control/report registries. It records the selectivity slider step separately from the number input's accepted intermediate values. Treasury ticket limits are shared and retain the GUI's current `baseConfig` behaviour.

## Checks performed

- `npm run typecheck` — passed (browser app and server TypeScript).
- `npm run test:fast` — passed, 139 files / 436 tests.
- `npx vitest run server/app.test.ts src/application/playerParityInventory.test.ts` — passed, 2 files / 8 tests, including exhaustive available-report hidden-marker checks and selectivity slider/typed-value parity.
- `npm run build` — passed. Vite reports the existing large main-chunk warning; the main JS bundle is about 846 kB minified.
- `npm run server:build` — passed; server bundle about 768 kB before external runtime dependencies.
- Production TCP smoke against the bundled server — passed: health, OpenAPI, admin run creation and credential issuance, one-month player close to horizon, same-ID retry returning the original result, and player-token denial on an admin route.
- `server/app.test.ts` exercises run/token isolation, hidden marker handling, grouped corporate rates, raw-action and invalid transaction-shape rejection, draft/cancel/close parity, preview non-mutation, matching GUI/API opening and close hashes, concurrent stale revisions, duplicate results, crash recovery after a committed month, hash replay, and engine-version/build refusal.
- The earlier `npm run test:browser` attempt could not start because Playwright Chromium is not installed at the configured cache path. Component-level rendered tests ran; full browser automation remains unverified.
- `npm run client:typecheck`, `npm run test:client` (4 focused contract/provider/config tests), and `npm run client:build` — passed.
- `npm run test:client:smoke` — passed. It rebuilds the server/client, packs and installs the client in a clean temporary directory, creates a one-month API run, confirms a local budget above the assigned cap is rejected, and finishes through the installed CLI with the mock provider. Result: `horizon_reached` at step 1, 2 model turns, 5 tool calls, 40 transcript events, no gaps and a saved player export. A second run drops a command response after the server commits it; resume reconciles the same ID and reaches the horizon. The admin export contains that command exactly once.
- The clean package contains 24 files and no engine, server, private scenario, seed, source or trace paths. Credentials were checked absent from the transcript; the model tool list contains no administrator operations.
- `npx vitest run server/auditBundle.test.ts server/app.test.ts` — passed, 2 files / 10 tests. Joined export verification checked hashes, client transcript bytes, missing/malformed transcript marking, a corrupted decision and replay divergence.
- `npm run test:client:smoke` — passed with audit collection and replay added. The joined bundle contained 40 client events and replay matched the opening plus one monthly checkpoint.
- `npm run audit:verify -- docs/evaluation/examples/mock-one-month.bundle.json.gz` — passed, 40 transcript records, two matched steps, no integrity issues.

## Known limitations and next concrete task

This is not ready for model evaluation until Phase G and the remaining deployment checks are complete. The current Pages build imports the public scenario catalogue, so it cannot support a scenario whose definition must remain private. The server export retains its `not-collected-by-server` marker; the owner collection command creates a separate joined bundle with local client records and explicit gaps. Docker image/Compose validation remains pending because Docker is unavailable in this workspace. There has been no VPS, HTTPS reverse-proxy, backup/restore or production installation check. A real model-provider smoke run remains unverified because no provider credentials or inference budget were authorized. The score definition is currently the existing versioned scenario-goal score; configurable benchmark scoring is not implemented.

The API currently serves a single immutable engine release per process and requires active runs to complete or be stopped before an upgrade. Old-build replay requires retaining that old build. The provider's client-reported transcript and model metadata will be provenance from the harness, not proof against a malicious client. The service's in-process run locks assume one server process owns the SQLite database; multi-process worker coordination is outside this V1.

Next: finish Phase F review by running the prepared image and Compose checks on a host with Docker, then commit that phase. Proceed to Phase G for the final parity, determinism and isolation review. Keep production deployment unperformed until Andrew instructs it.
