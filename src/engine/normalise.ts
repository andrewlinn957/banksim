import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';
import { BalanceSheetSide, Currency, LiabilityProductType, MaturityBucket } from '../domain/enums';
import { PRODUCT_META } from '../domain/productMeta';
import { DEFAULT_FEATURE_FLAGS } from './featureFlags';

export const CURRENT_STATE_VERSION = 'v1';
export const CURRENT_CONFIG_VERSION = 'v1';

export type AnyBankState = BankState;
export type AnySimulationConfig = SimulationConfig;

export const normaliseConfig = (raw: AnySimulationConfig): SimulationConfig => {
  return {
    ...baseConfig,
    ...raw,
    behaviour: {
      ...baseConfig.behaviour,
      ...(raw.behaviour ?? {}),
      depositByProduct: {
        ...(baseConfig.behaviour.depositByProduct ?? {}),
        ...(raw.behaviour?.depositByProduct ?? {}),
      },
      loanPipelineByProduct: {
        ...(baseConfig.behaviour.loanPipelineByProduct ?? {}),
        ...(raw.behaviour?.loanPipelineByProduct ?? {}),
      },
      creditRiskDynamics: {
        ...(baseConfig.behaviour.creditRiskDynamics ?? {}),
        ...(raw.behaviour?.creditRiskDynamics ?? {}),
        adverseSelection: {
          ...(baseConfig.behaviour.creditRiskDynamics?.adverseSelection ?? {}),
          ...(raw.behaviour?.creditRiskDynamics?.adverseSelection ?? {}),
        },
        affordabilityByProduct: {
          ...(baseConfig.behaviour.creditRiskDynamics?.affordabilityByProduct ?? {}),
          ...(raw.behaviour?.creditRiskDynamics?.affordabilityByProduct ?? {}),
        },
        refinanceByProduct: {
          ...(baseConfig.behaviour.creditRiskDynamics?.refinanceByProduct ?? {}),
          ...(raw.behaviour?.creditRiskDynamics?.refinanceByProduct ?? {}),
        },
        workoutPipeline: {
          ...(baseConfig.behaviour.creditRiskDynamics?.workoutPipeline ?? {}),
          ...(raw.behaviour?.creditRiskDynamics?.workoutPipeline ?? {}),
        },
      },
      costModel: {
        ...(baseConfig.behaviour.costModel ?? {}),
        ...(raw.behaviour?.costModel ?? {}),
      },
      fundingLadder: {
        ...(baseConfig.behaviour.fundingLadder ?? {}),
        ...(raw.behaviour?.fundingLadder ?? {}),
      },
      ifrs9: {
        ...(baseConfig.behaviour.ifrs9 ?? {}),
        ...(raw.behaviour?.ifrs9 ?? {}),
      },
      liquidityDynamics: {
        ...(baseConfig.behaviour.liquidityDynamics ?? {}),
        ...(raw.behaviour?.liquidityDynamics ?? {}),
      },
      irrbb: {
        ...(baseConfig.behaviour.irrbb ?? {}),
        ...(raw.behaviour?.irrbb ?? {}),
      },
      securitiesAccounting: {
        ...(baseConfig.behaviour.securitiesAccounting ?? {}),
        ...(raw.behaviour?.securitiesAccounting ?? {}),
        defaultClassificationByProduct: {
          ...(baseConfig.behaviour.securitiesAccounting?.defaultClassificationByProduct ?? {}),
          ...(raw.behaviour?.securitiesAccounting?.defaultClassificationByProduct ?? {}),
        },
        effectiveDurationYearsByProduct: {
          ...(baseConfig.behaviour.securitiesAccounting?.effectiveDurationYearsByProduct ?? {}),
          ...(raw.behaviour?.securitiesAccounting?.effectiveDurationYearsByProduct ?? {}),
        },
      },
      concentration: {
        ...(baseConfig.behaviour.concentration ?? {}),
        ...(raw.behaviour?.concentration ?? {}),
        sectorPdMultiplierByStress: {
          ...(baseConfig.behaviour.concentration?.sectorPdMultiplierByStress ?? {}),
          ...(raw.behaviour?.concentration?.sectorPdMultiplierByStress ?? {}),
        },
        geographyPdMultiplierByStress: {
          ...(baseConfig.behaviour.concentration?.geographyPdMultiplierByStress ?? {}),
          ...(raw.behaviour?.concentration?.geographyPdMultiplierByStress ?? {}),
        },
      },
      boardPressure: {
        ...(baseConfig.behaviour.boardPressure ?? {}),
        ...(raw.behaviour?.boardPressure ?? {}),
      },
      confidenceStateMachine: {
        ...(baseConfig.behaviour.confidenceStateMachine ?? {}),
        ...(raw.behaviour?.confidenceStateMachine ?? {}),
        impacts: {
          ...(baseConfig.behaviour.confidenceStateMachine?.impacts ?? {}),
          ...(raw.behaviour?.confidenceStateMachine?.impacts ?? {}),
        },
      },
      conductRisk: {
        ...(baseConfig.behaviour.conductRisk ?? {}),
        ...(raw.behaviour?.conductRisk ?? {}),
      },
      sharePriceModel: {
        ...(baseConfig.behaviour.sharePriceModel ?? {}),
        ...(raw.behaviour?.sharePriceModel ?? {}),
      },
    },
    riskLimits: {
      ...baseConfig.riskLimits,
      ...(raw.riskLimits ?? {}),
      capitalBufferStack: {
        ...baseConfig.riskLimits.capitalBufferStack,
        ...(raw.riskLimits?.capitalBufferStack ?? {}),
      },
      capitalPolicy: {
        ...baseConfig.riskLimits.capitalPolicy,
        ...(raw.riskLimits?.capitalPolicy ?? {}),
      },
      concentration: {
        ...baseConfig.riskLimits.concentration,
        ...(raw.riskLimits?.concentration ?? {}),
      },
      boardPressure: {
        ...baseConfig.riskLimits.boardPressure,
        ...(raw.riskLimits?.boardPressure ?? {}),
      },
    },
    featureFlags: {
      ...DEFAULT_FEATURE_FLAGS,
      ...(raw.featureFlags ?? {}),
    },
    version: raw.version ?? CURRENT_CONFIG_VERSION,
  };
};

