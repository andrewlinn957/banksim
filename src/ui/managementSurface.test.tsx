import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App';
it('opens a usable paused management surface with permanent time controls and report access',()=>{
 const html=renderToStaticMarkup(<App/>);
 expect(html).toContain('Simulation time controls');
 expect(html).toContain('To quarter end');expect(html).toContain('To year end');
 expect(html).toContain('Bank reports and tools');expect(html).toContain('Manage a department');
 expect(html).toContain('Capital &amp; liquidity');expect(html).not.toContain('<summary>Reports</summary>');
 expect(html).not.toContain('Your story starts here.');expect(html).not.toContain('actions-drawer');
});
