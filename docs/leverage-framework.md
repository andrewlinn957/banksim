# UK leverage ratio framework in BankSim

BankSim implements the UK leverage ratio framework currently effective from 1 January 2026. It deliberately does **not** implement the July 2026 reform proposal.

## Scope

The bank is subject to the binding UK leverage ratio minimum when either of these tests is met using the average of the three most recent accounting reference dates:

- retail deposits: **£75bn or more**;
- non-UK assets: **£10bn or more**.

Below those thresholds, BankSim continues to calculate and display leverage but treats **3.25% as the PRA supervisory expectation**, not as a hard minimum. The opening bank is below scope. Because the current product/geography model is domestic UK only, non-UK assets are currently zero; the separate measure is retained for future international products.

BankSim seeds the three opening accounting-reference-date observations at the opening bank's size. Thereafter, a new observation is recorded only on the explicit annual close. Ordinary metric refreshes do not advance scope history.

## Minimum and capital quality

For an in-scope firm, the base leverage ratio minimum is **3.25% of the leverage exposure measure**, met with Tier 1 capital. At least **75% of the base minimum** is expected to be met with CET1.

The leverage exposure engine continues to exclude eligible central-bank reserves, replace derivative book value with the prudential derivative exposure, and include 20% of modelled undrawn commitments.

## Countercyclical leverage ratio buffer (CCLB)

For an in-scope firm:

`CCLB = 35% × institution-specific CCyB`

The result is rounded to the nearest **10 basis points** of leverage ratio. With BankSim's current 2.0% UK institution-specific CCyB, the CCLB is **0.70%**.

The CCLB is met with CET1. Below scope, BankSim displays the same calculation only as an indicative future buffer; it is not binding.

## Additional leverage ratio buffer (ALRB)

BankSim ignores the G-SIB buffer, consistent with the broader game design. The ALRB is therefore linked to the modelled O-SII buffer:

`ALRB = 35% × O-SII buffer`

The ALRB is met with CET1 and becomes binding only when the bank is both in the UK leverage-ratio regime and subject to a positive O-SII buffer.

## Applied leverage stack

For an in-scope bank:

`Tier 1 leverage stack = 3.25% + CCLB + ALRB`

`CET1 leverage stack = (75% × 3.25%) + CCLB + ALRB`

A breach of the 3.25% binding minimum is a hard leverage breach. A shortfall against CCLB/ALRB is tracked separately. It does not trigger BankSim's risk-weighted MDA mechanism.

Below scope, only the 3.25% expectation is applied to dashboard headroom and internal-target floors; CCLB and ALRB are shown as indicative amounts.

## Official sources

- PRA Supervisory Statement SS45/15, *The UK leverage ratio framework*, November 2025 update: https://www.bankofengland.co.uk/-/media/boe/files/prudential-regulation/supervisory-statement/2025/ss4515-november-2025-update.pdf
- PRA Policy Statement PS22/25, *Leverage ratio: changes to the retail deposits threshold*, November 2025: https://www.bankofengland.co.uk/prudential-regulation/publication/2025/november/leverage-ratio-changes-to-the-retail-deposits-threshold-policy-statement
- PRA model requirements for additional leverage buffers: https://www.bankofengland.co.uk/prudential-regulation/publication/2020/vreq-additional-leverage-buffers-model-requirements
