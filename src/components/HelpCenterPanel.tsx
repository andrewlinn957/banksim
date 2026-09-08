import { useEffect, useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { buildMechanicsDynamicContext } from '../content/mechanicsContext';
import { buildMechanicsRegistry, MechanicCategory, MechanicEntry } from '../content/mechanicsRegistry';
import { formatCurrency, formatPct } from '../utils/formatters';

interface Props {
  state: BankState;
  config: SimulationConfig;
  focusSectionId?: string | null;
  onFocusHandled?: () => void;
}

const CATEGORY_ORDER: MechanicCategory[] = [
  'Start Here',
  'Customers',
  'Lending',
  'Treasury',
  'Capital',
  'Risk Measures',
  'Market & Reports',
];

const toSearchText = (entry: MechanicEntry): string =>
  [
    entry.title,
    entry.plainDescription,
    entry.whyItMatters,
    entry.formula ?? '',
    ...(entry.driverSummary ?? []),
    ...(entry.relatedActions ?? []),
    ...(entry.relatedMetrics ?? []),
  ]
    .join(' ')
    .toLowerCase();

const HelpCenterPanel = ({ state, config, focusSectionId, onFocusHandled }: Props) => {
  const [search, setSearch] = useState('');
  const mechanicsContext = useMemo(
    () => buildMechanicsDynamicContext({ state, config }),
    [state, config]
  );
  const entries = useMemo(
    () => buildMechanicsRegistry(mechanicsContext),
    [mechanicsContext]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => toSearchText(entry).includes(needle));
  }, [entries, search]);

  const grouped = useMemo(() => {
    const map = new Map<MechanicCategory, MechanicEntry[]>();
    CATEGORY_ORDER.forEach((category) => map.set(category, []));
    filtered.forEach((entry) => {
      const bucket = map.get(entry.category);
      if (bucket) bucket.push(entry);
      else map.set(entry.category, [entry]);
    });
    return map;
  }, [filtered]);

  useEffect(() => {
    if (!focusSectionId) return;
    const task = window.setTimeout(() => {
      const el = document.getElementById(`help-${focusSectionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if ('focus' in el) (el as HTMLElement).focus();
      }
      onFocusHandled?.();
    }, 40);
    return () => window.clearTimeout(task);
  }, [focusSectionId, filtered, onFocusHandled]);

  const risk = state.risk.riskMetrics;

  return (
    <section className="stack help-panel">
      <div className="help-header">
        <div>
          <div className="eyebrow">Game manual</div>
          <h2>How the bank works</h2>
          <p className="muted">Use this page to see what each control changes and what can go wrong.</p>
        </div>
        <div className="help-header-actions">
          <input
            className="help-search-input"
            placeholder="Search deposits, LCR, mortgages, Tier 2..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the game manual"
          />
        </div>
      </div>

      <section className="card stack" aria-label="How to use the manual">
        <strong>Read a control in this order</strong>
        <div className="grid-two">
          <div><strong>1. Price or policy</strong><p className="muted">Change the customer offer or the bank policy.</p></div>
          <div><strong>2. Volume and mix</strong><p className="muted">Customers, loans, deposits, and funding respond.</p></div>
          <div><strong>3. Profit and risk</strong><p className="muted">Income, losses, duration, and funding cost change.</p></div>
          <div><strong>4. Constraints</strong><p className="muted">Capital, leverage, LCR, NSFR, cash, and confidence can limit the bank.</p></div>
        </div>
      </section>

      <section className="stack" aria-label="Current bank position">
        <div>
          <div className="eyebrow">Current bank</div>
          <h3>Read these measures before you change policy</h3>
        </div>
        <div className="grid-metrics">
          <div className="metric-card"><div className="metric-label">CET1 ratio</div><div className="metric-value">{formatPct(risk.cet1Ratio)}</div><div className="metric-helper">Minimum {mechanicsContext.formatted.minCet1Ratio}</div></div>
          <div className="metric-card"><div className="metric-label">Leverage ratio</div><div className="metric-value">{formatPct(risk.leverageRatio)}</div><div className="metric-helper">Minimum {mechanicsContext.formatted.minLeverageRatio}</div></div>
          <div className="metric-card"><div className="metric-label">LCR</div><div className="metric-value">{formatPct(risk.lcr)}</div><div className="metric-helper">Minimum {mechanicsContext.formatted.minLcr}</div></div>
          <div className="metric-card"><div className="metric-label">NSFR</div><div className="metric-value">{formatPct(risk.nsfr)}</div><div className="metric-helper">Minimum {mechanicsContext.formatted.minNsfr}</div></div>
          <div className="metric-card"><div className="metric-label">Funding confidence</div><div className="metric-value">{risk.fundingConfidenceState}</div><div className="metric-helper">Score {formatPct(risk.fundingConfidenceScore)}</div></div>
          <div className="metric-card"><div className="metric-label">NII if rates rise 1pp</div><div className="metric-value">{formatCurrency(risk.niiSensitivity100bp)}</div><div className="metric-helper">Estimated annual change</div></div>
          <div className="metric-card"><div className="metric-label">EVE if rates rise 1pp</div><div className="metric-value">{formatCurrency(risk.eveSensitivity100bp)}</div><div className="metric-helper">Estimated value change</div></div>
        </div>
      </section>

      <nav className="help-chip-row" aria-label="Manual sections">
        {CATEGORY_ORDER.map((category) => {
          const count = grouped.get(category)?.length ?? 0;
          if (count === 0) return null;
          return (
            <a key={category} className="pill" href={`#help-cat-${encodeCategory(category)}`}>
              {category} ({count})
            </a>
          );
        })}
      </nav>

      {CATEGORY_ORDER.map((category) => {
        const rows = grouped.get(category) ?? [];
        if (rows.length === 0) return null;

        return (
          <section key={category} className="help-category stack" id={`help-cat-${encodeCategory(category)}`}>
            <div>
              <div className="eyebrow">Manual section</div>
              <h3>{category}</h3>
            </div>

            {rows.map((entry) => (
              <article
                key={entry.id}
                id={`help-${entry.id}`}
                tabIndex={-1}
                className="card stack help-entry"
              >
                <div className="help-entry-header">
                  <div>
                    <div className="eyebrow">{entry.category}</div>
                    <h3>{entry.title}</h3>
                  </div>
                </div>

                <p>{entry.plainDescription}</p>

                <div className="help-effect">
                  <strong>Consequence</strong>
                  <p>{entry.whyItMatters}</p>
                </div>

                <div>
                  <strong>What changes the result</strong>
                  <ul className="help-list">
                    {entry.driverSummary.map((line) => (
                      <li key={`${entry.id}-${line}`}>{line}</li>
                    ))}
                  </ul>
                </div>

                {entry.formula && (
                  <div className="help-formula">
                    <div className="muted">Equation</div>
                    {entry.formula.split('\n').map((line) => <code key={`${entry.id}-${line}`}>{line}</code>)}
                  </div>
                )}

                {entry.thresholds && entry.thresholds.length > 0 && (
                  <div className="stack">
                    <strong>Current values and limits</strong>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Measure</th>
                          <th className="numeric">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.thresholds.map((row) => (
                          <tr key={`${entry.id}-${row.label}`}>
                            <td>{row.label}</td>
                            <td className="numeric">{row.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {(entry.relatedMetrics?.length || entry.relatedActions?.length) && (
                  <div className="help-meta-grid">
                    {entry.relatedActions && entry.relatedActions.length > 0 && (
                      <div>
                        <div className="muted">Controls</div>
                        <div>{entry.relatedActions.join(' · ')}</div>
                      </div>
                    )}
                    {entry.relatedMetrics && entry.relatedMetrics.length > 0 && (
                      <div>
                        <div className="muted">Check after the close</div>
                        <div>{entry.relatedMetrics.join(' · ')}</div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>
        );
      })}

      {filtered.length === 0 && (
        <div className="card">No manual section matches this search.</div>
      )}
    </section>
  );
};

const encodeCategory = (category: MechanicCategory): string =>
  category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default HelpCenterPanel;
