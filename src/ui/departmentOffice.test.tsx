import { describe,it,expect,vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DepartmentOffice from '../components/DepartmentOffice';
import { ActionFormState } from '../components/ActionsPanel';
import { initialState } from '../config/initialState';

const form:ActionFormState={
 retailCurrentAccountRate:'2%',termDepositRate:'3.8%',termDepositTenorMonths:'12',corporateDepositRate:'3%',mortgageRate:'5%',consumerLoanRate:'10.5%',corporateLoanRate:'6%',
 mortgageUnderwritingTightness:'.5',consumerUnderwritingTightness:'.5',corporateUnderwritingTightness:'.5',mortgageMaxLtv:'.85',mortgageFixedPeriodMonths:'24',
 capitalMarketsInstrument:'none',capitalMarketsTargetAmount:'',capitalMarketsMaxDiscount:'15%',capitalMarketsMaxSpreadBps:'1000',capitalMarketsTenorMonths:'60',
 dividendPayoutRatio:'.3',at1CouponMode:'auto',giltTradeDirection:'buy',giltTradeAmount:'250m',giltDurationYears:'5',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24'
};
const noop=()=>{};
const props={state:initialState,history:[initialState],form,errors:{},hasErrors:false,onChange:noop,onReport:noop,onHelp:noop,estimate:null};

const findButton=(node:ReactNode,text:string):ReactElement|null=>{
 if(!node||typeof node==='string'||typeof node==='number'||typeof node==='boolean')return null;
 if(Array.isArray(node)){for(const child of node){const found=findButton(child,text);if(found)return found;}return null;}
 const element=node as ReactElement<{children?:ReactNode;onClick?:()=>void}>;
 const label=renderToStaticMarkup(element).replace(/<[^>]+>/g,'');
 if(element.type==='button'&&label.includes(text))return element;
 return findButton(element.props.children,text);
};

describe('Department decision destinations',()=>{
 it('keeps lending controls and market references while providing contextual help',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Lending" {...props}/>);
  expect(html).toContain('Undrawn commitments');expect(html).toContain('Approvals this quarter');
  expect(html).toContain('Mortgages');expect(html).toContain('value="5%"');expect(html).toContain('Selectivity');
  expect(html).toContain('Competitor rates');expect(html).toContain('New mortgages');expect(html).toContain('SME/business');
  expect(html).toContain('How pricing and selectivity affect lending');
 });
 it('uses current-account language for the retail sight-deposit market reference',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Customers" {...props}/>);
  expect(html).toContain('Retail current accounts');expect(html).not.toContain('Instant savings');
 });
 it('routes Treasury liquidity buttons to their intended regulatory metrics',()=>{
  const onReport=vi.fn();
  const tree=DepartmentOffice({department:'Treasury',...props,onReport});
  const lcr=findButton(tree,'Liquidity coverage');
  const nsfr=findButton(tree,'Stable funding');
  expect(lcr).not.toBeNull();expect(nsfr).not.toBeNull();
  lcr!.props.onClick?.();nsfr!.props.onClick?.();
  expect(onReport).toHaveBeenNthCalledWith(1,'Regulatory','lcr','Treasury');
  expect(onReport).toHaveBeenNthCalledWith(2,'Regulatory','nsfr','Treasury');
 });
 it('shows gilt investment as an explicit one-off trade with a live curve yield',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Treasury" {...props}/>);
  expect(html).toContain('Gilt transaction');expect(html).toContain('Buy gilts');expect(html).toContain('Sell gilts');
  expect(html).toContain('Gilt trade amount (£)');expect(html).toContain('Current simulated gilt yield:');
 });
});
