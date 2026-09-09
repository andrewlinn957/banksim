import { describe, expect, it } from 'vitest';
import { initialState } from '../config/initialState';
import { canonicalLoanGeography, isUkItl1Region, UK_ITL1_REGIONS } from '../domain/ukItl1';

describe('ITL1 loan geographies', () => {
  it('uses exactly the 12 UK ITL1 regions', () => {
    expect(UK_ITL1_REGIONS).toHaveLength(12);
    expect(new Set(UK_ITL1_REGIONS).size).toBe(12);
  });

  it('seeds every opening loan cohort into a canonical ITL1 region', () => {
    const cohorts = Object.values(initialState.loanCohorts ?? {}).flatMap(value => value ?? []);
    expect(cohorts.length).toBeGreaterThan(0);
    expect(cohorts.every(cohort => isUkItl1Region(cohort.geography))).toBe(true);
    expect(new Set(cohorts.map(cohort => cohort.geography)).size).toBeGreaterThan(1);
  });

  it('maps legacy broad buckets deterministically into ITL1 regions', () => {
    expect(canonicalLoanGeography('south', 0)).toBe('eastOfEngland');
    expect(canonicalLoanGeography('south', 1)).toBe('southEast');
    expect(canonicalLoanGeography('midlands', 1)).toBe('westMidlands');
    expect(canonicalLoanGeography('north', 2)).toBe('yorkshireAndTheHumber');
    expect(canonicalLoanGeography('other', 99)).toBe('eastOfEngland');
  });
});
