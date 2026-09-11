import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide, MaturityBucket, ProductType } from '../domain/enums';
import { hasCapability } from '../products/capabilities';
import {
  getLiquidityRule,
  liquidityTagForProduct,
} from '../products/regulatory';
import {
  getNsfrProductRule,
  NSFR_ASF_CATEGORIES,
  NSFR_RSF_CATEGORIES,
  NsfrAsfCategory,
  NsfrMaturityBand,
  NsfrRsfCategory,
  nsfrAsfFactor,
  nsfrEncumbranceTreatment,
  nsfrMaturityBand,
  nsfrRsfFactor,
} from '../products/nsfr';

// 2026 UK standardised portfolio assumptions: docs/model-basis.md.

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export interface NsfrContribution {
  side: 'ASF' | 'RSF';
  category: NsfrAsfCategory | NsfrRsfCategory | 'cet1Capital' | 'at1Capital';
  corep: string;
  label: string;
  group: string;
  sourceLabel: string;
  amount: number;
  factor: number;
  weighted: number;
  // For ASF this is funding residual maturity. For C80 RSF rows it is the
  // exposure residual-maturity column; encumbrance is represented by corep row.
  maturityBand: NsfrMaturityBand;
}

const fallbackMonthsForBucket = (bucket: MaturityBucket): number | null => {
  switch (bucket) {
    case MaturityBucket.Overnight: return 0;
    case MaturityBucket.LessThan1Y: return 0;
    case MaturityBucket.OneToThreeY: return 12;
    case MaturityBucket.ThreeToFiveY: return 36;
    case MaturityBucket.GreaterThan5Y: return 60;
    case MaturityBucket.Perpetual: return 120;
    default: return null;
  }
};

const asfContribution = (
  category: NsfrAsfCategory,
  amount: number,
  sourceLabel: string,
  monthsToMaturity?: number | null
): NsfrContribution => {
  const definition = NSFR_ASF_CATEGORIES[category];
  const factor = nsfrAsfFactor(category, monthsToMaturity);
  return {
    side: 'ASF', category, corep: definition.corep, label: definition.label, group: definition.group,
    sourceLabel, amount, factor, weighted: amount * factor, maturityBand: nsfrMaturityBand(monthsToMaturity),
  };
};

const rsfContribution = (
  category: NsfrRsfCategory,
  amount: number,
  sourceLabel: string,
  maturityBand: NsfrMaturityBand = 'none',
  factorOverride?: number
): NsfrContribution => {
  const definition = NSFR_RSF_CATEGORIES[category];
  const factor = factorOverride ?? nsfrRsfFactor(category, maturityBand);
  return {
    side: 'RSF', category, corep: definition.corep, label: definition.label, group: definition.group,
    sourceLabel, amount, factor, weighted: amount * factor, maturityBand,
  };
};

const applyNsfrEncumbrance = (
  contributions: NsfrContribution[],
  encumberedShare: number,
  months: number
): NsfrContribution[] => {
  if (encumberedShare <= 0 || months < 6) return contributions;
  return contributions.flatMap(contribution => {
    const treatment = nsfrEncumbranceTreatment(contribution.category as NsfrRsfCategory, months);
    if (!treatment) return [contribution];
    const encumberedAmount = contribution.amount * encumberedShare;
    const freeAmount = contribution.amount - encumberedAmount;
    const factor = treatment.factors[contribution.maturityBand];
    const result: NsfrContribution[] = [];
    if (freeAmount > 0) {
      result.push({ ...contribution, amount: freeAmount, weighted: freeAmount * contribution.factor });
    }
    if (encumberedAmount > 0) {
      result.push({
        ...contribution,
        corep: treatment.corep,
        label: treatment.label,
        amount: encumberedAmount,
        factor,
        weighted: encumberedAmount * factor,
      });
    }
    return result;
  });
};

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

