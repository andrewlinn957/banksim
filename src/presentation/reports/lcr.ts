import type { BankState } from '../../domain/bankState';
import type { SimulationConfig } from '../../domain/config';
import { calculateCor011, type LcrContribution } from '../../engine/cor011';
import { prudentialLiquidityLines } from '../../engine/prudential';
export type Part = {label:string;value:number;color:string};
export const colors=['#15578d','#149ed5','#7753be','#b398e3','#208674','#67c3a2','#8560b9','#57bce4'];

export const aggregateParts=(contributions:LcrContribution[]):Part[]=>{
 const grouped=new Map<string,number>();
 contributions.forEach(c=>{
  const label=`${c.corep} · ${c.label}`;
  grouped.set(label,(grouped.get(label)??0)+c.weighted);
 });
 return [...grouped.entries()].map(([label,value],i)=>({label,value,color:colors[i%colors.length]}));
};

export function lcrDashboardData(state:BankState,config:SimulationConfig) {
 const report=calculateCor011(state,config);
 const c76=report.c76;
 const lines=prudentialLiquidityLines(state,config);
 const outgoing=c76.totalOutflows;
 const incoming=report.inflows.reduce((sum,c)=>sum+c.weighted,0);
 const recognised=c76.reductionFullyExempt+c76.reduction90+c76.reduction75;
 const net=c76.netLiquidityOutflow;
 const requirement=config.riskLimits.minLcr;
 const target=Math.max(requirement,state.behaviour.riskAppetite?.lcr??requirement*1.1);
 const hqla={
  level1:c76.unadjustedLevel1,
  level2a:c76.unadjustedLevel2A,
  level2b:c76.unadjustedLevel2B,
  eligibleLevel2a:c76.unadjustedLevel2A,
  eligibleLevel2b:Math.max(0,c76.liquidityBuffer-c76.unadjustedLevel1-c76.unadjustedLevel2A),
  capDeduction:Math.max(0,c76.unadjustedLevel1+c76.unadjustedLevel2A+c76.unadjustedLevel2B-c76.liquidityBuffer),
  total:c76.liquidityBuffer,
 };
 return {
  report,c76,lines,hqla,
  commitments:report.outflows.filter(c=>c.corep.startsWith('C73 1.1.6')).reduce((sum,c)=>sum+c.weighted,0),
  outgoing,incoming,cap:outgoing*.75,recognised,net,requirement,target,ratio:c76.lcr,
  required:net*requirement,surplus:hqla.total-net*requirement,
  outParts:aggregateParts(report.outflows),
  inParts:aggregateParts(report.inflows),
  hqlaParts:aggregateParts(report.liquidAssets),
 };
}
