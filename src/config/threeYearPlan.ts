import type { BankState } from '../domain/bankState';
import { createThreeYearPlanState, DEFAULT_THREE_YEAR_PLAN_SETTINGS, type ThreeYearPlanTarget } from '../domain/threeYearPlan';
import { bankThreeYearPlanMetricRegistry, THREE_YEAR_PLAN_METRICS as M } from '../engine/threeYearPlanMetrics';

export const DEFAULT_THREE_YEAR_PLAN_WEIGHTS = { eps: 25, rote: 20, customerLending: 15, customerDeposits: 10, cet1: 15, lcr: 7.5, nsfr: 7.5 } as const;
const milestones = (a:number,b:number,c:number) => [{month:12 as const,lower:a},{month:24 as const,lower:b},{month:36 as const,lower:c}];

const REQUIRED_METRICS = [M.eps, M.rote, M.customerLending, M.customerDeposits, M.cet1, M.lcr, M.nsfr] as const;
const PROFITABILITY_METRICS = new Set<string>([M.eps, M.rote]);
const FRANCHISE_METRICS = new Set<string>([M.customerLending, M.customerDeposits]);
const RESILIENCE_METRICS = new Set<string>([M.cet1, M.lcr, M.nsfr]);

const agreementFloorFactor = (metricId:string):number =>
  metricId===M.eps||metricId===M.rote ? .80 :
  metricId===M.customerLending||metricId===M.customerDeposits ? .95 : 1;

const firstCycleBaseline = (state:BankState,metricId:string,current:number):number => {
  const firstArchived = state.threeYearPlan?.priorCycles?.[0]?.targets.find(target=>target.metricId===metricId)?.baseline;
  const currentPlan = state.threeYearPlan?.targets.find(target=>target.metricId===metricId)?.baseline;
  const anchor = firstArchived ?? currentPlan;
  return Number.isFinite(anchor) ? Math.max(current, anchor as number) : current;
};

/**
 * Calibrated board reference plan. For customer balances, successor cycles do not silently
 * ratchet ambition down after a missed plan: the commercial reference is at least the bank's
 * first-cycle opening scale, while the interpolation baseline remains the bank's actual current state.
 */
export const createDefaultThreeYearPlanTargets = (state: BankState): ThreeYearPlanTarget[] => {
  const read = (id:string) => bankThreeYearPlanMetricRegistry.read(id,state);
  const lending = read(M.customerLending), deposits = read(M.customerDeposits);
  const lendingReference = firstCycleBaseline(state,M.customerLending,lending);
  const depositReference = firstCycleBaseline(state,M.customerDeposits,deposits);
  return [
    { metricId:M.eps, weight:25, kind:'minimum', baseline:read(M.eps), milestones:milestones(.08,.09,.10), missTolerance:.08 },
    { metricId:M.rote, weight:20, kind:'minimum', baseline:read(M.rote), milestones:milestones(.08,.09,.10), missTolerance:.08 },
    { metricId:M.customerLending, weight:15, kind:'minimum', baseline:lending, milestones:milestones(lendingReference*1.00,lendingReference*.99,lendingReference*.97), missTolerance:lendingReference*.18 },
    { metricId:M.customerDeposits, weight:10, kind:'minimum', baseline:deposits, milestones:milestones(depositReference*.97,depositReference*.96,depositReference*.95), missTolerance:depositReference*.15 },
    { metricId:M.cet1, weight:15, kind:'minimum', baseline:read(M.cet1), milestones:milestones(.12,.125,.13), missTolerance:.03 },
    { metricId:M.lcr, weight:7.5, kind:'minimum', baseline:read(M.lcr), milestones:milestones(1.20,1.20,1.20), missTolerance:.25 },
    { metricId:M.nsfr, weight:7.5, kind:'minimum', baseline:read(M.nsfr), milestones:milestones(1.15,1.15,1.15), missTolerance:.15 },
  ];
};

/**
 * Board agreement gate. This constrains what can be called an agreed plan; it does not enter
 * the plan score or Board Confidence calculation. Management can change emphasis, but cannot
 * manufacture confidence by zero-weighting hard objectives or setting trivial targets.
 */
export const validateThreeYearPlanAgreement = (state:BankState,targets:readonly ThreeYearPlanTarget[]):string[] => {
  const issues:string[]=[];
  const byMetric = new Map<string,ThreeYearPlanTarget>();
  for(const target of targets){
    if(byMetric.has(target.metricId)) issues.push(`Duplicate plan measure: ${target.metricId}.`);
    byMetric.set(target.metricId,target);
  }
  const missing = REQUIRED_METRICS.filter(metricId=>!byMetric.has(metricId));
  const extra = [...byMetric.keys()].filter(metricId=>!REQUIRED_METRICS.includes(metricId as typeof REQUIRED_METRICS[number]));
  if(missing.length) issues.push(`The board plan must include all seven measures; missing ${missing.join(', ')}.`);
  if(extra.length) issues.push(`The board plan contains unsupported measures: ${extra.join(', ')}.`);
  if(issues.length) return issues;

  const weightTotal = targets.reduce((sum,target)=>sum+target.weight,0);
  if(!Number.isFinite(weightTotal)||Math.abs(weightTotal-100)>.01) issues.push('Plan weights must total 100%.');
  for(const target of targets){
    if(!Number.isFinite(target.weight)||target.weight<2.5) issues.push(`${bankThreeYearPlanMetricRegistry.get(target.metricId).label} must carry at least 2.5% weight.`);
  }
  const categoryWeight=(set:Set<string>)=>targets.filter(target=>set.has(target.metricId)).reduce((sum,target)=>sum+Math.max(0,target.weight),0);
  if(categoryWeight(PROFITABILITY_METRICS)<35) issues.push('Profitability measures (EPS and RoTE) must carry at least 35% combined weight.');
  if(categoryWeight(FRANCHISE_METRICS)<20) issues.push('Customer lending and deposits must carry at least 20% combined weight.');
  if(categoryWeight(RESILIENCE_METRICS)<25) issues.push('Capital and liquidity measures must carry at least 25% combined weight.');

  const reference = createDefaultThreeYearPlanTargets(state);
  for(const boardTarget of reference){
    const proposed=byMetric.get(boardTarget.metricId)!;
    if(proposed.milestones.length!==3||proposed.milestones.map(m=>m.month).join(',')!=='12,24,36'){
      issues.push(`${bankThreeYearPlanMetricRegistry.get(boardTarget.metricId).label} needs FY1, FY2 and FY3 milestones.`);
      continue;
    }
    const floorFactor=agreementFloorFactor(boardTarget.metricId);
    proposed.milestones.forEach((milestone,index)=>{
      const floor=boardTarget.milestones[index].lower*floorFactor;
      if(!Number.isFinite(milestone.lower)||milestone.lower<floor-1e-9){
        const label=bankThreeYearPlanMetricRegistry.get(boardTarget.metricId).label;
        issues.push(`${label} FY${index+1} is below the board's minimum ambition.`);
      }
    });
  }
  return issues;
};

export const createDefaultThreeYearPlan = (state: BankState) => createThreeYearPlanState({ startStep: state.time.step, targets: createDefaultThreeYearPlanTargets(state), settings: { ...DEFAULT_THREE_YEAR_PLAN_SETTINGS, enabled: true } });
