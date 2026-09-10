import type { BankState } from '../domain/bankState';
import { createThreeYearPlanState, DEFAULT_THREE_YEAR_PLAN_SETTINGS, type ThreeYearPlanTarget } from '../domain/threeYearPlan';
import { bankThreeYearPlanMetricRegistry, THREE_YEAR_PLAN_METRICS as M } from '../engine/threeYearPlanMetrics';

export const DEFAULT_THREE_YEAR_PLAN_WEIGHTS = { eps: 25, rote: 20, customerLending: 15, customerDeposits: 10, cet1: 15, lcr: 7.5, nsfr: 7.5 } as const;
const milestones = (a:number,b:number,c:number) => [{month:12 as const,lower:a},{month:24 as const,lower:b},{month:36 as const,lower:c}];

/** Calibrated against coherent 36-month managed paths across deterministic macro seeds. */
export const createDefaultThreeYearPlanTargets = (state: BankState): ThreeYearPlanTarget[] => {
  const read = (id:string) => bankThreeYearPlanMetricRegistry.read(id,state);
  const lending = read(M.customerLending), deposits = read(M.customerDeposits);
  return [
    { metricId:M.eps, weight:25, kind:'minimum', baseline:read(M.eps), milestones:milestones(.08,.09,.10), missTolerance:.08 },
    { metricId:M.rote, weight:20, kind:'minimum', baseline:read(M.rote), milestones:milestones(.08,.09,.10), missTolerance:.08 },
    { metricId:M.customerLending, weight:15, kind:'minimum', baseline:lending, milestones:milestones(lending*1.00,lending*.99,lending*.97), missTolerance:lending*.18 },
    { metricId:M.customerDeposits, weight:10, kind:'minimum', baseline:deposits, milestones:milestones(deposits*.97,deposits*.96,deposits*.95), missTolerance:deposits*.15 },
    { metricId:M.cet1, weight:15, kind:'minimum', baseline:read(M.cet1), milestones:milestones(.12,.125,.13), missTolerance:.03 },
    { metricId:M.lcr, weight:7.5, kind:'minimum', baseline:read(M.lcr), milestones:milestones(1.20,1.20,1.20), missTolerance:.25 },
    { metricId:M.nsfr, weight:7.5, kind:'minimum', baseline:read(M.nsfr), milestones:milestones(1.15,1.15,1.15), missTolerance:.15 },
  ];
};

export const createDefaultThreeYearPlan = (state: BankState) => createThreeYearPlanState({ startStep: state.time.step, targets: createDefaultThreeYearPlanTargets(state), settings: { ...DEFAULT_THREE_YEAR_PLAN_SETTINGS, enabled: true } });
