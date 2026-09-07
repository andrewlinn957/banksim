import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { formatPct } from '../utils/formatters';
export type RiskAppetite = NonNullable<BankState['behaviour']['riskAppetite']>;
export default function RiskAppetiteEditor({state,config,pending,onQueue}: {state:BankState;config:SimulationConfig;pending?:RiskAppetite|null;onQueue:(t:RiskAppetite|null)=>void}) {
 const current= pending ?? state.behaviour.riskAppetite ?? {cet1:state.risk.riskMetrics.internalCet1TargetRatio,leverage:config.riskLimits.minLeverageRatio*1.05,lcr:config.riskLimits.minLcr*1.1,nsfr:config.riskLimits.minNsfr*1.05};
 const [draft,setDraft]=useState(()=>Object.fromEntries(Object.entries(current).map(([k,v])=>[k,(v*100).toFixed(2)])));
 const keys=['cet1','leverage','lcr','nsfr'] as const;
 const values=Object.fromEntries(keys.map(k=>[k,Number(draft[k])/100])) as RiskAppetite;
 const valid=keys.every(k=>draft[k]?.trim()!==''&&Number.isFinite(values[k])&&values[k]>0&&values[k]<=(k==='cet1'||k==='leverage'?1:10));
 return <section className="capital-card risk-appetite-editor"><h3>Board risk appetite</h3><p>Set standing targets. CET1 governs distribution restraint; all four govern safety pauses during automatic play. Targets apply at the next monthly close and persist until changed.</p>
 <div className="appetite-fields">{keys.map(k=><label className="field" key={k}><strong>{k==='cet1'?'CET1':k==='leverage'?'Leverage':k.toUpperCase()} target (%)</strong><input type="number" step="0.01" min="0.01" max={k==='cet1'||k==='leverage'?100:1000} value={draft[k]} disabled={state.status.hasFailed} onChange={e=>setDraft({...draft,[k]:e.target.value})}/><small>Current effective target: {formatPct(k==='cet1'?state.risk.riskMetrics.internalCet1TargetRatio:Math.max(k==='leverage'?config.riskLimits.minLeverageRatio:k==='lcr'?config.riskLimits.minLcr:config.riskLimits.minNsfr,state.behaviour.riskAppetite?.[k]??(k==='leverage'?config.riskLimits.minLeverageRatio*1.05:k==='lcr'?config.riskLimits.minLcr*1.1:config.riskLimits.minNsfr*1.05)))}</small></label>)}</div>
 <p className="muted">The effective CET1 target cannot fall below the PRA buffer target. Other targets cannot fall below regulatory minima. Higher CET1 targets retain more earnings; lower targets leave less protection against losses.</p>
 <div className="metric-switch"><button className="button primary" disabled={!valid||state.status.hasFailed} onClick={()=>onQueue(values)}>Apply at next close</button><button className="button ghost" disabled={state.status.hasFailed} onClick={()=>onQueue(null)}>Restore automatic targets</button></div>
 {!valid&&<p role="alert">Enter positive percentages; capital targets may be up to 100%, liquidity targets up to 1,000%.</p>}
 {pending!==undefined&&<p role="status">{pending===null?'Automatic targets queued.':`Queued: CET1 ${formatPct(pending.cet1)}, leverage ${formatPct(pending.leverage)}, LCR ${formatPct(pending.lcr)}, NSFR ${formatPct(pending.nsfr)}.`} Time is paused. Run the next close to apply.</p>}
 </section>;
}
