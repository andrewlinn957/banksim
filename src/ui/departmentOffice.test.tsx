import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DepartmentOffice from '../components/DepartmentOffice';
import { ActionFormState } from '../components/ActionsPanel';
import { initialState } from '../config/initialState';
const form:ActionFormState={retailDepositRate:'2%',termDepositRate:'3.8%',termDepositTenorMonths:'12',corporateDepositRate:'3%',mortgageRate:'5%',consumerLoanRate:'10.5%',corporateLoanRate:'6%',mortgageUnderwritingTightness:'.5',consumerUnderwritingTightness:'.5',corporateUnderwritingTightness:'.5',mortgageMaxLtv:'.85',mortgageFixedPeriodMonths:'24',issueLTDebtAmount:'',issueEquityAmount:'',issueTier2Amount:'',dividendPayoutRatio:'.3',at1CouponMode:'auto',giltShareOfHqla:'.6',giltDurationYears:'5',boeFacility:'none',boeFundingAmount:'',hedgeDirection:'none',hedgeNotional:'',hedgeFixedRate:'',hedgeMaturityMonths:'24'};
const noop=()=>{};
describe('Department decision destinations',()=>{
 it('puts lending controls beside actual loan pipeline information and labels the report separately',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Lending" state={initialState} history={[initialState]} form={form} errors={{}} hasErrors={false} selected={[]} onChange={noop} onDecision={noop} onReport={noop} onHelp={noop} estimate={null}/>);
  expect(html).toContain('Undrawn commitments');expect(html).toContain('Approvals this quarter');
  expect(html).toContain('Mortgages');expect(html).toContain('value="5%"');expect(html).toContain('Selectivity');
  expect(html).toContain('Competitor rates');expect(html).toContain('New mortgages');expect(html).toContain('SME/business');
  expect(html).toContain('Read loan portfolio report');expect(html).not.toContain('Retail savings offer');
 });
 it('keeps invalid inputs in another department visible so time cannot appear silently blocked',()=>{
  const html=renderToStaticMarkup(<DepartmentOffice department="Customers" state={initialState} history={[initialState]} form={form} errors={{hedgeNotional:'Enter a valid amount'}} hasErrors selected={[]} onChange={noop} onDecision={noop} onReport={noop} onHelp={noop} estimate={null}/>);
  expect(html).toContain('Enter a valid amount');expect(html).toContain('role="alert"');expect(html).toContain('Instant-access savings offer');
  expect(html).toContain('Competitor rates');expect(html).toContain('Instant savings');expect(html).toContain('Business deposits');
 });
});
