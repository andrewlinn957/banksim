import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LeverageDashboard from '../components/LeverageDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { cloneBankState } from '../engine/clone';

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


it('renders negative CET1 below zero while retaining positive AT1 in the composition chart', () => {
  const state = cloneBankState(initialState);
  state.financial.capital.cet1 = -100e6;
  state.financial.capital.accumulatedOCI = 0;
  state.financial.capital.at1 = 250e6;

  const html = renderToStaticMarkup(
    <LeverageDashboard state={state} config={baseConfig} history={[state]} />
  );

  expect(html).toContain('leverage-zero-axis');
  const cet1Rect = html.match(/<rect[^>]*data-capital-component="CET1"[^>]*>/)?.[0] ?? '';
  const at1Rect = html.match(/<rect[^>]*data-capital-component="AT1"[^>]*>/)?.[0] ?? '';
  expect(cet1Rect).toContain('data-end-ratio="-');
  expect(at1Rect).toContain('data-start-ratio="-');
  expect(cet1Rect).toMatch(/height="(?!0(?:\.0+)?")[^"]+"/);
  expect(at1Rect).toMatch(/height="(?!0(?:\.0+)?")[^"]+"/);
});
