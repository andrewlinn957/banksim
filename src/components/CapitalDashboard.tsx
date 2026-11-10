import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import Pillar2APanel from './Pillar2APanel';
import CapitalBuffersPanel from './CapitalBuffersPanel';
import { capitalDashboardData, type RequirementBar } from '../presentation/reports/capital';
export { capitalDashboardData } from '../presentation/reports/capital';








function RequirementComposition({
  bars,
  displayBars,
  payoutCap,
}: {
  bars: RequirementBar[];
  displayBars: ReturnType<typeof capitalDashboardData>['display']['requirementComposition'];
  payoutCap: string;
}) {
  const [unit, setUnit] = useState<'ratio' | 'amount'>('ratio');
  const scale = Math.max(...bars.map((bar) => bar.requirement), 0.01);

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
      {bars.map((bar, barIndex) => {
        const displayBar = displayBars[barIndex];
        return <div className="requirement-bar-block" key={bar.name}>
        <div className="requirement-bar-heading">
          <strong>{bar.name}</strong>
          <b>{displayBar.requirement} / {displayBar.amount}</b>
        </div>
        <div className="requirement-bar-track" aria-label={`${bar.name} ${displayBar.requirement}`}>
          {bar.segments.map((segment, segmentIndex) => {
            const displaySegment = displayBar.segments[segmentIndex];
            const width = Math.max(0, segment.ratio) / scale * 100;
            if (segment.ratio <= 1e-12) return null;
            return <span
              className={`requirement-segment requirement-segment-${segment.tone}`}
              style={{ width: `${width}%` }}
              title={displaySegment.title}
              key={segment.label}
            >
              {width >= 7 && <><b>{unit === 'ratio' ? displaySegment.ratio : displaySegment.amount}</b><small>{segment.label}</small></>}
            </span>;
          })}
        </div>
        <div className="requirement-segment-legend">
          {bar.segments.map((segment, segmentIndex) => <span key={segment.label}>
            <i className={`requirement-key requirement-key-${segment.tone}`} />
            {segment.label} <b>{unit === 'ratio' ? displayBar.segments[segmentIndex].ratio : displayBar.segments[segmentIndex].amount}</b>
          </span>)}
        </div>
      </div>;
      })}
    </div>

    <p className="capital-payout"><strong>Bank policy payout cap: {payoutCap}</strong><br />Maximum share of positive profit available for distributions under bank policy. This is not the PRA maximum distributable amount calculation.</p>
  </section>;
}

