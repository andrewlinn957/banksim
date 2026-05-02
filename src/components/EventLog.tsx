import { SimulationEvent } from '../engine/simulation';

interface Props {
  events: SimulationEvent[];
  highlightEventIds?: string[];
  onClearHighlight?: () => void;
}

const EventLog = ({ events, highlightEventIds = [], onClearHighlight }: Props) => {
  const highlightSet = new Set(highlightEventIds);
  const hasHighlight = highlightSet.size > 0;
  const linkedCount = hasHighlight
    ? events.reduce((count, event) => (highlightSet.has(event.id) ? count + 1 : count), 0)
    : 0;

  return (
    <div className="card stack">
      <h3>Event Log</h3>
      {hasHighlight && (
        <div className="event-log-highlight">
          <span>
            Showing {linkedCount} linked event{linkedCount === 1 ? '' : 's'} from selected attribution driver.
          </span>
          <button type="button" className="button ghost small" onClick={onClearHighlight}>
            Clear filter
          </button>
        </div>
      )}
      {events.length === 0 ? (
        <div className="muted">No events yet.</div>
      ) : (
        <ul className="event-log">
          {events.map((e) => (
            <li
              key={e.id}
              id={e.id}
              className={`event ${e.severity} ${hasHighlight ? (highlightSet.has(e.id) ? 'linked' : 'dimmed') : ''}`}
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