export const normaliseState = (raw: AnyBankState): BankState => {
  const merged: BankState = {
    ...initialState,
    ...raw,
    version: raw.version ?? CURRENT_STATE_VERSION,
    financial: {
      ...initialState.financial,
      ...(raw.financial ?? {}),
      balanceSheet: raw.financial?.balanceSheet ?? initialState.financial.balanceSheet,
      capital: {
        ...initialState.financial.capital,
        ...(raw.financial?.capital ?? {}),
      },
      provisionStock: {
        ...initialState.financial.provisionStock,
        ...(raw.financial?.provisionStock ?? {}),
      },
      hedges: (raw.financial?.hedges ?? initialState.financial.hedges ?? []).map((hedge) => ({
        ...hedge,
      })),
      incomeStatement: {
        ...initialState.financial.incomeStatement,
        ...(raw.financial?.incomeStatement ?? {}),
      },
      cashFlowStatement: {
        ...initialState.financial.cashFlowStatement,
        ...(raw.financial?.cashFlowStatement ?? {}),
      },
    },
    risk: {
      ...initialState.risk,
      ...(raw.risk ?? {}),
      riskMetrics: {
        ...initialState.risk.riskMetrics,
        ...(raw.risk?.riskMetrics ?? {}),
      },
      compliance: {
        ...initialState.risk.compliance,
        ...(raw.risk?.compliance ?? {}),
      },
    },
    board: {
      ...initialState.board,
      ...(raw.board ?? {}),
    },
    equityMarket: {
      ...initialState.equityMarket,
      ...(raw.equityMarket ?? {}),
    },
    status: {
      ...initialState.status,
      ...(raw.status ?? {}),
    },
    market: {
      ...initialState.market,
      ...(raw.market ?? {}),
      giltCurve: {
        ...initialState.market.giltCurve,
        ...(raw.market?.giltCurve ?? {}),
        nelsonSiegel: {
          ...initialState.market.giltCurve.nelsonSiegel,
          ...(raw.market?.giltCurve?.nelsonSiegel ?? {}),
        },
        yields: {
          ...initialState.market.giltCurve.yields,
          ...(raw.market?.giltCurve?.yields ?? {}),
        },
      },
      macroModel: {
        ...initialState.market.macroModel,
        ...(raw.market?.macroModel ?? {}),
        factors: {
          ...initialState.market.macroModel.factors,
          ...(raw.market?.macroModel?.factors ?? {}),
        },
      },
    },
    behaviour: {
      ...initialState.behaviour,
      ...(raw.behaviour ?? {}),
      depositRateLagMemory: {
        ...(initialState.behaviour.depositRateLagMemory ?? {}),
        ...(raw.behaviour?.depositRateLagMemory ?? {}),
      },
      depositUnderpricingMonths: {
        ...(initialState.behaviour.depositUnderpricingMonths ?? {}),
        ...(raw.behaviour?.depositUnderpricingMonths ?? {}),
      },
      depositStabilityIndex: {
        ...(initialState.behaviour.depositStabilityIndex ?? {}),
        ...(raw.behaviour?.depositStabilityIndex ?? {}),
      },
      underwritingTightness: {
        ...(initialState.behaviour.underwritingTightness ?? {}),
        ...(raw.behaviour?.underwritingTightness ?? {}),
      },
      capitalPolicy: {
        ...(initialState.behaviour.capitalPolicy ?? { dividendPayoutRatio: 0, at1CouponMode: 'auto' }),
        ...(raw.behaviour?.capitalPolicy ?? {}),
      },
    },
    loanPipelines: {
      ...(initialState.loanPipelines ?? {}),
      ...(raw.loanPipelines ?? {}),
    },
    workoutPipelines: Object.entries(raw.workoutPipelines ?? initialState.workoutPipelines ?? {}).reduce(
      (acc, [productType, buckets]) => {
        acc[productType as keyof typeof acc] = (buckets ?? []).map((bucket) => ({ ...bucket }));
        return acc;
      },
      { ...(initialState.workoutPipelines ?? {}) } as BankState['workoutPipelines']
    ),
    fundingLadders: Object.entries(raw.fundingLadders ?? initialState.fundingLadders ?? {}).reduce(
      (acc, [productType, buckets]) => {
        acc[productType as keyof typeof acc] = (buckets ?? []).map((bucket) => ({ ...bucket }));
        return acc;
      },
      { ...(initialState.fundingLadders ?? {}) } as BankState['fundingLadders']
    ),
  };

  // Migrate legacy aggregate deposit lines into segmented products if needed.
  const hasSegmentedDeposits = merged.financial.balanceSheet.items.some(
    (item) =>
      item.productType === LiabilityProductType.RetailTransactionalDeposits ||
      item.productType === LiabilityProductType.RetailSavingsDeposits ||
      item.productType === LiabilityProductType.CorporateOperatingDeposits ||
      item.productType === LiabilityProductType.CorporateNonOperatingDeposits
  );

  if (!hasSegmentedDeposits) {
    const legacyRetail = merged.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.RetailDeposits
    );
    const legacyCorporate = merged.financial.balanceSheet.items.find(
      (item) => item.productType === LiabilityProductType.CorporateDeposits
    );

    const spawn = (
      productType:
        | LiabilityProductType.RetailTransactionalDeposits
        | LiabilityProductType.RetailSavingsDeposits
        | LiabilityProductType.CorporateOperatingDeposits
        | LiabilityProductType.CorporateNonOperatingDeposits,
      balance: number,
      rate: number
    ) => ({
      side: BalanceSheetSide.Liability,
      productType,
      label: PRODUCT_META[productType].label,
      currency: legacyRetail?.currency ?? legacyCorporate?.currency ?? Currency.GBP,
      balance,
      interestRate: rate,
      maturityBucket: legacyRetail?.maturityBucket ?? legacyCorporate?.maturityBucket ?? MaturityBucket.LessThan1Y,
      liquidityTag: baseConfig.liquidityTags[productType],
      encumbrance: { encumberedAmount: 0 },
    });

    if (legacyRetail && legacyRetail.balance > 0) {
      merged.financial.balanceSheet.items.push(
        spawn(LiabilityProductType.RetailTransactionalDeposits, legacyRetail.balance * 0.45, legacyRetail.interestRate * 0.85),
        spawn(LiabilityProductType.RetailSavingsDeposits, legacyRetail.balance * 0.55, legacyRetail.interestRate * 1.05)
      );
      legacyRetail.balance = 0;
    }

    if (legacyCorporate && legacyCorporate.balance > 0) {
      merged.financial.balanceSheet.items.push(
        spawn(LiabilityProductType.CorporateOperatingDeposits, legacyCorporate.balance * 0.6, legacyCorporate.interestRate * 0.9),
        spawn(LiabilityProductType.CorporateNonOperatingDeposits, legacyCorporate.balance * 0.4, legacyCorporate.interestRate * 1.1)
      );
      legacyCorporate.balance = 0;
    }
  }

  merged.financial.balanceSheet.items.forEach((item) => {
    const defaultClassification =
      baseConfig.behaviour.securitiesAccounting?.defaultClassificationByProduct?.[item.productType];
    if (!defaultClassification) return;
    if (!item.security) {
      item.security = {
        classification: defaultClassification,
        effectiveDurationYears:
          baseConfig.behaviour.securitiesAccounting?.effectiveDurationYearsByProduct?.[item.productType] ?? 0,
        valuationReferenceYield: merged.market.riskFreeLong,
      };
      return;
    }
    item.security.classification = item.security.classification ?? defaultClassification;
    item.security.effectiveDurationYears =
      item.security.effectiveDurationYears ??
      baseConfig.behaviour.securitiesAccounting?.effectiveDurationYearsByProduct?.[item.productType] ??
      0;
    item.security.valuationReferenceYield =
      item.security.valuationReferenceYield && Number.isFinite(item.security.valuationReferenceYield)
        ? item.security.valuationReferenceYield
        : merged.market.riskFreeLong;
  });

  return merged;
};
