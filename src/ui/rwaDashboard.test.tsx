import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RwaDashboard, { rwaDashboardData } from '../components/RwaDashboard';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { UK_ITL1_LABELS, UK_ITL1_REGIONS } from '../domain/ukItl1';

it('reconciles the regional RWA map to loan credit RWA across all 12 ITL1 regions', () => {
  const data = rwaDashboardData(initialState, baseConfig);
  expect(Object.keys(data.regionalRwa)).toHaveLength(12);
  const regionalTotal = UK_ITL1_REGIONS.reduce((sum, region) => sum + data.regionalRwa[region], 0);
  expect(regionalTotal).toBeCloseTo(data.loanRwa, 4);
  expect(data.creditRwa + data.addOns).toBeCloseTo(data.totalRwa, 4);
});

it('renders a focusable coloured map with hover detail titles for every ITL1 region', () => {
  const html = renderToStaticMarkup(
    <RwaDashboard state={initialState} config={baseConfig} history={[initialState]} />
  );
  expect(html).toContain('UK loan RWA by region');
  expect(html).toContain('RWA composition');
  expect(html).toContain('Risk-weighted assets over time');
  expect((html.match(/data-itl1-region=/g) ?? []).length).toBe(12);
  expect((html.match(/tabindex="0"/g) ?? []).length).toBeGreaterThanOrEqual(12);
  UK_ITL1_REGIONS.forEach(region => {
    expect(html).toContain(`data-itl1-region="${region}"`);
    expect(html).toContain(UK_ITL1_LABELS[region]);
  });
});
