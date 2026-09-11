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
  confidenceStateMachine: true,
  recommendations: true,
  stepDiagnosticsAttribution: true,
  // Three-Year Plan is opt-in: ordinary Sandbox remains a pure simulation.
  threeYearPlan: false,
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
  // threeYearPlan currently owns no SimulationConfig transform; its false default is intentionally inert.
  if (Object.entries(flags).every(([key, enabled]) => key === 'threeYearPlan' || enabled)) return config;

  return {
    ...config,
    behaviour: {
      ...config.behaviour,
      costModel: flags.costDecomposition ? config.behaviour.costModel : undefined,
      liquidityDynamics: flags.liquidityDynamics ? config.behaviour.liquidityDynamics : undefined,
      irrbb: flags.irrbbHedges ? config.behaviour.irrbb : undefined,
      securitiesAccounting: flags.securitiesAccounting ? config.behaviour.securitiesAccounting : undefined,
      concentration: flags.concentrationRisk ? config.behaviour.concentration : undefined,
      confidenceStateMachine: flags.confidenceStateMachine ? config.behaviour.confidenceStateMachine : undefined,
    },
    riskLimits: {
      ...config.riskLimits,
      concentration: flags.concentrationRisk
        ? config.riskLimits.concentration
        : {
            maxSingleSectorShare: 1,
            maxSingleGeographyShare: 1,
          },
    },
  };
};
