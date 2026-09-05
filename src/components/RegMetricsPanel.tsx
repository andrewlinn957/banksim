import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide, HQLALevel } from '../domain/enums';
import { AttributionLineSelection, StepAttribution } from '../domain/attribution';
import { computeHqla, HQLA_FACTORS } from '../engine/metrics';
import { centralBankExclusion, committedExposure, commitmentLiquidity, eligibleCet1, prudentialLiquidityLines } from '../engine/prudential';
import { formatCurrency, formatPct } from '../utils/formatters';
import TimeSeriesChart from './TimeSeriesChart';

type Metric = 'capital' | 'rwa' | 'leverage' | 'lcr' | 'nsfr';
interface Props { state: BankState; history: BankState[]; config: SimulationConfig; attribution?: StepAttribution | null; onAttributionLineSelect?: (s: AttributionLineSelection) => void; onNavigateHelp?: (id: string) => void; }
interface Row { label: string; value: number; factor?: number; ratio?: boolean; total?: boolean; }

export const regulatoryRows = (s: BankState, c: SimulationConfig, metric: Metric): Row[] => {
  const m = s.risk.riskMetrics, assets = s.financial.balanceSheet.items.filter(i => i.side === BalanceSheetSide.Asset);
  const lines = prudentialLiquidityLines(s, c), undrawn = commitmentLiquidity(s);
  if (metric === 'capital') return [
    { label: 'CET1 including eligible OCI', value: eligibleCet1(s, c) }, { label: 'AT1', value: s.financial.capital.at1 },
    { label: 'CET1 ratio', value: m.cet1Ratio, ratio: true }, { label: 'Tier 1 ratio', value: m.tier1Ratio ?? 0, ratio: true },
    { label: 'Total capital ratio (no Tier 2 issued)', value: m.totalCapitalRatio ?? 0, ratio: true },
    { label: 'CET1 needed for own-funds minima and combined buffers', value: m.cet1Requirement, ratio: true },
    { label: 'Internal CET1 target', value: m.internalCet1TargetRatio, ratio: true },
    { label: 'Bank policy payout cap', value: m.maxPayoutRatio, ratio: true },
  ];
  if (metric === 'rwa') {
    const rows: Row[] = assets.map(i => ({ label: i.label, value: i.balance * (c.productParameters[i.productType]?.riskWeight ?? 0), factor: c.productParameters[i.productType]?.riskWeight ?? 0 }));
    rows.push({ label: 'Undrawn commitments and configured risk add-ons', value: m.rwa - rows.reduce((sum, r) => sum + r.value, 0) });
    return [...rows, { label: 'Total risk-weighted assets', value: m.rwa, total: true }];
  }
  if (metric === 'leverage') return [
    ...assets.map(i => ({ label: i.label, value: i.balance })),
    { label: 'Eligible central bank reserves exclusion', value: -centralBankExclusion(s) },
    { label: 'Undrawn commitments × 20% CCF', value: committedExposure(s) * .2, factor: .2 },
    { label: 'Total exposure measure', value: m.leverageExposure, total: true },
    { label: 'Eligible Tier 1 capital', value: eligibleCet1(s, c) + s.financial.capital.at1 },
    { label: 'Leverage ratio', value: m.leverageRatio, ratio: true, total: true },
  ];
  if (metric === 'nsfr') return [
    { label: 'ASF · eligible capital', value: eligibleCet1(s, c) + s.financial.capital.at1, factor: 1 },
    ...lines.filter(l => !l.asset).map(l => ({ label: `ASF · ${l.label}`, value: l.asf, factor: l.balance > 0 ? l.asf / l.balance : 0 })),
    { label: 'Total available stable funding', value: m.asf, total: true },
    ...lines.filter(l => l.asset).map(l => ({ label: `RSF · ${l.label}`, value: l.rsf, factor: l.balance > 0 ? l.rsf / l.balance : 0 })),
    { label: 'RSF · undrawn commitments', value: undrawn.rsf, factor: .05 },
    { label: 'Total required stable funding', value: m.rsf, total: true },
    { label: 'NSFR', value: m.nsfr, ratio: true, total: true },
  ];
  const hqlaRows = assets.filter(i => i.liquidityTag?.hqlaLevel !== HQLALevel.None).map(i => ({ label: `HQLA · ${i.label}`, value: Math.max(0, i.balance - Math.max(0, i.encumbrance?.encumberedAmount ?? 0)) * (HQLA_FACTORS[i.liquidityTag?.hqlaLevel] ?? 0), factor: HQLA_FACTORS[i.liquidityTag?.hqlaLevel] ?? 0 }));
  const out = lines.reduce((sum, l) => sum + l.outflow, undrawn.outflow), incoming = lines.reduce((sum, l) => sum + l.inflow, 0);
  return [
    ...hqlaRows, { label: 'HQLA composition cap adjustment', value: computeHqla(assets) - hqlaRows.reduce((sum, r) => sum + r.value, 0) },
    { label: 'Total HQLA', value: m.hqla, total: true },
    ...lines.filter(l => !l.asset).map(l => ({ label: `Outflow · ${l.label}`, value: l.outflow, factor: l.balance > 0 ? l.outflow / l.balance : 0 })),
    { label: 'Outflow · undrawn commitments', value: undrawn.outflow },
    { label: 'Total outflows', value: out, total: true },
    ...lines.filter(l => l.inflow > 0).map(l => ({ label: `Inflow · ${l.label}`, value: l.inflow })),
    { label: 'Eligible inflows after 75% cap', value: Math.min(incoming, out * .75), total: true },
    { label: 'Net outflows', value: out - Math.min(incoming, out * .75), total: true },
    { label: 'LCR', value: m.lcr, ratio: true, total: true },
  ];
};

