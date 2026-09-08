import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RiskDashboard from '../components/RiskDashboard';
import PerformanceReport from '../components/PerformanceReport';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';

describe('risk reporting UI', () => {
  it('renders a dense risk dashboard with risk, macro and curve intelligence', () => {
    const html = renderToStaticMarkup(
      <RiskDashboard state={initialState} config={baseConfig} attribution={null} />
    );

    expect(html).toContain('Bank risk position');
    expect(html).toContain('Balance-sheet risk');
    expect(html).toContain('Franchise &amp; earnings');
    expect(html).toContain('Macro model');
    expect(html).toContain('Gilt curve');
    expect(html).toContain('CET1');
    expect(html).toContain('LCR');

    expect(html).toContain('Regime');
    expect(html).toContain('Normal');
    expect(html).toContain('R* real');
    expect(html).toContain('1.25%');
    expect(html).toContain('Neutral nominal');
    expect(html).toContain('3.25%');
    expect(html).toContain('Policy target');
    expect(html).toContain('Term premium');
    expect(html).toContain('Demand (D)');
    expect(html).toContain('Financial stress (F)');

    expect(html).toContain('1Y');
    expect(html).toContain('30Y');
    expect(html).toContain('2s10s');
    expect(html).toContain('NS level β0');
    expect(html).not.toContain('stable funding confidence');

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
