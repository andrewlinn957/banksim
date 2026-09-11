# Funding market engine

## Purpose

The funding-market engine replaces Funding Confidence as the direct determinant of capital-market debt pricing and capacity. It is intentionally backend-only for now: no current UI or UX surface consumes the new assessment object.

The design rule is:

> observable issuer fundamentals + external market conditions + instrument terms -> spread, investor demand, capacity and tenor availability

The engine does **not** collapse these inputs into a single confidence score.

## Architecture

1. `src/domain/fundingMarket.ts` defines the raw fundamentals, driver effects and assessment output.
2. `src/engine/fundingMarket.ts` is the pure calculation engine. It has no dependency on `BankState`.
3. `src/engine/fundingMarketAdapter.ts` translates current `BankState` into observable funding-market fundamentals.
4. `src/engine/capitalMarkets.ts` supplies instrument terms and uses the assessment to execute AT1, Tier 2 and senior debt bookbuilds.

## Observable inputs

The current adapter supplies:

- CET1 headroom;
- leverage headroom;
- LCR and NSFR;
- wholesale market-funding share of liabilities;
- wholesale market funding maturing within 12 months;
- deposit franchise strength;
- Stage 2 and Stage 3 shares of the loan book;
- annualised ROA once an earnings period has been observed;
- unencumbered Level 1 HQLA as a share of assets (retained for future secured-market modelling);
- the external senior-debt market spread.

Recent issuance is added separately because repeated market use changes investor capacity even if the balance sheet is unchanged.

## Pricing

Each observable driver produces two explicit outputs:

- a spread contribution in basis points; and
- a capacity multiplier.

The quoted fair spread is the sum of:

- the external market spread;
- instrument premium;
- minimum new-issue concession;
- capital penalty;
- liquidity penalty;
- funding-structure penalty;
- asset-quality penalty;
- earnings penalty where earnings have been observed;
- recent-issuance penalty;
- tenor premium.

All raw observations and contributions are returned in `FundingMarketAssessment.drivers` so a future UX can expose any level of detail without reverse-engineering the calculation.

## Investor demand curve

`capacityAtFairSpread` is the amount the market will absorb at the fair spread. Paying a wider spread moves along a simple demand curve until `hardCapacity` is reached.

If management specifies `maxSpreadBps`, the engine calculates how much investor demand exists at that price. This allows a transaction to be partially filled rather than treating access as a binary open/closed switch.

## Tenor

Instrument eligibility still comes from the typed product/capital-markets catalogue. The funding-market engine can make longer permitted tenors unavailable when stressed capacity falls below a minimum viable issue size. No new product or tenor is invented by the engine.

## Equity

CET1 issuance remains in the capital-markets engine but no longer reads Funding Confidence. Capacity is based on market capitalisation and recent issuance; discounting is based on deal size, observable share-price valuation and recent issuance.

## Deliberate non-goals in this change

- No UI or UX changes.
- No removal of the existing Funding Confidence state from the rest of BankSim yet.
- No change to funding-ladder rollover mechanics yet.
- No covered-bond or other secured wholesale issuance product yet. The unencumbered Level 1 input is included so that secured market capacity can be added without redesigning the domain model.
