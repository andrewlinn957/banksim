import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';

const formatPct = (value: number, digits = 1): string => `${(value * 100).toFixed(digits)}%`;

const formatMultiple = (value: number, digits = 2): string => `${value.toFixed(digits)}x`;

export interface MechanicsDynamicContext {
  minCet1Ratio: number;
  minLeverageRatio: number;
  minLcr: number;
  minNsfr: number;
  combinedCet1Requirement: number;
  at1DiscretionaryCet1Threshold: number;
  confidenceStrongMinScore: number;
  confidenceStableMinScore: number;
  confidenceWatchMinScore: number;
  confidenceHardLcrWatch: number;
  confidenceHardLcrStressed: number;
  currentCet1Ratio?: number;
  currentLeverageRatio?: number;
  currentLcr?: number;
  currentNsfr?: number;
}

export interface MechanicsDisplayContext {
  values: MechanicsDynamicContext;
  formatted: {
    minCet1Ratio: string;
    minLeverageRatio: string;
    minLcr: string;
    minNsfr: string;
    combinedCet1Requirement: string;
    at1DiscretionaryCet1Threshold: string;
    confidenceStrongMinScore: string;
    confidenceStableMinScore: string;
    confidenceWatchMinScore: string;
    confidenceHardLcrWatch: string;
    confidenceHardLcrStressed: string;
    currentCet1Ratio?: string;
    currentLeverageRatio?: string;
    currentLcr?: string;
    currentNsfr?: string;
  };
}

export const buildMechanicsDynamicContext = (args: {
  config: SimulationConfig;
  state?: BankState;
}): MechanicsDisplayContext => {
  const { config, state } = args;
  const stack = config.riskLimits.capitalBufferStack;
  const confidence = config.behaviour.confidenceStateMachine;

  const values: MechanicsDynamicContext = {
    minCet1Ratio: config.riskLimits.minCet1Ratio,
    minLeverageRatio: config.riskLimits.minLeverageRatio,
    minLcr: config.riskLimits.minLcr,
    minNsfr: config.riskLimits.minNsfr,
    combinedCet1Requirement: state?.risk.riskMetrics.cet1Requirement ?? (
      config.riskLimits.minCet1Ratio +
      stack.conservationBuffer +
      stack.countercyclicalBuffer +
      stack.systemicBuffer),
    at1DiscretionaryCet1Threshold: config.riskLimits.capitalPolicy.at1DiscretionaryCet1Threshold,
    confidenceStrongMinScore: confidence?.strongMinScore ?? 0.8,
    confidenceStableMinScore: confidence?.stableMinScore ?? 0.6,
    confidenceWatchMinScore: confidence?.watchMinScore ?? 0.38,
    confidenceHardLcrWatch: confidence?.hardLcrWatch ?? 1.02,
    confidenceHardLcrStressed: confidence?.hardLcrStressed ?? 0.92,
    currentCet1Ratio: state?.risk.riskMetrics.cet1Ratio,
    currentLeverageRatio: state?.risk.riskMetrics.leverageRatio,
    currentLcr: state?.risk.riskMetrics.lcr,
    currentNsfr: state?.risk.riskMetrics.nsfr,
  };

  const formatMaybePct = (value: number | undefined, digits = 1): string | undefined =>
    value === undefined ? undefined : formatPct(value, digits);
  const formatMaybeMult = (value: number | undefined, digits = 2): string | undefined =>
    value === undefined ? undefined : formatMultiple(value, digits);

  return {
    values,
    formatted: {
      minCet1Ratio: formatPct(values.minCet1Ratio),
      minLeverageRatio: formatPct(values.minLeverageRatio),
      minLcr: formatMultiple(values.minLcr),
      minNsfr: formatMultiple(values.minNsfr),
      combinedCet1Requirement: formatPct(values.combinedCet1Requirement),
      at1DiscretionaryCet1Threshold: formatPct(values.at1DiscretionaryCet1Threshold),
      confidenceStrongMinScore: formatPct(values.confidenceStrongMinScore),
      confidenceStableMinScore: formatPct(values.confidenceStableMinScore),
      confidenceWatchMinScore: formatPct(values.confidenceWatchMinScore),
      confidenceHardLcrWatch: formatMaybeMult(values.confidenceHardLcrWatch) ?? 'N/A',
      confidenceHardLcrStressed: formatMaybeMult(values.confidenceHardLcrStressed) ?? 'N/A',
      currentCet1Ratio: formatMaybePct(values.currentCet1Ratio),
      currentLeverageRatio: formatMaybePct(values.currentLeverageRatio),
      currentLcr: formatMaybeMult(values.currentLcr),
      currentNsfr: formatMaybeMult(values.currentNsfr),
    },
  };
};

