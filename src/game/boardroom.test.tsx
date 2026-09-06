import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialState } from '../config/initialState';
import { cloneBankState } from '../engine/clone';
import { boardDecisions, mandateProgress } from './boardroom';
import { parseRateInput } from '../utils/parsers';
import Boardroom from '../components/Boardroom';
describe('First-year mandate', () => {
  it('accounts for dilution and dividends per share and freezes the first-year result', () => {
    const history=[cloneBankState(initialState)];
    for(let i=1;i<=13;i++){
      const s=cloneBankState(initialState);s.time.step=i;s.financial.incomeStatement.netIncome=1e6;s.financial.incomeStatement.dividendsPaid=0;s.equityMarket.sharePrice=initialState.equityMarket.sharePrice*1.09;history.push(s);
    }
    history[13].equityMarket.sharePrice=0;
    expect(mandateProgress(history).stars).toBe(3);
    history[12].risk.compliance.lcrBreached=true;
    expect(mandateProgress(history).stars).toBe(0);
    expect(mandateProgress(history).finished).toBe(true);
  });
  it('provides executable proposal inputs with explicit cost and benefit', () => {
    for(const d of boardDecisions(initialState)){
      expect(d.benefit.length).toBeGreaterThan(0);expect(d.tradeoff.length).toBeGreaterThan(0);
      for(const [key,value] of Object.entries(d.changes))if(key.endsWith('Rate'))expect(parseRateInput(value).error).toBeUndefined();
    }
  });
  it('renders the management surface with invalid-plan guidance and no forced monthly action', () => {
    const noop=()=>{};
    const markup=renderToStaticMarkup(<Boardroom state={initialState} history={[initialState]} department={null} hasErrors onDepartment={noop} onClose={noop}/>);
    expect(markup).toContain('invalid policy input');expect(markup).toContain('Manage a department');expect(markup.match(/class="department-building/g)).toHaveLength(4);expect(markup).not.toContain('Adopt proposal');expect(markup).not.toContain('history-card');
  });
});

import { quarterlyReviews } from './boardroom';
it('freezes quarterly badges at their deadline and offers real equity recovery', () => {
  const first=structuredClone(initialState), end=structuredClone(first), later=structuredClone(first);
  end.time.step=3;later.time.step=4;later.behaviour.depositFranchiseStrength=0;
  expect(quarterlyReviews([first,end,later])[0].earned).toBe(true);
  later.risk.riskMetrics.internalCet1Headroom=-.01;
  const rescue=boardDecisions(later).find(d=>d.id==='capital');
  expect(Number(rescue?.changes.issueEquityAmount)).toBeGreaterThan(0);
  expect(boardDecisions(later).some(d=>d.id==='growth')).toBe(false);
});
