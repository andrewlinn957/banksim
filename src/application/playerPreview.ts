import type { Department } from '../game/departments';
import { departmentSummary } from '../game/departments';
import { getScenarioStepPayload } from '../config/scenarios';
import type { PlayerSessionState } from './playerSession';
import type { SimulationController } from './simulationController';
import { buildActionsFromParsed, parseActionFormInputs, type PlayerControlIssue } from './playerControls';
import { buildDepartmentPreview } from '../presentation/playerPreviews';

export type PlayerForecastResult =
  | { accepted: false; issues: PlayerControlIssue[] }
  | { accepted: true; baseline: import('../domain/bankState').BankState; stressed: import('../domain/bankState').BankState; breachProbability: number; pathCount: number; deltas: { cet1Ratio: number; lcr: number; nsfr: number; nim: number } };

export type PlayerForecastSession = Pick<PlayerSessionState,
  'actionForm' | 'capitalMarketsDraftArea' | 'queuedTransactions' | 'pendingRiskAppetite' | 'scenarioId' | 'bankState' | 'stateHistory'>;

/** Shared GUI/API forecast calculation; the HTTP boundary must project before serialization. */
export const calculatePlayerNextCloseForecast = (
  session: PlayerForecastSession,
  controller: SimulationController,
): PlayerForecastResult => {
  const parsed = parseActionFormInputs(session.actionForm, {
    capitalMarketsArea: session.capitalMarketsDraftArea ?? undefined,
  });
  if (parsed.hasErrors) {
    return {
      accepted: false,
      issues: Object.entries(parsed.errors)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([field, message]) => ({ field, message })),
    };
  }
  const actions = buildActionsFromParsed(
    parsed,
    session.actionForm,
    session.bankState,
    session.queuedTransactions.map((transaction) => transaction.action),
  );
  if (session.pendingRiskAppetite !== undefined) actions.push({ type: 'setRiskAppetite', targets: session.pendingRiskAppetite });
  const scenario = getScenarioStepPayload({
    scenarioId: session.scenarioId,
    stepNumber: session.bankState.time.step,
    state: session.bankState,
    actions,
  });
  const summary = controller.preview(session.bankState, actions, scenario.shocks);
  return {
    accepted: true,
    baseline: summary.baseline,
    stressed: summary.stressed,
    breachProbability: summary.breachProbability,
    pathCount: summary.pathCount,
    deltas: {
      cet1Ratio: summary.baseline.risk.riskMetrics.cet1Ratio - session.bankState.risk.riskMetrics.cet1Ratio,
      lcr: summary.baseline.risk.riskMetrics.lcr - session.bankState.risk.riskMetrics.lcr,
      nsfr: summary.baseline.risk.riskMetrics.nsfr - session.bankState.risk.riskMetrics.nsfr,
      nim: calculateNim(summary.baseline) - calculateNim(session.bankState),
    },
  };
};

const calculateNim = (state: import('../domain/bankState').BankState) => {
  const assets = state.financial.balanceSheet.items
    .filter((item) => item.side === 'Asset')
    .reduce((sum, item) => sum + item.balance, 0);
  return assets > 0 ? state.financial.incomeStatement.netInterestIncome * 12 / assets : 0;
};

export type PlayerPreviewResult =
  | { accepted: false; issues: PlayerControlIssue[] }
  | { accepted: true; department: Department; preview: ReturnType<typeof buildDepartmentPreview> };

/** Run the GUI's next-close forecast and return only the fields its department panel displays. */
export const buildPlayerNextClosePreview = (
  session: PlayerSessionState,
  controller: SimulationController,
  department: Department,
): PlayerPreviewResult => {
  const forecast = calculatePlayerNextCloseForecast(session, controller);
  if (forecast.accepted === false) return { accepted: false, issues: forecast.issues };
  const currentFundingDue = departmentSummary(department, session.bankState, session.stateHistory).metrics[2]?.rawValue ?? 0;
  return {
    accepted: true,
    department,
    preview: buildDepartmentPreview(
      department,
      session.bankState,
      forecast.baseline,
      currentFundingDue,
      Boolean(session.bankState.threeYearPlan?.enabled),
      session.actionForm.capitalMarketsInstrument !== 'none',
    ),
  };
};
