import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import EventLog from '../../components/EventLog';
import { buildPlayerEventLog } from './events';

describe('player event log projection', () => {
  it('shares visible event fields and linked-event filtering with the rendered UI', () => {
    const events = [
      { id: 'event-1', severity: 'warning' as const, message: 'Deposit funding needs review', timestamp: 123456, tags: ['funding', 'deposits'] },
      { id: 'event-2', severity: 'info' as const, message: 'Monthly close completed', timestamp: 123457, tags: [] },
    ];
    const report = buildPlayerEventLog(events, ['event-1']);
    const markup = renderToStaticMarkup(<EventLog events={events} highlightEventIds={['event-1']} />);

    expect(report.linkedCount).toBe(1);
    expect(report.events[0]).toEqual({ id: 'event-1', severity: 'warning', message: 'Deposit funding needs review', tags: ['funding', 'deposits'], linked: true });
    expect(report.events[0]).not.toHaveProperty('timestamp');
    expect(markup).toContain('[WARNING] Deposit funding needs review (funding, deposits)');
    expect(markup).toContain('Showing 1 linked event from selected attribution driver.');
  });
});
