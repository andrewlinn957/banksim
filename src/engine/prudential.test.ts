import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType as A, LiabilityProductType as L, HQLALevel, BalanceSheetSide } from '../domain/enums';
import { cloneBankState } from './clone';
import { centralBankExclusion, commitmentLiquidity, prudentialLiquidityLines } from './prudential';
import { calculateRiskMetrics, computeHqla, evaluateCompliance } from './metrics';
import { computeMetrics } from './simulation';
import { regulatoryRows } from '../components/RegMetricsPanel';
const line = (s: typeof initialState, p: A | L) => s.financial.balanceSheet.items.find(i => i.productType === p)!;
describe('2026 prudential rules under documented portfolio assumptions', () => {
  it('uses separate CET1, Tier 1, total own funds and leverage thresholds', () => {
    expect(baseConfig.riskLimits).toMatchObject({ minCet1Ratio: .045, minTier1Ratio: .06, minTotalCapitalRatio: .08, minLeverageRatio: .0325 });
    const m = { ...initialState.risk.riskMetrics, cet1Ratio: .05, tier1Ratio: .055, totalCapitalRatio: .055 };
    expect(evaluateCompliance(m, baseConfig.riskLimits).ownFundsBreached).toBe(true);
    expect(evaluateCompliance({ ...m, lcr: NaN }, baseConfig.riskLimits).lcrBreached).toBe(true);
  });
  it('does not include management buffers in the regulatory CET1 requirement', () => {
    const config = structuredClone(baseConfig); config.riskLimits.capitalBufferStack.managementBuffer = .5;
    expect(calculateRiskMetrics({ state: initialState, config }).cet1Requirement).toBe(initialState.risk.riskMetrics.cet1Requirement);
  });
  it('caps HQLA Level 2 at 40% and Level 2B at 15% after haircuts', () => {
    const h = (level: HQLALevel, balance: number) => ({ ...line(initialState, A.Gilts), balance, encumbrance: { encumberedAmount: 0 }, liquidityTag: { productType: A.Gilts, hqlaLevel: level } });
    expect(computeHqla([h(HQLALevel.Level1, 60), h(HQLALevel.Level2A, 1000)])).toBeCloseTo(100);
    expect(computeHqla([h(HQLALevel.Level1, 85), h(HQLALevel.Level2B, 1000)])).toBeCloseTo(100);
    expect(computeHqla([h(HQLALevel.Level2A, 1000)])).toBe(0);
  });
  it('uses retail/corporate liquidity factors independently of reputation', () => {
    const expected = [[L.RetailTransactionalDeposits,.05,.95],[L.RetailSavingsDeposits,.1,.9],[L.CorporateOperatingDeposits,.25,.5],[L.CorporateNonOperatingDeposits,.4,.5]] as const;
    const lines = prudentialLiquidityLines(initialState, baseConfig);
    for (const [p, runoff, asf] of expected) {
      const l = lines.find(x => x.productType === p)!;
      expect(l.outflow / l.balance).toBeCloseTo(runoff); expect(l.asf / l.balance).toBeCloseTo(asf);
    }
  });
  it('uses contractual wholesale maturities at 1, 6 and 12 months', () => {
    const s = cloneBankState(initialState);
    s.fundingLadders[L.WholesaleFundingLT] = [1,5,6,11,12].map(monthsToMaturity => ({ monthsToMaturity, tenorMonths: 24, notional: 100, rate: 0 }));
    line(s,L.WholesaleFundingLT).balance=500;
    const l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===L.WholesaleFundingLT)!;
    expect(l.outflow).toBe(100);expect(l.asf).toBe(200);
  });
  it('excludes defaulted loan inflows and uses qualifying mortgage maturity RSF', () => {
    const s=cloneBankState(initialState), c=s.loanCohorts[A.Mortgages]![0];
    s.loanCohorts[A.Mortgages]=[{...c,outstandingPrincipal:100,annualInterestRate:0,termMonths:12,ageMonths:0,stage:'stage1'}];s.workoutPipelines[A.Mortgages]=[];line(s,A.Mortgages).balance=100;
    let l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===A.Mortgages)!;
    expect(l.inflow).toBeCloseTo(100/12*.5);expect(l.rsf).toBeCloseTo(100 * (11 / 12 * .5 + 1 / 12 * .65));
    s.loanCohorts[A.Mortgages]![0].stage='stage3';l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===A.Mortgages)!;
    expect(l.inflow).toBe(0);expect(l.rsf).toBe(100);
  });
  it('limits reserve exclusion to deposit-matched reserves and includes commitments', () => {
    const s=cloneBankState(initialState);
    s.financial.balanceSheet.items.filter(i=>i.side===BalanceSheetSide.Liability).forEach(i=>i.balance=0);
    line(s,L.RetailTransactionalDeposits).balance=100;
    expect(centralBankExclusion(s)).toBe(100);
    s.loanPipelines={ [A.Mortgages]:{demandNotional:0,approvedNotional:0,committedNotional:100},[A.CorporateLoans]:{demandNotional:0,approvedNotional:0,committedNotional:100} };
    expect(commitmentLiquidity(s)).toEqual({outflow:15,rsf:10});
    const before=calculateRiskMetrics({state:s,config:baseConfig});s.loanPipelines={};const after=calculateRiskMetrics({state:s,config:baseConfig});
    expect(before.leverageExposure-after.leverageExposure).toBeCloseTo(40);
    expect(before.rwa-after.rwa).toBeCloseTo(27);
  });
  it('lets an LCR shortfall recover without declaring legal resolution or game failure', () => {
    const s=cloneBankState(initialState);line(s,A.Gilts).encumbrance.encumberedAmount=line(s,A.Gilts).balance;
    line(s,A.CashReserves).encumbrance.encumberedAmount=line(s,A.CashReserves).balance;
    computeMetrics(s,baseConfig,1,[]);
    expect(s.risk.compliance.lcrBreached).toBe(true);expect(s.status.hasFailed).toBe(false);
  });
  it('reconciles regulatory contribution tables with the engine', () => {
    const rows=regulatoryRows(initialState,baseConfig,'rwa');
    expect(rows.filter(r=>!r.total).reduce((sum,r)=>sum+r.value,0)).toBeCloseTo(initialState.risk.riskMetrics.rwa,4);
    const lcr=regulatoryRows(initialState,baseConfig,'lcr');
    const h=lcr.find(r=>r.label==='Total HQLA')!.value,n=lcr.find(r=>r.label==='Net outflows')!.value;
    expect(h/n).toBeCloseTo(initialState.risk.riskMetrics.lcr,10);
  });
});
