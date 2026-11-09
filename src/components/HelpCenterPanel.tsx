import { useEffect, useMemo } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { buildHelpCenterData } from '../presentation/help';
import './HelpCenterPanel.css';

interface Props {
  state: BankState;
  config: SimulationConfig;
  focusSectionId?: string | null;
  onFocusHandled?: () => void;
}

const HelpCenterPanel = ({ state, config, focusSectionId, onFocusHandled }: Props) => {
  const help = useMemo(() => buildHelpCenterData(state, config), [state, config]);

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
        <p>{help.introduction}</p>
      </header>

      {help.categories.map((group) => (
          <section key={group.category} id={`help-cat-${group.id}`}>
            <h2>{group.label}</h2>

            {group.entries.map((entry) => (
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
      ))}
    </article>
  );
};

export default HelpCenterPanel;
