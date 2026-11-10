# BankSim evaluation API

This document describes the current V1 service. GUI controls and reports are inventoried in [`gui-parity.md`](./gui-parity.md) and [`gui-parity.json`](./gui-parity.json); the status document records the exact source baseline and tested implementation revision.

## Trust boundaries and shared application code

The React game and HTTP service use shared player control definitions, action parsing/building, transaction draft handling, monthly session close, scenario triggers, safe preview projections, report/help builders and player export. API handlers invoke `src/application/playerSession.ts` and `src/application/playerSessionCommands.ts`; they do not call `engine.step` directly. A run stores opening/current `BankState`, complete history, action form, pending risk appetite, transaction drafts, scenario and mode, timeline, events, snapshots, safety-pause setting, horizon and terminal status.

The server owns configuration, seed/RNG state, full session checkpoints, credentials and the administrator export. Player routes authenticate a high-entropy bearer token whose hash maps to one run and explicit scopes. A run ID is not a credential. The player contract contains no raw state patch, JavaScript, shell, filesystem, browser, arbitrary network or administrator tool.

The existing Pages app imports `src/config/scenarios.ts`, which is bundled as public browser data. The current catalogue must therefore be treated as public. A server-only private-scenario loader is not implemented.

## Runtime, storage and release pinning

The service uses Fastify 5, TypeBox runtime schemas/OpenAPI, `better-sqlite3`, SQLite WAL, foreign keys and append-only audit-record triggers. Node is pinned to `24.22.x` by `.nvmrc` and `package.json`. `npm run server:build` creates `dist-server/server.js`; `npm run server:start` starts it. The server bundle contains engine code and is a trusted VPS artifact; it is not part of the standalone evaluation client.

SQLite stores run records, hashed player credentials, command request/result records, full checkpoints and audit records. Each month close commits the session, checkpoint, bank-state hash, command progress and audit record in one database transaction. Session state uses the explicit versioned codec in `src/application/sessionCodec.ts`, not a lossy plain JSON round trip.

A run manifest pins engine version, server build digest, dependency lock hash, Node version, config/scenario hashes and versions, seed scheme, start date, horizon, mode, feature flags and player contract versions. The service refuses startup when an active run is pinned to a different build. Player requests and replay also reject incompatible builds. Old-build replay requires retaining and running that immutable build; the current process serves one release at a time.

## Authentication, limits and errors

Set `BANKSIM_ADMIN_TOKEN` to a high-entropy secret of at least 32 characters. It is separate from player credentials and held in process memory as a hash. Admin endpoints require it. The server binds to `127.0.0.1` by default; expose it through an authenticated HTTPS reverse proxy or private network. Player tokens are issued once, stored hashed, scoped to a single run, and may be revoked. Default scopes are `player:read`, `player:write` and `player:export`.

Authorization headers and cookies are redacted from Fastify logs. API errors contain a request ID, stable code, safe message and optional field issues; raw engine exceptions and stacks are not returned. Default limits are a 1 MB body, 120 requests/minute, 12 months per advance and 120 months per run. Environment configuration can lower/increase the first three within validated bounds. Report pagination defaults to 120 and is capped at 500; schema offsets are bounded. These are service limits, not additional game rules. Run creation records the requested evaluation limits; the local client independently enforces its configured model-turn, tool-call and no-progress budgets.

## HTTP routes

OpenAPI is generated from route schemas and is served at `GET /openapi.json`.

