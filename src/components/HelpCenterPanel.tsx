import { useEffect, useMemo } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { buildMechanicsDynamicContext } from '../content/mechanicsContext';
import { buildMechanicsRegistry, MechanicCategory } from '../content/mechanicsRegistry';
import { pillar2AHelpEntry } from '../content/pillar2AHelp';
import './HelpCenterPanel.css';

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

const CATEGORY_LABEL: Record<MechanicCategory, string> = {
  'Start Here': 'Playing the game',
  Customers: 'Customers',
  Lending: 'Lending',
  Treasury: 'Treasury',
  Capital: 'Capital',
  'Risk Measures': 'Risk and regulation',
  'Market & Reports': 'Market and reports',
};

const HelpCenterPanel = ({ state, config, focusSectionId, onFocusHandled }: Props) => {
  const mechanicsContext = useMemo(
    () => buildMechanicsDynamicContext({ state, config }),
    [state, config]
  );
  const entries = useMemo(
    () => [...buildMechanicsRegistry(mechanicsContext), pillar2AHelpEntry],
    [mechanicsContext]
  );

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
  }, [focusSectionId, onFocusHandled]);

  return (
    <article className="help-manual">
      <header>
        <h1>Help</h1>
        <p>
          BankSim advances one month at a time. Your decisions change customer behaviour,
          lending, funding, profit, and risk.
        </p>
      </header>

      {CATEGORY_ORDER.map((category) => {
        const rows = entries.filter((entry) => entry.category === category);
        if (rows.length === 0) return null;

        return (
          <section key={category} id={`help-cat-${encodeCategory(category)}`}>
            <h2>{CATEGORY_LABEL[category]}</h2>

            {rows.map((entry) => (
              <section
                key={entry.id}
                id={`help-${entry.id}`}
                tabIndex={-1}
                className="help-manual-entry"
              >
                <h3>{entry.title}</h3>
                <p>{entry.plainDescription}</p>
                <p>{entry.whyItMatters}</p>

                <ul>
                  {entry.driverSummary.map((line) => (
                    <li key={`${entry.id}-${line}`}>{line}</li>
                  ))}
                </ul>

                {entry.formula && (
                  <pre aria-label={`${entry.title} equation`}>
                    <code>{entry.formula}</code>
                  </pre>
                )}
              </section>
            ))}
          </section>
        );
      })}
    </article>
  );
};

const encodeCategory = (category: MechanicCategory): string =>
  category.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export default HelpCenterPanel;
