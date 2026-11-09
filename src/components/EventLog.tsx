import { SimulationEvent } from '../engine/simulation';
import { buildPlayerEventLog } from '../presentation/reports/events';

interface Props {
  events: SimulationEvent[];
  highlightEventIds?: string[];
  onClearHighlight?: () => void;
}

const EventLog = ({ events, highlightEventIds = [], onClearHighlight }: Props) => {
  const report = buildPlayerEventLog(events, highlightEventIds);

  return (
    <div className="card stack">
      <h3>Event Log</h3>
      {report.hasHighlight && (
        <div className="event-log-highlight">
          <span>
            Showing {report.linkedCount} linked event{report.linkedCount === 1 ? '' : 's'} from selected attribution driver.
          </span>
          <button type="button" className="button ghost small" onClick={onClearHighlight}>
            Clear filter
          </button>
        </div>
      )}
      {report.emptyMessage ? (
        <div className="muted">{report.emptyMessage}</div>
      ) : (
        <ul className="event-log">
          {report.events.map((e) => (
            <li
              key={e.id}
              id={e.id}
              className={`event ${e.severity} ${report.hasHighlight ? (e.linked ? 'linked' : 'dimmed') : ''}`}
            >
              [{e.severity.toUpperCase()}] {e.message}
              {e.tags && e.tags.length > 0 ? ` (${e.tags.join(', ')})` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EventLog;
