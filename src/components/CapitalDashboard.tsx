import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { eligibleCet1, ownFundsRequirements } from '../engine/prudential';
import { formatCurrency, formatPct } from '../utils/formatters';

export function capitalDashboardData(state: BankState, config: SimulationConfig) {
  const rwa = state.risk.riskMetrics.rwa;
  const cet1 = eligibleCet1(state, config), at1 = state.financial.capital.at1;
  const minima = ownFundsRequirements(config.riskLimits, rwa);
  const b = config.riskLimits.capitalBufferStack;
  const buffer = b.conservationBuffer + b.countercyclicalBuffer + b.systemicBuffer;
  const substitution = rwa > 0 ? Math.max(0, minima.tier1 - at1 / rwa - minima.cet1, minima.total - at1 / rwa - minima.cet1) : 0;
  const rows = [
    { label: 'Pillar 1 CET1', ratio: config.riskLimits.minCet1Ratio },
    { label: 'Pillar 2A CET1', ratio: minima.cet1 - config.riskLimits.minCet1Ratio },
    { label: 'CET1 covering other capital minima', ratio: substitution },
    { label: 'Capital conservation buffer', ratio: b.conservationBuffer },
    { label: 'Countercyclical buffer', ratio: b.countercyclicalBuffer },
    { label: 'Systemic buffer', ratio: b.systemicBuffer },
  ];
  return { rwa, cet1, at1, rows, cards: [
    { name: 'CET1', amount: cet1, minimum: minima.cet1, requirement: minima.cet1 + substitution + buffer },
    { name: 'Tier 1', amount: cet1 + at1, minimum: minima.tier1, requirement: Math.max(minima.tier1, minima.total) + buffer },
    { name: 'Total capital', amount: cet1 + at1, minimum: minima.total, requirement: minima.total + buffer },
  ].map(c => ({ ...c, actual: rwa > 0 ? c.amount / rwa : NaN, requiredAmount: c.requirement * rwa })) };
}

