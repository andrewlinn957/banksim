# BankSim Mechanics Exposure Plan

Date: 2026-02-23  
Owner: Product + UX + Engineering

## 1. Purpose

Define how to expose simulation mechanics to players so the game is playable and teachable without overwhelming users.

This plan covers:
- information architecture
- UX surfaces and interaction patterns
- content model and governance
- engineering rollout phases
- QA and success metrics

## 2. Goals

1. Make first-time users able to complete a stable 12-month run.
2. Make cause-and-effect legible (which action changed which risk/financial outcome).
3. Keep advanced mechanics available without forcing all users to read everything up front.
4. Keep mechanic descriptions consistent with code over time.

## 3. Non-goals

- Rebuilding core simulation mechanics.
- Full redesign of visual style.
- Replacing the existing event/attribution engines.

## 4. Audience Segments

1. New players: need plain-language guidance and safe defaults.
2. Intermediate players: need tactical "what happens if I do X?" help.
3. Power users: need formulas, thresholds, and model assumptions.

## 5. UX Principles

1. Progressive disclosure:
   - Start with intent and impact.
   - Reveal formulas/thresholds on demand.
2. Context first:
   - Show help where decisions are made (Actions, metrics panels).
3. Traceability:
   - Every warning/event should link to "why".
4. Single source of truth:
   - Reuse one mechanics content registry across tooltips, manual, and warnings.
5. Actionability:
   - Guidance should suggest what to do next, not just definitions.

## 6. Information Architecture

## 6.1 Canonical Content Layers

Layer A: Plain-language summary  
- "What this lever/metric means"
- "Why it matters"

Layer B: Tactical behavior  
- "What increases/decreases it"
- typical trade-offs

Layer C: Model detail  
- formula sketch
- threshold/default values
- links to full section anchors

## 6.2 Mechanics Taxonomy

1. Actions and controls
2. Deposits and franchise dynamics
3. Loan pipeline/cohorts/credit risk
4. Funding ladder and liquidity risk
5. Capital, distributions, and compliance
6. Market/exogenous drivers
7. Share price model
8. Scenarios and scoring
9. Attribution/events/reconciliation

## 7. UX Surfaces to Implement

## 7.1 Help Center Tab (Full Reference)

Add a dedicated `Help` tab with:
- searchable section list
- left nav TOC
- anchor links from other UI surfaces
- "basic / advanced" toggle to collapse detailed sections

Content source: `player_guide.md` sections or generated from mechanics registry.

## 7.2 Inline Help on Actions

For each field in `ActionsPanel`:
- add info icon + hover/focus popover
- include:
  - effect in one sentence
  - key trade-off
  - relevant threshold/formula snippet
  - link to full Help section

Priority fields:
- pricing (deposit/lending)
- underwriting tightness
- capital policy
- hedge controls

## 7.3 Metric Explanations in Overview + Regulatory

For top metrics (CET1, LCR, NSFR, leverage, payout cap, confidence, board pressure):
- add info popovers
- include "breach line" and "current distance to line"
- include "top 2 drivers this month" (from attribution where available)

## 7.4 Just-in-Time Guardrails in Actions Drawer

Before run submission:
- detect risky combinations (already partly inferable from preview/metrics).
- show warning blocks, e.g.:
  - likely adverse selection pressure
  - payout clipped by internal target
  - rollover wall with weak confidence

Guardrails should be advisory, not hard blockers.

## 7.5 "Why did this move?" Drilldown

Connect:
- attribution driver row
- linked event log entries
- short mechanic explanation

Flow:
1. User clicks driver in `Regulatory`.
2. Event Log filters linked events.
3. Side panel/popup explains mechanism path (inputs -> engine effect -> metric delta).

## 7.6 Scenario Briefing + Debrief

Briefing (on scenario start):
- scenario-specific risk map
- likely failure modes
- suggested first-step focus

Debrief (on failure or horizon end):
- what failed first
- top cumulative drivers
- recommended alternate levers

## 7.7 First-Run Guided Walkthrough

Add opt-in tutorial overlay:
1. Set safe pricing.
2. Run one month.
3. Read CET1/LCR deltas.
4. Trigger a controlled risky move.
5. Observe warning + mitigation move.

Outcome: user understands cause/effect loop in <10 minutes.

## 8. Content System and Governance

## 8.1 Mechanics Registry (Single Source)

Create `src/content/mechanicsRegistry.ts` with structured entries:
- `id`
- `title`
- `plainDescription`
- `driverSummary`
- `thresholds` (optional)
- `formula` (optional)
- `relatedMetrics`
- `relatedActions`
- `helpAnchor`

Render this registry in:
- tooltips/popovers
- Help tab
- warning/guardrail copy

## 8.2 Dynamic Value Injection

