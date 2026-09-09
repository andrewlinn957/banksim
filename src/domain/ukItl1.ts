export const UK_ITL1_REGIONS = [
  'northEast',
  'northWest',
  'yorkshireAndTheHumber',
  'eastMidlands',
  'westMidlands',
  'eastOfEngland',
  'london',
  'southEast',
  'southWest',
  'scotland',
  'wales',
  'northernIreland',
] as const;

export type UkItl1Region = typeof UK_ITL1_REGIONS[number];

export const UK_ITL1_LABELS: Record<UkItl1Region, string> = {
  northEast: 'North East (England)',
  northWest: 'North West (England)',
  yorkshireAndTheHumber: 'Yorkshire and The Humber',
  eastMidlands: 'East Midlands (England)',
  westMidlands: 'West Midlands (England)',
  eastOfEngland: 'East (England)',
  london: 'London',
  southEast: 'South East (England)',
  southWest: 'South West (England)',
  scotland: 'Scotland',
  wales: 'Wales',
  northernIreland: 'Northern Ireland',
};

export const isUkItl1Region = (value: string | undefined): value is UkItl1Region =>
  value !== undefined && (UK_ITL1_REGIONS as readonly string[]).includes(value);

/**
 * Converts pre-ITL1 BankSim geography buckets into a deterministic ITL1 region.
 * New cohorts are always created with an ITL1 value; this mapper keeps older
 * saved games usable without retaining the old buckets in new portfolio data.
 */
export const canonicalLoanGeography = (
  value: string | undefined,
  cohortId = 0
): UkItl1Region => {
  if (isUkItl1Region(value)) return value;
  const index = Math.abs(Math.floor(cohortId));
  if (value === 'south') return ['eastOfEngland', 'southEast', 'southWest'][index % 3] as UkItl1Region;
  if (value === 'midlands') return ['eastMidlands', 'westMidlands'][index % 2] as UkItl1Region;
  if (value === 'north') return ['northEast', 'northWest', 'yorkshireAndTheHumber'][index % 3] as UkItl1Region;
  if (value === 'other') return 'eastOfEngland';
  return UK_ITL1_REGIONS[index % UK_ITL1_REGIONS.length];
};
