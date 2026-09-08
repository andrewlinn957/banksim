import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LoansPanel from '../components/LoansPanel';
import { initialState } from '../config/initialState';

it('shows mortgages, personal credit and SME/business lending in the retail loan report',()=>{
  const html=renderToStaticMarkup(<LoansPanel items={initialState.financial.balanceSheet.items} loanCohorts={initialState.loanCohorts} loanPipelines={initialState.loanPipelines} workoutPipelines={initialState.workoutPipelines}/>);
  expect(html).toContain('Mortgages');
  expect(html).toContain('Personal Credit');
  expect(html).toContain('SME &amp; Business');
  expect(html).toContain('Personal Loans &amp; Revolving Credit');
});
