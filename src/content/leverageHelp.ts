import { MechanicEntry } from './mechanicsRegistry';

export const leverageHelpEntry: MechanicEntry = {
  id: 'uk-leverage-framework',
  category: 'Capital',
  title: 'UK leverage ratio framework',
  plainDescription:
    'BankSim applies the PRA 3.25% leverage expectation below the UK leverage-framework scope thresholds and the binding minimum once the bank is in scope.',
  whyItMatters:
    'Growth can turn leverage from a supervisory expectation into a binding capital constraint even when risk-weighted capital ratios remain strong.',
  driverSummary: [
    'Scope is tested from the average of the three most recent annual accounting-reference-date observations: £75bn retail deposits or £10bn non-UK assets.',
    'Below scope, 3.25% is an expectation rather than a hard game-ending requirement.',
    'In scope, the 3.25% minimum is binding and 75% of the minimum must be met with CET1.',
    'The CCLB is 35% of the institution-specific CCyB, rounded to the nearest 10bp. The ALRB is 35% of the O-SII buffer in BankSim.',
    'CCLB and ALRB are met with CET1. A leverage-buffer shortfall is tracked separately and does not trigger the risk-weighted MDA mechanism.',
  ],
  formula:
    'In-scope Tier 1 stack = 3.25% + CCLB + ALRB\nIn-scope CET1 stack = 75% × 3.25% + CCLB + ALRB',
  thresholds: [
    { label: 'Base leverage rate', value: '3.25%' },
    { label: 'Retail-deposit scope threshold', value: '£75bn (3-date average)' },
    { label: 'Non-UK-assets scope threshold', value: '£10bn (3-date average)' },
  ],
  relatedMetrics: ['Leverage ratio', 'Leverage exposure', 'CCLB', 'ALRB'],
};
