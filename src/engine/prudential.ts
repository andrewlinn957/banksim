import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, BalanceSheetSide, ProductType, LiabilityProductType } from '../domain/enums';
import { PRODUCT_META } from '../domain/productMeta';

// 2026 UK standardised portfolio assumptions: docs/model-basis.md.
export const committedExposure = (s: BankState, product?: ProductType): number =>
  Object.entries(s.loanPipelines ?? {}).reduce((sum, [p, b]) => sum + (!product || p === product ? Math.max(0, b?.committedNotional ?? 0) : 0), 0);
export const commitmentLiquidity = (s: BankState) => ({ outflow: committedExposure(s, AssetProductType.Mortgages) * .05 + committedExposure(s, AssetProductType.CorporateLoans) * .1, rsf: committedExposure(s) * .05 });
export const eligibleCet1 = (s: BankState, c: SimulationConfig) => s.financial.capital.cet1 + s.financial.capital.accumulatedOCI * Math.max(0, Math.min(1, c.behaviour.securitiesAccounting?.fvociCet1InclusionRate ?? 1));
export const centralBankExclusion = (s: BankState) => {
  const cash = s.financial.balanceSheet.items.find(i => i.productType === AssetProductType.CashReserves);
  const deposits = s.financial.balanceSheet.items.reduce((sum, i) => sum + (i.currency === cash?.currency && PRODUCT_META[i.productType]?.behaviour?.isCustomerDeposit ? Math.max(0, i.balance) : 0), 0);
  return Math.min(Math.max(0, cash?.balance ?? 0), deposits);
};
export const contractualLoanPayment = (principal: number, annualRate: number, months: number) => {
  const r = Math.max(0, annualRate) / 12, n = Math.max(1, months);
  return r > 0 ? principal * r / (1 - (1 + r) ** -n) : principal / n;
};
export const prudentialLiquidityLines = (s: BankState, c: SimulationConfig) => s.financial.balanceSheet.items.map(i => {
  const p = i.productType, b = Math.max(0, i.balance), tag = i.liquidityTag;
  const asset = i.side === BalanceSheetSide.Asset;
  let outflow = asset ? 0 : b * Math.min(1, Math.max(0, tag?.lcrOutflowRate ?? 0));
  let inflow = asset ? b * Math.min(1, Math.max(0, tag?.lcrInflowRate ?? 0)) : 0;
  let asf = asset ? 0 : b * (tag?.nsfrAsfFactor ?? 0);
  let rsf = asset ? b * (tag?.nsfrRsfFactor ?? 0) : 0;
  if (p === LiabilityProductType.WholesaleFundingST || p === LiabilityProductType.WholesaleFundingLT) {
    const buckets = s.fundingLadders?.[p];
    if (buckets?.length) {
      outflow = buckets.reduce((sum, f) => sum + (f.monthsToMaturity <= 1 ? f.notional * (1 + f.rate / 12) : 0), 0);
      asf = buckets.reduce((sum, f) => sum + f.notional * (f.monthsToMaturity >= 12 ? 1 : f.monthsToMaturity >= 6 ? .5 : 0), 0);
    }
  }
  if (PRODUCT_META[p]?.behaviour?.isLoan) {
    const cohorts = s.loanCohorts?.[p] ?? [], workouts = s.workoutPipelines?.[p] ?? [];
    inflow = cohorts.reduce((sum, loan) => sum + (loan.stage === 'stage3' ? 0 : .5 * contractualLoanPayment(loan.outstandingPrincipal, loan.annualInterestRate, loan.termMonths - loan.ageMonths)), 0);
    const gross = cohorts.reduce((sum, l) => sum + l.outstandingPrincipal, 0) + workouts.reduce((sum, w) => sum + w.defaultedPrincipal, 0);
    const weighted = cohorts.reduce((sum, l) => {
      if (l.stage === 'stage3') return sum + l.outstandingPrincipal;
      const term = Math.max(1, l.termMonths - l.ageMonths);
      const payment = contractualLoanPayment(l.outstandingPrincipal, l.annualInterestRate, term);
      let remaining = l.outstandingPrincipal;
      // Article 428q(4): contractual amortisation due before one year receives its shorter tenor.
      for (let month = 1; month <= Math.min(11, term); month++) remaining = Math.max(0, remaining - Math.max(0, payment - remaining * Math.max(0, l.annualInterestRate) / 12));
      const longFactor = (c.productParameters[p]?.riskWeight ?? 1) <= .35 ? .65 : .85;
      return sum + (l.outstandingPrincipal - remaining) * .5 + remaining * longFactor;
    }, 0) + workouts.reduce((sum, w) => sum + w.defaultedPrincipal, 0);
    rsf = gross > 0 ? b * weighted / gross : 0;
  }
  if (asset) {
    const enc = Math.min(b, Math.max(0, i.encumbrance?.encumberedAmount ?? 0));
    const months = i.encumbrance?.remainingMonths ?? 12;
    const base = b > 0 ? rsf / b : 0;
    rsf += enc * ((months >= 12 ? 1 : months >= 6 ? Math.max(.5, base) : base) - base);
  }
  return { productType: p, label: i.label, balance: b, asset, outflow, inflow, asf, rsf };
});
