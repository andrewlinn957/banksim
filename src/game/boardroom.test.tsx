import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialState } from '../config/initialState';
import { boardDecisions } from './boardroom';
import { parseRateInput } from '../utils/parsers';
import Boardroom from '../components/Boardroom';

describe('board management', () => {
  it('provides executable proposal inputs with explicit cost and benefit', () => {
    for (const decision of boardDecisions(initialState)) {
      expect(decision.benefit.length).toBeGreaterThan(0);
      expect(decision.tradeoff.length).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(decision.changes)) {
        if (key.endsWith('Rate')) expect(parseRateInput(value).error).toBeUndefined();
      }
    }
  });

  it('renders the management surface with invalid-plan guidance and no forced monthly action', () => {
    const noop = () => {};
    const markup = renderToStaticMarkup(
      <Boardroom
        state={initialState}
        history={[initialState]}
        department={null}
        hasErrors
        onDepartment={noop}
        onClose={noop}
      />
    );
    expect(markup).toContain('invalid policy input');
    expect(markup).toContain('Manage a department');
    expect(markup.match(/class="department-building/g)).toHaveLength(4);
    expect(markup).not.toContain('Adopt proposal');
    expect(markup).not.toContain('history-card');
  });

  it('offers real equity recovery when internal capital headroom is negative', () => {
    const stressed = structuredClone(initialState);
    stressed.risk.riskMetrics.internalCet1Headroom = -.01;
    const rescue = boardDecisions(stressed).find((decision) => decision.id === 'capital');
    expect(Number(rescue?.changes.issueEquityAmount)).toBeGreaterThan(0);
    expect(boardDecisions(stressed).some((decision) => decision.id === 'growth')).toBe(false);
  });
});
