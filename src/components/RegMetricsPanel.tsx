import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AttributionLineSelection, StepAttribution } from '../domain/attribution';
import CapitalDashboard from './CapitalDashboard';
import LcrDashboard from './LcrDashboard';
import NsfrDashboard from './NsfrDashboard';
import LeverageDashboard from './LeverageDashboard';
import RwaDashboard from './RwaDashboard';
import CapitalHistory from './CapitalHistory';
import RiskAppetiteEditor, { RiskAppetite } from './RiskAppetiteEditor';
import type { RegulatoryMetric as RegulatoryMetricType } from '../presentation/reports/regulatory';
export { regulatoryRows } from '../presentation/reports/regulatory';
export type { RegulatoryMetric } from '../presentation/reports/regulatory';


type RegulatoryMetric = RegulatoryMetricType;
interface Props { state: BankState; history: BankState[]; config: SimulationConfig; metric:RegulatoryMetric; pendingRiskAppetite?:RiskAppetite|null; onRiskAppetite?:(t:RiskAppetite|null)=>void; attribution?: StepAttribution | null; onAttributionLineSelect?: (s: AttributionLineSelection) => void; }






export default function RegMetricsPanel({ state, history, config, metric, pendingRiskAppetite, onRiskAppetite }: Props) {
  const labels: Record<RegulatoryMetric, string> = { capital: 'Capital', rwa: 'Risk-weighted assets', leverage: 'Leverage', lcr: 'Liquidity coverage', nsfr: 'Stable funding' };
  return <section className="card regulatory-detail">
    <div className="section-heading"><div><div className="eyebrow">Regulatory metrics</div><h3>{labels[metric]}</h3></div></div>
    {metric === 'capital' ? <CapitalDashboard state={state} config={config}/> : metric === 'lcr' ? <LcrDashboard state={state} config={config} history={history}/> : metric === 'nsfr' ? <NsfrDashboard state={state} config={config} history={history}/> : metric === 'leverage' ? <LeverageDashboard state={state} config={config} history={history}/> : <RwaDashboard state={state} config={config} history={history}/>}
    {metric === 'capital' && <><CapitalHistory history={history}/>{onRiskAppetite&&<RiskAppetiteEditor state={state} config={config} pending={pendingRiskAppetite} onQueue={onRiskAppetite}/>}</>}
  </section>;
}