const pp = (v: number) => Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}pp` : 'N/A';
const signedMoney = (v: number) => `${v >= 0 ? '+' : '−'}${formatCurrency(Math.abs(v))}`;

export default function CapitalDashboard({ state, config }: { state: BankState; config: SimulationConfig }) {
  const d = capitalDashboardData(state, config);
  const targets = [
    { name: 'PRA CET1 target', ratio: state.risk.riskMetrics.praBufferTarget ?? d.cards[0].requirement, color: '#a66809', dash: '8 4' },
    { name: 'Internal CET1 target', ratio: state.risk.riskMetrics.internalCet1TargetRatio, color: '#b24b92', dash: '2 4' },
  ].filter(t => Number.isFinite(t.ratio));
  const levels = [
    ...d.cards.map(c => ({name: `${c.name} requirement`, ratio: c.requirement, color: '#285478', dash: '6 4'})),
    ...targets,
  ].sort((a,b)=>b.ratio-a.ratio);
  const groups: { ratio:number; names:string[]; color:string; dash:string }[] = [];
  for(const level of levels) {
    const same = groups.find(g=>Math.abs(g.ratio-level.ratio)<1e-10);
    if(same) same.names.push(level.name);
    else groups.push({...level,names:[level.name]});
  }
  const maximum = Math.max(.2, ...levels.map(t=>t.ratio*1.2), ...d.cards.map(c => Number.isFinite(c.actual) ? Math.max(c.actual, c.requirement) * 1.2 : c.requirement * 1.2));
  const max = Math.ceil(maximum / .05) * .05;
  const min = Math.min(0, Number.isFinite(d.cards[0].actual) ? Math.floor(d.cards[0].actual / .05) * .05 : 0);
  const y = (r: number) => 410 - (r - min) / (max - min) * 370;
  const ticks = Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
  const segments = [{ name: 'CET1', amount: d.cet1, color: '#15578d' }, { name: 'AT1', amount: d.at1, color: '#159de0' }, { name: 'Tier 2', amount: 0, color: '#8261c7' }];
  let cumulative = 0;
  return <div className="capital-dashboard">
    <div className="capital-cards">{d.cards.map(c => {
      const gap = c.actual - c.requirement;
      const status = !Number.isFinite(c.actual) ? 'Unavailable' : c.actual < c.minimum ? 'Below minimum' : gap < -1e-10 ? 'Buffer shortfall' : 'Meets requirement';
      return <article className={`capital-card ${gap < -1e-10 ? 'shortfall' : ''}`} key={c.name}>
        <header><h3>{c.name}</h3><span className="capital-status">{status}</span></header>
        <div className="capital-ratios"><div><strong>{formatPct(c.actual)}</strong><span>Actual</span></div><div><span>Requirement</span><b>{formatPct(c.requirement)}</b></div><div><span>Headroom</span><b className="capital-gap">{pp(gap)}</b></div></div>
        <svg className="capital-bullet" viewBox="0 0 400 58" role="img" aria-label={`${c.name}: actual ${formatPct(c.actual)}, requirement ${formatPct(c.requirement)}, headroom ${pp(gap)}`}>
          <rect x="8" y="10" width="384" height="18" rx="5" fill="var(--border)"/>
          <rect x="8" y="10" width={Number.isFinite(c.actual) ? Math.max(0,c.actual)/max*384 : 0} height="18" rx="5" fill="currentColor"/>
          <path d={`M${8+c.requirement/max*384} 5v28`} stroke="var(--text)" strokeWidth="3"/>
          {c.name==='CET1'&&targets.map((t,i)=>{const x=8+t.ratio/max*384;return <g key={t.name}><title>{t.name}: {formatPct(t.ratio)}</title><path d={`M${x} 10v18`} stroke={t.color} strokeWidth="2" strokeDasharray={t.dash}/><path d={i===0?`M${x-5} 1h10l-5 8z`:`M${x-5} 36h10l-5 -8z`} fill={t.color}/></g>;})}
          {[0,1,2,3,4].map(i=><text key={i} x={8+i*96} y="51" textAnchor={i===0?'start':i===4?'end':'middle'}>{formatPct(max*i/4,0)}</text>)}
        </svg>
        {c.name==='CET1'&&<div className="capital-target-key">{targets.map((t,i)=><span key={t.name}><b style={{color:t.color}}>{i===0?'▼':'▲'}</b> {t.name} <strong>{formatPct(t.ratio)}</strong></span>)}</div>}
        <div className="capital-amounts"><div><b>{formatCurrency(c.amount)}</b><span>actual</span></div><div><b>{formatCurrency(c.requiredAmount)}</b><span>required</span></div><div><b className="capital-gap">{signedMoney(c.amount-c.requiredAmount)}</b><span>headroom</span></div></div>
      </article>;
    })}</div>
    <div className="capital-detail-grid">
      <section className="capital-card"><h3>Capital composition</h3>
        <p className="capital-total">Total capital held <strong>{formatCurrency(d.cet1+d.at1)} ({formatPct(d.cards[2].actual)})</strong></p>
        {d.rwa > 0 ? <svg className="capital-composition" viewBox="0 0 740 460" role="img" aria-label={`Capital composition: CET1 ${formatCurrency(d.cet1)}, AT1 ${formatCurrency(d.at1)}, no Tier 2 issued. RWA ${formatCurrency(d.rwa)}. ${levels.map(l=>`${l.name} ${formatPct(l.ratio)}`).join('. ')}`}>
          {ticks.map(t=><g key={t}><path d={`M65 ${y(t)}H355`} stroke="var(--border)"/><text x="55" y={y(t)+5} textAnchor="end">{formatPct(t,0)}</text></g>)}
          <text transform="translate(18 180) rotate(-90)" textAnchor="middle">% of RWA</text>
          {segments.filter(s=>s.amount!==0).map(s=>{ const start=cumulative; cumulative+=s.amount/d.rwa; const top=y(Math.max(start,cumulative)), bottom=y(Math.min(start,cumulative)); return <g key={s.name}><rect x="110" y={top} width="190" height={Math.max(0,bottom-top)} fill={s.color}/>{bottom-top>35&&<text x="205" y={(top+bottom)/2} textAnchor="middle" className="stack-label">{s.name}<tspan x="205" dy="20">{formatCurrency(s.amount)}</tspan></text>}</g>; })}
          {groups.map((g,i)=>{const labelY=65+groups.slice(0,i).reduce((sum,p)=>sum+34+p.names.length*22,0);return <g key={g.ratio}><path d={`M300 ${y(g.ratio)}H330L385 ${labelY}H400`} fill="none" stroke={g.color} strokeWidth="1.7" strokeDasharray={g.dash}/><circle cx="330" cy={y(g.ratio)} r="3" fill={g.color}/><text x="414" y={labelY-4}>{g.names.map((name,j)=><tspan key={name} x="414" dy={j===0?0:22}>{name}</tspan>)}<tspan x="414" dy="24" fontWeight="700">{formatPct(g.ratio)} · {formatCurrency(g.ratio*d.rwa)}</tspan></text></g>;})}
          <text x="205" y="447" textAnchor="middle" fontWeight="700">RWA {formatCurrency(d.rwa)}</text>
        </svg> : <p>Capital ratios are unavailable when RWA is zero.</p>}
        <ul className="capital-legend">{segments.map(s=><li key={s.name}><i style={{background:s.color}}/>{s.name} · {formatCurrency(s.amount)}{s.name==='Tier 2'?' · none issued':''}</li>)}</ul>
      </section>
      <section className="capital-card"><h3>Requirement breakdown</h3><div className="table-scroll"><table><thead><tr><th>CET1 requirement</th><th>% of RWA</th><th>Amount</th></tr></thead><tbody>{d.rows.map(r=><tr key={r.label}><td>{r.label}</td><td>{formatPct(r.ratio)}</td><td>{formatCurrency(r.ratio*d.rwa)}</td></tr>)}<tr className="total-row"><th>Total CET1 requirement</th><td>{formatPct(d.cards[0].requirement)}</td><td>{formatCurrency(d.cards[0].requiredAmount)}</td></tr></tbody></table></div>
        <div className="table-scroll"><table><tbody>{d.cards.slice(1).map(c=><tr key={c.name}><th>{c.name} requirement</th><td>{formatPct(c.requirement)}</td><td>{formatCurrency(c.requiredAmount)}</td></tr>)}</tbody></table></div>
        <p className="muted">Requirements include combined buffers. CET1 used to cover other capital minima is shown explicitly; Tier 1 also covers the total capital minimum while no Tier 2 is issued.</p>
      </section>
    </div>
  </div>;
}
