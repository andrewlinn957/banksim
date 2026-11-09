import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DepartmentOffice from '../components/DepartmentOffice';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { createActionFormState } from '../application/actionFormState';
import { buildDepartmentPreview } from './playerPreviews';

describe('rendered department previews use the shared player projection', () => {
  it('renders the same selected metrics and forecast values returned to API readers', () => {
    const next = structuredClone(initialState);
    next.risk.riskMetrics.cet1Ratio = 0.07123;
    next.financial.incomeStatement.netInterestIncome = 17_250_000;
    const form = createActionFormState(initialState, baseConfig);
    const projection = buildDepartmentPreview('Customers', initialState, next, 0, false, false);
    const markup = renderToStaticMarkup(
      <DepartmentOffice
        department="Customers"
        state={initialState}
        history={[initialState]}
        form={form}
        errors={{}}
        hasErrors={false}
        onChange={() => {}}
        onReport={() => {}}
        onHelp={() => {}}
        estimate={next}
      />
    );

    expect(markup).toContain(projection.ratios.find((row) => row.label === 'CET1')!.after);
    expect(markup).toContain(projection.commercialImpact.find((row) => row.label === 'Net interest income')!.after);
    expect(markup).toContain(projection.impactHeading.replace('&', '&amp;'));
  });
});
