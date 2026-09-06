import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App';
it('opens a usable paused management surface with permanent time controls and report access',()=>{
 const html=renderToStaticMarkup(<App/>);
 expect(html).toContain('Simulation time controls');
 expect(html).toContain('Run to quarter end');expect(html).toContain('Run to year end');
 expect(html).toContain('Reports and tools');expect(html).toContain('Bank departments');
 expect(html).toContain('Your story starts here.');
});
