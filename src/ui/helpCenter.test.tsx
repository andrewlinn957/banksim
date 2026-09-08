import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HelpCenterPanel from '../components/HelpCenterPanel';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';

describe('HelpCenterPanel', () => {
  it('renders the current retail-bank controls and equations in plain language', () => {
    const html = renderToStaticMarkup(<HelpCenterPanel state={initialState} config={baseConfig}/>);

    expect(html).toContain('How the bank works');
    expect(html).toContain('Current bank');
    expect(html).toContain('Fixed-term savings');
    expect(html).toContain('Mortgage LTV and fixed period');
    expect(html).toContain('Bank of England secured funding');
    expect(html).toContain('Equity and Tier 2 issuance');
    expect(html).toContain('LCR = HQLA');
    expect(html).toContain('CET1 ratio = adjusted CET1 / RWA');
    expect(html).not.toContain('Mechanics Help Center');
    expect(html).not.toContain('Wholesale ST/LT funding');
  });
});
