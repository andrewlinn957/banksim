import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide, ProductType } from '../domain/enums';
import { hasCapability } from '../products/capabilities';
import {
  getLiquidityRule,
  liquidityTagForProduct,
} from '../products/regulatory';

// 2026 UK standardised portfolio assumptions: docs/model-basis.md.

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export const retailCurrentAccountRegulatoryFactors = (s: BankState) => {
  const stableShare = clamp01(s.behaviour.insuredRetailDepositShare ?? 0);
  const otherShare = 1 - stableShare;
  return {
    stableShare,
    otherShare,
    lcrOutflowFactor: stableShare * 0.05 + otherShare * 0.10,
    nsfrAsfFactor: stableShare * 0.95 + otherShare * 0.90,
  };
};

export const committedExposure = (s: BankState, product?: ProductType): number =>
  Object.entries(s.loanPipelines ?? {}).reduce(
    (sum, [p, b]) =>
      sum + (!product || p === product ? Math.max(0, b?.committedNotional ?? 0) : 0),
    0
  );

export const commitmentLiquidity = (s: BankState) =>
  Object.entries(s.loanPipelines ?? {}).reduce(
    (totals, [rawProductType, pipeline]) => {
      const productType = rawProductType as ProductType;
      const committed = Math.max(0, pipeline?.committedNotional ?? 0);
      const rule = getLiquidityRule(productType);
      totals.outflow += committed * Math.max(0, rule.commitmentOutflowFactor ?? 0);
      totals.rsf += committed * Math.max(0, rule.commitmentRsfFactor ?? 0);
      return totals;
    },
    { outflow: 0, rsf: 0 }
  );

export const eligibleCet1 = (s: BankState, c: SimulationConfig) =>
  s.financial.capital.cet1 +
  s.financial.capital.accumulatedOCI *
    Math.max(0, Math.min(1, c.behaviour.securitiesAccounting?.fvociCet1InclusionRate ?? 1));

export const centralBankExclusion = (s: BankState) => {
  const reserve = s.financial.balanceSheet.items.find(
    i => getLiquidityRule(i.productType).centralBankReserveExcludable
  );
  const deposits = s.financial.balanceSheet.items.reduce(
    (sum, i) =>
      sum +
      (i.currency === reserve?.currency && hasCapability(i.productType, 'customerDeposit')
        ? Math.max(0, i.balance)
        : 0),
    0
  );
  return Math.min(Math.max(0, reserve?.balance ?? 0), deposits);
};

export const contractualLoanPayment = (principal: number, annualRate: number, months: number) => {
  const r = Math.max(0, annualRate) / 12;
  const n = Math.max(1, months);
  return r > 0 ? (principal * r) / (1 - (1 + r) ** -n) : principal / n;
};

const derivativeCashFlows = (s: BankState, c: SimulationConfig) => {
  let receipts = 0;
  let payments = 0;
  for (const hedge of s.financial.hedges) {
    if (hedge.monthsRemaining <= 0) continue;
    const spread =
      hedge.direction === 'payFixedReceiveFloat'
        ? s.market.riskFreeShort - hedge.fixedRate
        : hedge.fixedRate - s.market.riskFreeShort;
    const coupon =
      (hedge.notional * (spread - Math.abs(c.behaviour.irrbb?.hedgeCarrySpread ?? 0))) / 12;
    receipts += Math.max(0, coupon);
    payments += Math.max(0, -coupon);
  }

  const derivativeAssets = s.financial.balanceSheet.items.reduce(
    (sum, item) =>
      sum +
      (getLiquidityRule(item.productType).derivativeTreatment === 'asset'
        ? Math.max(0, item.balance)
        : 0),
    0
  );
  const derivativeLiabilities = s.financial.balanceSheet.items.reduce(
    (sum, item) =>
      sum +
      (getLiquidityRule(item.productType).derivativeTreatment === 'liability'
        ? Math.max(0, item.balance)
        : 0),
    0
  );

  return { receipts, payments, derivativeAssets, derivativeLiabilities };
};