export default function CapitalDashboard({ state, config }: { state: BankState; config: SimulationConfig }) {
  const d = capitalDashboardData(state, config);
  const internalTarget = state.risk.riskMetrics.internalCet1TargetRatio;
  const cardScale = d.cardScale;
  const positionedResources = d.positionedResources;
  const positionLevels = d.positionLevels;
  const positionMin = d.positionMin;
  const positionRange = d.positionRange;
  const chartY = (ratio: number) => 330 - ((ratio - positionMin) / positionRange) * 285;
  const positionTicks = Array.from({ length: 5 }, (_, i) => positionMin + positionRange * i / 4);
  const groupedLevels = d.groupedPositionLevels;

  return <div className="capital-dashboard capital-dashboard-redesign">
    <div className="capital-cards capital-summary-cards">
      {d.cards.map((card, index) => {
        const display = d.display.cards[index];
        const gap = card.actual - card.requirement;
        const actualWidth = Number.isFinite(card.actual) ? Math.max(0, Math.min(100, card.actual / cardScale * 100)) : 0;
        const requirementLeft = Math.max(0, Math.min(100, card.requirement / cardScale * 100));
        const targetLeft = card.name === 'CET1' && Number.isFinite(internalTarget)
          ? Math.max(0, Math.min(100, internalTarget / cardScale * 100))
          : undefined;

        return <article className={`capital-card capital-summary-card ${gap < -1e-10 ? 'shortfall' : ''}`} key={card.name}>
          <header><h3>{card.name}</h3><span className="capital-status">{display.status}</span></header>
          <div className="capital-summary-metrics">
            <div className="capital-summary-actual"><strong>{display.actual}</strong><b>{display.amount}</b><span>Actual</span></div>
            <div><strong>{display.requirement}</strong><b>{display.requiredAmount}</b><span>Requirement</span></div>
            <div><strong className="capital-gap">{display.gap}</strong><b className="capital-gap">{display.gapAmount}</b><span>Headroom</span></div>
          </div>
          <div className="capital-bullet-html" role="img" aria-label={display.ariaLabel}>
            <div className="capital-bullet-track">
              <div className="capital-bullet-fill" style={{ width: `${actualWidth}%` }} />
              <i className="capital-bullet-requirement" style={{ left: `${requirementLeft}%` }} />
              {targetLeft !== undefined && <i className="capital-bullet-target" style={{ left: `${targetLeft}%` }} />}
            </div>
            <div className="capital-bullet-axis">{display.axisLabels.map((label) => <span key={label}>{label}</span>)}</div>
          </div>
          <div className="capital-bullet-key">
            <span><i className="capital-key-actual" />Actual {display.actual}</span>
            <span><i className="capital-key-requirement" />Requirement {display.requirement}</span>
            {targetLeft !== undefined && <span><i className="capital-key-target" />Internal target {d.display.internalTarget}</span>}
          </div>
        </article>;
      })}
    </div>

    <div className="capital-main-grid">
      <section className="capital-card capital-position-card">
        <header className="capital-section-heading">
          <div><h3>Capital position</h3><p className="muted">Composition of capital resources versus key requirements</p></div>
          <div className="capital-position-total"><span>Total capital ratio</span><strong>{d.display.capitalPosition.totalCapitalRatio} ({d.display.capitalPosition.totalCapitalAmount})</strong></div>
        </header>
        {d.rwa > 0 ? <svg className="capital-position-chart" viewBox="0 0 700 370" role="img" aria-label={`Capital position. CET1 ${d.display.cards[0].actual}, Tier 1 ${d.display.cards[1].actual}, total capital ${d.display.cards[2].actual}.`}>
          {positionTicks.map((tick, index) => <g key={tick}>
            <path d={`M62 ${chartY(tick)}H300`} className="capital-position-gridline" />
            <text x="50" y={chartY(tick) + 5} textAnchor="end">{d.display.capitalPosition.axisTickLabels[index]}</text>
          </g>)}
          {positionMin < 0 && <path d={`M62 ${chartY(0)}H300`} className="capital-position-zero" />}
          <text transform="translate(18 190) rotate(-90)" textAnchor="middle">{d.display.capitalPosition.axisTitle}</text>
          {positionedResources.filter((part) => part.amount !== 0).map((part) => {
            const display = d.display.capitalPosition.resources.find((resource) => resource.name === part.name)!;
            const top = Math.min(chartY(part.start), chartY(part.end));
            const height = Math.abs(chartY(part.end) - chartY(part.start));
            return <g key={part.name} data-capital-resource={part.name}>
              <rect x="115" y={top} width="150" height={height} className={`capital-resource capital-resource-${part.tone}`} />
              {height > 38 ? <text x="190" y={top + height / 2 - 8} textAnchor="middle" className="capital-resource-label">
                <tspan x="190">{part.name}</tspan>
                <tspan x="190" dy="20">{display.ratio}</tspan>
                <tspan x="190" dy="18">{display.amount}</tspan>
              </text> : height > 18 ? <text x="190" y={top + height / 2 + 4} textAnchor="middle" className="capital-resource-label capital-resource-label-compact">
                <tspan x="190">{part.name}</tspan>
              </text> : null}
            </g>;
          })}
          {groupedLevels.map((group, index) => {
            const display = d.display.capitalPosition.levels[index];
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
                <tspan x="402" dy="22" className="capital-level-value">{display.ratio} / {display.amount}</tspan>
              </text>
            </g>;
          })}
          <text x="190" y="360" textAnchor="middle" className="capital-rwa-label">RWA {d.display.capitalPosition.rwa}</text>
        </svg> : <p>Capital ratios are unavailable when RWA is zero.</p>}
        <div className="capital-resource-legend">
          {positionedResources.map((part, index) => <span key={part.name}><i className={`capital-resource-key capital-resource-key-${part.tone}`} />{d.display.capitalPosition.resourceLegend[index]}</span>)}
        </div>
      </section>

      <RequirementComposition bars={d.requirementBars} displayBars={d.display.requirementComposition} payoutCap={d.display.payoutCap} />
    </div>

    <CapitalBuffersPanel state={state} config={config} />
    <Pillar2APanel state={state} config={config} />
  </div>;
}
