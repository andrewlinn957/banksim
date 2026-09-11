import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { AssetProductType as A, LiabilityProductType as L, HQLALevel, BalanceSheetSide } from '../domain/enums';
import { cloneBankState } from './clone';
import { centralBankExclusion, commitmentLiquidity, prudentialLiquidityLines, retailCurrentAccountRegulatoryFactors } from './prudential';
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
  it('classifies retail current accounts explicitly for LCR and NSFR', () => {
    const factors = retailCurrentAccountRegulatoryFactors(initialState);
    expect(factors.stableShare).toBeCloseTo(0.9);
    expect(factors.otherShare).toBeCloseTo(0.1);
    expect(factors.lcrOutflowFactor).toBeCloseTo(0.055);
    expect(factors.nsfrAsfFactor).toBeCloseTo(0.945);
    const lines = prudentialLiquidityLines(initialState, baseConfig);
    const retail = lines.find(x => x.productType === L.RetailCurrentAccounts)!;
    expect(retail.outflow / retail.balance).toBeCloseTo(0.055);
    expect(retail.asf / retail.balance).toBeCloseTo(0.945);
    expect(retail.asfContributions.map(c => c.category)).toEqual(['stableRetail', 'otherRetail']);
    expect(retail.asfContributions.map(c => c.corep)).toEqual(['C81 2.2.1', 'C81 2.2.2']);
    const operating = lines.find(x => x.productType === L.CorporateOperatingDeposits)!;
    const otherBusiness = lines.find(x => x.productType === L.CorporateNonOperatingDeposits)!;
    expect(operating.outflow / operating.balance).toBeCloseTo(0.25);
    expect(operating.asf / operating.balance).toBeCloseTo(0.5);
    expect(operating.asfContributions[0].corep).toBe('C81 2.3.5');
    expect(otherBusiness.outflow / otherBusiness.balance).toBeCloseTo(0.4);
    expect(otherBusiness.asf / otherBusiness.balance).toBeCloseTo(0.5);
  });
  it('uses stable/other retail factors and maturity-based NSFR treatment for fixed-term savings', () => {
    const s = cloneBankState(initialState);
    s.fundingLadders[L.RetailTermDeposits] = [
      { monthsToMaturity: 1, tenorMonths: 12, notional: 100, rate: .04 },
      { monthsToMaturity: 12, tenorMonths: 12, notional: 100, rate: .04 },
    ];
    line(s,L.RetailTermDeposits).balance=200;
    const l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===L.RetailTermDeposits)!;
    expect(l.outflow).toBeCloseTo(10);
    expect(l.asf).toBeCloseTo(194.5);
    expect(l.asfContributions.reduce((sum,c)=>sum+c.weighted,0)).toBeCloseTo(l.asf);
    expect(l.asfContributions.filter(c=>c.maturityBand==='under6m').map(c=>c.factor).sort()).toEqual([0.9,0.95]);
    expect(l.asfContributions.filter(c=>c.maturityBand==='oneYearPlus').every(c=>c.factor===1)).toBe(true);
  });
  it('uses contractual wholesale maturities at 1, 6 and 12 months', () => {
    const s = cloneBankState(initialState);
    s.fundingLadders[L.WholesaleFundingLT] = [1,5,6,11,12].map(monthsToMaturity => ({ monthsToMaturity, tenorMonths: 24, notional: 100, rate: 0 }));
    line(s,L.WholesaleFundingLT).balance=500;
    const l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===L.WholesaleFundingLT)!;
    expect(l.outflow).toBe(100);expect(l.asf).toBe(200);
    expect(l.asfContributions.every(c=>c.corep==='C81 2.6')).toBe(true);
  });
  it('uses the Tier 2 capital-instrument ASF schedule rather than generic wholesale treatment', () => {
    const s=cloneBankState(initialState);
    s.financial.balanceSheet.items.push({ ...line(s,L.WholesaleFundingLT), productType:L.Tier2Debt, label:'Tier 2 subordinated debt', balance:200 });
    s.fundingLadders[L.Tier2Debt]=[
      { monthsToMaturity:11, tenorMonths:60, notional:100, rate:.06 },
      { monthsToMaturity:12, tenorMonths:60, notional:100, rate:.06 },
    ];
    const l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===L.Tier2Debt)!;
    expect(l.asf).toBe(100);
    expect(l.asfContributions.map(c=>c.factor)).toEqual([0,1]);
    expect(l.asfContributions.every(c=>c.corep==='C81 2.1.3')).toBe(true);
  });
  it('splits performing mortgage principal across the C80 exposure-maturity columns', () => {
    const s=cloneBankState(initialState), c=s.loanCohorts[A.Mortgages]![0];
    s.loanCohorts[A.Mortgages]=[{...c,outstandingPrincipal:100,annualInterestRate:0,termMonths:12,ageMonths:0,stage:'stage1'}];s.workoutPipelines[A.Mortgages]=[];line(s,A.Mortgages).balance=100;
    let l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===A.Mortgages)!;
    expect(l.inflow).toBeCloseTo(100/12*.5);
    expect(l.rsf).toBeCloseTo(100 * (11 / 12 * .5 + 1 / 12 * .65));
    expect(l.rsfContributions.map(c=>c.category)).toEqual(['mortgage','mortgage','mortgage']);
    expect(l.rsfContributions.map(c=>c.corep)).toEqual(['C80 1.4.5.1','C80 1.4.5.1','C80 1.4.5.1']);
    expect(l.rsfContributions.map(c=>c.maturityBand)).toEqual(['under6m','sixTo12m','oneYearPlus']);
    expect(l.rsfContributions.map(c=>c.factor)).toEqual([0.5,0.5,0.65]);
    expect(l.rsfContributions.map(c=>c.amount)).toEqual([
      expect.closeTo(100 * 5 / 12),
      expect.closeTo(100 * 6 / 12),
      expect.closeTo(100 * 1 / 12),
    ]);
    s.loanCohorts[A.Mortgages]![0].stage='stage3';l=prudentialLiquidityLines(s,baseConfig).find(l=>l.productType===A.Mortgages)!;
    expect(l.inflow).toBe(0);expect(l.rsf).toBe(100);
    expect(l.rsfContributions).toHaveLength(1);
    expect(l.rsfContributions[0]).toMatchObject({ category:'nonPerforming', corep:'C80 1.9.3', factor:1 });
  });
  it('limits reserve exclusion to deposit-matched reserves and includes commitments', () => {
    const s=cloneBankState(initialState);
    s.financial.balanceSheet.items.filter(i=>i.side===BalanceSheetSide.Liability).forEach(i=>i.balance=0);
    line(s,L.RetailCurrentAccounts).balance=100;
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