import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { calculateRiskMetrics } from '../engine/metrics';
import CapitalDashboard, { capitalDashboardData } from '../components/CapitalDashboard';

it('reconciles displayed CET1 requirements and nominal headroom to the engine across capital mixes',()=>{
  for(const at1 of [0, 100e6, 2e9]) {
    const state=structuredClone(initialState);
    state.financial.capital.at1=at1;
    const metrics=calculateRiskMetrics({state,config:baseConfig});
    state.risk.riskMetrics=metrics;
    const d=capitalDashboardData(state,baseConfig);
    expect(d.rows.reduce((s,r)=>s+r.ratio,0)).toBeCloseTo(metrics.cet1Requirement,12);
    expect(d.cards[0].requirement).toBeCloseTo(metrics.cet1Requirement,12);
    expect(d.cards[0].amount-d.cards[0].requiredAmount).toBeCloseTo(metrics.cet1Headroom*metrics.rwa,4);
    expect(d.cards[2].amount).toBeCloseTo(d.cards[1].amount + (state.financial.capital.tier2 ?? 0), 4);
  }
});

it('shows issued Tier 2 in total capital without changing Tier 1',()=>{
  const state=structuredClone(initialState);
  state.financial.capital.tier2=75e6;
  state.risk.riskMetrics=calculateRiskMetrics({state,config:baseConfig});
  const d=capitalDashboardData(state,baseConfig);
  expect(d.tier2).toBe(75e6);
  expect(d.cards[2].amount-d.cards[1].amount).toBeCloseTo(75e6,4);
  expect(d.cards[2].actual).toBeCloseTo(state.risk.riskMetrics.totalCapitalRatio ?? 0,12);
});

it('shows the 24-month Pillar 2A assessment, its risk components and PS15/20 offset',()=>{
  const html=renderToStaticMarkup(<CapitalDashboard state={initialState} config={baseConfig}/>);
  expect(html).toContain('Pillar 2A SREP assessment');
  expect(html).toContain('reset every 24 months');
  expect(html).toContain('SA credit-risk underestimation');
  expect(html).toContain('Single-name concentration');
  expect(html).toContain('Geographic concentration');
  expect(html).toContain('IRRBB');
  expect(html).toContain('PS15/20 initial offset');
  expect(html).toContain('UK CCyB pass-through');
  expect(html).toContain('Next review');
});


it('shows the dynamic capital buffer framework and O-SII growth trigger',()=>{
  const html=renderToStaticMarkup(<CapitalDashboard state={initialState} config={baseConfig}/>);
  expect(html).toContain('Capital buffer framework');
  expect(html).toContain('Institution-specific countercyclical buffer');
  expect(html).toContain('O-SII buffer');
  expect(html).toContain('O-SII growth trigger');
  expect(html).toContain('scope threshold');
});
