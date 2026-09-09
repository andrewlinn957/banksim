import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LeverageDashboard from '../components/LeverageDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { cloneBankState } from '../engine/clone';

it('renders the opening bank as subject to the leverage expectation in the redesigned dashboard', () => {
  const html = renderToStaticMarkup(
    <LeverageDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );

  expect((html.match(/leverage-summary-card/g) ?? []).length).toBe(3);
  expect(html).toContain('Leverage position');
  expect(html).toContain('Requirement composition');
  expect(html).toContain('Minimum / PRA expectation');
  expect(html).toContain('Indicative requirement if in scope');
  expect(html).toContain('Minimum CET1 component');
  expect(html).toContain('AT1 eligible');
  expect(html).toContain('CCLB (CET1 only)');
  expect(html).toContain('ALRB (CET1 only)');
  expect(html).toContain('Framework scope');
  expect(html).toContain('Expectation only');
  expect(html).toContain('Expectation limit');
  expect(html).toContain('£75.00bn');
  expect(html).toContain('£10.00bn');
  expect(html).toContain('Leverage exposure reconciliation');
  expect(html).toContain('leverage-waterfall');
  expect(html).toContain('Leverage exposure measure over time');
  expect(html).toContain('Current LEM');
  expect(html).toContain('Change (Q/Q)');
  expect(html).not.toContain('leverage-compact-table');
  expect(html).not.toContain('Additional leverage buffers');
});

it('switches concise labels to binding requirements when the bank is in scope', () => {
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
  expect(html).toContain('Requirement limit');
  expect(html).toContain('Minimum leverage requirement');
  expect(html).toContain('Leverage requirement including buffers');
  expect(html).toContain('Minimum Tier 1 requirement');
  expect(html).not.toContain('Expectation limit');
});

it('renders the two leverage requirement bars with the 75% CET1 quality floor', () => {
  const html = renderToStaticMarkup(
    <LeverageDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );

  expect((html.match(/leverage-requirement-bar/g) ?? []).length).toBe(2);
  expect(html).toContain('2.44%');
  expect(html).toContain('0.81%');
  expect(html).toContain('3.25%');
  expect(html).toContain('3.95%');
  expect(html).toContain('data-requirement-view="ratio"');
  expect(html).toContain('data-requirement-view="amount"');

  const shares = [...html.matchAll(/data-requirement-share="([^"]+)"/g)].map(match => Number(match[1]));
  expect(shares).toHaveLength(6);
  expect(shares[0] + shares[1]).toBeCloseTo(1, 10);
  expect(shares.slice(2).reduce((total, share) => total + share, 0)).toBeCloseTo(1, 10);
});

it('keeps leverage position threshold callout labels visibly separated', () => {
  const html = renderToStaticMarkup(
    <LeverageDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );

  const labelYs = [...html.matchAll(/data-threshold-label-y="([^"]+)"/g)]
    .map(match => Number(match[1]))
    .sort((a, b) => a - b);

  expect(labelYs).toHaveLength(3);
  expect(labelYs[1] - labelYs[0]).toBeGreaterThanOrEqual(50);
  expect(labelYs[2] - labelYs[1]).toBeGreaterThanOrEqual(50);
});

it('renders negative CET1 below zero while retaining positive AT1 in the leverage position chart', () => {
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
