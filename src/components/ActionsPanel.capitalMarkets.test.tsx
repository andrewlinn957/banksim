import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { buildCapitalMarketsBook } from '../engine/capitalMarkets';
import ActionsPanel, { type ActionFormState } from './ActionsPanel';

const form = (overrides: Partial<ActionFormState> = {}): ActionFormState => ({
  retailCurrentAccountRate:'3%',termDepositRate:'4%',termDepositTenorMonths:'12',corporateDepositRate:'3%',
  mortgageRate:'5%',consumerLoanRate:'8%',corporateLoanRate:'6%',mortgageUnderwritingTightness:'0.2',consumerUnderwritingTightness:'0.3',corporateUnderwritingTightness:'0.2',
  mortgageMaxLtv:'0.85',mortgageFixedPeriodMonths:'24',capitalMarketsInstrument:'none',capitalMarketsTargetAmount:'',capitalMarketsMaxDiscount:'15%',capitalMarketsMaxSpreadBps:'1000',capitalMarketsTenorMonths:'60',
  dividendPayoutRatio:'30%',at1CouponMode:'auto',giltTradeDirection:'none',giltTradeAmount:'',giltDurationYears:'5',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24',
  ...overrides,
});

describe('capital-markets transaction ticket', () => {
  it('shows an indicative equity book with demand, coverage and clearing discount', () => {
    const state=form({capitalMarketsInstrument:'cet1',capitalMarketsTargetAmount:'100m'});
    const quote=buildCapitalMarketsBook(initialState,baseConfig,{instrument:'cet1',targetAmount:100e6,maxDiscount:.15});
    const markup=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} capitalMarketsQuote={quote}/>);
    expect(markup).toContain('Indicative book');
    expect(markup).toContain('CET1 equity');
    expect(markup).toContain('coverage');
    expect(markup).toContain('Clearing discount');
    expect(markup).toContain('issue price');
  });

  it('shows spread and tenor controls for a Tier 2 book on the Treasury & Funding desk', () => {
    const state=form({capitalMarketsInstrument:'tier2',capitalMarketsTargetAmount:'100m',capitalMarketsTenorMonths:'84'});
    const quote=buildCapitalMarketsBook(initialState,baseConfig,{instrument:'tier2',targetAmount:100e6,maxSpreadBps:1000,tenorMonths:84});
    const markup=renderToStaticMarkup(<ActionsPanel department="Treasury" state={state} onChange={()=>{}} capitalMarketsQuote={quote}/>);
    expect(markup).toContain('Wholesale funding markets');
    expect(markup).toContain('Tier 2');
    expect(markup).toContain('Maximum acceptable spread');
    expect(markup).toContain('7 years');
    expect(markup).toContain('Clearing spread');
    expect(markup).toContain('all-in yield');
  });

  it('only shows plan impact when supplied and states there is no direct Board Confidence effect', () => {
    const state=form({capitalMarketsInstrument:'cet1',capitalMarketsTargetAmount:'100m'});
    const quote=buildCapitalMarketsBook(initialState,baseConfig,{instrument:'cet1',targetAmount:100e6,maxDiscount:.15});
    const withoutPlan=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} capitalMarketsQuote={quote}/>);
    const withPlan=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} capitalMarketsQuote={quote} capitalMarketsPlanImpact={{cet1Before:.13,cet1After:.145,epsBefore:.08,epsAfter:.075}}/>);
    expect(withoutPlan).not.toContain('Three-Year Plan impact');
    expect(withPlan).toContain('Three-Year Plan impact');
    expect(withPlan).toContain('no direct Board Confidence effect');
  });
});
