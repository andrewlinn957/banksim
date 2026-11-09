import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ActionsPanel from '../components/ActionsPanel';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { createActionFormState } from './actionFormState';
import { choicesForFormField, PLAYER_CONTROL_REGISTRY } from './playerControls';

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
});
