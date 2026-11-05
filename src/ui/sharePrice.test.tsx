import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import SharePricePanel from '../components/SharePricePanel';

const card = (html: string, label: string) => {
  const start = html.indexOf(`<div class="metric-label">${label}</div>`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</div></div>', start) + 6);
};

describe('share valuation reporting', () => {
  it('keeps model and quoted P/E distinct when price lags a profit collapse', () => {
    const state = structuredClone(initialState);
    Object.assign(state.equityMarket, {
      sharePrice: 1.2645,
      epsTtm: 0.1137,
      smoothedAnnualisedEps: 0.1137,
      trailingEps: 0.15044,
      trailingEarningsMonths: 12,
      peMultiple: 7.87,
    });
    const html = renderToStaticMarkup(<SharePricePanel state={state} history={[state]} config={baseConfig} />);
    expect(card(html, 'Model P/E')).toContain('7.87');
    expect(card(html, 'Quoted P/E (smoothed)')).toContain('11.12');
    expect(card(html, 'Quoted P/E (TTM)')).toContain('8.41');
    expect(card(html, 'Smoothed annualised EPS')).toContain('0.1137');
    expect(card(html, 'TTM EPS')).toContain('0.1504');
    expect(html).not.toContain('TTM proxy');
  });

  it('marks incomplete trailing history unavailable without substituting the smoothed estimate', () => {
    const state = structuredClone(initialState);
    state.equityMarket.trailingEps = null;
    state.equityMarket.trailingEarningsMonths = 6;
    const html = renderToStaticMarkup(<SharePricePanel state={state} history={[state]} config={baseConfig} />);
    expect(card(html, 'TTM EPS')).toContain('N/A');
    expect(card(html, 'TTM EPS')).toContain('6 of 12 months recorded');
    expect(card(html, 'Quoted P/E (TTM)')).toContain('N/A');
  });
});
