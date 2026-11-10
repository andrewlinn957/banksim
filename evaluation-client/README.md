# BankSim evaluation client

This package runs a model against an owner-created BankSim run. It imports no simulator engine code and has no administrator operations in its model tool list.

## Requirements

- Node.js `24.22.x` for building and running the client.
- A reachable BankSim API URL, run ID and run-scoped player token supplied by the owner.
- For the OpenAI-compatible adapter, a model endpoint and explicit model ID. A deterministic mock provider is available for offline checks.

The controlled runner gives the model only BankSim player tools. It does not give the model shell, filesystem, browser, arbitrary network, database or administrator tools. An unrestricted IDE coding agent remains a different evaluation mode.

## Build and install

From a BankSim checkout, build the distributable package:

```sh
npm --prefix evaluation-client install
npm --prefix evaluation-client run build
npm pack ./evaluation-client
```

Copy the resulting `banksim-evaluation-client-0.1.0.tgz` to the owner PC. In a clean directory that has no BankSim checkout:

```sh
npm install --global ./banksim-evaluation-client-0.1.0.tgz
banksim-eval --help
```

The tarball contains compiled client code, examples, prompt examples and documentation. It does not contain `src/engine`, starting portfolios, private scenarios, server code, seeds or audit traces.

## Configure and run

Copy `examples/config.json` to a working directory and copy `examples/prompts/manage-bank.md` to `./prompts/manage-bank.md`. Edit the server URL, run ID and explicit provider model. Set the environment variables named in the config:

```sh
export BANKSIM_PLAYER_TOKEN='owner-issued-run-token'
export MODEL_API_KEY='provider-key'
banksim-eval run ./config.json
```

The config's `provider.model` is required. The API returns the administrator-assigned model-turn and tool-call budgets in the player overview; local config caps may be lower, but cannot exceed those assigned values. Sampling values and optional provider seed are recorded with each turn. The prompt file is read as UTF-8 without trimming; its exact bytes, base64 and SHA-256 are saved in the local attempt.

## Transaction workflow

The agent can edit the same transaction form fields shown in the GUI. `update_decisions` accepts standing policy changes under `controls` and partial transaction form changes under `drafts`. For example:

```json
{
  "drafts": {
    "gilt": { "direction": "buy", "amountGbp": 1000000, "tenorMonths": 60 }
  }
}
```

Editing a draft does not submit or execute it. `queue_transaction` takes a transaction `kind` such as `giltTrade` and submits the current form draft to the next-close queue. Queueing clears that form draft. A queued item executes only during a valid monthly close. `get_controls` reports current draft values and queued item IDs. `cancel_transaction` removes a queued item by its `transaction_id`; it does not restore the cleared draft, so enter the fields again before resubmitting. The client tool schemas update to match available reports, controls, transaction choices and the current queue. To clear a text amount or price field, send an empty string; choose `none` to clear a transaction selector.

The `mock` adapter uses a deterministic scripted sequence, but still requires an explicit model ID in config. For a local mock run, set `provider.adapter` to `mock`; no model API key is needed. The player token is still required because the mock uses the real player API.

Each attempt is written under `<outputDirectory>/<sanitised-run-id>/`:

- `client-state.json` contains resumable state and pending command/provider records.
- `client-run.json` contains a compact result summary.
- `transcript.jsonl` contains the prompt inputs, tool contracts, every player request and returned result, model response/tool call, usage, retries, transcript gaps and terminal events.
- `prompt.txt` is the exact prompt file bytes decoded as UTF-8.
- `player-export.json` is the familiar player-facing BankSim export, never the admin bundle.

Local files contain the prompt and model transcript. Protect the output directory as you would other evaluation records. Credentials and authorization headers are not written to these files or sent in model messages.

## Commands

```sh
banksim-eval run ./config.json       # start a new client attempt
banksim-eval resume ./config.json    # reconcile pending command IDs and continue
banksim-eval inspect ./config.json   # inspect local state; no API token is needed
banksim-eval collect ./config.json   # fetch the player export for a saved attempt
banksim-eval batch ./run-a.json ./run-b.json  # run owner-created attempts sequentially
```

`run` and `resume` collect the player export on completion when the API is available. A model error, budget limit, interruption, or server error leaves a saved partial attempt. Raise a local limit only by editing config and recording the change; a resume may raise, but not lower, limits within the attempt, and the cap cannot exceed the administrator-assigned run budget. Resume will not silently replace the prompt, server, run ID, model or provider settings.

Batch mode takes one config per owner-created run ID and processes them sequentially. Each run keeps its own output directory; failures are retained and do not prevent later configs from running. Outcomes include `model_finished`, `provider_error`, `provider_timeout`, `budget_exhausted`, `interrupted` and the server's terminal statuses.

Press `Ctrl+C` to ask the runner to stop at a safe boundary. A command whose HTTP response was lost is reconciled with its original command ID before a later mutation. If the provider request may have completed before a client crash and no response was saved, the client records a transcript gap and does not guess at the missing response.

## Model context policy

`banksim-player-protocol-v3` contains only required tool and protocol instructions, including the distinction between editing a form draft, submitting it to the queue, removing a queued item and executing it at a close. The user's prompt is kept in a separate user message. The client sends the complete accumulated message history and current player tool definitions on each provider turn; it does not summarise or silently truncate context. `resume-gap-note-v1` marks an unmatched server revision and `provider-gap-v1` marks a missing provider response. No scratchpad or hidden reasoning is requested or claimed as captured.

## VS Code

The examples include tasks and launch settings using the same CLI. Set the run config's environment variable names in the VS Code process environment before starting the task. The client does not require a VS Code extension.

## Provider compatibility

`openai-compatible` sends a Chat Completions request to `<baseUrl>/chat/completions`, with `model`, `messages`, `tools`, `tool_choice: "auto"`, and configured `temperature`, `top_p` and `seed` when supplied. The [OpenAI Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) documents these fields. OpenAI currently marks `seed` and the returned `system_fingerprint` as deprecated; the seed is best effort and does not guarantee identical model decisions. Other compatible endpoints may differ, so check the selected provider's documentation.

The transcript records provider-supplied identity and usage as harness provenance. It cannot prove that a client was honest or expose hidden model reasoning.
