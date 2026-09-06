# Management interface

The player sets a policy, watches it develop, and intervenes when a constraint needs attention. Monthly accounting remains the engine clock. Quarterly and annual views sum income flows and show actual closing stocks; partial periods are explicitly labelled.

## Implemented interaction

- The opening screen is the bank and four department entrances. Each displays a real balance or ratio and its operational status. No proposal feed, teaching cards, information-layer tabs, badge panel or history chart occupies the homepage.
- Selecting Customers, Lending, Capital or Treasury opens its management workspace beside the bank. Current operational figures, consequences and editable policy controls appear together. On narrower screens the workspace follows the bank and receives focus; closing it returns focus to the selected department.
- Lending shows gross principal, quarter approvals, undrawn commitments and Stage 2/3 share alongside loan prices and underwriting settings. Capital headroom is labelled in percentage points. Treasury uses actual wholesale maturities, not a forecast or all deposits treated as immediately due.
- Reports are explicitly named as reports. The loan report offers a separate “Manage lending” link that opens the real lending controls. Performance history and optional first-year challenges live in Reports.
- The time console has a horizon selector and Run/Pause. Game settings contain speed, safety interruptions, save, restart and tutorial. Auto is a sequence of monthly steps and can continue while a department remains visible. Opening a department or editing its policy pauses time; the player can restart to watch the results.
- Pricing, underwriting and payout policies persist. Debt, equity and swap transactions execute once and clear. Each department can cancel its own queued transactions. Hedging and department-head advice are disclosed on demand.
- The next-close estimate includes all policies and queued orders; it is explicitly not an isolated department effect. Expensive previews are skipped during playback.
- Safety interruption remains on by default. Failure always stops playback. Attention notices route to the responsible capital or treasury department.
- The first-year challenges remain optional records and do not end the career. Partial reporting periods state how many months have closed.

## Validation boundary

Department tests cover quarter opening/closing flows, missing history, gross loans including workouts, capital units and wholesale maturities. Render checks verify that a lending destination contains both its pipeline figures and actual lending inputs. Browser interaction QA is still unavailable because the approved browser environment rejected access to the test preview; no alternative browser was used to bypass that restriction.

## Design references

[Factorio's GUI redesign](https://factorio.com/blog/post/fff-212) motivates separating routine schedules from occasional settings and making contextual help available. [Factorio's research and alert interface](https://www.factorio.com/blog/post/fff-423) motivates maintaining context when inspecting trends and warnings. [Dwarf Fortress development notes](https://www.bay12games.com/dwarves/) describe urgency ordering, tutorial and navigation improvements within a complex simulation. The application of those principles to banking is our design judgement, rather than a claim that those games prescribe this exact layout.

The pacing and SICR corrections, their evidence and their regulatory boundary are documented in [career-pacing.md](career-pacing.md).
