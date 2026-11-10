import type { Department } from '../game/departments';
import { departmentSummary } from '../game/departments';
import { scenarios } from '../config/scenarios';
import { buildHelpCenterData, getHelpTopic } from '../presentation/help';
import { buildPlayerCapitalMarketsQuote } from '../presentation/quotes';
import { PLAYER_REPORT_REGISTRY } from '../presentation/reportRegistry';
import { buildAccountsReportData } from '../presentation/reports/accounts';
import { buildCapitalHistoryData, CAPITAL_HISTORY_DEFAULTS, type CapitalHistoryUnit } from '../presentation/reports/capitalHistory';
import { buildCreditLossesReportData } from '../presentation/reports/creditLosses';
import { buildCostsReportData } from '../presentation/reports/costs';
import { buildPlayerEventLog } from '../presentation/reports/events';
import { leverageDashboardData } from '../presentation/reports/leverage';
import { lcrDashboardData } from '../presentation/reports/lcr';
import { nsfrDashboardData } from '../presentation/reports/nsfr';
import { buildBoardroomOverviewData } from '../presentation/reports/overview';
import { buildPerformanceReportData } from '../presentation/reports/performance';
import { buildReconciliationReportData } from '../presentation/reports/reconciliations';
import { buildRiskDashboardData } from '../presentation/reports/risk';
import { buildScenarioProgressReport } from '../presentation/reports/scenario';
import { buildThreeYearPlanPresentation } from '../presentation/reports/threeYearPlan';
import { buildSharePriceReportData } from '../presentation/reports/sharePrice';
import { buildCapitalBuffersPresentation, buildPillar2AAssessmentPresentation } from '../presentation/reports/capitalAssessments';
import { capitalDashboardData } from '../presentation/reports/capital';
import { rwaDashboardData } from '../presentation/reports/rwa';
import { buildLoanPortfolioReportData, EMPTY_LOAN_COHORT_FILTERS, EMPTY_LOAN_SUMMARY_FILTERS, filterLoanCohorts, filterLoanProducts, LOAN_REPORT_PORTFOLIOS, sortLoanCohorts, sortLoanProducts } from '../presentation/reports/loans';
import { buildDraftTransactionLabels, buildPendingActionLabels, parseActionFormInputs } from './playerControls';
import { buildPlayerRunExtract } from './playerExport';
import { buildPlayerNextClosePreview } from './playerPreview';
import type { PlayerSessionState } from './playerSession';
import type { SimulationController } from './simulationController';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { summarizeQueuedPlayerTransactions } from './playerTransactions';

export interface PlayerReportQuery {
  offset?: number;
  limit?: number;
  department?: Department;
  unit?: CapitalHistoryUnit;
  selected?: string[];
  years?: 'all' | '1' | '3' | '5';
  periodMonths?: 3 | 12;
  portfolio?: string;
}

const clampPage = (query: PlayerReportQuery) => ({
  offset: Math.max(0, Math.floor(query.offset ?? 0)),
  limit: Math.max(1, Math.min(500, Math.floor(query.limit ?? 120))),
});

