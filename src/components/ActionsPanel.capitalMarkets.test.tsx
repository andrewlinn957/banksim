import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { buildPlayerCapitalMarketsQuote } from '../presentation/quotes';
import { updateActionFormFields } from '../application/playerControls';
import ActionsPanel, { type ActionFormState } from './ActionsPanel';

const form = (overrides: Partial<ActionFormState> = {}): ActionFormState => ({
  retailCurrentAccountRate:'3%',termDepositRate:'4%',termDepositTenorMonths:'12',corporateDepositRate:'3%',
  mortgageRate:'5%',consumerLoanRate:'8%',corporateLoanRate:'6%',mortgageUnderwritingTightness:'0.2',consumerUnderwritingTightness:'0.3',corporateUnderwritingTightness:'0.2',
  mortgageMaxLtv:'0.85',mortgageFixedPeriodMonths:'24',capitalMarketsInstrument:'none',capitalMarketsTargetAmount:'',capitalMarketsMaxDiscount:'15%',capitalMarketsMaxSpreadBps:'1000',capitalMarketsTenorMonths:'60',
  dividendPayoutRatio:'30%',at1CouponMode:'auto',giltTradeDirection:'none',giltTradeAmount:'',giltDurationYears:'5',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24',
  ...overrides,
});

describe('capital-markets transaction ticket', () => {
  it('keeps a valid capital transaction marked as a draft until the queue button is pressed', () => {
    const state=form({capitalMarketsInstrument:'cet1',capitalMarketsTargetAmount:'100m'});
    const markup=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} onQueueTransaction={()=>{}}/>);
    expect(markup).toContain('Draft · not queued');
    expect(markup).toContain('Queue transaction');
    expect(markup).not.toContain('Transaction queued for next close');
  });

  it('shows committed transactions and explains that they execute when time advances', () => {
    const markup=renderToStaticMarkup(<ActionsPanel
      department="Capital"
      state={form()}
      onChange={()=>{}}
      queuedTransactions={[{id:1,kind:'capitalMarkets',label:'AT1 · £100m'}]}
      onCancelQueuedTransaction={()=>{}}
    />);
    expect(markup).toContain('Transaction queued for next close');
    expect(markup).toContain('They will execute once when you roll the game forward one month.');
    expect(markup).toContain('AT1 · £100m');
    expect(markup).toContain('Remove');
  });

  it('shows an indicative equity book with demand, coverage and clearing discount', () => {
    const state=form({capitalMarketsInstrument:'cet1',capitalMarketsTargetAmount:'100m'});
    const quote=buildPlayerCapitalMarketsQuote(initialState,baseConfig,{instrument:'cet1',targetAmount:100e6,maxDiscount:.15});
    const markup=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} capitalMarketsQuote={quote}/>);
    expect(markup).toContain('Indicative book');
    expect(markup).toContain('CET1 equity');
    expect(markup).toContain('coverage');
    expect(markup).toContain('Clearing discount');
    expect(markup).toContain('issue price');
  });

  it('shows the return estimate that drives CET1 investor demand', () => {
    const state=form({capitalMarketsInstrument:'cet1',capitalMarketsTargetAmount:'100m'});
    const quote=buildPlayerCapitalMarketsQuote(initialState,baseConfig,{instrument:'cet1',targetAmount:100e6,maxDiscount:.5});
    const markup=renderToStaticMarkup(<ActionsPanel department="Capital" bankState={initialState} state={state} onChange={()=>{}} capitalMarketsQuote={quote}/>);
    expect(markup).toContain('Post-raise ROE proxy');
    expect(markup).toContain('Expected dividend/share');
    expect(markup).toContain('Expected total return proxy');
    expect(markup).toContain('Cost of equity');
    expect(markup).toContain('Investor demand factor');
    expect(markup).toContain('ROE estimate assumes proceeds earn the cash reserve rate.');
  });

  it('shows spread and tenor controls for a Tier 2 book on the Capital desk', () => {
    const state=form({capitalMarketsInstrument:'tier2',capitalMarketsTargetAmount:'100m',capitalMarketsTenorMonths:'84'});
    const quote=buildPlayerCapitalMarketsQuote(initialState,baseConfig,{instrument:'tier2',targetAmount:100e6,maxSpreadBps:1000,tenorMonths:84});
    const markup=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} capitalMarketsQuote={quote}/>);
    expect(markup).toContain('Raise capital');
    expect(markup).toContain('Tier 2');
    expect(markup).toContain('Maximum acceptable spread');
    expect(markup).toContain('7 years');
    expect(markup).toContain('Clearing spread');
    expect(markup).toContain('all-in yield');
  });

  it('uses shared form side effects when a rendered GUI selector changes', () => {
    const state = form({ capitalMarketsTenorMonths: '84', giltTradeDirection: 'buy', giltTradeAmount: '10m' });
    const markup = renderToStaticMarkup(<ActionsPanel department="Treasury" state={state} onChange={() => {}}/>);
    expect(markup).toContain('Swap term');
    expect(markup).toContain('value="senior"');

    const selectedInstrument = updateActionFormFields(state, { capitalMarketsInstrument: 'senior' });
    expect(selectedInstrument.capitalMarketsInstrument).toBe('senior');
    expect(selectedInstrument.capitalMarketsTenorMonths).toBe('36');
    const discardedGilt = updateActionFormFields(state, { giltTradeDirection: 'none' });
    expect(discardedGilt.giltTradeDirection).toBe('none');
    expect(discardedGilt.giltTradeAmount).toBe('');
  });

  it('identifies a transaction draft in the other management area', () => {
    const state=form({capitalMarketsInstrument:'senior',capitalMarketsTargetAmount:'100m',capitalMarketsTenorMonths:'84'});
    const markup=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}}/>);
    expect(markup).toContain('is drafted in Treasury &amp; Funding');
    expect(markup).toContain('Switch areas to queue or discard this draft.');
    expect(markup).toContain('<select disabled=""');
    expect(markup).not.toContain('Indicative book');
    expect(markup).not.toContain('Discard draft');
  });

  it('shows explicit queue and discard controls for Treasury transactions', () => {
    const state=form({
      capitalMarketsInstrument:'senior',capitalMarketsTargetAmount:'100m',capitalMarketsTenorMonths:'84',
      giltTradeDirection:'buy',giltTradeAmount:'50m',boeFacility:'ILTR',boeFundingAmount:'100m',
      hedgeDirection:'payFixedReceiveFloat',hedgeNotional:'75m',hedgeMaturityMonths:'24',
    });
    const markup=renderToStaticMarkup(<ActionsPanel department="Treasury" state={state} onChange={()=>{}} maxGiltSaleAmount={200e6} maxBoeFundingAmount={150e6}/>);
    expect(markup.match(/Queue transaction/g)?.length).toBe(4);
    expect(markup).toContain('Discard draft');
    expect(markup).not.toContain('Cancel gilt transaction');
    expect(markup).not.toContain('Cancel Bank of England drawing');
    expect(markup).not.toContain('Cancel swap transaction');
    expect(markup).not.toContain('Cancel queued transactions');
  });

  it('only shows quantified plan impact when supplied', () => {
    const state=form({capitalMarketsInstrument:'cet1',capitalMarketsTargetAmount:'100m'});
    const quote=buildPlayerCapitalMarketsQuote(initialState,baseConfig,{instrument:'cet1',targetAmount:100e6,maxDiscount:.15});
    const withoutPlan=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} capitalMarketsQuote={quote}/>);
    const withPlan=renderToStaticMarkup(<ActionsPanel department="Capital" state={state} onChange={()=>{}} capitalMarketsQuote={quote} capitalMarketsPlanImpact={{cet1Before:.13,cet1After:.145,epsBefore:.08,epsAfter:.075}}/>);
    expect(withoutPlan).not.toContain('Three-Year Plan impact');
    expect(withPlan).toContain('Three-Year Plan impact');
    expect(withPlan).toContain('13.00% → 14.50%');
    expect(withPlan).toContain('8.0p → 7.5p');
  });
});
