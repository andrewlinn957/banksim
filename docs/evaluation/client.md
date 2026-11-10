# Standalone evaluation client

The owner creates a run through the authenticated administration API, then gives the harness its run ID and one run-scoped player token. The evaluation client runs on the owner's PC and imports no BankSim engine, server or scenario modules. The model receives only registered player tools and their results.

## Build and install

The supported build runtime is Node.js `24.22.x`.

```sh
npm --prefix evaluation-client install
npm run client:typecheck
npm run test:client
npm run client:build
npm pack ./evaluation-client
```

Copy the generated tarball to the owner PC and install it in a clean working directory:

```sh
npm install --global ./banksim-evaluation-client-0.1.0.tgz
banksim-eval --help
```

The package ships compiled CLI/client code, docs and examples. Its `files` allowlist excludes engine/server source, opening state, seeds, private configurations and full traces. The clean-directory smoke evidence is recorded in [`implementation-status.md`](./implementation-status.md).

## Config and secrets

Copy `evaluation-client/examples/config.json` to the evaluation working directory. Copy the example prompt to `./prompts/manage-bank.md`, then set the server URL, run ID, prompt path and an explicit model ID. `serverUrl` must use HTTPS except for loopback development; a local inference endpoint may also use loopback HTTP. URL credentials and query parameters are rejected. The administrator-assigned model-turn and tool-call budgets are returned in the player overview; local limits may be lower, and a config above either assigned limit is rejected.

Set only the environment variables named in the config:

```sh
export BANKSIM_PLAYER_TOKEN='owner-issued-run-token'
export MODEL_API_KEY='provider-key'
banksim-eval run ./config.json
```

The player token and model API key are never placed in model messages, transcripts, result summaries or request logs. The saved provider settings contain the environment variable names, not their values. Authorization headers are not logged by the client. Administrator credentials are not required by the client.

The prompt file is decoded as strict UTF-8, without trimming or rewriting. The client stores its exact text, base64 bytes and SHA-256. The protocol instruction is a separately versioned system message; the user's prompt remains a separate message. Complete messages, tool definitions, returned model messages and tool calls are retained. The client does not summarize or truncate context silently and does not claim to capture hidden reasoning.

## Commands

```sh
banksim-eval run ./config.json
banksim-eval resume ./config.json
banksim-eval inspect ./config.json
banksim-eval collect ./config.json
banksim-eval batch ./run-a.json ./run-b.json
```

`run` starts a new local attempt. `resume` requires the same prompt, server, run ID and provider settings; local budgets may be raised and that change is logged. A saved command ID/body is checked with the service before retry. A lost command response is reconciled under that same ID. If a provider request may have completed before its response was saved, the runner writes a transcript gap and tells the next model turn not to infer the missing answer. A returned multi-tool response executes in listed order.

`inspect` reads the local result and does not require either API credential. `collect` needs the player token but not the model provider credential. `run` and `resume` automatically try to download the player export after the attempt ends. Batch mode runs separate owner-created configs in order; it retains each result and continues after an individual failure.

## Transaction form and queue

`get_controls` returns the GUI-shaped transaction draft values and the current queued item IDs. `update_decisions` accepts persistent policies under `controls` and partial form edits under `drafts`, grouped as `capitalMarkets`, `gilt`, `boeFunding` and `hedge`. For example, `{"drafts":{"gilt":{"direction":"buy","amountGbp":1000000,"tenorMonths":60}}}` edits a gilt ticket. This leaves it as a draft. `queue_transaction` takes a `kind` (for gilts, `giltTrade`) and submits that form to the next-close queue; queueing clears the draft form, and a valid monthly close executes queued items. `cancel_transaction` takes `transaction_id` from `get_controls` and removes that queued item. It does not restore the cleared draft; enter the fields again before resubmitting. The schemas expose only transaction kinds not already queued and IDs that are currently in the queue. Send an empty string to clear a text amount or price field, and `none` to clear a selector. Shared API validation applies the same GUI grouping, choices, prerequisites and limits.

`Ctrl+C` asks the client to stop at a safe boundary. Local outcomes include `model_finished`, `provider_error`, `provider_timeout`, `budget_exhausted`, `interrupted` and server terminal states. A failed or partial attempt remains on disk.

The context policy is versioned: `banksim-player-protocol-v3` carries protocol instructions, including the distinction between transaction form drafts, queued items and monthly execution; `resume-gap-note-v1` describes unmatched server revisions; `provider-gap-v1` describes provider replies that may have completed but were not saved. The runner sends the complete message history and current tool schemas on every turn. It does not silently summarize or truncate context.

## Provider adapter

The built-in `openai-compatible` adapter calls `<baseUrl>/chat/completions` with the explicitly configured model, complete messages, player-only tool schemas and `tool_choice: "auto"`. It conditionally sends `temperature`, `top_p` and `seed`. The [OpenAI Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) supports these request fields; OpenAI marks `seed` and `system_fingerprint` as deprecated and describes the seed as best-effort. It records the returned message/tool calls, finish reason, usage, returned model, system fingerprint, service tier and raw JSON response when present. Provider timeout and retry count are client settings, recorded as provenance. Check the selected endpoint's documentation for optional field support.

The `mock` adapter is a deterministic offline script used to check the harness. It still calls a real BankSim player API and still requires an explicit model string for provenance. No real provider smoke run has been performed without the owner's provider credential and authorized budget.

## Attempt files

The output path is `<outputDirectory>/<sanitised-run-id>/`:

| File | Contents |
|---|---|
| `client-run.json` | Result summary, prompt digest, model/provider provenance, usage, gaps and outcome |
| `client-state.json` | Resumable messages, pending provider response, outstanding command and limits |
| `transcript.jsonl` | Exact provider inputs/outputs, tool schemas, player requests/responses, retries and lifecycle events |
| `prompt.txt` | Exact prompt bytes as UTF-8 text |
| `player-export.json` | BankSim's player-visible extract; never the administrator audit bundle |

The client transcript is a harness record reported by the local client. It is useful provenance, but does not prove model identity or that a malicious client reported honestly. Server API logs, commands and checkpoints remain authoritative for server-side actions.

VS Code task and launch examples are in `evaluation-client/examples/.vscode/`. They call the same CLI and need no extension.
