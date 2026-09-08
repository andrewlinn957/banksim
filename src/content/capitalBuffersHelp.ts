import { MechanicEntry } from './mechanicsRegistry';

export const capitalBuffersHelpEntry: MechanicEntry = {
  id: 'capital-buffer-framework',
  category: 'Capital',
  title: 'Capital conservation, CCyB and O-SII buffers',
  plainDescription:
    'Above Pillar 1 and Pillar 2A minima, BankSim holds a combined CET1 buffer made up of the 2.5% capital conservation buffer, the institution-specific countercyclical capital buffer and any O-SII buffer. The G-SIB buffer is deliberately outside the game.',
  whyItMatters:
    'The conservation buffer applies throughout the game. The CCyB depends on where relevant credit exposures are located. The O-SII buffer is a growth consequence: a bank can become domestically systemic as its deposit base and UK leverage exposure grow.',
  driverSummary: [
    'The capital conservation buffer is 2.5% of RWA and is met with CET1.',
    'The current UK CCyB rate is 2%. The institution-specific rate is a geographic weighted average of applicable CCyB rates; all currently modelled lending geographies are UK regions, so the sandbox rate is presently 2%.',
    'For the generic UK bank, more than £35bn of core deposits brings it into the O-SII scope proxy. The game distinguishes a low-trading large domestic bank from a ring-fenced-bank proxy, but does not model the full legal ring-fencing test.',
    'The O-SII rate is reset annually from the trailing four quarter-end UK leverage exposure measures. The UK LEM proxy excludes central-bank reserves and includes committed but undrawn credit facilities.',
    'For rates applying in 2026 the first positive O-SII bucket starts at £190bn average UK LEM. The published 2027 framework starts at £205bn; higher buckets rise to 3%. BankSim uses the 2027 published thresholds thereafter until the framework is updated in the game.',
    'A newly assessed O-SII rate applies to all RWA. BankSim applies it at the annual in-game review rather than reproducing the external PRA publication lag.',
  ],
  formula:
    'Combined buffer = capital conservation buffer + institution-specific CCyB + O-SII buffer\nInstitution-specific CCyB = Σ(jurisdiction share of relevant credit RWA × jurisdiction CCyB rate)\nO-SII rate = bucket(trailing four-quarter average UK leverage exposure)',
  relatedMetrics: ['CET1 requirement', 'Combined buffer', 'UK leverage exposure', 'RWA'],
  relatedActions: ['Grow customer deposits', 'Grow lending', 'Raise equity'],
};
