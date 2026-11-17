# Private scenario mount

Place an owner-controlled `scenarios.json` file in this directory and set
`BANKSIM_PRIVATE_SCENARIOS_FILE=/private-scenarios/scenarios.json` in
`deploy/.env`. The Compose service mounts this directory read-only. JSON files in
this directory are ignored by Git and excluded from Docker build context; keep the
source file in the owner's protected configuration and backup system.

The file contains a JSON array of scenario definitions. Each entry uses the
BankSim scenario fields `id`, `name`, `description`, optional `briefing`,
`goals`, `initialStateOverride`, `configOverrides`, `scheduledShocks` and
optional `arcStages`. Shock types are `depositCompetition`, `marketSpreadShock`,
`idiosyncraticRun`, `macroDownturn`, `counterpartyDefault` and `rolloverStress`.
The loader rejects duplicate public/private IDs, unknown config fields, unsupported
shock types, malformed triggers, invalid balance-sheet values and non-finite JSON
before the server listens. `configOverrides` may use fields present in `baseConfig`
and the shipped scenario override examples. When BankSim adds a new optional config
path, add its runtime validation shape in `server/privateScenarios.ts` before using it
in a private scenario.

For example, a private definition can look like this:

```json
[
  {
    "id": "internal-liquidity-review",
    "name": "Internal liquidity review",
    "description": "Maintain liquidity through the assigned review horizon.",
    "briefing": {
      "openingPressure": "Funding access is under review.",
      "firstDecision": "Check liquidity headroom before expanding the balance sheet."
    },
    "scheduledShocks": [
      {
        "stepNumber": 3,
        "shock": {
          "type": "rolloverStress",
          "accessMultiplier": 0.8,
          "spreadBps": 70
        }
      }
    ]
  }
]
```

The owner can list available definitions through the admin-only
`GET /admin/v1/scenarios` route. It returns IDs and descriptions, never the
shock parameters. The player receives only the same selected briefing and
shock-category timeline shown by the GUI. Opening state, full scenario
definition and future shock parameters remain in protected server session and
administrator audit data. The local evaluation client has no admin tools.

The session stores the exact selected definition, so an existing run can resume
after the mounted file changes. Its manifest records the scenario catalogue
version and a hash of the selected definition. Preserve the owner-controlled
file for creating matched future runs and retain exported audit bundles for
replay.
