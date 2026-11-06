import { useMemo, useState } from 'react';
import type { BankState } from '../domain/bankState';
import type { ProductType } from '../domain/enums';
import { creditStageDiagnostics } from '../engine/creditStageDiagnostics';
import { getProduct } from '../products/catalogue';
import { loanCarryingAmounts } from '../products/loanBalances';
import { formatCurrency, formatRate } from '../utils/formatters';
import './CreditLossesPanel.css';

const STAGES = [
  { key: 'stage1', label: 'Stage 1', trigger: 'No significant increase in risk', measure: '12-month ECL', className: 'stage-one' },
  { key: 'stage2', label: 'Stage 2', trigger: 'Credit risk has increased significantly', measure: 'Lifetime ECL', className: 'stage-two' },
  { key: 'stage3', label: 'Stage 3', trigger: 'Credit-impaired', measure: 'Lifetime ECL', className: 'stage-three' },
] as const;

type StageKey = typeof STAGES[number]['key'];

interface StageRow {
  key: StageKey;
  label: string;
  trigger: string;
  measure: string;
  className: string;
  exposure: number;
  allowance: number | null;
  share: number;
  coverage: number | null;
}

interface MonthRow {
  date: string;
  openingEcl: number | null;
  provisionCharge: number | null;
  defaults: number;
  recoveries: number;
  realisedLosses: number;
  closingEcl: number | null;
  bridgeGap: number | null;
}

interface VintageRow {
  product: string;
  vintage: string;
  booked: number;
  defaults: number;
  recoveries: number;
  realisedLosses: number;
}

const sumValues = (record: object | undefined): number =>
  Object.values(record ?? {}).reduce<number>((total, value) => total + (typeof value === 'number' ? value : 0), 0);

const dateLabel = (date: Date): string =>
  date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const vintageName = (step: number | null | undefined, history: readonly BankState[]): string => {
  const openingStep = history[0]?.time.step ?? 0;
  if (step == null || step <= openingStep) return 'Opening book';
  const snapshot = history.find((state) => state.time.step === step);
  return snapshot ? String(snapshot.time.date.getUTCFullYear()) : 'In-run';
};

const buildVintageRows = (history: readonly BankState[]): VintageRow[] => {
  const totals = new Map<string, VintageRow>();
  const rowFor = (product: string, vintage: string): VintageRow => {
    const key = `${product}|${vintage}`;
    let row = totals.get(key);
    if (!row) {
      row = { product, vintage, booked: 0, defaults: 0, recoveries: 0, realisedLosses: 0 };
      totals.set(key, row);
    }
    return row;
  };

  if (history.length > 0) {
    Object.entries(loanCarryingAmounts(history[0]).byProduct).forEach(([product, amounts]) => {
      if (amounts) rowFor(product, 'Opening book').booked = amounts.gross;
    });
  }

  history.slice(1).forEach((state) => {
    const flow = state.periodFlows;
    if (!flow) return;
    const year = String(state.time.date.getUTCFullYear());
    Object.entries(flow.newLendingByProduct).forEach(([product, amount]) => {
      rowFor(product, year).booked += amount ?? 0;
    });
    Object.entries(flow.renewalsByProduct).forEach(([product, amount]) => {
      rowFor(product, year).booked += amount ?? 0;
    });
    flow.defaultsByVintage.forEach((item) => {
      rowFor(item.productType, vintageName(item.originationStep, history)).defaults += item.amount;
    });
    flow.recoveriesByVintage.forEach((item) => {
      rowFor(item.productType, vintageName(item.originationStep, history)).recoveries += item.amount;
    });
    flow.realizedLossesByVintage.forEach((item) => {
      rowFor(item.productType, vintageName(item.originationStep, history)).realisedLosses += item.amount;
    });
  });

  return [...totals.values()].sort((a, b) => a.vintage.localeCompare(b.vintage) || a.product.localeCompare(b.product));
};

const CreditLossesPanel = ({ history }: { history: BankState[] }) => {
  const [showAllMonths, setShowAllMonths] = useState(false);
  const data = useMemo(() => {
    const latest = history[history.length - 1];
    if (!latest) return null;

    const carrying = loanCarryingAmounts(latest).total;
    const bridge = latest.periodFlows?.provisionBridge;
    const diagnostic = creditStageDiagnostics(latest);
    const grossByStage = diagnostic.stageGross;
    const totalStageGross = Object.values(grossByStage).reduce((sum, value) => sum + value, 0);
    const allowances = bridge?.fundedAllowanceClosingByStage;
    const stages: StageRow[] = STAGES.map((stage) => {
      const exposure = grossByStage[stage.key];
      const allowance = allowances ? allowances[stage.key] : null;
      return {
        ...stage,
        exposure,
        allowance,
        share: totalStageGross > 0 ? exposure / totalStageGross : 0,
        coverage: allowance !== null && exposure > 0 ? allowance / exposure : null,
      };
    });

    const months: MonthRow[] = history.slice(1).flatMap((state) => {
      const flow = state.periodFlows;
      if (!flow) return [];
      const monthBridge = flow.provisionBridge;
      return [{
        date: dateLabel(state.time.date),
        openingEcl: monthBridge?.fundedAllowanceOpeningByStage.total ?? null,
        provisionCharge: monthBridge?.provisionCharge ?? null,
        defaults: sumValues(flow.defaultsByProduct),
        recoveries: sumValues(flow.recoveriesByProduct),
        realisedLosses: flow.realizedLossesByVintage.reduce((sum, item) => sum + item.amount, 0),
        closingEcl: monthBridge?.fundedAllowanceClosingByStage.total ?? null,
        bridgeGap: monthBridge?.reconciliationDifference ?? null,
      }];
    });

    const workouts = Object.values(latest.workoutPipelines ?? {}).flatMap((buckets) => buckets ?? []);
    const workoutStock = workouts.reduce((sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal), 0);
    const expectedRecoveries = workouts.reduce((sum, bucket) => sum + Math.max(0, bucket.defaultedPrincipal) * Math.max(0, Math.min(1, bucket.expectedRecoveryRate)), 0);

    return {
      carrying,
      stages,
      months,
      latestMonth: months[months.length - 1] ?? null,
      commitmentEcl: bridge?.commitmentAllowanceClosing ?? null,
      workoutStock,
      expectedRecoveries,
      expectedWorkoutLoss: Math.max(0, workoutStock - expectedRecoveries),
      vintages: buildVintageRows(history),
    };
  }, [history]);

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