| Method and path | Role | Behaviour |
|---|---|---|
| `GET /health` | Public | Minimal readiness status |
| `POST /admin/v1/runs` | Admin | Create run from scenario, seed, start date, horizon, mode and limits; response includes one run ID and manifest |
| `GET /admin/v1/runs/:runId` | Admin | Status, revision, provenance and credential metadata |
| `POST /admin/v1/runs/:runId/credentials` | Admin | Issue a one-run player token; token shown once |
| `DELETE /admin/v1/runs/:runId/credentials/:credentialId` | Admin | Revoke the scoped player token |
| `POST /admin/v1/runs/:runId/stop` | Admin | Record owner stop reason and terminal status |
| `GET /admin/v1/runs/:runId/export` | Admin | Export manifest, full opening/current sessions, month checkpoints, commands and server audit; client transcript is marked not collected |
| `POST /admin/v1/replays` | Admin | Replay the saved accepted timeline with the current matching build and report first hash divergence |
| `GET /api/v1/runs/:runId/overview` | Player read | Concise overview, status/revision/horizon and the administrator-assigned model/tool-call budgets |
| `GET /api/v1/runs/:runId/controls` | Player read | Control schemas, current draft values, shared capital-market instrument/pricing/tenor catalogue, Treasury limits, risk targets, pause and time-boundary information |
| `GET /api/v1/runs/:runId/reports` | Player read | Discover report IDs, availability and each report's supported query fields/schema |
| `GET /api/v1/runs/:runId/reports/:reportId` | Player read | Shared curated report; accepts only that report's bounded query fields |
| `GET /api/v1/runs/:runId/help/:topicId` | Player read | Shared help topic |
| `POST /api/v1/runs/:runId/preview` | Player read | GUI-equivalent preview without changing authoritative state or RNG |
| `POST /api/v1/runs/:runId/commands` | Player write | Validated, revision-checked and idempotent mutation |
| `GET /api/v1/runs/:runId/commands/:commandId` | Player read | Poll/reconcile a long command and receive its stored result |
| `GET /api/v1/runs/:runId/export` | Player export | Existing player-visible extract only |

Player operations require the corresponding scope on every endpoint. Player tokens fail on admin routes. Player report and export paths return curated data; they never return full configuration, seed/RNG state, hidden scenario schedules or another run's data.

Report data comes from shared GUI presentation builders. In particular, `report.regulatory.capital` returns the rendered capital cards, position labels, axis labels, composition strings and hover titles at GUI precision; it does not return internal numeric chart/layout helpers. `report.three_year_plan` is available only when that mode was assigned at run creation and returns the same mandate targets, progress, Board Confidence and formal review feedback rendered in the Boardroom.

## Player command contract

Every mutation includes a unique `commandId` and `expectedRevision`. `update_decisions` accepts stable standing-policy IDs from the registry under `controls`, and partial GUI-shaped ticket edits under `drafts`. Rates are annual ratios, e.g. `0.024` for 2.4%. Editing a transaction draft does not submit it. `queue_transaction` submits the current draft for one transaction kind and clears the form; only the queued item executes at a monthly close. Cancellation removes the queued item and does not restore the cleared draft.

```json
{
  "commandId": "client-generated-uuid",
  "expectedRevision": 17,
  "type": "update_decisions",
  "payload": {
    "controls": {
      "policy.deposit.corporate_rate": 0.024,
      "policy.loan.mortgage_selectivity": 0.425
    }
  }
}
```

Supported `type` values and payloads:

- `update_decisions`: `{ "controls": { "<standing-control-id>": number|string } }`, optionally or instead with `drafts`, containing partial GUI-shaped fields grouped as `capitalMarkets`, `gilt`, `boeFunding` or `hedge`.
- `queue_transaction`: `{ "kind": "capitalMarkets" | "giltTrade" | "boeFunding" | "hedge" }`; submits the validated current draft for that kind and clears that draft form.
- `cancel_transaction`: `{ "transaction_id": integer }`; removes the currently queued item with that ID. The prior draft is not restored.
- `set_risk_appetite`: `{ "targets": { "cet1", "leverage", "lcr", "nsfr", "irrbbEveLimit" } | null }`; null restores automatic targets.
- `set_safety_pause`: `{ "enabled": boolean }`.
- `advance_time`: `{ "months": integer }`, bounded by the configured per-command maximum and run horizon.

The full request schemas and control descriptions are returned through `/openapi.json` and `/controls`. `/reports` returns a runtime query schema for each report; only that report's registered fields are accepted. The client derives capital-market tools from the shared GUI area/instrument catalogue and omits pricing fields or tenors that the selected GUI ticket does not expose. It separates gilt buys from proportional sells, applies current Treasury sale/facility caps, omits cancellation when there is no queued item and offers only currently available reports. The API rejects extra properties, raw engine actions, grouped-field bypasses, unknown controls and GUI-unavailable instrument/tenor choices. Shared application validation enforces dynamic limits and GUI semantics. Invalid commands do not advance simulation time. Tool and report contract versions are `banksim-player-tools-v2` and `banksim-player-reports-v2`.

