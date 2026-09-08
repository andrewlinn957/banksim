import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { formatCurrency, formatPct } from '../utils/formatters';

const hhiPct = (value: number) => `${(value * 100).toFixed(2)}%`;

export default function Pillar2APanel({ state, config }: { state: BankState; config: SimulationConfig }) {
  const assessment = state.risk.pillar2A;
  if (!assessment) return null;

  const currentRwa = state.risk.riskMetrics.rwa;
  const effectiveRate = state.risk.riskMetrics.pillar2ARate ?? assessment.assessedRate;
  const currentAmount = effectiveRate * currentRwa;
  const totalOffset = assessment.ps1520.initialOffsetRate + assessment.ps1520.additionalOffsetRate;
  const monthsToReview = Math.max(0, assessment.nextAssessmentStep - state.time.step);
  const configuredFloor = Math.max(0, config.riskLimits.pillar2A?.totalRatio ?? 0);
  const componentRows = [
    ['SA credit-risk underestimation', assessment.components.creditRisk],
    ['Single-name concentration', assessment.components.singleNameConcentration],
    ['Sector concentration', assessment.components.sectorConcentration],
    ['Geographic concentration', assessment.components.geographicConcentration],
    ['IRRBB', assessment.components.irrbb],
  ] as const;

  return <section className="capital-card pillar2a-panel">
    <header><div><h3>Pillar 2A annual SREP assessment</h3><p className="muted">The assessed variable P2A rate is reset annually from the bank's risk profile and then held until the next review. Its £ amount moves with current RWA.</p></div></header>
    <div className="capital-ratios">
      <div><strong>{formatPct(effectiveRate)}</strong><span>Current P2A rate</span></div>
      <div><span>Current amount</span><b>{formatCurrency(currentAmount)}</b></div>
      <div><span>Next review</span><b>{monthsToReview === 0 ? 'Next close' : `${monthsToReview}m`}</b></div>
    </div>

    <div className="capital-detail-grid">
      <div>
        <h4>Latest assessment</h4>
        <div className="table-scroll"><table><thead><tr><th>Risk component</th><th>At assessment</th><th>% assessment RWA</th></tr></thead><tbody>
          {componentRows.map(([label, amount])=><tr key={label}><td>{label}</td><td>{formatCurrency(amount)}</td><td>{assessment.assessmentRwa > 0 ? formatPct(amount / assessment.assessmentRwa) : 'N/A'}</td></tr>)}
          <tr className="total-row"><th>Gross variable P2A</th><td>{formatCurrency(assessment.grossRate * assessment.assessmentRwa)}</td><td>{formatPct(assessment.grossRate)}</td></tr>
          <tr><td>PS15/20 initial offset</td><td>−{formatCurrency(assessment.ps1520.initialOffsetRate * assessment.assessmentRwa)}</td><td>−{formatPct(assessment.ps1520.initialOffsetRate)}</td></tr>
          <tr><td>PS15/20 additional small-bank offset</td><td>−{formatCurrency(assessment.ps1520.additionalOffsetRate * assessment.assessmentRwa)}</td><td>−{formatPct(assessment.ps1520.additionalOffsetRate)}</td></tr>
          <tr className="total-row"><th>Assessed variable P2A</th><td>{formatCurrency(assessment.assessedRate * assessment.assessmentRwa)}</td><td>{formatPct(assessment.assessedRate)}</td></tr>
          {configuredFloor > assessment.assessedRate + 1e-10 && <tr><td>Scenario/manual P2A floor</td><td>{formatCurrency(configuredFloor * assessment.assessmentRwa)}</td><td>{formatPct(configuredFloor)}</td></tr>}
        </tbody></table></div>
      </div>
      <div>
        <h4>Assessment drivers</h4>
        <div className="table-scroll"><table><tbody>
          <tr><th>Assessment date</th><td>{new Date(assessment.assessmentDate).toLocaleDateString()}</td></tr>
          <tr><th>Assessment RWA</th><td>{formatCurrency(assessment.assessmentRwa)}</td></tr>
          <tr><th>UK CCyB pass-through</th><td>{formatPct(assessment.ps1520.ukCcybPassThroughRate)}</td></tr>
          <tr><th>Total PS15/20 offset</th><td>{formatPct(totalOffset)}</td></tr>
          <tr><th>Single-name HHI</th><td>{hhiPct(assessment.concentration.singleNameHhi)}</td></tr>
          <tr><th>Sector HHI</th><td>{hhiPct(assessment.concentration.sectorHhi)}</td></tr>
          <tr><th>Geographic HHI</th><td>{hhiPct(assessment.concentration.geographicHhi)}</td></tr>
          <tr><th>Worst ±200bp EVE loss</th><td>{formatCurrency(assessment.irrbb.worstLoss200bp)}</td></tr>
          <tr><th>Board IRRBB EVE limit</th><td>{formatCurrency(assessment.irrbb.policyLimit)}</td></tr>
          <tr><th>IRRBB capitalisation scalar</th><td>{formatPct(assessment.irrbb.capitalConversionFactor)}</td></tr>
        </tbody></table></div>
        <p className="muted">BankSim uses the PRA's published concentration HHI ranges and PS15/20 offset mechanics. The equal-obligor single-name approximation, automatic low-risk/MREL eligibility, and IRRBB capitalisation scalar are explicit game simplifications where the public policy does not provide a complete mechanical calculation.</p>
      </div>
    </div>
  </section>;
}