export const prudentialLiquidityLines = (s: BankState, c: SimulationConfig) => {
  const derivatives = derivativeCashFlows(s, c);

  return s.financial.balanceSheet.items.map(i => {
    const p = i.productType;
    const b = Math.max(0, i.balance);
    const tag = liquidityTagForProduct(p);
    const rule = getLiquidityRule(p);
    const asset = i.side === BalanceSheetSide.Asset;

    let outflow = asset ? 0 : b * Math.min(1, Math.max(0, tag.lcrOutflowRate ?? 0));
    let inflow = asset ? b * Math.min(1, Math.max(0, tag.lcrInflowRate ?? 0)) : 0;
    let asf = asset ? 0 : b * (tag.nsfrAsfFactor ?? 0);
    let rsf = asset ? b * (tag.nsfrRsfFactor ?? 0) : 0;

    if (rule.dynamicRetailSight) {
      const retail = retailCurrentAccountRegulatoryFactors(s);
      outflow = b * retail.lcrOutflowFactor;
      asf = b * retail.nsfrAsfFactor;
    }

    if (rule.derivativeTreatment) {
      inflow = rule.derivativeTreatment === 'asset' ? derivatives.receipts : 0;
      outflow = rule.derivativeTreatment === 'liability' ? derivatives.payments : 0;
      asf = 0;
      rsf =
        rule.derivativeTreatment === 'asset'
          ? Math.max(0, derivatives.derivativeAssets - derivatives.derivativeLiabilities)
          : derivatives.derivativeLiabilities * 0.05;
    }

    if (rule.fundingMaturityTreatment) {
      const buckets = s.fundingLadders?.[p];
      if (buckets?.length) {
        if (rule.fundingMaturityTreatment === 'retailTerm') {
          outflow = buckets.reduce(
            (sum, f) =>
              f.monthsToMaturity <= 1 ? sum + Math.max(0, f.notional) * 0.10 : sum,
            0
          );
          asf = buckets.reduce(
            (sum, f) =>
              sum + Math.max(0, f.notional) * (f.monthsToMaturity >= 12 ? 1 : 0.90),
            0
          );
        } else {
          outflow = buckets.reduce((sum, f) => {
            if (f.monthsToMaturity > 1) return sum;
            return sum + Math.max(0, f.notional) * (1 + Math.max(0, f.rate) / 12);
          }, 0);
          asf = buckets.reduce(
            (sum, f) =>
              sum +
              Math.max(0, f.notional) *
                (f.monthsToMaturity >= 12 ? 1 : f.monthsToMaturity >= 6 ? 0.5 : 0),
            0
          );
        }
      }
    }

    if (hasCapability(p, 'loan')) {
      const cohorts = s.loanCohorts?.[p] ?? [];
      const workouts = s.workoutPipelines?.[p] ?? [];
      inflow = cohorts.reduce(
        (sum, loan) =>
          sum +
          (loan.stage === 'stage3'
            ? 0
            : 0.5 *
              contractualLoanPayment(
                loan.outstandingPrincipal,
                loan.annualInterestRate,
                loan.termMonths - loan.ageMonths
              )),
        0
      );
      const gross =
        cohorts.reduce((sum, l) => sum + l.outstandingPrincipal, 0) +
        workouts.reduce((sum, w) => sum + w.defaultedPrincipal, 0);
      const longFactor = Math.max(0, rule.loanLongRsfFactor ?? tag.nsfrRsfFactor ?? 1);
      const weighted =
        cohorts.reduce((sum, l) => {
          if (l.stage === 'stage3') return sum + l.outstandingPrincipal;
          const term = Math.max(1, l.termMonths - l.ageMonths);
          const payment = contractualLoanPayment(l.outstandingPrincipal, l.annualInterestRate, term);
          let remaining = l.outstandingPrincipal;
          // Article 428q(4): contractual amortisation due before one year receives its shorter tenor.
          for (let month = 1; month <= Math.min(11, term); month++) {
            remaining = Math.max(
              0,
              remaining -
                Math.max(0, payment - (remaining * Math.max(0, l.annualInterestRate)) / 12)
            );
          }
          return sum + (l.outstandingPrincipal - remaining) * 0.5 + remaining * longFactor;
        }, 0) + workouts.reduce((sum, w) => sum + w.defaultedPrincipal, 0);
      rsf = gross > 0 ? (b * weighted) / gross : 0;
    }

    if (asset) {
      const enc = Math.min(b, Math.max(0, i.encumbrance?.encumberedAmount ?? 0));
      const months = i.encumbrance?.remainingMonths ?? 12;
      const base = b > 0 ? rsf / b : 0;
      rsf += enc * ((months >= 12 ? 1 : months >= 6 ? Math.max(0.5, base) : base) - base);
    }

    return { productType: p, label: i.label, balance: b, asset, outflow, inflow, asf, rsf };
  });
};

// SS31/15: firm-specific P2A may contain an RWA rate and fixed nominal add-ons.
export const ownFundsRequirements = (limits: SimulationConfig['riskLimits'], rwa: number) => {
  const p = limits.pillar2A;
  const total =
    Math.max(0, p?.totalRatio ?? 0) +
    (rwa > 0 ? Math.max(0, p?.fixedAmount ?? 0) / rwa : 0);
  const cet1Share = Math.max(0.5625, Math.min(1, p?.cet1Share ?? 0.5625));
  const tier1Share = Math.max(0.75, cet1Share, Math.min(1, p?.tier1Share ?? 0.75));
  return {
    cet1: limits.minCet1Ratio + total * cet1Share,
    tier1: (limits.minTier1Ratio ?? 0.06) + total * tier1Share,
    total: (limits.minTotalCapitalRatio ?? 0.08) + total,
  };
};
