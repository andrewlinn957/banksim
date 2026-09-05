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
  it('renders the monthly decision flow and disables the close action for invalid input', () => {
    const noop=()=>{};
    const markup=renderToStaticMarkup(<Boardroom state={initialState} history={[initialState]} selected={[]} campaign hasErrors onDecision={noop} onRun={noop} onPlan={noop} onRestart={noop} onContinue={noop} onNavigate={noop}/>);
    expect(markup).toContain('Close month 1');expect(markup).toContain('disabled');expect(markup).toContain('Your plan has an invalid input');expect(markup).toContain('What’s on the agenda?');
  });
});