/** Shared safe report resolver; output consists only of current player builders and session history. */
export const buildPlayerReport = (
  session: PlayerSessionState,
  controller: SimulationController,
  reportId: string,
  query: PlayerReportQuery = {},
): { reportId: string; data: unknown; page?: { offset: number; limit: number; total: number; nextOffset: number | null } } | undefined => {
  const { bankState: state, stateHistory: history, config } = session;
  switch (reportId) {
    case 'report.overview':
      return { reportId, data: buildBoardroomOverviewData(
        state,
        history,
        [
          ...summarizeQueuedPlayerTransactions(session.queuedTransactions).map((transaction) => transaction.label),
          session.pendingRiskAppetite !== undefined ? 'Update internal risk appetite' : null,
        ].filter((item): item is string => item !== null),
        session.lastAttribution,
        config,
        buildDraftTransactionLabels(session.actionForm),
      ) };
    case 'report.department.customers':
      return { reportId, data: departmentSummary('Customers', state, history) };
    case 'report.department.lending':
      return { reportId, data: departmentSummary('Lending', state, history) };
    case 'report.department.treasury':
      return { reportId, data: departmentSummary('Treasury', state, history) };
    case 'report.department.capital':
      return { reportId, data: departmentSummary('Capital', state, history) };
    case 'report.dashboard.risk':
      return { reportId, data: buildRiskDashboardData(state, config, session.lastAttribution) };
    case 'report.regulatory.capital': {
      const capitalDashboard = capitalDashboardData(state, config);
      const pillar2AAssessment = buildPillar2AAssessmentPresentation(state, config);
      const capitalBuffers = buildCapitalBuffersPresentation(state, config);
      return { reportId, data: {
        dashboard: {
          capitalPosition: capitalDashboard.display,
          pillar2AAssessment: pillar2AAssessment?.display ?? null,
          capitalBuffers: capitalBuffers.display,
        },
      } };
    }
    case 'report.regulatory.rwa':
      return { reportId, data: rwaDashboardData(state, config) };
    case 'report.regulatory.leverage':
      return { reportId, data: leverageDashboardData(state, config) };
    case 'report.regulatory.lcr':
      return { reportId, data: lcrDashboardData(state, config) };
    case 'report.regulatory.nsfr':
      return { reportId, data: nsfrDashboardData(state, config) };
    case 'report.capital_history': {
      const unit = query.unit ?? 'ratio';
      const selected = query.selected ?? CAPITAL_HISTORY_DEFAULTS[unit];
      return { reportId, data: buildCapitalHistoryData(history, unit, selected, query.years ?? 'all') };
    }
    case 'report.performance':
      return { reportId, data: buildPerformanceReportData(history, query.periodMonths ?? 3) };
    case 'report.accounts':
      return { reportId, data: buildAccountsReportData(state, history) };
    case 'report.share_price':
      return { reportId, data: buildSharePriceReportData(state, history, config) };
    case 'report.loans': {
      const selectedPortfolio = LOAN_REPORT_PORTFOLIOS.includes(query.portfolio as never)
        ? query.portfolio as typeof LOAN_REPORT_PORTFOLIOS[number]
        : LOAN_REPORT_PORTFOLIOS.find((product) => state.loanCohorts?.[product]?.length) ?? LOAN_REPORT_PORTFOLIOS[0];
      const portfolioCohorts = (state.loanCohorts?.[selectedPortfolio] ?? []).filter((cohort) => cohort.productType === selectedPortfolio);
      const visibleCohorts = sortLoanCohorts(filterLoanCohorts(portfolioCohorts, EMPTY_LOAN_COHORT_FILTERS), { key: 'cohortId', direction: 'asc' });
      const visibleProducts = sortLoanProducts(filterLoanProducts(state.financial.balanceSheet.items, EMPTY_LOAN_SUMMARY_FILTERS), null);
      return {
        reportId,
        data: {
          ...buildLoanPortfolioReportData({
            items: visibleProducts,
            loanCohorts: state.loanCohorts,
            loanPipelines: state.loanPipelines,
            workoutPipelines: state.workoutPipelines,
            selectedPortfolio,
            visibleCohorts,
            portfolioCohortCount: portfolioCohorts.length,
            cohortFiltersActive: false,
          }),
          availableControls: {
            portfolios: [...LOAN_REPORT_PORTFOLIOS],
            summaryFilters: EMPTY_LOAN_SUMMARY_FILTERS,
            cohortFilters: EMPTY_LOAN_COHORT_FILTERS,
            sort: { key: 'cohortId', direction: 'asc' },
          },
        },
      };
    }
    case 'report.credit_losses':
      return { reportId, data: buildCreditLossesReportData(history) };
    case 'report.costs':
      return { reportId, data: buildCostsReportData(state.financial.incomeStatement) };
    case 'report.events': {
      const page = clampPage(query);
      const all = buildPlayerEventLog(session.eventLog).events;
      const rows = all.slice(page.offset, page.offset + page.limit);
      return { reportId, data: { events: rows, emptyMessage: all.length === 0 ? 'No events yet.' : undefined }, page: { ...page, total: all.length, nextOffset: page.offset + rows.length < all.length ? page.offset + rows.length : null } };
    }
    case 'report.reconciliations':
      return { reportId, data: buildReconciliationReportData(state) };
    case 'report.scenario': {
      const scenario = scenarios.find((item) => item.id === session.scenarioId) ?? null;
      return { reportId, data: buildScenarioProgressReport({
        scenario,
        state,
        openingStep: session.openingState.time.step,
        config,
        attribution: session.lastAttribution,
        recommendationTitles: controller.recommend(state).map((recommendation) => recommendation.title),
      }) };
    }
    case 'report.three_year_plan': {
      const data = buildThreeYearPlanPresentation(state);
      return { reportId, data: data ? { available: true, ...data } : { available: false } };
    }
    case 'report.help':
      return { reportId, data: buildHelpCenterData(state, config) };
    case 'report.preview': {
      const result = buildPlayerNextClosePreview(session, controller, query.department ?? 'Customers');
      if (result.accepted === false) return { reportId, data: { available: false, issues: result.issues } };
      return { reportId, data: { available: true, ...result } };
    }
    case 'report.player_export':
      return { reportId, data: buildPlayerRunExtract({ bankState: state, stateHistory: history, simConfig: config, timeline: session.timeline, events: session.eventLog }) };
    case 'report.past_games': {
      const page = clampPage(query);
      const rows = session.timeline.slice(page.offset, page.offset + page.limit).map((entry) => ({ ...entry, actions: entry.actions.map((action) => ({ ...action })), shocks: entry.shocks.map((shock) => ({ ...shock })) }));
      return { reportId, data: { runId: session.runId, openingStep: session.openingState.time.step, finalStep: state.time.step, rows, snapshots: session.snapshots.slice(page.offset, page.offset + page.limit + 1) }, page: { ...page, total: session.timeline.length, nextOffset: page.offset + rows.length < session.timeline.length ? page.offset + rows.length : null } };
    }
    case 'report.quote': {
      const parsed = parseActionFormInputs(session.actionForm, { capitalMarketsArea: session.capitalMarketsDraftArea ?? undefined });
      const instrumentId = session.actionForm.capitalMarketsInstrument;
      if (parsed.hasErrors || instrumentId === 'none' || parsed.values.capitalMarketsTargetAmount === undefined) return { reportId, data: { available: false } };
      const instrument = getCapitalMarketsInstrument(instrumentId);
      return { reportId, data: { available: true, quote: buildPlayerCapitalMarketsQuote(state, config, {
        instrument: instrumentId,
        targetAmount: parsed.values.capitalMarketsTargetAmount,
        maxDiscount: instrument.pricingKind === 'discount' ? parsed.values.capitalMarketsMaxDiscount : undefined,
        maxSpreadBps: instrument.pricingKind === 'spread' ? parsed.values.capitalMarketsMaxSpreadBps : undefined,
        tenorMonths: instrument.permittedTenorMonths?.length ? parsed.values.capitalMarketsTenorMonths : undefined,
      }) } };
    }
    case 'report.validation': {
      const parsed = parseActionFormInputs(session.actionForm, { capitalMarketsArea: session.capitalMarketsDraftArea ?? undefined });
      return { reportId, data: {
        valid: !parsed.hasErrors,
        errors: parsed.errors,
        pendingActionLabels: [
          ...summarizeQueuedPlayerTransactions(session.queuedTransactions).map((transaction) => transaction.label),
          ...buildPendingActionLabels(session.actionForm, session.pendingRiskAppetite),
        ],
        queuedTransactions: summarizeQueuedPlayerTransactions(session.queuedTransactions),
        draftTransactions: buildDraftTransactionLabels(session.actionForm),
      } };
    }
    default:
      return undefined;
  }
};

