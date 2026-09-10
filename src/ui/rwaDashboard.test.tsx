import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RwaDashboard, { rwaDashboardData } from '../components/RwaDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { UK_ITL1_LABELS, UK_ITL1_REGIONS } from '../domain/ukItl1';
import { UK_ITL1_MAP_PATHS, UK_ITL1_MAP_VIEWBOX } from '../domain/ukItl1MapPaths';

it('reconciles the regional RWA map to loan credit RWA across all 12 ITL1 regions', () => {
  const data = rwaDashboardData(initialState, baseConfig);
  expect(Object.keys(data.regionalRwa)).toHaveLength(12);
  const regionalTotal = UK_ITL1_REGIONS.reduce((sum, region) => sum + data.regionalRwa[region], 0);
  expect(regionalTotal).toBeCloseTo(data.loanRwa, 4);
  expect(data.creditRwa + data.addOns).toBeCloseTo(data.totalRwa, 4);
});

it('uses the configured operational-risk RWA in the headline metrics', () => {
  const data = rwaDashboardData(initialState, baseConfig);
  expect(data.operationalRiskRwa).toBe(baseConfig.riskLimits.rwaAddOns?.operationalRisk);
});

it('renders official-shaped, focusable ITL1 regions with hover detail', () => {
  const html = renderToStaticMarkup(
    <RwaDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );
  expect(html).toContain('UK loan RWA by region');
  expect(html).toContain('Operational risk RWA');
  expect(html).toContain('RWA composition');
  expect(html).toContain('Risk-weighted assets over time');
  expect(html).toContain('Source: ONS ITL1 boundaries, January 2025');
  expect(html).toContain(`viewBox="${UK_ITL1_MAP_VIEWBOX}"`);
  expect((html.match(/data-itl1-region=/g) ?? []).length).toBe(12);
  expect((html.match(/tabindex="0"/g) ?? []).length).toBeGreaterThanOrEqual(12);
  UK_ITL1_REGIONS.forEach(region => {
    expect(UK_ITL1_MAP_PATHS[region].length).toBeGreaterThan(40);
    expect(html).toContain(`data-itl1-region="${region}"`);
    expect(html).toContain(UK_ITL1_LABELS[region]);
  });
});
