import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App';
it('opens a usable paused management surface with permanent time controls and report access',()=>{
 const html=renderToStaticMarkup(<App/>);
 expect(html).toContain('Simulation time controls');
 expect(html).toContain('To quarter end');expect(html).toContain('To year end');
 expect(html).toContain('Bank areas');expect(html).toContain('Bank functional areas');
 expect(html).toContain('Deposits');expect(html).toContain('Treasury &amp; Funding');expect(html).toContain('Finance &amp; Capital');expect(html).toContain('Risk &amp; Regulatory');
 expect(html).toContain('>Scenarios<');expect(html).not.toContain('Bank reports and tools');
 expect(html.toLowerCase()).not.toContain('tutorial');expect(html).not.toContain('Your story starts here.');expect(html).not.toContain('actions-drawer');
});
