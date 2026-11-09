import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { eligibleCet1, ownFundsRequirements } from '../../engine/prudential';
import { eligibleTier2OwnFunds } from '../../products/regulatory';

type RequirementSegment = {
  label: string;
  ratio: number;
  tone: 'p1' | 'p2a' | 'other' | 'ccob' | 'ccyb' | 'osii';
};

export type RequirementBar = {
  name: string;
  requirement: number;
  segments: RequirementSegment[];
};

export function capitalDashboardData(state: BankState, config: SimulationConfig) {
  const rwa = state.risk.riskMetrics.rwa;
  const cet1 = eligibleCet1(state, config);
  const at1 = state.financial.capital.at1;
  const tier2 = eligibleTier2OwnFunds(state);
  const minima = ownFundsRequirements(
    config.riskLimits,
    rwa,
    state.risk.riskMetrics.pillar2ARate ?? state.risk.pillar2A?.assessedRate ?? 0
  );
  const b = config.riskLimits.capitalBufferStack;
  const metrics = state.risk.riskMetrics;
  const conservationBuffer = metrics.capitalConservationBufferRate ?? b.conservationBuffer;
  const countercyclicalBuffer = metrics.countercyclicalBufferRate ?? b.countercyclicalBuffer;
  const osiiBuffer = metrics.osiiBufferRate ?? b.systemicBuffer;
  const buffer = metrics.combinedBufferRate ?? conservationBuffer + countercyclicalBuffer + osiiBuffer;
  const effectiveTier1Minimum = rwa > 0
    ? Math.max(minima.tier1, minima.total - tier2 / rwa)
    : Math.max(minima.tier1, minima.total);
  const substitution = rwa > 0
    ? Math.max(
        0,
        minima.tier1 - at1 / rwa - minima.cet1,
        minima.total - (at1 + tier2) / rwa - minima.cet1
      )
    : 0;

  const rows = [
    { label: 'Pillar 1 CET1', ratio: config.riskLimits.minCet1Ratio },
    { label: 'Pillar 2A CET1', ratio: minima.cet1 - config.riskLimits.minCet1Ratio },
    { label: 'CET1 covering other capital minima', ratio: substitution },
    { label: 'Capital conservation buffer', ratio: conservationBuffer },
    { label: 'Institution-specific countercyclical buffer', ratio: countercyclicalBuffer },
    { label: 'O-SII buffer', ratio: osiiBuffer },
  ];

  const cards = [
    { name: 'CET1', amount: cet1, minimum: minima.cet1, requirement: minima.cet1 + substitution + buffer },
    { name: 'Tier 1', amount: cet1 + at1, minimum: minima.tier1, requirement: effectiveTier1Minimum + buffer },
    { name: 'Total capital', amount: cet1 + at1 + tier2, minimum: minima.total, requirement: minima.total + buffer },
  ].map((card) => ({
    ...card,
    actual: rwa > 0 ? card.amount / rwa : NaN,
    requiredAmount: card.requirement * rwa,
  }));

  const tier1OtherMinimum = Math.max(0, effectiveTier1Minimum - minima.tier1);
  const requirementBars: RequirementBar[] = [
    {
      name: 'CET1 requirement',
      requirement: cards[0].requirement,
      segments: [
        { label: 'Pillar 1 CET1', ratio: config.riskLimits.minCet1Ratio, tone: 'p1' },
        { label: 'P2A CET1', ratio: Math.max(0, minima.cet1 - config.riskLimits.minCet1Ratio), tone: 'p2a' },
        { label: 'Other minima (CET1)', ratio: substitution, tone: 'other' },
        { label: 'CCoB', ratio: conservationBuffer, tone: 'ccob' },
        { label: 'CCyB', ratio: countercyclicalBuffer, tone: 'ccyb' },
        { label: 'O-SII', ratio: osiiBuffer, tone: 'osii' },
      ],
    },
    {
      name: 'Tier 1 requirement',
      requirement: cards[1].requirement,
      segments: [
        { label: 'Pillar 1 Tier 1', ratio: config.riskLimits.minTier1Ratio, tone: 'p1' },
        { label: 'P2A Tier 1', ratio: Math.max(0, minima.tier1 - config.riskLimits.minTier1Ratio), tone: 'p2a' },
        { label: 'Other minima (Tier 1)', ratio: tier1OtherMinimum, tone: 'other' },
        { label: 'CCoB', ratio: conservationBuffer, tone: 'ccob' },
        { label: 'CCyB', ratio: countercyclicalBuffer, tone: 'ccyb' },
        { label: 'O-SII', ratio: osiiBuffer, tone: 'osii' },
      ],
    },
    {
      name: 'Total capital requirement',
      requirement: cards[2].requirement,
      segments: [
        { label: 'Pillar 1 total', ratio: config.riskLimits.minTotalCapitalRatio, tone: 'p1' },
        { label: 'P2A total', ratio: Math.max(0, minima.total - config.riskLimits.minTotalCapitalRatio), tone: 'p2a' },
        { label: 'CCoB', ratio: conservationBuffer, tone: 'ccob' },
        { label: 'CCyB', ratio: countercyclicalBuffer, tone: 'ccyb' },
        { label: 'O-SII', ratio: osiiBuffer, tone: 'osii' },
      ],
    },
  ];

  return {
    rwa,
    cet1,
    at1,
    tier2,
    minima,
    rows,
    buffer,
    conservationBuffer,
    countercyclicalBuffer,
    osiiBuffer,
    requirementBars,
    cards,
  };
}
