import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ActionsPanel from '../components/ActionsPanel';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { createActionFormState } from './actionFormState';
import {
  capitalMarketsInstrumentsForArea,
  choicesForFormField,
  PLAYER_CONTROL_REGISTRY,
} from './playerControls';

const renderedOptions = (html: string, label: string): string[] => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const select = html.match(new RegExp(`<label class="field"><strong>${escapedLabel}</strong><select[^>]*>([\\s\\S]*?)<\\/select>`))?.[1];
  if (!select) throw new Error(`Rendered select not found: ${label}`);
  return [...select.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
};

describe('rendered player controls use the shared registry', () => {
  it('renders the mortgage choices and selectivity increment defined by player controls', () => {
    const form = createActionFormState(initialState, baseConfig);
    const html = renderToStaticMarkup(
      <ActionsPanel department="Lending" bankState={initialState} state={form} onChange={() => {}} />
    );

    for (const ltv of choicesForFormField('mortgageMaxLtv')) {
      expect(html).toContain(`value="${Number(ltv).toFixed(2)}"`);
    }
    for (const months of choicesForFormField('mortgageFixedPeriodMonths')) {
      expect(html).toContain(`value="${months}"`);
    }
    const selectivity = PLAYER_CONTROL_REGISTRY.find((control) => control.id === 'policy.loan.mortgage_selectivity');
    expect(html).toContain(`step="${selectivity?.increment}"`);
    expect(html).toContain('aria-label="New lending selectivity slider"');
  });

  it('renders only the choices and area-specific instruments from the shared registry', () => {
    const form = createActionFormState(initialState, baseConfig);
    const customers = renderToStaticMarkup(<ActionsPanel department="Customers" bankState={initialState} state={form} onChange={() => {}} />);
    const lending = renderToStaticMarkup(<ActionsPanel department="Lending" bankState={initialState} state={form} onChange={() => {}} />);
    const capital = renderToStaticMarkup(<ActionsPanel department="Capital" bankState={initialState} state={form} onChange={() => {}} />);
    const treasury = renderToStaticMarkup(<ActionsPanel department="Treasury" bankState={initialState} state={form} onChange={() => {}} />);

    expect(renderedOptions(customers, 'Term')).toEqual(choicesForFormField('termDepositTenorMonths').map(String));
    expect(renderedOptions(lending, 'Maximum LTV')).toEqual(choicesForFormField('mortgageMaxLtv').map((value) => Number(value).toFixed(2)));
    expect(renderedOptions(lending, 'Initial fixed period')).toEqual(choicesForFormField('mortgageFixedPeriodMonths').map(String));
    expect(renderedOptions(treasury, 'Gilt transaction')).toEqual(['none', ...choicesForFormField('giltTradeDirection').map(String)]);
    expect(renderedOptions(treasury, 'Maturity')).toEqual(choicesForFormField('giltDurationYears').map(String));
    expect(renderedOptions(treasury, 'Bank of England facility')).toEqual(['none', ...choicesForFormField('boeFacility').map(String)]);
    expect(renderedOptions(treasury, 'Swap direction')).toEqual(['none', ...choicesForFormField('hedgeDirection').map(String)]);
    expect(renderedOptions(treasury, 'Swap term')).toEqual(choicesForFormField('hedgeMaturityMonths').map(String));
    expect(renderedOptions(capital, 'Instrument')).toEqual(['none', ...capitalMarketsInstrumentsForArea('Capital')]);
    expect(renderedOptions(treasury, 'Instrument')).toEqual(['none', ...capitalMarketsInstrumentsForArea('Treasury')]);
  });
});