const retailAsfContributions = (
  s: BankState,
  amount: number,
  sourceLabel: string,
  monthsToMaturity?: number | null
): NsfrContribution[] => {
  const { stableShare, otherShare } = retailCurrentAccountRegulatoryFactors(s);
  return [
    asfContribution('stableRetail', amount * stableShare, sourceLabel, monthsToMaturity),
    asfContribution('otherRetail', amount * otherShare, sourceLabel, monthsToMaturity),
  ].filter(c => c.amount > 0);
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

export const commitmentNsfrContribution = (s: BankState): NsfrContribution =>
  rsfContribution('undrawnCommitment', committedExposure(s), 'Undrawn commitments');

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
    const nsfrRule = getNsfrProductRule(p);
    const asset = i.side === BalanceSheetSide.Asset;

    let outflow = asset ? 0 : b * Math.min(1, Math.max(0, tag.lcrOutflowRate ?? 0));
    let inflow = asset ? b * Math.min(1, Math.max(0, tag.lcrInflowRate ?? 0)) : 0;
    let asfContributions: NsfrContribution[] = [];
    let rsfContributions: NsfrContribution[] = [];

    if (!asset && nsfrRule.asf) {
      if (nsfrRule.asf === 'retail') {
        const buckets = s.fundingLadders?.[p];
        if (rule.fundingMaturityTreatment === 'retailTerm' && buckets?.length) {
          asfContributions = buckets.flatMap(f =>
            retailAsfContributions(s, Math.max(0, f.notional), i.label, f.monthsToMaturity)
          );
        } else {
          asfContributions = retailAsfContributions(s, b, i.label, null);
        }
      } else {
        const category = nsfrRule.asf;
        const buckets = s.fundingLadders?.[p];
        if (rule.fundingMaturityTreatment && buckets?.length) {
          asfContributions = buckets.map(f =>
            asfContribution(category, Math.max(0, f.notional), i.label, f.monthsToMaturity)
          );
        } else {
          const fallbackMaturity = rule.fundingMaturityTreatment ? fallbackMonthsForBucket(i.maturityBucket) : null;
          asfContributions = [asfContribution(category, b, i.label, fallbackMaturity)];
        }
      }
    }

    if (rule.dynamicRetailSight) {
      const retail = retailCurrentAccountRegulatoryFactors(s);
      outflow = b * retail.lcrOutflowFactor;
    }

    if (rule.derivativeTreatment) {
      inflow = rule.derivativeTreatment === 'asset' ? derivatives.receipts : 0;
      outflow = rule.derivativeTreatment === 'liability' ? derivatives.payments : 0;
      if (rule.derivativeTreatment === 'asset') {
        rsfContributions = [rsfContribution('derivativeAsset', Math.max(0, derivatives.derivativeAssets - derivatives.derivativeLiabilities), i.label)];
      } else {
        rsfContributions = [rsfContribution('derivativeLiability', derivatives.derivativeLiabilities, i.label)];
      }
    } else if (asset && nsfrRule.rsf === 'centralBankReserve') {
      rsfContributions = [rsfContribution('centralBankReserve', b, i.label)];
    } else if (asset && nsfrRule.rsf === 'level1Sovereign') {
      rsfContributions = [rsfContribution('level1Sovereign', b, i.label)];
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
        } else {
          outflow = buckets.reduce((sum, f) => {
            if (f.monthsToMaturity > 1) return sum;
            return sum + Math.max(0, f.notional) * (1 + Math.max(0, f.rate) / 12);
          }, 0);
        }
      }
    }

    if (hasCapability(p, 'loan')) {
      if (nsfrRule.rsf !== 'mortgage' && nsfrRule.rsf !== 'otherLoan') {
        throw new Error(`Loan product ${p} must declare mortgage or otherLoan NSFR RSF treatment`);
      }
      const loanCategory: NsfrRsfCategory = nsfrRule.rsf;
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
      const scale = gross > 0 ? b / gross : 1;
      const loanContributions: NsfrContribution[] = [];
      cohorts.forEach(l => {
        if (l.stage === 'stage3') {
          loanContributions.push(rsfContribution('nonPerforming', l.outstandingPrincipal * scale, i.label));
          return;
        }
        const term = Math.max(1, l.termMonths - l.ageMonths);
        const payment = contractualLoanPayment(l.outstandingPrincipal, l.annualInterestRate, term);
        let remaining = l.outstandingPrincipal;
        let remainingAfterFiveMonths = remaining;
        let remainingAfterElevenMonths = remaining;
        // C80 distinguishes exposure residual maturity <6m, 6–12m and >=1y.
        // Allocate contractual principal amortisation to those columns while the
        // C80 row itself continues to represent encumbrance treatment.
        for (let month = 1; month <= Math.min(11, term); month++) {
          remaining = Math.max(
            0,
            remaining -
              Math.max(0, payment - (remaining * Math.max(0, l.annualInterestRate)) / 12)
          );
          if (month === Math.min(5, term)) remainingAfterFiveMonths = remaining;
          if (month === Math.min(11, term)) remainingAfterElevenMonths = remaining;
        }
        const underSixMonths = (l.outstandingPrincipal - remainingAfterFiveMonths) * scale;
        const sixToTwelveMonths = (remainingAfterFiveMonths - remainingAfterElevenMonths) * scale;
        const oneYearPlus = remainingAfterElevenMonths * scale;
        if (underSixMonths > 0) {
          loanContributions.push(rsfContribution(loanCategory, underSixMonths, i.label, 'under6m'));
        }
        if (sixToTwelveMonths > 0) {
          loanContributions.push(rsfContribution(loanCategory, sixToTwelveMonths, i.label, 'sixTo12m'));
        }
        if (oneYearPlus > 0) {
          loanContributions.push(rsfContribution(loanCategory, oneYearPlus, i.label, 'oneYearPlus'));
        }
      });
      workouts.forEach(w => {
        if (w.defaultedPrincipal > 0) loanContributions.push(rsfContribution('nonPerforming', w.defaultedPrincipal * scale, i.label));
      });
      if (loanContributions.length === 0 && b > 0) {
        loanContributions.push(rsfContribution(loanCategory, b, i.label, 'oneYearPlus'));
      }
      rsfContributions = loanContributions;
    }

    if (asset) {
      const enc = Math.min(b, Math.max(0, i.encumbrance?.encumberedAmount ?? 0));
      const months = i.encumbrance?.remainingMonths ?? 12;
      const encumberedShare = b > 0 ? enc / b : 0;
      rsfContributions = applyNsfrEncumbrance(rsfContributions, encumberedShare, months);
    }

    const asf = asfContributions.reduce((sum, contribution) => sum + contribution.weighted, 0);
    const rsf = rsfContributions.reduce((sum, contribution) => sum + contribution.weighted, 0);

    return { productType: p, label: i.label, balance: b, asset, outflow, inflow, asf, rsf, asfContributions, rsfContributions };
  });
};

// The annual SREP engine supplies assessedP2ARate. A configured rate/fixed amount remains as a
// backwards-compatible scenario floor. Capital-quality shares are explicit BankSim assumptions;
// the uploaded PRA methodology/PS15/20 documents do not prescribe the full composition rule here.
export const ownFundsRequirements = (
  limits: SimulationConfig['riskLimits'],
  rwa: number,
  assessedP2ARate = 0
) => {
  const p = limits.pillar2A;
  const configured =
    Math.max(0, p?.totalRatio ?? 0) +
    (rwa > 0 ? Math.max(0, p?.fixedAmount ?? 0) / rwa : 0);
  const total = Math.max(configured, Math.max(0, assessedP2ARate));
  const cet1Share = Math.max(0.5625, Math.min(1, p?.cet1Share ?? 0.5625));
  const tier1Share = Math.max(0.75, cet1Share, Math.min(1, p?.tier1Share ?? 0.75));
  return {
    pillar2A: total,
    cet1: limits.minCet1Ratio + total * cet1Share,
    tier1: (limits.minTier1Ratio ?? 0.06) + total * tier1Share,
    total: (limits.minTotalCapitalRatio ?? 0.08) + total,
  };
};
