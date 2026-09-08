import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LeverageDashboard from '../components/LeverageDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';

it('renders a consistent compact leverage dashboard', () => {
  const html = renderToStaticMarkup(
    <LeverageDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );

  expect((html.match(/leverage-summary-card/g) ?? []).length).toBe(3);
  expect(html).toContain('Ratio thresholds');
  expect(html).toContain('Capital position');
  expect(html).toContain('leverage-compact-table');
  expect(html).toContain('Regulatory limit');
  expect(html).toContain('Internal limit');
  expect(html).not.toContain('Additional leverage buffers');
  expect(html).not.toContain('not separately modelled');
});
