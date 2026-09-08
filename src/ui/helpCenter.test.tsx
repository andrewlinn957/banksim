import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HelpCenterPanel from '../components/HelpCenterPanel';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';

describe('HelpCenterPanel', () => {
  it('renders a simple markdown-style game manual without dashboard clutter', () => {
    const html = renderToStaticMarkup(<HelpCenterPanel state={initialState} config={baseConfig}/>);

    expect(html).toContain('<h1>Help</h1>');
    expect(html).toContain('<h2>Playing the game</h2>');
    expect(html).toContain('<h2>Customers</h2>');
    expect(html).toContain('Fixed-term savings');
    expect(html).toContain('Mortgage LTV and fixed period');
    expect(html).toContain('Bank of England secured funding');
    expect(html).toContain('Equity and Tier 2 issuance');
    expect(html).toContain('Capital conservation, CCyB and O-SII buffers');
    expect(html).toContain('Pillar 2A and the SREP cycle');
    expect(html).toContain('once every 24 months');
    expect(html).toContain('PS15/20');
    expect(html).toContain('LCR = HQLA');
    expect(html).toContain('CET1 ratio = adjusted CET1 / RWA');
    expect(html).toContain('<pre');

    expect(html).not.toContain('Current bank');
    expect(html).not.toContain('Read a control in this order');
    expect(html).not.toContain('Current values and limits');
    expect(html).not.toContain('help-chip-row');
    expect(html).not.toContain('metric-card');
    expect(html).not.toContain('Wholesale ST/LT funding');
  });
});
