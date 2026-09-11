# Funding-market implementation scope

This implementation deliberately stops at the backend calculation and execution layer.

- No React component reads `FundingMarketAssessment`.
- No new dashboard, tooltip, status pill, chart or explainer is added.
- The data structure is intentionally richer than current UI needs so the UX can be designed separately.
- Existing Funding Confidence remains elsewhere in the simulation until those dependencies are considered separately.
