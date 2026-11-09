import type { SimulationEvent } from '../../engine/simulationEvents';

export interface PlayerEventView {
  id: string;
  severity: SimulationEvent['severity'];
  message: string;
  tags: string[];
}

/** Fields the Event Log renders, with no internal event metadata or object references. */
export const buildPlayerEventLog = (events: readonly SimulationEvent[], highlightEventIds: readonly string[] = []) => {
  const highlights = new Set(highlightEventIds);
  const visibleEvents: PlayerEventView[] = events.map(({ id, severity, message, tags }) => ({ id, severity, message, tags: [...(tags ?? [])] }));
  const hasHighlight = highlights.size > 0;
  return {
    events: visibleEvents.map((event) => ({ ...event, linked: highlights.has(event.id) })),
    hasHighlight,
    linkedCount: hasHighlight ? visibleEvents.reduce((count, event) => count + (highlights.has(event.id) ? 1 : 0), 0) : 0,
    emptyMessage: visibleEvents.length === 0 ? 'No events yet.' : undefined,
  };
};
