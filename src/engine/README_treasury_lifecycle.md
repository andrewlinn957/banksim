# Passive treasury lifecycle boundary

The simulation distinguishes **contractual/passive balance-sheet mechanics** from **management decisions**.

Passive mechanics that occur without player action:
- BoE reserve balances earn the simulated Bank Rate.
- Existing gilt vintages age and mature into the BoE reserve account.
- Deposit inflows, loan repayments and operating cashflows may therefore accumulate as reserves.
- New loan drawdowns may consume those reserves.

Management decisions:
- Buying or selling gilts.
- Choosing the maturity of new gilt purchases.
- Repricing customer products, changing underwriting, raising funding or capital, hedging, and distributions.

There is deliberately no rule that automatically invests surplus reserves, targets a particular LCR, or restores a target reserves/gilts mix. A no-action bank is allowed to become inefficiently liquid. That outcome should be penalised through economics and management pressure rather than silently corrected by the engine.