Where possible, show current config-derived thresholds (not hardcoded text):
- min CET1 / leverage / LCR / NSFR
- payout caps
- confidence thresholds

## 8.3 Copy Style Rules

1. One-sentence "what" + one-sentence "so what".
2. Keep formula snippets compact.
3. Avoid unexplained abbreviations in layer A copy.
4. Use consistent terms with existing UI labels.

## 9. Engineering Plan by Phase

## Phase 0: Foundation (Content + Components)

Deliverables:
- `mechanicsRegistry.ts` schema + initial entries
- reusable components:
  - `InfoTooltip`
  - `HelpLink`
  - `WarningBanner`
- helper for pulling dynamic threshold values from config/state

Acceptance:
- registry is renderable and test-covered
- no user-visible regressions

## Phase 1: Manual Exposure

Deliverables:
- new `Help` tab in main nav
- rendered mechanics sections with search + anchors
- links from top-level tabs into Help anchors

Acceptance:
- user can find any major mechanic in <=3 clicks

## Phase 2: Contextual Help

Deliverables:
- action-field tooltips in `ActionsPanel`
- metric tooltips in `TopMetricsPanel` + key `RegMetricsPanel` headers
- help links wired to anchors

Acceptance:
- all visible player levers have contextual explanations

## Phase 3: Guardrails + Explainability

Deliverables:
- pre-run risk guardrails in actions drawer
- attribution -> event -> mechanic explainer chain
- scenario briefing/debrief cards

Acceptance:
- warnings explain both risk and mitigation option

## Phase 4: Onboarding

Deliverables:
- first-run guided walkthrough
- completion state persisted locally
- "replay tutorial" option

Acceptance:
- new users can complete tutorial and run at least 3 months without confusion

## 10. QA and Validation Plan

## 10.1 Functional QA

1. Tooltips open on hover/focus and are keyboard accessible.
2. Help links land on correct anchors.
3. Dynamic thresholds match active scenario config.
4. Guardrails appear/disappear with changing input/state.
5. No stepping/performance regressions.

## 10.2 Content QA

1. Every exposed lever has matching explanation entry.
2. Terminology matches UI labels and event text.
3. No stale hardcoded thresholds when config overrides are active.

## 10.3 Regression QA

1. Existing run/save/replay still deterministic.
2. Existing scenario flows unaffected.
3. Existing panels render without layout breakage on mobile and desktop.

## 11. Telemetry and Success Metrics

Track (if telemetry available):
- Help tab open rate
- tooltip open rate by field
- time-to-first-run
- first-session failure rate
- % runs ending in first-3-month hard failure
- tutorial completion rate

Success targets (initial):
- reduce first-session hard failure by 25%
- improve median time-to-confident-run (12m) by 30%
- >50% of first-time users interact with contextual help

## 12. Risks and Mitigations

1. Risk: Content drifts from engine behavior.
   - Mitigation: single registry + config-derived values + periodic doc tests.
2. Risk: Too much text overwhelms users.
   - Mitigation: layered disclosure + default concise mode.
3. Risk: Guardrails feel like noise.
   - Mitigation: trigger only on meaningful thresholds; cap visible warnings.
4. Risk: Implementation churn across many components.
   - Mitigation: phase rollout and reuse shared UI primitives.

## 13. Concrete File/Component Changes (Proposed)

New:
- `src/content/mechanicsRegistry.ts`
- `src/components/InfoTooltip.tsx`
- `src/components/HelpCenterPanel.tsx`
- `src/components/MechanicGuardrails.tsx`

Modified:
- `src/App.tsx` (add Help tab routing + anchor handling)
- `src/components/ActionsPanel.tsx` (field-level help + guardrails mount)
- `src/components/TopMetricsPanel.tsx` (metric tooltips)
- `src/components/RegMetricsPanel.tsx` (explainability links)
- `src/components/EventLog.tsx` (context links)

Optional:
- `src/styles.css` (tooltip/help styles)
- tests for registry/component rendering

## 14. Rollout Order Recommendation

1. Phase 0 + Phase 1 first (manual + structured content).
2. Phase 2 next (contextual help on decisions/metrics).
3. Phase 3 after baseline usability confirmation.
4. Phase 4 onboarding last.

Reason:
- fastest path to immediate user value with minimal gameplay-risk changes.

## 15. Exit Criteria

Consider this effort "done" when:
- mechanics are discoverable from UI without external docs
- core levers and risk metrics have contextual explanations
- users can trace major metric changes to actions/events/mechanics
- explanations remain consistent under scenario config overrides

## 16. Immediate Next Step

Implement Phase 0 + Phase 1:
- mechanics registry
- Help tab with searchable, anchored content
- links from Actions/Regulatory to Help sections
