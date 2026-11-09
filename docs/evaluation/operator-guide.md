# BankSim evaluation operator guide

This guide runs the one VPS evaluation service and the owner-side audit collection tools. It does not perform a production deployment. The current service supports the public scenario catalogue and one server process owning one SQLite database.

## Fresh installation

Use a reviewed immutable commit from the feature branch. The container build and runtime are pinned to Node `24.22.1-bookworm-slim`; npm dependencies come from the repository lockfile. Install Docker Engine and the Compose plugin on the VPS using the VPS owner's approved package source.

From the repository root:

```sh
cd deploy
cp banksim.env.example .env
chmod 600 .env
```

Edit `deploy/.env` on the VPS. Set a unique release ID in `BANKSIM_ENGINE_VERSION` and `BANKSIM_IMAGE_TAG`, choose `BANKSIM_PORT`, and replace the admin token with a high-entropy value. Generate the secret with an approved local secret manager or `openssl rand -hex 32`; keep it out of source control, command transcripts and evaluation-client configuration. Keep an encrypted copy in the owner's secret store. The public scenario catalogue version is `public-catalogue-v1`; private scenario loading is not implemented.

Start the service:

```sh
docker compose --env-file .env -f compose.yaml config
docker compose --env-file .env -f compose.yaml up -d --build
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail=100 banksim-api
```

Compose publishes the container only on VPS loopback and stores SQLite in the persistent volume `banksim-evaluation-data`. The container runs as an unprivileged user with a read-only root filesystem. SQLite schema migrations run on startup. `/health` is a minimal readiness response. Check health before creating runs:

```sh
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/openapi.json
```

Put the service behind the VPS's existing HTTPS reverse proxy for remote player access. Configure that proxy to restrict `/admin/v1/` to the owner's private network, VPN or SSH tunnel. Keep administrator authentication enabled even on that private path. Allow player `/api/v1/` access only over HTTPS. Do not expose port 3000 directly to the internet. No VPS, proxy, firewall or TLS configuration has been tested here.

## Create a run and issue its player token

Run creation is a separate owner operation. Keep the admin token in the owner's secret store or private terminal environment; the evaluation client does not need it. Use `GET /openapi.json` for the exact runtime contract. For example, save this as a private `run.json`, changing the release ID, scenario, seed, horizon and limits for the planned evaluation:

```json
{
  "engineVersion": "REPLACE_WITH_IMMUTABLE_RELEASE_ID",
  "scenarioId": "supervisory-review",
  "seed": 20261108,
  "horizonMonths": 12,
  "limits": { "maxModelTurns": 100, "maxToolCalls": 500 }
}
```

Submit the run request and issue a run-scoped credential:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $BANKSIM_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @run.json \
  https://YOUR-BANKSIM-SERVER/admin/v1/runs

curl --fail --silent --show-error \
  -H "Authorization: Bearer $BANKSIM_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{}' \
  https://YOUR-BANKSIM-SERVER/admin/v1/runs/RUN_ID/credentials
```

The issue response shows the player token once. Store it in the evaluation PC's secret manager under the environment variable configured by `playerTokenEnv` (the example uses `BANKSIM_PLAYER_TOKEN`). The token authorizes only one run and its listed player scopes. Revoke it after the attempt with `DELETE /admin/v1/runs/:runId/credentials/:credentialId`. Never use an admin token as a player token.

The manifest records the engine build digest, dependency lock hash, runtime, public scenario version, seed scheme, start date, horizon, mode, score version and owner-assigned model/tool-call caps. The score is BankSim's existing scenario goal score when the selected scenario defines goals; sandbox runs have no scenario score. The service does not create a new overall benchmark reward. Record any benchmark objective separately from the natural-language prompt.

## Run the client and inspect results

Install the standalone tarball and configure its server URL, run ID, player-token environment variable, provider, explicit model ID, prompt file and local budgets as described in [`client.md`](./client.md). The client is a player only. It does not receive the administration token, engine sources, full state or private administrator exports.

Use the installed client commands to start/resume/inspect the attempt. The client saves its exact prompt bytes/hash, effective model requests, tool schemas/results, provider response metadata, API interactions, usage records, retry history, terminal outcome and any transcript gaps. It does not capture hidden reasoning. Preserve unsuccessful and incomplete output directories.

Join the owner-side API export with the local client records from a trusted machine or owner workstation. `BANKSIM_ADMIN_TOKEN` is read from that process environment; it is never written into the bundle or transcript:

```sh
BANKSIM_ADMIN_TOKEN='owner-admin-token' npm run audit:collect -- \
  https://YOUR-BANKSIM-SERVER RUN_ID ./results/RUN_ID ./joined/RUN_ID.json
