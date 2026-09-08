import { useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { formatCurrency, formatPct } from '../utils/formatters';

export type RiskAppetite = NonNullable<BankState['behaviour']['riskAppetite']>;

export default function RiskAppetiteEditor({state,config,pending,onQueue}: {state:BankState;config:SimulationConfig;pending?:RiskAppetite|null;onQueue:(t:RiskAppetite|null)=>void}) {
  const automatic = {
    cet1: state.risk.riskMetrics.internalCet1TargetRatio,
    leverage: config.riskLimits.minLeverageRatio * 1.05,
    lcr: config.riskLimits.minLcr * 1.1,
    nsfr: config.riskLimits.minNsfr * 1.05,
    irrbbEveLimit: config.riskLimits.pillar2A?.defaultIrrbbEveLimit ?? 250e6,
  };
  const current: RiskAppetite = { ...automatic, ...(pending ?? state.behaviour.riskAppetite ?? {}) };
  const ratioKeys=['cet1','leverage','lcr','nsfr'] as const;
  const [draft,setDraft]=useState(()=>Object.fromEntries(ratioKeys.map(k=>[k,(current[k]*100).toFixed(2)])) as Record<typeof ratioKeys[number],string>);
  const [irrbbDraft,setIrrbbDraft]=useState(()=>((current.irrbbEveLimit ?? automatic.irrbbEveLimit)/1e6).toFixed(0));
  const ratioValues=Object.fromEntries(ratioKeys.map(k=>[k,Number(draft[k])/100])) as Pick<RiskAppetite,typeof ratioKeys[number]>;
  const irrbbEveLimit=Number(irrbbDraft)*1e6;
  const values: RiskAppetite={...ratioValues,irrbbEveLimit};
  const validRatios=ratioKeys.every(k=>draft[k]?.trim()!==''&&Number.isFinite(ratioValues[k])&&ratioValues[k]>0&&ratioValues[k]<=(k==='cet1'||k==='leverage'?1:10));
  const valid=validRatios&&irrbbDraft.trim()!==''&&Number.isFinite(irrbbEveLimit)&&irrbbEveLimit>0;

  return <section className="capital-card risk-appetite-editor"><h3>Board risk appetite</h3><p>Set standing targets. CET1 governs distribution restraint; capital and liquidity targets govern safety pauses. The IRRBB limit is used at the next annual Pillar 2A assessment. Targets apply at the next monthly close and persist until changed.</p>
    <div className="appetite-fields">{ratioKeys.map(k=><label className="field" key={k}><strong>{k==='cet1'?'CET1':k==='leverage'?'Leverage':k.toUpperCase()} target (%)</strong><input type="number" step="0.01" min="0.01" max={k==='cet1'||k==='leverage'?100:1000} value={draft[k]} disabled={state.status.hasFailed} onChange={e=>setDraft({...draft,[k]:e.target.value})}/><small>Current effective target: {formatPct(k==='cet1'?state.risk.riskMetrics.internalCet1TargetRatio:Math.max(k==='leverage'?config.riskLimits.minLeverageRatio:k==='lcr'?config.riskLimits.minLcr:config.riskLimits.minNsfr,state.behaviour.riskAppetite?.[k]??(k==='leverage'?config.riskLimits.minLeverageRatio*1.05:k==='lcr'?config.riskLimits.minLcr*1.1:config.riskLimits.minNsfr*1.05)))}</small></label>)}
      <label className="field"><strong>IRRBB EVE limit (£m, ±200bp)</strong><input type="number" step="10" min="1" value={irrbbDraft} disabled={state.status.hasFailed} onChange={e=>setIrrbbDraft(e.target.value)}/><small>Current policy limit: {formatCurrency(state.behaviour.riskAppetite?.irrbbEveLimit ?? automatic.irrbbEveLimit)}</small></label>
    </div>
    <p className="muted">The effective CET1 target cannot fall below the PRA buffer target. Other ratio targets cannot fall below regulatory minima. The IRRBB limit does not change the current P2A immediately: it is one input to the next annual SREP assessment.</p>
    <div className="metric-switch"><button className="button primary" disabled={!valid||state.status.hasFailed} onClick={()=>onQueue(values)}>Apply at next close</button><button className="button ghost" disabled={state.status.hasFailed} onClick={()=>onQueue(null)}>Restore automatic targets</button></div>
    {!valid&&<p role="alert">Enter positive percentages and a positive IRRBB EVE limit; capital targets may be up to 100%, liquidity targets up to 1,000%.</p>}
    {pending!==undefined&&<p role="status">{pending===null?'Automatic targets queued.':`Queued: CET1 ${formatPct(pending.cet1)}, leverage ${formatPct(pending.leverage)}, LCR ${formatPct(pending.lcr)}, NSFR ${formatPct(pending.nsfr)}, IRRBB limit ${formatCurrency(pending.irrbbEveLimit ?? automatic.irrbbEveLimit)}.`} Time is paused. Run the next close to apply.</p>}
  </section>;
}
