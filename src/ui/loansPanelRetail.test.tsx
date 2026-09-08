import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LoansPanel from '../components/LoansPanel';
import { initialState } from '../config/initialState';
import { AssetProductType } from '../domain/enums';
import { getProduct } from '../products/catalogue';

it('shows every catalogue loan product in the retail loan report',()=>{
  const html=renderToStaticMarkup(<LoansPanel items={initialState.financial.balanceSheet.items} loanCohorts={initialState.loanCohorts} loanPipelines={initialState.loanPipelines} workoutPipelines={initialState.workoutPipelines}/>);
  for (const productType of [AssetProductType.Mortgages, AssetProductType.ConsumerLoans, AssetProductType.CorporateLoans]) {
    expect(html).toContain(getProduct(productType).label.replaceAll('&', '&amp;'));
  }
});

it('shows consumer cohorts as consumer rather than SME/corporate sectors',()=>{
  const consumerItems = initialState.financial.balanceSheet.items.filter((item)=>item.productType===AssetProductType.ConsumerLoans);
  const consumerCohorts = initialState.loanCohorts[AssetProductType.ConsumerLoans] ?? [];
  const html=renderToStaticMarkup(<LoansPanel items={consumerItems} loanCohorts={{[AssetProductType.ConsumerLoans]: consumerCohorts}} loanPipelines={{[AssetProductType.ConsumerLoans]: initialState.loanPipelines?.[AssetProductType.ConsumerLoans]}} workoutPipelines={{[AssetProductType.ConsumerLoans]: initialState.workoutPipelines?.[AssetProductType.ConsumerLoans]}}/>);
  expect(html).toContain(`Cohort breakdown — ${getProduct(AssetProductType.ConsumerLoans).label.replaceAll('&', '&amp;')}`);
  expect(html).toContain('Consumer');
  expect(html).not.toContain('Large corporate');
  expect(html).not.toContain('Commercial real estate');
  expect(html).not.toContain('>SME<');
  expect(html).toContain('Net carrying amount');
  expect(html).toContain('Offer rate');
  expect(html).toContain('Maturity bucket');
  expect(html).toContain('3–5 years');
  expect(html).not.toContain('ThreeToFiveY');
  expect(html).toContain('Current PD');
  expect(html).toContain('Current LGD');
  expect(html).not.toContain('Green safer');
});
