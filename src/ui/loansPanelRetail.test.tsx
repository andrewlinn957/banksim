import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LoansPanel from '../components/LoansPanel';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';

it('shows mortgages, personal credit and SME/business lending in the retail loan report',()=>{
  const html=renderToStaticMarkup(<LoansPanel items={initialState.financial.balanceSheet.items} loanCohorts={initialState.loanCohorts} loanPipelines={initialState.loanPipelines} workoutPipelines={initialState.workoutPipelines}/>);
  expect(html).toContain('Residential mortgages');
  expect(html).toContain('Personal loans &amp; revolving credit');
  expect(html).toContain('SME &amp; business lending');
  expect(html).toContain('Personal Loans &amp; Revolving Credit');
});


it('shows consumer cohorts as consumer rather than SME/corporate sectors',()=>{
  const consumerItems = initialState.financial.balanceSheet.items.filter((item)=>item.productType===AssetProductType.ConsumerLoans);
  const consumerCohorts = initialState.loanCohorts[AssetProductType.ConsumerLoans] ?? [];
  const html=renderToStaticMarkup(<LoansPanel items={consumerItems} loanCohorts={{[AssetProductType.ConsumerLoans]: consumerCohorts}} loanPipelines={{[AssetProductType.ConsumerLoans]: initialState.loanPipelines?.[AssetProductType.ConsumerLoans]}} workoutPipelines={{[AssetProductType.ConsumerLoans]: initialState.workoutPipelines?.[AssetProductType.ConsumerLoans]}}/>);
  expect(html).toContain('Cohort breakdown — Personal loans &amp; revolving credit');
  expect(html).toContain('Consumer');
  expect(html).not.toContain('Large corporate');
  expect(html).not.toContain('Commercial real estate');
  expect(html).not.toContain('>SME<');
  expect(html).toContain('Net carrying amount');
  expect(html).toContain('Offer rate');
  expect(html).toContain('Maturity bucket');
});
