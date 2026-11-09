import { useState } from 'react';
import type { BankState } from '../domain/bankState';
import type { ProductType } from '../domain/enums';
import { getProduct } from '../products/catalogue';
import { formatCurrency, formatRate } from '../utils/formatters';
import './CreditLossesPanel.css';
import { buildCreditLossesReportData } from '../presentation/reports/creditLosses';


const CreditLossesPanel = ({ history }: { history: BankState[] }) => {
  const [showAllMonths, setShowAllMonths] = useState(false);
  const data = buildCreditLossesReportData(history);

  if (!data) return <div className="muted">No credit history is available yet.</div>;

  const amount = (value: number | null | undefined) => value == null ? '—' : formatCurrency(value);
  const latestMonth = data.latestMonth;
  const visibleMonths = showAllMonths ? data.months : data.months.slice(-12);

  return (
    <div className="credit-losses-panel stack">
      <header className="credit-losses-heading">
        <div><div className="eyebrow">LOAN PORTFOLIO</div><h2>Credit losses</h2></div>
        <p>See how estimated losses, accounting charges and workout outcomes differ.</p>
      </header>

      <section className="grid-metrics credit-loss-kpis" aria-label="Current credit loss measures">
        <div className="metric-card"><div className="metric-label">Funded ECL · balance-sheet stock</div><div className="metric-value">{amount(data.carrying.fundedAllowance)}</div></div>
        <div className="metric-card"><div className="metric-label">Provision charge · latest P&amp;L flow</div><div className="metric-value">{amount(latestMonth?.provisionCharge)}</div></div>
        <div className="metric-card"><div className="metric-label">Defaults · latest close</div><div className="metric-value">{amount(latestMonth?.defaults)}</div></div>
        <div className="metric-card"><div className="metric-label">Workout losses realised · latest close</div><div className="metric-value">{amount(latestMonth?.realisedLosses)}</div></div>
        <div className="metric-card"><div className="metric-label">Defaulted loans in workout</div><div className="metric-value">{amount(data.workoutStock)}</div></div>
        <div className="metric-card"><div className="metric-label">Expected workout recoveries</div><div className="metric-value">{amount(data.expectedRecoveries)}</div></div>
        <div className="metric-card"><div className="metric-label">Expected workout loss</div><div className="metric-value">{amount(data.expectedWorkoutLoss)}</div></div>
      </section>

      <section className="credit-loss-section">
        <div className="credit-section-heading"><h3>How ECL changes the loan balance</h3><span>Funded allowance</span></div>
        <div className="credit-loss-equation" aria-label={`Gross loan exposure ${amount(data.carrying.gross)} minus funded ECL ${amount(data.carrying.fundedAllowance)} equals net loan carrying amount ${amount(data.carrying.net)}`}>
          <div className="credit-equation-item"><span>Gross loan exposure</span><strong>{amount(data.carrying.gross)}</strong></div>
          <span className="credit-equation-operator" aria-hidden="true">−</span>
          <div className="credit-equation-item"><span>Funded ECL allowance</span><strong>{amount(data.carrying.fundedAllowance)}</strong></div>
          <span className="credit-equation-operator" aria-hidden="true">=</span>
          <div className="credit-equation-item credit-equation-net"><span>Net loan asset</span><strong>{amount(data.carrying.net)}</strong></div>
        </div>
        <div className="credit-equation-foot">
          <span>Undrawn commitments: {amount(data.commitmentEcl)} ECL held separately</span>
          <span>Reconciliation difference: {amount(data.carrying.reconciliationDifference)}</span>
        </div>
      </section>

      <section className="credit-loss-section">
        <div className="credit-section-heading"><h3>Three stages of expected loss</h3><span>Exposure and allowance at the latest close</span></div>
        <div className="credit-stage-mix" role="img" aria-label={`Stage exposure mix: ${data.stages.map((stage) => `${stage.label} ${formatRate(stage.share)}`).join(', ')}`}>
          {data.stages.map((stage) => <span key={stage.key} className={`credit-stage-segment ${stage.className}`} style={{ width: `${stage.share * 100}%` }} />)}
        </div>
        <div className="credit-stage-grid">
          {data.stages.map((stage) => (
            <article key={stage.key} className={`credit-stage-card ${stage.className}`}>
              <div className="credit-stage-title"><strong>{stage.label}</strong><span>{stage.measure}</span></div>
              <p>{stage.trigger}</p>
              <dl>
                <div><dt>Gross exposure</dt><dd>{amount(stage.exposure)}</dd></div>
                <div><dt>Funded allowance</dt><dd>{amount(stage.allowance)}</dd></div>
                <div><dt>Allowance / exposure</dt><dd>{stage.coverage == null ? '—' : formatRate(stage.coverage)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <p className="credit-model-note">Stage 2 uses a simplified current-versus-origination PD test as its SICR proxy.</p>
      </section>

      <section className="credit-loss-section">
        <div className="credit-section-heading">
          <div><h3>Expected charges and actual outcomes</h3><p>Defaults enter workout; recoveries and write-offs determine realised losses.</p></div>
          <div className="credit-history-switch" role="group" aria-label="Credit history range">
            <button type="button" className={!showAllMonths ? 'active' : ''} onClick={() => setShowAllMonths(false)}>Last 12</button>
            <button type="button" className={showAllMonths ? 'active' : ''} onClick={() => setShowAllMonths(true)}>All closes</button>
          </div>
        </div>
        {visibleMonths.length === 0 ? (
          <div className="credit-empty-state">Run one month to start the allowance and loss history.</div>
        ) : (
          <div className="credit-table-scroll">
            <table className="data-table credit-loss-table">
              <thead><tr><th>Close</th><th className="numeric">Opening ECL</th><th className="numeric">Provision charge / (release)</th><th className="numeric">Defaults</th><th className="numeric">Recovery cash</th><th className="numeric">Realised workout loss</th><th className="numeric">Closing ECL</th><th className="numeric">Bridge gap</th></tr></thead>
              <tbody>{visibleMonths.map((month, index) => (
                <tr key={`${month.date}-${index}`}>
                  <td>{month.date}</td><td className="numeric">{amount(month.openingEcl)}</td><td className="numeric">{amount(month.provisionCharge)}</td><td className="numeric">{amount(month.defaults)}</td><td className="numeric">{amount(month.recoveries)}</td><td className="numeric">{amount(month.realisedLosses)}</td><td className="numeric">{amount(month.closingEcl)}</td><td className="numeric">{amount(month.bridgeGap)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <details className="credit-vintage-details">
        <summary>Explore defaults and realised losses by product and origination vintage</summary>
        <div className="credit-table-scroll">
          <p className="muted">Default share is run-to-date gross defaults divided by booked lending; the opening book uses opening gross exposure.</p>
          <table className="data-table credit-vintage-table">
            <thead><tr><th>Product</th><th>Vintage</th><th className="numeric">Booked</th><th className="numeric">Gross defaults</th><th className="numeric">Default share</th><th className="numeric">Recoveries</th><th className="numeric">Realised loss</th></tr></thead>
            <tbody>{data.vintages.map((row) => (
              <tr key={`${row.product}-${row.vintage}`}>
                <td>{getProduct(row.product as ProductType).label}</td><td>{row.vintage}</td><td className="numeric">{amount(row.booked)}</td><td className="numeric">{amount(row.defaults)}</td><td className="numeric">{row.booked > 0 ? formatRate(row.defaults / row.booked) : '—'}</td><td className="numeric">{amount(row.recoveries)}</td><td className="numeric">{amount(row.realisedLosses)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>

      <p className="credit-accounting-note">A provision charge affects profit; funded ECL reduces the net loan asset. Defaults, cash recoveries and realised workout losses are shown as separate measures. Capital effects can differ after prudential adjustments.</p>
    </div>
  );
};

export default CreditLossesPanel;
