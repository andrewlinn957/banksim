import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RiskDashboard from '../components/RiskDashboard';
import PerformanceReport from '../components/PerformanceReport';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';

describe('risk reporting UI', () => {
  it('renders a dense risk dashboard without mechanics-link clutter', () => {
    const html = renderToStaticMarkup(
      <RiskDashboard state={initialState} config={baseConfig} attribution={null} />
    );

    expect(html).toContain('Bank risk position');
    expect(html).toContain('Balance-sheet risk');
    expect(html).toContain('Franchise &amp; earnings');
    expect(html).toContain('Market context');
    expect(html).toContain('CET1');
    expect(html).toContain('LCR');
    expect(html).not.toContain('Prudential dashboard');
    expect(html).not.toContain('Open help');
    expect(html).not.toContain('Mechanics references');
  });

  it('does not render the removed first-year board challenges', () => {
    const html = renderToStaticMarkup(<PerformanceReport history={[initialState]} />);
    expect(html).not.toContain('board challenges');
    expect(html).not.toContain('/3 stars');
  });
});