export default function RegMetricsPanel({ state, history, config, onNavigateHelp }: Props) {
  const [metric, setMetric] = useState<Metric>('capital');
  const labels: Record<Metric, string> = { capital: 'Capital', rwa: 'Risk-weighted assets', leverage: 'Leverage', lcr: 'Liquidity coverage', nsfr: 'Stable funding' };
  const fields = { capital: 'cet1Ratio', rwa: 'rwa', leverage: 'leverageRatio', lcr: 'lcr', nsfr: 'nsfr' } as const;
  return <section className="card regulatory-detail">
    <div className="section-heading"><div><div className="eyebrow">Know your headroom</div><h2>Prudential dashboard</h2></div><button className="button ghost" onClick={() => onNavigateHelp?.('liquidity-ratios')}>How to read this</button></div>
    <p className="muted">2026 UK standardised bank assumptions. Ratios use prescribed factors; internal stress estimates are shown separately. Firm-specific Pillar 2 requirements and full regulatory reporting are outside this model.</p>
    <div className="metric-switch" role="group" aria-label="Regulatory metric">{(Object.keys(labels) as Metric[]).map(k => <button key={k} className={`button ${metric === k ? 'primary' : 'ghost'}`} aria-pressed={metric === k} onClick={() => setMetric(k)}>{labels[k]}</button>)}</div>
    <div className="regulatory-grid"><div className="table-wrap"><table><thead><tr><th>Contribution</th><th className="align-right">Effective factor</th><th className="align-right">Amount / ratio</th></tr></thead><tbody>{regulatoryRows(state, config, metric).map((r, n) => <tr key={n} className={r.total ? 'total-row' : ''}><td>{r.label}</td><td className="align-right">{r.factor === undefined ? '·' : formatPct(r.factor)}</td><td className="align-right">{r.ratio ? formatPct(r.value) : formatCurrency(r.value)}</td></tr>)}</tbody></table></div>
    <aside><h3>{labels[metric]} over time</h3><div style={{ height: 260 }}><TimeSeriesChart data={history.map(s => ({ step: s.time.step, value: s.risk.riskMetrics[fields[metric]] }))} xLabel="Month" /></div><div className="policy-note"><strong>Management stress estimates</strong><p>LCR {formatPct(state.risk.riskMetrics.managementLcr ?? state.risk.riskMetrics.lcr)} · NSFR {formatPct(state.risk.riskMetrics.managementNsfr ?? state.risk.riskMetrics.nsfr)}</p><p>These apply behavioural assumptions. They are not the reported prudential ratios.</p></div><p className="muted">Inside the combined buffer, bank policy suspends distributions. The policy payout cap is not a calculation of the PRA maximum distributable amount.</p></aside></div>
  </section>;
}
