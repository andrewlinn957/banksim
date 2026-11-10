import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { eligibleCet1, ownFundsRequirements } from '../../engine/prudential';
import { eligibleTier2OwnFunds } from '../../products/regulatory';
import { formatCurrency, formatPct } from '../../utils/formatters';
import { buildCapitalBuffersPresentation, buildPillar2AAssessmentPresentation } from './capitalAssessments';

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

const formatPercentagePoints = (value: number) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}pp` : 'N/A';

const formatSignedMoney = (value: number) => `${value >= 0 ? '+' : '−'}${formatCurrency(Math.abs(value))}`;

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

  const internalTarget = metrics.internalCet1TargetRatio;
  const positionLevels = [
    { name: 'Total capital requirement', ratio: cards[2].requirement, tone: 'total' },
    { name: 'Tier 1 requirement', ratio: cards[1].requirement, tone: 'tier1' },
    ...(Number.isFinite(internalTarget) ? [{ name: 'Internal CET1 target', ratio: internalTarget, tone: 'target' as const }] : []),
    { name: 'CET1 requirement', ratio: cards[0].requirement, tone: 'cet1req' },
  ];
  const groupedPositionLevels: { ratio: number; names: string[]; tone: string }[] = [];
  positionLevels
    .sort((a, b) => b.ratio - a.ratio)
    .forEach((level) => {
      const existing = groupedPositionLevels.find((group) => Math.abs(group.ratio - level.ratio) < 1e-10);
      if (existing) existing.names.push(level.name);
      else groupedPositionLevels.push({ ratio: level.ratio, names: [level.name], tone: level.tone });
    });
  const cardScaleRaw = Math.max(
    0.2,
    (metrics.praBufferTarget ?? cards[0].requirement) * 1.1,
    Number.isFinite(internalTarget) ? internalTarget * 1.1 : 0,
    ...cards.map((card) => Number.isFinite(card.actual) ? Math.max(card.actual, card.requirement) * 1.1 : card.requirement * 1.1),
  );
  const cardScale = Math.ceil(cardScaleRaw / 0.05) * 0.05;
  const resources = [
    { name: 'CET1', amount: cet1, tone: 'cet1' },
    { name: 'AT1', amount: at1, tone: 'at1' },
    { name: 'Tier 2', amount: tier2, tone: 'tier2' },
  ];
  let resourceCumulative = 0;
  const positionedResources = resources.map((resource) => {
    const start = resourceCumulative;
    resourceCumulative += rwa > 0 ? resource.amount / rwa : 0;
    return { ...resource, start, end: resourceCumulative };
  });
  const positionMaxRaw = Math.max(
    0.2,
    ...positionedResources.flatMap((part) => [part.start, part.end]).map((value) => value * 1.12),
    ...positionLevels.map((level) => level.ratio * 1.12),
  );
  const positionMax = Math.ceil(positionMaxRaw / 0.05) * 0.05;
  const positionMinRaw = Math.min(0, ...positionedResources.flatMap((part) => [part.start, part.end]));
  const positionMin = positionMinRaw < 0 ? Math.floor(positionMinRaw / 0.05) * 0.05 : 0;
  const positionRange = Math.max(0.05, positionMax - positionMin);
  const display = {
    internalTarget: Number.isFinite(internalTarget) ? formatPct(internalTarget) : null,
    cards: cards.map((card) => {
      const gap = card.actual - card.requirement;
      const status = !Number.isFinite(card.actual)
        ? 'Unavailable'
        : card.actual < card.minimum
          ? 'Below minimum'
          : gap < -1e-10
            ? 'Buffer shortfall'
            : 'Meets requirement';
      return {
        name: card.name,
        status,
        actual: formatPct(card.actual),
        amount: formatCurrency(card.amount),
        requirement: formatPct(card.requirement),
        requiredAmount: formatCurrency(card.requiredAmount),
        gap: formatPercentagePoints(gap),
        gapAmount: formatSignedMoney(card.amount - card.requiredAmount),
        ariaLabel: `${card.name}: actual ${formatPct(card.actual)}, requirement ${formatPct(card.requirement)}, headroom ${formatPercentagePoints(gap)}`,
        axisLabels: [0, 1, 2, 3, 4].map((index) => formatPct(cardScale * index / 4, 0)),
      };
    }),
    capitalPosition: {
      totalCapitalRatio: formatPct(cards[2].actual),
      totalCapitalAmount: formatCurrency(cards[2].amount),
      rwa: formatCurrency(rwa),
      axisTitle: '% of RWA',
      axisTickLabels: Array.from({ length: 5 }, (_, index) => formatPct(positionMin + positionRange * index / 4, 0)),
      resources: positionedResources.map((resource) => ({
        name: resource.name,
        ratio: rwa > 0 ? formatPct(resource.amount / rwa) : 'N/A',
        amount: formatCurrency(resource.amount),
      })),
      levels: groupedPositionLevels.map((level) => ({
        names: level.names,
        ratio: formatPct(level.ratio),
        amount: formatCurrency(level.ratio * rwa),
      })),
      resourceLegend: positionedResources.map((resource) =>
        `${resource.name} ${formatCurrency(resource.amount)} (${rwa > 0 ? formatPct(resource.amount / rwa) : 'N/A'})`,
      ),
    },
    requirementComposition: requirementBars.map((bar) => ({
      name: bar.name,
      requirement: formatPct(bar.requirement),
      amount: formatCurrency(bar.requirement * rwa),
      segments: bar.segments.map((segment) => ({
        label: segment.label,
        ratio: formatPct(segment.ratio),
        amount: formatCurrency(segment.ratio * rwa),
        title: `${segment.label}: ${formatPct(segment.ratio)} · ${formatCurrency(segment.ratio * rwa)}`,
      })),
    })),
    payoutCap: formatPct(metrics.maxPayoutRatio),
  };

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
    positionLevels,
    groupedPositionLevels,
    positionedResources,
    cardScale,
    positionMin,
    positionRange,
    display,
    pillar2AAssessment: buildPillar2AAssessmentPresentation(state, config),
    capitalBuffers: buildCapitalBuffersPresentation(state, config),
  };
}
