import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LeverageDashboard from '../components/LeverageDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { cloneBankState } from '../engine/clone';

it('renders the opening bank as subject to the leverage expectation', () => {
  const html = renderToStaticMarkup(
    <LeverageDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );

  expect((html.match(/leverage-summary-card/g) ?? []).length).toBe(3);
  expect(html).toContain('Leverage framework');
  expect(html).toContain('Ratio thresholds');
  expect(html).toContain('Capital position');
  expect(html).toContain('leverage-compact-table');
  expect(html).toContain('Expectation only');
  expect(html).toContain('Expectation limit');
  expect(html).toContain('CCLB');
  expect(html).toContain('ALRB');
  expect(html).toContain('indicative');
  expect(html).toContain('£75.00bn');
  expect(html).toContain('£10.00bn');
  expect(html).not.toContain('Additional leverage buffers');
});

it('switches concise labels to requirement when the bank is in scope', () => {
  const state = cloneBankState(initialState);
  state.risk.leverageFramework = {
    inScope: true,
    scopeRoute: 'retailDeposits',
    assessmentStep: 0,
    assessmentDate: new Date(state.time.date).toISOString(),
    nextAssessmentStep: 12,
    averageRetailDeposits: 80e9,
    averageNonUkAssets: 0,
    accountingReferenceObservations: [-24, -12, 0].map(step => ({
      step,
      date: new Date(state.time.date).toISOString(),
      retailDeposits: 80e9,
      nonUkAssets: 0,
    })),
  };
  const html = renderToStaticMarkup(
    <LeverageDashboard state={state} config={baseConfig} history={[state]} />
  );
  expect(html).toContain('In scope');
  expect(html).toContain('Regulatory limit');
  expect(html).toContain('Leverage requirement');
  expect(html).not.toContain('Expectation limit');
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
