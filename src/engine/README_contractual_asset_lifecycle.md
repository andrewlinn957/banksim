# Contractual asset lifecycle

Contractual treasury-asset mechanics run inside `createSimulationEngine().step()` as part of the authoritative month-end close. There is no wrapper simulation path.

The product catalogue owns the behaviour flags that determine whether an asset is a floating settlement asset, tradable, or contractually maturing. `applyActions()` emits structured execution records containing requested and actually-settled notionals plus tenor; lifecycle code consumes those records directly. Human-readable events are presentation output only and are never parsed back into economic state.

Asset maturity ladders live in `BankState.assetMaturityLadders`; `fundingLadders` is reserved for liabilities. Existing Phase-1 saves that stored asset ladders under `fundingLadders` are migrated on the first lifecycle close.

The legacy `setTreasuryPolicy` action remains only for replay/backward compatibility. The live management surface uses explicit one-off asset trades.
