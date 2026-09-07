# Board risk appetite

The Capital department and prudential Capital dashboard let the player queue standing CET1, leverage, LCR and NSFR targets. They apply at the next monthly close through the `setRiskAppetite` action. Actions are included in saved run timelines and replay; targets persist in bank state. Restarting a scenario restores its automatic policy. Restoring automatic targets is also a queued action.

An explicit CET1 target replaces the automatic dynamic target, subject to a floor at the model's PRA buffer target. It drives the existing distribution restraint and dividend capacity calculation. Leverage, LCR and NSFR targets govern safety pauses and attention notices, subject to regulatory minima. They do not automatically trade assets, originate loans or raise funding. The player makes those decisions through the departments.

The always-visible history chart compares selectable ratios, sterling amounts or percentage-point headroom, with full-history and recent-year windows. It uses metrics recorded at each close, so a new target does not rewrite earlier policy. New series are unavailable for historical snapshots that did not record them. The dashboard cards show Pillar 2A-inclusive minima; the requirement breakdown contains the bank policy payout cap. The former duplicate detailed-capital table has been removed.
