import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { eligibleCet1, ownFundsRequirements } from '../engine/prudential';
import { eligibleTier2OwnFunds } from '../products/regulatory';
import { formatCurrency, formatPct } from '../utils/formatters';
import Pillar2APanel from './Pillar2APanel';
import CapitalBuffersPanel from './CapitalBuffersPanel';

type RequirementSegment = {
  label: string;
  ratio: number;
  tone: 'p1' | 'p2a' | 'other' | 'ccob' | 'ccyb' | 'osii';
};

type RequirementBar = {
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

const pp = (value: number) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}pp` : 'N/A';
const signedMoney = (value: number) => `${value >= 0 ? '+' : '−'}${formatCurrency(Math.abs(value))}`;

function RequirementComposition({
  bars,
  rwa,
  payoutRatio,
}: {
  bars: RequirementBar[];
  rwa: number;
  payoutRatio: number;
}) {
  const [unit, setUnit] = useState<'ratio' | 'amount'>('ratio');
  const scale = Math.max(...bars.map((bar) => bar.requirement), 0.01);
  const labelFor = (ratio: number) => (unit === 'ratio' ? formatPct(ratio) : formatCurrency(ratio * rwa));

  return <section className="capital-card capital-requirements-card">
    <header className="capital-section-heading">
      <div>
        <h3>Requirement composition</h3>
        <p className="muted">Breakdown of regulatory capital requirements</p>
      </div>
      <div className="capital-unit-toggle" role="group" aria-label="Requirement display units">
        <button type="button" className={unit === 'ratio' ? 'active' : ''} onClick={() => setUnit('ratio')}>% of RWA</button>
        <button type="button" className={unit === 'amount' ? 'active' : ''} onClick={() => setUnit('amount')}>£ Amount</button>
      </div>
    </header>

    <div className="requirement-bars">
      {bars.map((bar) => <div className="requirement-bar-block" key={bar.name}>
        <div className="requirement-bar-heading">
          <strong>{bar.name}</strong>
          <b>{formatPct(bar.requirement)} / {formatCurrency(bar.requirement * rwa)}</b>
        </div>
        <div className="requirement-bar-track" aria-label={`${bar.name} ${formatPct(bar.requirement)}`}>
          {bar.segments.map((segment) => {
            const width = Math.max(0, segment.ratio) / scale * 100;
            if (segment.ratio <= 1e-12) return null;
            return <span
              className={`requirement-segment requirement-segment-${segment.tone}`}
              style={{ width: `${width}%` }}
              title={`${segment.label}: ${formatPct(segment.ratio)} · ${formatCurrency(segment.ratio * rwa)}`}
              key={segment.label}
            >
              {width >= 7 && <><b>{labelFor(segment.ratio)}</b><small>{segment.label}</small></>}
            </span>;
          })}
        </div>
        <div className="requirement-segment-legend">
          {bar.segments.map((segment) => <span key={segment.label}>
            <i className={`requirement-key requirement-key-${segment.tone}`} />
            {segment.label} <b>{labelFor(segment.ratio)}</b>
          </span>)}
        </div>
      </div>)}
    </div>

    <p className="capital-payout"><strong>Bank policy payout cap: {formatPct(payoutRatio)}</strong><br />Maximum share of positive profit available for distributions under bank policy. This is not the PRA maximum distributable amount calculation.</p>
  </section>;
}

export default function CapitalDashboard({ state, config }: { state: BankState; config: SimulationConfig }) {
  const d = capitalDashboardData(state, config);
  const internalTarget = state.risk.riskMetrics.internalCet1TargetRatio;
  const praTarget = state.risk.riskMetrics.praBufferTarget ?? d.cards[0].requirement;
  const cardScaleRaw = Math.max(
    0.2,
    praTarget * 1.1,
    Number.isFinite(internalTarget) ? internalTarget * 1.1 : 0,
    ...d.cards.map((card) => Number.isFinite(card.actual) ? Math.max(card.actual, card.requirement) * 1.1 : card.requirement * 1.1)
  );
  const cardScale = Math.ceil(cardScaleRaw / 0.05) * 0.05;

  const resourceParts = [
    { name: 'CET1', amount: d.cet1, tone: 'cet1' },
    { name: 'AT1', amount: d.at1, tone: 'at1' },
    { name: 'Tier 2', amount: d.tier2, tone: 'tier2' },
  ];
  let resourceCumulative = 0;
  const positionedResources = resourceParts.map((part) => {
    const start = resourceCumulative;
    resourceCumulative += d.rwa > 0 ? part.amount / d.rwa : 0;
    return { ...part, start, end: resourceCumulative };
  });

  const positionLevels = [
    { name: 'Total capital requirement', ratio: d.cards[2].requirement, tone: 'total' },
    { name: 'Tier 1 requirement', ratio: d.cards[1].requirement, tone: 'tier1' },
    ...(Number.isFinite(internalTarget) ? [{ name: 'Internal CET1 target', ratio: internalTarget, tone: 'target' as const }] : []),
    { name: 'CET1 requirement', ratio: d.cards[0].requirement, tone: 'cet1req' },
  ];
  const positionMaxRaw = Math.max(
    0.2,
    ...positionedResources.flatMap((part) => [part.start, part.end]).map((value) => value * 1.12),
    ...positionLevels.map((level) => level.ratio * 1.12)
  );
  const positionMax = Math.ceil(positionMaxRaw / 0.05) * 0.05;
  const positionMinRaw = Math.min(0, ...positionedResources.flatMap((part) => [part.start, part.end]));
  const positionMin = positionMinRaw < 0 ? Math.floor(positionMinRaw / 0.05) * 0.05 : 0;
  const positionRange = Math.max(0.05, positionMax - positionMin);
  const chartY = (ratio: number) => 330 - ((ratio - positionMin) / positionRange) * 285;
  const positionTicks = Array.from({ length: 5 }, (_, i) => positionMin + positionRange * i / 4);

  const groupedLevels: { ratio: number; names: string[]; tone: string }[] = [];
  positionLevels
    .sort((a, b) => b.ratio - a.ratio)
    .forEach((level) => {
      const existing = groupedLevels.find((group) => Math.abs(group.ratio - level.ratio) < 1e-10);
      if (existing) existing.names.push(level.name);
      else groupedLevels.push({ ratio: level.ratio, names: [level.name], tone: level.tone });
    });

  return <div className="capital-dashboard capital-dashboard-redesign">
    <div className="capital-cards capital-summary-cards">
      {d.cards.map((card) => {
        const gap = card.actual - card.requirement;
        const status = !Number.isFinite(card.actual)
          ? 'Unavailable'
          : card.actual < card.minimum
            ? 'Below minimum'
            : gap < -1e-10
              ? 'Buffer shortfall'
              : 'Meets requirement';
        const actualWidth = Number.isFinite(card.actual) ? Math.max(0, Math.min(100, card.actual / cardScale * 100)) : 0;
        const requirementLeft = Math.max(0, Math.min(100, card.requirement / cardScale * 100));
        const targetLeft = card.name === 'CET1' && Number.isFinite(internalTarget)
          ? Math.max(0, Math.min(100, internalTarget / cardScale * 100))
          : undefined;

        return <article className={`capital-card capital-summary-card ${gap < -1e-10 ? 'shortfall' : ''}`} key={card.name}>
          <header><h3>{card.name}</h3><span className="capital-status">{status}</span></header>
          <div className="capital-summary-metrics">
            <div className="capital-summary-actual"><strong>{formatPct(card.actual)}</strong><b>{formatCurrency(card.amount)}</b><span>Actual</span></div>
            <div><strong>{formatPct(card.requirement)}</strong><b>{formatCurrency(card.requiredAmount)}</b><span>Requirement</span></div>
            <div><strong className="capital-gap">{pp(gap)}</strong><b className="capital-gap">{signedMoney(card.amount - card.requiredAmount)}</b><span>Headroom</span></div>
          </div>
          <div className="capital-bullet-html" role="img" aria-label={`${card.name}: actual ${formatPct(card.actual)}, requirement ${formatPct(card.requirement)}, headroom ${pp(gap)}`}>
            <div className="capital-bullet-track">
              <div className="capital-bullet-fill" style={{ width: `${actualWidth}%` }} />
              <i className="capital-bullet-requirement" style={{ left: `${requirementLeft}%` }} />
              {targetLeft !== undefined && <i className="capital-bullet-target" style={{ left: `${targetLeft}%` }} />}
            </div>
            <div className="capital-bullet-axis">{[0, 1, 2, 3, 4].map((i) => <span key={i}>{formatPct(cardScale * i / 4, 0)}</span>)}</div>
          </div>
          <div className="capital-bullet-key">
            <span><i className="capital-key-actual" />Actual {formatPct(card.actual)}</span>
            <span><i className="capital-key-requirement" />Requirement {formatPct(card.requirement)}</span>
            {targetLeft !== undefined && <span><i className="capital-key-target" />Internal target {formatPct(internalTarget)}</span>}
          </div>
        </article>;
      })}
    </div>

    <div className="capital-main-grid">
      <section className="capital-card capital-position-card">
        <header className="capital-section-heading">
          <div><h3>Capital position</h3><p className="muted">Composition of capital resources versus key requirements</p></div>
          <div className="capital-position-total"><span>Total capital ratio</span><strong>{formatPct(d.cards[2].actual)} ({formatCurrency(d.cards[2].amount)})</strong></div>
        </header>
        {d.rwa > 0 ? <svg className="capital-position-chart" viewBox="0 0 700 370" role="img" aria-label={`Capital position. CET1 ${formatPct(d.cards[0].actual)}, Tier 1 ${formatPct(d.cards[1].actual)}, total capital ${formatPct(d.cards[2].actual)}.`}>
          {positionTicks.map((tick) => <g key={tick}>
            <path d={`M62 ${chartY(tick)}H300`} className="capital-position-gridline" />
            <text x="50" y={chartY(tick) + 5} textAnchor="end">{formatPct(tick, 0)}</text>
          </g>)}
          {positionMin < 0 && <path d={`M62 ${chartY(0)}H300`} className="capital-position-zero" />}
          <text transform="translate(18 190) rotate(-90)" textAnchor="middle">% of RWA</text>
          {positionedResources.filter((part) => part.amount !== 0).map((part) => {
            const top = Math.min(chartY(part.start), chartY(part.end));
            const height = Math.abs(chartY(part.end) - chartY(part.start));
            return <g key={part.name} data-capital-resource={part.name}>
              <rect x="115" y={top} width="150" height={height} className={`capital-resource capital-resource-${part.tone}`} />
              {height > 38 ? <text x="190" y={top + height / 2 - 8} textAnchor="middle" className="capital-resource-label">
                <tspan x="190">{part.name}</tspan>
                <tspan x="190" dy="20">{formatPct(part.amount / d.rwa)}</tspan>
                <tspan x="190" dy="18">{formatCurrency(part.amount)}</tspan>
              </text> : height > 18 ? <text x="190" y={top + height / 2 + 4} textAnchor="middle" className="capital-resource-label capital-resource-label-compact">
                <tspan x="190">{part.name}</tspan>
              </text> : null}
            </g>;
          })}
          {groupedLevels.map((group, index) => {
            const sourceY = chartY(group.ratio);
            const labelY = 70 + index * 70;
            return <g key={`${group.ratio}-${group.names.join('-')}`} className={`capital-level capital-level-${group.tone}`}>
              <path
                d={`M265 ${sourceY}H315L365 ${labelY}H390`}
                data-capital-level-leader={group.names.join(' / ')}
                style={{ fill: 'none' }}
              />
              <circle cx="315" cy={sourceY} r="3" />
              <text x="402" y={labelY - 5}>
                {group.names.map((name, i) => <tspan key={name} x="402" dy={i === 0 ? 0 : 18}>{name}</tspan>)}
                <tspan x="402" dy="22" className="capital-level-value">{formatPct(group.ratio)} / {formatCurrency(group.ratio * d.rwa)}</tspan>
              </text>
            </g>;
          })}
          <text x="190" y="360" textAnchor="middle" className="capital-rwa-label">RWA {formatCurrency(d.rwa)}</text>
        </svg> : <p>Capital ratios are unavailable when RWA is zero.</p>}
        <div className="capital-resource-legend">
          {resourceParts.map((part) => <span key={part.name}><i className={`capital-resource-key capital-resource-key-${part.tone}`} />{part.name} {formatCurrency(part.amount)} ({d.rwa > 0 ? formatPct(part.amount / d.rwa) : 'N/A'})</span>)}
        </div>
      </section>

      <RequirementComposition bars={d.requirementBars} rwa={d.rwa} payoutRatio={state.risk.riskMetrics.maxPayoutRatio} />
    </div>

    <CapitalBuffersPanel state={state} config={config} />
    <Pillar2APanel state={state} config={config} />
  </div>;
}
