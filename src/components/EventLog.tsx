import { SimulationEvent } from '../engine/simulation';

interface Props {
  events: SimulationEvent[];
}

const EventLog = ({ events }: Props) => {
  return (
    <div className="card stack">
      <h3>Event Log</h3>
      {events.length === 0 ? (
        <div className="muted">No events yet.</div>
      ) : (
        <ul className="event-log">
          {events.map((e) => (
            <li key={e.id} className={`event ${e.severity}`}>
              [{e.severity.toUpperCase()}] {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EventLog;
