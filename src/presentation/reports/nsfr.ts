import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { commitmentNsfrContribution, eligibleCet1, type NsfrContribution, prudentialLiquidityLines } from '../../engine/prudential';
export type FundingRow={label:string;amount:number;weighted:number;factor:number|null};
export type Segment={label:string;value:number;color:string};
const palette=['#18528b','#4d95d6','#43ab85','#a0dbc8','#7661bd','#ada0df','#8060c5','#59418f'];

const capitalContribution=(category:'cet1Capital'|'at1Capital',corep:string,label:string,amount:number):NsfrContribution=>({
 side:'ASF',category,corep,label,group:'Eligible capital',sourceLabel:label,amount,factor:1,weighted:amount,maturityBand:'none'
});

const aggregateRows=(contributions:NsfrContribution[]):FundingRow[]=>{
 const rows=new Map<string,FundingRow>();
 contributions.forEach(c=>{
  const key=`${c.corep}|${c.label}|${c.factor}|${c.maturityBand}`;
  const band=c.maturityBand==='under6m'?'<6m':c.maturityBand==='sixTo12m'?'6–12m':c.maturityBand==='oneYearPlus'?'≥1y':'';
  const suffix=band?(c.side==='RSF'?` · exposure maturity ${band}`:` · ${band}`):'';
  const existing=rows.get(key)??{label:`${c.corep} · ${c.label}${suffix}`,amount:0,weighted:0,factor:c.factor};
  existing.amount+=c.amount;existing.weighted+=c.weighted;rows.set(key,existing);
 });
 return [...rows.values()].filter(r=>r.amount!==0||r.weighted!==0);
};

const aggregateGroups=(contributions:NsfrContribution[]):Segment[]=>{
 const groups=new Map<string,number>();
 contributions.forEach(c=>groups.set(c.group,(groups.get(c.group)??0)+c.weighted));
 return [...groups.entries()].map(([label,value],i)=>({label,value,color:palette[i%palette.length]}));
};

const maturityName=(c:NsfrContribution)=>c.category==='undrawnCommitment'?'Unallocated commitments':c.maturityBand==='under6m'?'< 6 months':c.maturityBand==='sixTo12m'?'6–12 months':c.maturityBand==='oneYearPlus'?'≥ 1 year':'No contractual maturity';

export function nsfrDashboardData(state:BankState,config:SimulationConfig) {
 const lines=prudentialLiquidityLines(state,config);
 const equity=eligibleCet1(state,config),at1=state.financial.capital.at1;
 const asfContributions:NsfrContribution[]=[
  capitalContribution('cet1Capital','C81 2.1.1','CET1 including eligible OCI',equity),
  capitalContribution('at1Capital','C81 2.1.2','AT1 capital',at1),
  ...lines.flatMap(l=>l.asfContributions),
 ];
 const commitment=commitmentNsfrContribution(state);
 const rsfContributions:NsfrContribution[]=[...lines.flatMap(l=>l.rsfContributions),...(commitment.amount>0?[commitment]:[])];
 const asfRows=aggregateRows(asfContributions),rsfRows=aggregateRows(rsfContributions);
 const asf=asfContributions.reduce((s,c)=>s+c.weighted,0),rsf=rsfContributions.reduce((s,c)=>s+c.weighted,0);
 const asfParts=aggregateGroups(asfContributions),rsfParts=aggregateGroups(rsfContributions);
 const maturities:Record<string,{asf:number;rsf:number}>={'< 6 months':{asf:0,rsf:0},'6–12 months':{asf:0,rsf:0},'≥ 1 year':{asf:0,rsf:0},'No contractual maturity':{asf:0,rsf:0},'Unallocated commitments':{asf:0,rsf:0}};
 asfContributions.forEach(c=>maturities[maturityName(c)].asf+=c.weighted);
 rsfContributions.forEach(c=>maturities[maturityName(c)].rsf+=c.weighted);
 return {asfRows,rsfRows,asf,rsf,ratio:rsf>0?asf/rsf:Infinity,minimum:config.riskLimits.minNsfr,target:Math.max(config.riskLimits.minNsfr,state.behaviour.riskAppetite?.nsfr??config.riskLimits.minNsfr*1.05),asfParts,rsfParts,maturities};
}