export const playerReportAvailability = (session: PlayerSessionState) => PLAYER_REPORT_REGISTRY.map((report) => {
  const draftValid = !parseActionFormInputs(session.actionForm, { capitalMarketsArea: session.capitalMarketsDraftArea ?? undefined }).hasErrors;
  const available = report.id === 'report.validation' ||
    report.availability === 'always' || report.availability === 'active-run' || report.availability === 'history' ||
    (report.availability === 'scenario' && session.scenarioId !== null) ||
    (report.availability === 'three-year-plan' && Boolean(session.bankState.threeYearPlan?.enabled)) ||
    (report.id === 'report.quote' && draftValid && session.actionForm.capitalMarketsInstrument !== 'none') ||
    (report.id !== 'report.quote' && report.availability === 'valid-draft' && draftValid);
  return {
    id: report.id,
    title: report.title,
    guiLocation: report.guiLocation,
    availability: report.availability,
    queryFields: [...(report.queryFields ?? [])],
    available,
  };
});

export const findPlayerHelpTopic = (session: PlayerSessionState, topicId: string) => getHelpTopic(buildHelpCenterData(session.bankState, session.config), topicId);

export const reportDepartmentForId = (id: string): Department | undefined => ({
  'report.department.customers': 'Customers',
  'report.department.lending': 'Lending',
  'report.department.treasury': 'Treasury',
  'report.department.capital': 'Capital',
} as const)[id as 'report.department.customers' | 'report.department.lending' | 'report.department.treasury' | 'report.department.capital'];
