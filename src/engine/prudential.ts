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
  factor = nsfrRsfFactor(category),
  maturityBand: NsfrMaturityBand = 'none'
): NsfrContribution => {
  const definition = NSFR_RSF_CATEGORIES[category];
  return {
    side: 'RSF', category, corep: definition.corep, label: definition.label, group: definition.group,
    sourceLabel, amount, factor, weighted: amount * factor, maturityBand,
  };
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
          asfContributions = [asfContribution(category, b, i.label, fallbackMonthsForBucket(i.maturityBucket))];
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
      const shortCategory: NsfrRsfCategory = nsfrRule.rsf === 'mortgage' ? 'mortgageShort' : 'otherLoanShort';
      const longCategory: NsfrRsfCategory = nsfrRule.rsf === 'mortgage' ? 'mortgageLong' : 'otherLoanLong';
      const loanContributions: NsfrContribution[] = [];
      cohorts.forEach(l => {
        if (l.stage === 'stage3') {
          loanContributions.push(rsfContribution('nonPerforming', l.outstandingPrincipal * scale, i.label));
          return;
        }
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
        const shortAmount = (l.outstandingPrincipal - remaining) * scale;
        const longAmount = remaining * scale;
        if (shortAmount > 0) loanContributions.push(rsfContribution(shortCategory, shortAmount, i.label, undefined, 'sixTo12m'));
        if (longAmount > 0) loanContributions.push(rsfContribution(longCategory, longAmount, i.label, undefined, 'oneYearPlus'));
      });
      workouts.forEach(w => {
        if (w.defaultedPrincipal > 0) loanContributions.push(rsfContribution('nonPerforming', w.defaultedPrincipal * scale, i.label));
      });
      if (loanContributions.length === 0 && b > 0) {
        loanContributions.push(rsfContribution(longCategory, b, i.label, undefined, 'oneYearPlus'));
      }
      rsfContributions = loanContributions;
    }

    let asf = asfContributions.reduce((sum, contribution) => sum + contribution.weighted, 0);
    let rsf = rsfContributions.reduce((sum, contribution) => sum + contribution.weighted, 0);

    if (asset) {
      const enc = Math.min(b, Math.max(0, i.encumbrance?.encumberedAmount ?? 0));
      const months = i.encumbrance?.remainingMonths ?? 12;
      const base = b > 0 ? rsf / b : 0;
      const target = months >= 12 ? 1 : months >= 6 ? Math.max(0.5, base) : base;
      const uplift = Math.max(0, enc * (target - base));
      if (uplift > 0) {
        const category: NsfrRsfCategory = months >= 12 ? 'encumberedOneYearPlus' : 'encumberedSixTo12m';
        const contribution = rsfContribution(category, enc, i.label, target - base, months >= 12 ? 'oneYearPlus' : 'sixTo12m');
        rsfContributions.push(contribution);
        rsf += contribution.weighted;
      }
    }

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
