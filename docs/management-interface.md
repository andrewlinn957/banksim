# Management interface

The player sets a policy, watches it develop, and intervenes when a constraint needs attention. Monthly accounting remains the engine clock. Quarterly and annual views sum income flows and show actual closing stocks; partial periods are explicitly labelled.

## Implemented interaction

- Headquarters is a City of London bank viewport with customer, earnings and resilience information layers. Blue controls and light panels take their visual cue from city management games; the existing Threadneedle Street artwork anchors the location.
- Permanent time controls offer pause, one month, quarter end, year end and continuous auto, with two playback speeds. The quarter/year buttons stop at the next career-period boundary. Auto is a sequence of individual monthly steps, so pause remains available between steps.
- Policies persist. Equity, debt and swap orders clear after execution. Opening Departments, adopting a proposal, opening the tutorial or hiding the browser tab pauses time. Starting a fresh bank cancels playback.
- Safety interruption defaults on. It stops after a month that falls below an internal/combined capital target, breaches own funds, approaches leverage requirements or reaches LCR 110%/NSFR 105%. These are player attention thresholds, not additional prudential rules. Failure always stops playback, including with safety interruption off.
- Departments replaces the combined action form: Customers, Lending, Capital and Treasury. Only the selected department's fields are exposed. Standing instructions and one-off transactions are explained separately. All validation errors remain visible even if their field is in another department.
- Decision proposals disclose concrete benefits and trade-offs before adoption. The first-year challenges are optional records, with no forced ending after twelve months.
- Headquarters shows four measures, a signed period profit history and clickable explanations of funding, lending, earnings and capital. Detailed reporting, scenario tools and accounting reconciliations remain accessible from the reports menu.
- Expensive stress previews run only while reviewing Departments or the tutorial. They are not computed for every animation tick.

## Design references

[Factorio's GUI redesign](https://factorio.com/blog/post/fff-212) motivates separating routine schedules from occasional settings and making contextual help available. [Factorio's research and alert interface](https://www.factorio.com/blog/post/fff-423) motivates maintaining context when inspecting trends and warnings. [Dwarf Fortress development notes](https://www.bay12games.com/dwarves/) describe urgency ordering, tutorial and navigation improvements within a complex simulation. The application of those principles to banking is our design judgement, rather than a claim that those games prescribe this exact layout.

The pacing and SICR corrections, their evidence and their regulatory boundary are documented in [career-pacing.md](career-pacing.md).
