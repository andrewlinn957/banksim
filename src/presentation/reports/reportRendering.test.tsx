import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LcrDashboard from '../../components/LcrDashboard';
import { baseConfig } from '../../config/baseConfig';
import { initialState } from '../../config/initialState';
import { AssetProductType } from '../../domain/enums';
import { formatCurrency } from '../../utils/formatters';
import { lcrDashboardData } from './lcr';

describe('rendered regulatory reports use shared presentation builders', () => {
  it('renders the LCR report values calculated by its shared data builder', () => {
    const state = {
      ...initialState,
      financial: {
        ...initialState.financial,
        balanceSheet: {
          ...initialState.financial.balanceSheet,
          items: initialState.financial.balanceSheet.items.map((item) => item.productType === AssetProductType.CashReserves
            ? { ...item, balance: item.balance + 125_000_000 }
            : item),
        },
      },
    };
    const expected = lcrDashboardData(state, baseConfig);
    const markup = renderToStaticMarkup(<LcrDashboard state={state} config={baseConfig} history={[state]} />);

    expect(markup).toContain(formatCurrency(expected.hqla.total));
    expect(markup).toContain('COR011 detail');
    expect(markup).toContain('C72 — Liquid assets');
    expect(markup).toContain('underlying contributions');
  });
});
