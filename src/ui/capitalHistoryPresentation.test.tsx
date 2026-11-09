import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CapitalHistory from '../components/CapitalHistory';
import { initialState } from '../config/initialState';
import { buildCapitalHistoryData } from '../presentation/reports/capitalHistory';

describe('capital history report UI', () => {
  it('renders the shared series choices and chart labels', () => {
    const report = buildCapitalHistoryData([initialState], 'ratio', ['CET1', 'CET1 requirement', 'Internal CET1 target'], 'all');
    const html = renderToStaticMarkup(<CapitalHistory history={[initialState]} />);
    expect(html).toContain('Capital and risk history');
    expect(html).toContain('Internal CET1 target');
    expect(html).toContain('Selected risk metrics over time');
    expect(report.datasets.map((series) => series.label)).toEqual(['CET1', 'CET1 requirement', 'Internal CET1 target']);
  });
});
