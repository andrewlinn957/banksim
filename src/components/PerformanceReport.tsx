import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { periodHistory } from '../game/management';
import { formatCurrency, formatPct } from '../utils/formatters';

export default function PerformanceReport({ history }: { history: BankState[] }) {
  const [period, setPeriod] = useState(3);
  const periods = periodHistory(history, period);
  const latest = periods.at(-1);
  const prior = periods.at(-2);

  return (
    <div className="stack">
      <section className="card history-card">
        <div className="section-heading">
          <div>
            <div className="eyebrow">The bank you are building</div>
            <h2>Watch the strategy develop</h2>
          </div>
          <div className="department-tabs">
            {[3, 12].map((months) => (
              <button
                className={`button ${period === months ? 'primary' : ''}`}
                key={months}
                aria-pressed={period === months}
                onClick={() => setPeriod(months)}
              >
                {months === 3 ? 'Quarters' : 'Years'}
              </button>
            ))}
          </div>
        </div>

        {periods.length === 0 ? (
          <div className="history-empty">
            <strong>Your story starts here.</strong>
            <p>Set a policy in a department, then run a quarter. You will see earnings accumulate and the funding base develop. You can pause after any month.</p>
          </div>
        ) : (
          <>
            <div className="profit-timeline" aria-label="Profit by reporting period">
              {periods.slice(-12).map((item) => (
                <div className="profit-period" key={item.label}>
                  <span>{formatCurrency(item.profit)}</span>
                  <div className="profit-track">
                    <div
                      className={item.profit < 0 ? 'negative' : ''}
                      style={{
                        height: `${Math.max(
                          4,
                          Math.abs(item.profit) /
                            Math.max(1, ...periods.slice(-12).map((periodItem) => Math.abs(periodItem.profit))) *
                            60
                        )}px`,
                      }}
                    />
                  </div>
                  <strong>{item.label}</strong>
                  <small>{item.months < period ? `${item.months}/${period} months` : 'Complete'}</small>
                </div>
              ))}
            </div>
            <p className="muted">
              {latest && latest.months < period
                ? 'The current period is incomplete. Compare it with a full period only after the books close.'
                : prior
                  ? `Profit changed by ${formatCurrency(latest!.profit - prior.profit)} from the previous period.`
                  : 'Your first completed period establishes the baseline.'}
            </p>
            <details>
              <summary>View period figures and closing balances</summary>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Period</th><th>Months</th><th>Profit</th><th>Deposits</th><th>CET1</th></tr>
                  </thead>
                  <tbody>
                    {periods.map((item) => (
                      <tr key={item.label}>
                        <td>{item.label}</td>
                        <td>{item.months}/{period}</td>
                        <td>{formatCurrency(item.profit)}</td>
                        <td>{formatCurrency(item.deposits)}</td>
                        <td>{formatPct(item.cet1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
