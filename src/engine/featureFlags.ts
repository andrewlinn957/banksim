import { EngineFeatureFlagKey, SimulationConfig } from '../domain/config';

export type EngineFeatureFlags = Record<EngineFeatureFlagKey, boolean>;

export const DEFAULT_FEATURE_FLAGS: EngineFeatureFlags = {
  depositSegmentation: true,
  loanPipeline: true,
  costDecomposition: true,
  fundingLadder: true,
  ifrs9Staging: true,
  liquidityDynamics: true,
  irrbbHedges: true,
  securitiesAccounting: true,
  capitalPolicy: true,
  concentrationRisk: true,
  boardPressure: true,
  confidenceStateMachine: true,
  conductRisk: true,
  recommendations: true,
  stepDiagnosticsAttribution: true,
};

export const resolveFeatureFlags = (config: SimulationConfig): EngineFeatureFlags => {
  return {
    ...DEFAULT_FEATURE_FLAGS,
    ...(config.featureFlags ?? {}),
  };
};

export const isFeatureEnabled = (
  config: SimulationConfig,
  key: EngineFeatureFlagKey
): boolean => {
  const flags = resolveFeatureFlags(config);
  return Boolean(flags[key]);
};

export const applyFeatureFlagsToConfig = (
  config: SimulationConfig,
  flags: EngineFeatureFlags
): SimulationConfig => {
  if (Object.values(flags).every(Boolean)) return config;

  return {
    ...config,
    behaviour: {
      ...config.behaviour,
      costModel: flags.costDecomposition ? config.behaviour.costModel : undefined,
      liquidityDynamics: flags.liquidityDynamics ? config.behaviour.liquidityDynamics : undefined,
      irrbb: flags.irrbbHedges ? config.behaviour.irrbb : undefined,
      securitiesAccounting: flags.securitiesAccounting ? config.behaviour.securitiesAccounting : undefined,
      concentration: flags.concentrationRisk ? config.behaviour.concentration : undefined,
      boardPressure: flags.boardPressure
        ? config.behaviour.boardPressure
        : {
            earningsVolatilitySmoothing: 0.75,
            volatilityWeight: 0,
            franchiseWeight: 0,
            riskWeight: 0,
          },
      confidenceStateMachine: flags.confidenceStateMachine ? config.behaviour.confidenceStateMachine : undefined,
      conductRisk: flags.conductRisk ? config.behaviour.conductRisk : undefined,
    },
    riskLimits: {
      ...config.riskLimits,
      concentration: flags.concentrationRisk
        ? config.riskLimits.concentration
        : {
            maxSingleSectorShare: 1,
            maxSingleGeographyShare: 1,
          },
      boardPressure: flags.boardPressure
        ? config.riskLimits.boardPressure
        : {
            earningsVolatilityTolerance: 1e12,
            franchiseTarget: 0,
            riskAppetiteCet1Headroom: 0,
          },
    },
  };
};
