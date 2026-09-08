from pathlib import Path

scenarios = Path('src/config/scenarios.ts')
text = scenarios.read_text()
import_anchor = "import { getCapability, productTypesWithCapability } from '../products/capabilities';\n"
import_line = "import { resetOpeningSupervisoryAssessments } from '../engine/supervisoryAssessments';\n"
if import_anchor not in text:
    raise SystemExit('scenario import anchor not found')
if import_line not in text:
    text = text.replace(import_anchor, import_anchor + import_line, 1)
metrics_anchor = "  state.risk.riskMetrics = calculateRiskMetrics({ state, config });\n"
if metrics_anchor not in text:
    raise SystemExit('scenario metrics anchor not found')
text = text.replace(
    metrics_anchor,
    "  resetOpeningSupervisoryAssessments(state);\n" + metrics_anchor,
    1,
)
scenarios.write_text(text)

utils = Path('src/config/calibration/utils.ts')
text = utils.read_text()
utils_import_anchor = "import { calculateProvisionTargetFromCohorts, sumLoanOutstanding } from '../../engine/loanCohorts';\n"
utils_import_line = "import { resetOpeningSupervisoryAssessments } from '../../engine/supervisoryAssessments';\n"
if utils_import_anchor not in text:
    raise SystemExit('calibration import anchor not found')
if utils_import_line not in text:
    text = text.replace(utils_import_anchor, utils_import_anchor + utils_import_line, 1)
refresh_anchor = "  state.financial.provisionStock = calculateProvisionTargetFromCohorts({ state, config });\n  state.risk.riskMetrics = calculateRiskMetrics({ state, config });\n"
if refresh_anchor not in text:
    raise SystemExit('calibration refresh anchor not found')
text = text.replace(
    refresh_anchor,
    "  state.financial.provisionStock = calculateProvisionTargetFromCohorts({ state, config });\n  resetOpeningSupervisoryAssessments(state);\n  state.risk.riskMetrics = calculateRiskMetrics({ state, config });\n",
    1,
)
utils.write_text(text)

helper = Path('src/engine/supervisoryAssessments.ts')
helper.write_text(r'''import { BankState } from '../domain/bankState';

/**
 * Scenario and calibration builders clone the fully assessed base bank before
 * applying opening-state overrides. Frozen supervisory assessments from that
 * base bank are no longer valid once the opening portfolio or configuration is
 * changed, so clear them immediately before opening risk metrics are rebuilt.
 */
export const resetOpeningSupervisoryAssessments = (state: BankState): void => {
  state.risk.pillar2A = undefined;
  state.risk.osii = undefined;
};
''')

test = Path('src/config/openingSupervisoryAssessments.test.ts')
test.write_text(r'''import { describe, expect, it } from 'vitest';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { cloneBankState } from '../engine/clone';
import { assessPillar2A } from '../engine/pillar2A';
import { baseConfig } from './baseConfig';
import { calibrationPacks } from './calibration';
import { applyScenarioConfig, getScenarioInitialState, scenarios } from './scenarios';

const componentKeys = [
  'creditRisk',
  'singleNameConcentration',
  'sectorConcentration',
  'geographicConcentration',
  'irrbb',
] as const;

const expectFreshOpeningPillar2A = (
  state: BankState,
  config: SimulationConfig,
  label: string
): void => {
  const actual = state.risk.pillar2A;
  expect(actual, `${label}: missing opening Pillar 2A assessment`).toBeDefined();

  const expected = assessPillar2A({
    state: cloneBankState(state),
    config,
    rwa: state.risk.riskMetrics.rwa,
    eveSensitivity100bp: state.risk.riskMetrics.eveSensitivity100bp,
    assessmentStep: state.time.step,
  });

  expect(actual!.assessmentStep, `${label}: assessment step`).toBe(state.time.step);
  expect(actual!.assessmentRwa, `${label}: assessment RWA`).toBeCloseTo(state.risk.riskMetrics.rwa, 6);
  expect(actual!.assessmentRwa, `${label}: fresh assessment RWA`).toBeCloseTo(expected.assessmentRwa, 6);
  expect(actual!.grossRate, `${label}: gross rate`).toBeCloseTo(expected.grossRate, 12);
  expect(actual!.assessedRate, `${label}: assessed rate`).toBeCloseTo(expected.assessedRate, 12);

  componentKeys.forEach((key) => {
    expect(actual!.components[key], `${label}: ${key}`).toBeCloseTo(expected.components[key], 6);
  });
};

describe('opening supervisory assessments', () => {
  it('assesses every scenario against its own opening balance sheet', () => {
    scenarios.forEach((scenario) => {
      const config = applyScenarioConfig(baseConfig, scenario.id);
      const state = getScenarioInitialState(scenario.id, config);
      expectFreshOpeningPillar2A(state, config, `scenario ${scenario.id}`);
    });
  });

  it('assesses every calibration pack against its own opening balance sheet', () => {
    calibrationPacks.forEach((pack) => {
      expectFreshOpeningPillar2A(pack.initialState, pack.config, `calibration ${pack.id}`);
    });
  });
});
''')