npm run audit:verify -- ./joined/RUN_ID.json
```

Use `-` instead of the client directory when it is unavailable. The collector then marks `missing-client-transcript`; it does not invent model events. A malformed final JSONL line is preserved and marks the client trace partial. The joined bundle includes the server's full private sessions/checkpoints, commands, player response audit, client transcript, local client state and summary, and familiar player export. Store it as owner-only data. A player token cannot fetch it.

`audit:verify` checks the recorded bundle hashes and replays the saved accepted actions without invoking a model. It reports the first divergent month with expected/actual hashes. A mismatch means the bundle should not be treated as a successful replay. Hashes detect accidental changes and link the records; they are not a digital signature against an administrator who can rewrite both data and hashes. Client-supplied model identity, transcript and usage remain harness provenance.

The API also provides `POST /admin/v1/replays`, which replays the database run under its recorded live build. The offline joined-bundle verifier uses the code checkout that invokes it, so replay a historical run with the matching immutable source release. Keep the relevant Git commit, image and lockfile available.

## Persistence, backups and recovery

The SQLite database and WAL live in the named Docker volume. Stop the service cleanly before copying the volume so SQLite has closed and checkpointed WAL data:

```sh
mkdir -p backups
chmod 700 backups
docker compose --env-file .env -f compose.yaml stop banksim-api
docker run --rm \
  -v banksim-evaluation-data:/data:ro \
  -v "$PWD/backups:/backup" \
  node:24.22.1-bookworm-slim \
  tar -czf "/backup/banksim-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /data .
docker compose --env-file .env -f compose.yaml start banksim-api
```

Copy backups to encrypted storage outside the VPS. Back up joined audit bundles and local client transcripts separately; they are not automatically uploaded to the service. Test restoration on a separate volume before relying on a backup.

To restore, stop the service, preserve a copy of the current volume, and extract the selected backup into the named volume using the same pinned helper image. Start the service and check `/health`, the run list and a known audit export. Do not restore over the only copy of the current database.

On a normal process restart, SQLite restores complete sessions and the server resumes pending multi-month advances from the latest committed monthly checkpoint. A failed or interrupted run keeps its partial checkpoints and audit. Client `resume` reconciles outstanding command IDs before sending another mutation. Preserve both records when an attempt ends with `interrupted`, `server_error`, `provider_error`, `provider_timeout` or `budget_exhausted`.

## Updating, rollback and logs

Each run is pinned to the served engine build. Before changing the image tag, finish or explicitly stop all active runs. The server refuses to start on a different build while incompatible runs remain active; it will not silently continue them under new code. Keep old source commits and image tags for historical replay.

Before an update, create and verify a backup, set a new immutable `BANKSIM_ENGINE_VERSION` and `BANKSIM_IMAGE_TAG` in `deploy/.env`, and build/start the new image:

```sh
docker compose --env-file .env -f compose.yaml build banksim-api
docker compose --env-file .env -f compose.yaml up -d banksim-api
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail=200 banksim-api
```

Keep the previous image and its exact source release. For rollback, stop the current service, restore the previous immutable release identifiers, and start the retained image. If the release changed database schema or the old binary cannot read the current database, restore the pre-update backup on a separate copy and follow the owner's recovery procedure; test this path before the first live run. Never delete partial/new run records to make a rollback appear clean.

Compose rotates container stdout/stderr logs at 20 MB with five files. Export bundles remain separate owner-managed artifacts. The health check reports process readiness only; it does not certify database backup integrity, active-run compatibility or reverse-proxy access.

## Operational limits and unverified items

Default API bounds are a 1 MB request body, 120 requests per minute, 12 months per advance, 120 months per run, 500 report rows per page and 120 report rows by default. The administrator also assigns model-turn and tool-call caps. These limits are configuration choices; they are not gameplay rules. The Docker Compose file sets no CPU or memory performance claim. Monitor the selected VPS during representative previews and monthly closes, then set host/container resource limits based on measured use.

This implementation does not include private scenario loading, a dashboard, multi-process SQLite coordination, transcript upload from an untrusted client, a digital signature for audit bundles, or an automated score leaderboard. No real provider call has been run. No VPS install, proxy/TLS, firewall, backup restoration, Docker image build or production deployment has been verified in the owner's environment.
