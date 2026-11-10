# BankSim evaluation implementation status

Updated: 10 November 2026
Branch: `feature/evaluation-functionality`
Audit baseline: `main` revision `2e51380cd11e0f95a4d5143d42dfcb08cbca6729`
Evaluation merge: local revision `74cf7872d8f39f63549026f8a6a675df9388d51f`; GitHub branch contains the same tree at merge checkpoint `cf54a316f336bc655eb69debaabe2ef8821cad46`.

## Phase status

| Phase | Status | Evidence and remaining limits |
|---|---|---|
| A — Audit and contracts | Complete | [GUI parity inventory](./gui-parity.md), machine-readable [control and report inventory](./gui-parity.json), API schemas and data-boundary notes. The inventory includes the Three-Year Plan report added in Phase G. |
| B — Shared player/session layer | Complete | The GUI and HTTP API use shared controls, validation, drafts, transaction queues, close behaviour, report builders, help, previews and the player export. API routes do not call `engine.step` directly. |
| C — Deterministic lifecycle | Implemented and locally verified | Seeded opening creation, persisted session/RNG state, logical event IDs, canonical replay hashes and checkpoint continuation are covered by application and server tests. Determinism is promised only for the pinned supported runtime/build. |
| D — Durable API service | Implemented and locally verified | Versioned player/admin routes, scoped hashed bearer credentials, SQLite persistence, run serialization, command idempotency/revision checks, resume and replay verification have HTTP tests. Single-process service operation remains the supported deployment shape. |
| E — Standalone evaluation client | Complete for the controlled client | The client builds separately from engine/server code, has an OpenAI-compatible tool adapter and deterministic mock, bounded execution, prompt/tool logging, resume reconciliation and VS Code task examples. A clean-directory smoke run succeeded without a BankSim checkout or admin credential. |
| F — Exports and operator workflow | Implemented; fresh container install not verified | Joined server/client audit bundles, integrity verification, replay, sample bundle, operator docs, container and Compose artifacts are present. Docker is unavailable in this environment, so image build and fresh Compose installation remain unverified. |
| G — Final parity and end-to-end review | Substantive local review complete; external checks remain | Queue semantics, shared control choices, report query schemas, capital display parity and mode-gated Three-Year Plan parity were reviewed and tested. The full browser suite could not launch because the configured Playwright Chromium executable is absent. VPS deployment and a real-provider inference run were not performed. See unresolved limits below. |

## Work completed in the Phase G review

- Merged current `main` into the evaluation branch and reviewed the incoming gameplay/UI changes against the evaluation API.
- Made transaction drafts distinct from submitted queue items in the shared session layer. Queueing validates and clears a GUI-shaped draft; only submitted queue entries execute at close; cancellation removes the queued entry; close and persistence follow the GUI lifecycle.
- Reused the GUI's control groupings and action-choice registries in the agent controls and model tool descriptions. The corporate deposit control still changes both corporate deposit classes together. Hidden raw engine actions and fields remain unavailable.
- Made report query fields report-specific in the shared report registry and generated their API schemas from that registry.
- Added the Boardroom's Three-Year Plan display as a mode-gated player report using the same display builder as the rendered React panel.
- Moved capital dashboard display formatting into a shared builder used by React and the API, preserving GUI-visible precision, labels, hover text and annotations while excluding internal chart geometry values.
- Updated parity, API and client documentation, and regenerated the one-month mock-provider bundle using the current session codec and protocol versions.

## Verification performed

All commands below ran in the repository on 10 November 2026 unless noted.

| Command/check | Result |
|---|---|
| `npm run typecheck` | Passed: browser and server TypeScript checks. |
| `npm run test:fast` | Passed: 143 test files, 470 tests. |
| `npm run test:regression` | Passed: 3 files, 8 regression tests. |
| `npm run build` | Passed. Vite reports the existing large main-chunk warning; generated JS is approximately 858 kB. |
| `npm run server:build` | Passed. |
| `npm run client:typecheck` | Passed. |
| `npm run test:client` | Passed: 6 tests. |
| `npm run test:client:smoke` | Passed from a clean directory: mock run reached its one-month horizon; exported player data and joined bundle; recovered a committed command after simulated lost response; replay matched opening and close checkpoints; configured budget cap was enforced. |
| `npm run audit:verify -- docs/evaluation/examples/mock-one-month.bundle.json.gz` | Passed: bundle integrity verified, 40 transcript records, two state checkpoints, two replayed steps and no divergence. |
| `git diff --check` | Passed. |
| Focused rendered GUI/report and HTTP parity suites | Passed, including action choice parity, capital report rendering, Three-Year Plan states, queue lifecycle, report query availability and seeded GUI/API state matching. |
| `npm run test:browser` | Could not run: all 18 cases failed before assertions because Playwright's configured `chromium_headless_shell-1243` binary is absent. This is an environment setup failure, not a passing browser check. |
| Docker image/Compose checks | Not run: Docker executable unavailable. |
| VPS/reverse-proxy/backup-restore checks | Not run: no VPS access or deployment configuration was provided. |
| Real model-provider smoke test | Not run: provider credentials and an inference budget were not supplied. The mock-provider path is verified. |

The Vite bundle-size warning is recorded for follow-up; it did not fail the build. The accepted application has not been deployed or merged to `main`.

## Remaining limitations and next work

1. **External installation checks:** build and start the container with Docker, perform a fresh Compose install and restore drill, and verify HTTPS, private admin access, persistent volume permissions, log rotation and recovery on the owner's VPS. Required owner inputs are the VPS's existing reverse-proxy/network details, domain or private access route, and the chosen secret-delivery method. No production change is authorized by this implementation work.
2. **Browser automation:** install the Playwright browser version pinned by the repository and rerun `npm run test:browser`. Rendered component parity tests pass, but the configured full browser suite has not executed in this environment.
3. **Provider verification:** confirm the owner's selected provider endpoint/model supports the adapter's tool-call fields, then run a budget-authorized real-provider smoke test. Provider-specific behavior remains unverified.
4. **Scenario privacy:** the current GitHub Pages application imports the public scenario catalogue. The current catalogue is therefore public browser data; private future scenario definitions require moving them to server-only configuration before they are treated as confidential.
5. **Presentation coverage:** API reports expose all GUI-visible loan portfolio rows, while GUI table sorting/filtering remains a presentation interaction without corresponding query operations. Browser-local Past games also has a broader local-browser history view; the remote API intentionally returns only the assigned run's player-accessible history. These limits are described in [the parity inventory](./gui-parity.md).
6. **Ongoing parity process:** the registry coverage test verifies registered controls and reports; it cannot discover a future React screen that has not been registered. New gameplay or information surfaces must receive a parity inventory row and a shared-builder/GUI consumption review.
7. **Evidence boundary:** the server records API interactions and authoritative state. Model identity, prompts, transcript, usage and latency submitted by the local harness are provenance from that client, not cryptographic proof against a malicious harness. The system records available data and transcript gaps without inventing missing material.

No benchmark-wide reward has been added. Existing scenario scoring remains versioned as `banksim-scenario-score-v1`; the owner's benchmark objectives remain a separate decision.

## Next concrete task

Install the pinned Playwright browser and run the browser suite, then perform the container/Compose checks on a Docker-capable machine. After those local checks, collect the owner's VPS and provider details to schedule explicitly authorized external smoke checks. Until then, treat Phase G as locally reviewed with deployment and external-provider gates open, not as production-ready.
