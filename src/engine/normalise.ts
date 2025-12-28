import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { initialState } from '../config/initialState';
import { baseConfig } from '../config/baseConfig';

export const CURRENT_STATE_VERSION = 'v1';
export const CURRENT_CONFIG_VERSION = 'v1';

export type AnyBankState = BankState;
export type AnySimulationConfig = SimulationConfig;

export const normaliseConfig = (raw: AnySimulationConfig): SimulationConfig => {
  return {
    ...baseConfig,
    ...raw,
    version: raw.version ?? CURRENT_CONFIG_VERSION,
  };
};

export const normaliseState = (raw: AnyBankState): BankState => {
  return {
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
  };
};
