import { useEffect, useMemo, useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { buildMechanicsDynamicContext } from '../content/mechanicsContext';
import { buildMechanicsRegistry, MechanicCategory, MechanicEntry } from '../content/mechanicsRegistry';
import InfoTooltip from './InfoTooltip';
import WarningBanner from './WarningBanner';

interface Props {
  state: BankState;
  config: SimulationConfig;
  focusSectionId?: string | null;
  onFocusHandled?: () => void;
}

const CATEGORY_ORDER: MechanicCategory[] = [
  'Controls',
  'Deposits',
  'Loans',
  'Funding & Liquidity',
  'Capital & Compliance',
  'Market & Scenarios',
  'Diagnostics',
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
      if (bucket) {
        bucket.push(entry);
      } else {
        map.set(entry.category, [entry]);
      }
    });
    return map;
  }, [filtered]);

  useEffect(() => {
    if (!focusSectionId) return;
    const task = window.setTimeout(() => {
      const el = document.getElementById(`help-${focusSectionId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if ('focus' in el) {
          (el as HTMLElement).focus();
        }
      }
      onFocusHandled?.();
    }, 40);
    return () => window.clearTimeout(task);
  }, [focusSectionId, filtered, onFocusHandled]);

  return (
    <section className="stack help-panel">
      <div className="help-header">
        <div>
          <div className="eyebrow">Manual</div>
          <h2>Mechanics Help Center</h2>
        </div>
        <div className="help-header-actions">
          <input
            className="help-search-input"
            placeholder="Search mechanics, metrics, actions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search mechanics help"
          />
        </div>
      </div>

      <WarningBanner title="How to use this page" severity="info">
        Start with the short "what/why" text, then open formulas and thresholds only when needed for tuning.
      </WarningBanner>

      <div className="help-chip-row">
        {CATEGORY_ORDER.map((category) => {
          const count = grouped.get(category)?.length ?? 0;
          return (
            <a key={category} className="pill" href={`#help-cat-${encodeCategory(category)}`}>
              {category} ({count})
            </a>
          );
        })}
      </div>

      {CATEGORY_ORDER.map((category) => {
        const rows = grouped.get(category) ?? [];
        if (rows.length === 0) return null;

        return (
          <div key={category} className="help-category stack" id={`help-cat-${encodeCategory(category)}`}>
            <h3>{category}</h3>
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
                  <InfoTooltip
                    label={`About ${entry.title}`}
                    content={
                      <span>
                        Anchor: <code>#{entry.id}</code>
                      </span>
                    }
                  />
                </div>

                <p>{entry.plainDescription}</p>
                <p className="muted">{entry.whyItMatters}</p>

                <div>
                  <div style={{ fontWeight: 700 }}>Main drivers</div>
                  <ul className="help-list">
                    {entry.driverSummary.map((line) => (
                      <li key={`${entry.id}-${line}`}>{line}</li>
                    ))}
                  </ul>
                </div>

                {entry.formula && (
                  <div className="help-formula">
                    <code>{entry.formula}</code>
                  </div>
                )}

                {entry.thresholds && entry.thresholds.length > 0 && (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Threshold / level</th>
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
                )}

                {(entry.relatedMetrics?.length || entry.relatedActions?.length) && (
                  <div className="help-meta-grid">
                    {entry.relatedMetrics && entry.relatedMetrics.length > 0 && (
                      <div>
                        <div className="muted">Related metrics</div>
                        <div>{entry.relatedMetrics.join(', ')}</div>
                      </div>
                    )}
                    {entry.relatedActions && entry.relatedActions.length > 0 && (
                      <div>
                        <div className="muted">Related actions</div>
                        <div>{entry.relatedActions.join(', ')}</div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        );
      })}
    </section>
  );
};

const encodeCategory = (category: MechanicCategory): string =>
  category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default HelpCenterPanel;