Successful command responses identify request and command, accepted/rejected result, revision, simulation step, status, stop reason and remaining horizon; successful mutations include a player overview. The overview exposes the run's assigned max model-turn and tool-call budgets so the client can reject a local cap above the owner-set limit. Validation issues are player-safe. A stale revision returns HTTP 409. Invalid semantic values return a structured rejection. Matching command ID/body retries return the originally persisted response and status; changed-body reuse returns `COMMAND_ID_REUSE`.

## Concurrency, retries and recovery

Mutations are serialized by run ID. Different runs can progress independently. A mutation validates the current revision and applies shared logic under the run lock. Ordinary command responses, session changes and audit records commit atomically. The command key and canonical body hash are persisted before a potentially long advance. Each completed month commits its checkpoint and progress atomically. A lost response can be retried with the same ID without repeating a settled month. Pending advances are resumed from the last committed checkpoint on startup; command status is also available for polling.

The service does not hold a database transaction or run lock while a provider is thinking; the model client runs separately. Local client resume and command reconciliation are implemented in Phase E. Phase F adds the trusted owner-side `audit:collect` command to join the database export with a local client transcript, plus offline bundle hash checks and decision replay. The API export itself remains server-only and records a `not-collected-by-server` marker for the client transcript.

## Determinism and replay

Run creation applies `banksim-seed-v1` before opening loan cohorts or economic state are generated. It stores seed and RNG state only server-side. Logical event IDs, simulation dates and canonical state hashes are deterministic for the pinned engine/runtime, configuration, start date, seed and accepted action sequence. Preview/read routes operate on cloned state and do not mutate live RNG. Request timestamps and elapsed wall time are operational metadata outside simulation hashes.

The admin replay endpoint consumes the saved timeline and checks the bank-state hash at opening and each monthly close. It does not call a model. It reports the first divergence. Current replay requires the exact served build; retaining old builds/images is an operator responsibility. Provider sampling, model seeds and repeated trial records are future client work, not guaranteed by the simulation seed.

## Administrator audit and current limits

The version 2 server export includes a manifest, full opening/current session objects and codecs, checkpoints with session/state hashes, command request/response records and server-side player read/response audit. It is owner-only and excludes raw tokens. `npm run audit:collect` joins it with the local client transcript, state, summary and player export, preserving raw JSONL bytes and marking missing or incomplete client records. `npm run audit:verify` checks hashes and replays recorded decisions without a model, reporting the first divergence. These hashes detect accidental alteration but are not signatures. The client-reported provider identity/transcript is harness provenance, not proof against a malicious client.

Current server run statuses include active, bank failure, horizon reached, owner stopped and server error. The client separately records provider failure, interruption and local resource-budget exhaustion in its outcome summary. Incomplete server commands/checkpoints remain stored. Run creation uses the current public scenario catalogue only. The Dockerfile, Compose package, environment template and operator/backup/rollback guide are prepared, but Docker is unavailable here, so the image and Compose configuration have not been validated. No VPS, HTTPS proxy, backup restoration or production installation check has been performed.

## Current completion state

Phases A–F are implemented. Phase G has added shared queue/draft behavior, report-specific query schemas, rendered capital dashboard/report parity, and a shared Three-Year Plan Boardroom/API report. Its substantive regression and final packaging checks are recorded in [`implementation-status.md`](./implementation-status.md).

The local service, client, joined export, and deterministic replay have been exercised with the mock provider. The current GUI scenario catalogue remains public because Pages bundles it. The loan table's sorting/filtering affects visible row selection only; the API returns the complete report categories and supports portfolio selection. The API's Past games view is scoped to the assigned run while browser storage can show other local attempts. Registry tests check registered controls/reports but cannot discover an unregistered future UI surface automatically.

Docker image/Compose validation, VPS installation, HTTPS reverse-proxy configuration, backup restoration, and production checks remain unperformed in this workspace. A real-provider smoke run is unverified because no provider credentials or inference budget were authorized. The score function remains the existing versioned scenario scoring; no new overall benchmark reward has been introduced.
