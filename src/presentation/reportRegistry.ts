export interface PlayerReportDefinition {
  id: string;
  title: string;
  guiLocation: string;
  source: string[];
  availability: 'always' | 'history' | 'valid-draft' | 'scenario' | 'active-run';
  presentation: 'shared-builder' | 'session-data' | 'existing-player-view';
}

/** Stable discovery IDs for the GUI surfaces that the player API must expose. */
export const PLAYER_REPORT_REGISTRY: readonly PlayerReportDefinition[] = [
  { id: 'report.overview', title: 'Bank overview', guiLocation: 'Bank / Boardroom', source: ['src/presentation/reports/overview.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.department.customers', title: 'Deposits management', guiLocation: 'Deposits management', source: ['src/game/departments.ts', 'src/presentation/playerPreviews.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.department.lending', title: 'Lending management', guiLocation: 'Lending management', source: ['src/game/departments.ts', 'src/presentation/playerPreviews.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.department.treasury', title: 'Treasury and funding management', guiLocation: 'Treasury & Funding management', source: ['src/game/departments.ts', 'src/presentation/quotes.ts', 'src/presentation/playerPreviews.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.department.capital', title: 'Finance and capital management', guiLocation: 'Finance & Capital management', source: ['src/game/departments.ts', 'src/presentation/quotes.ts', 'src/presentation/playerPreviews.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.dashboard.risk', title: 'Risk dashboard', guiLocation: 'Risk & Regulatory / Risk overview', source: ['src/presentation/reports/risk.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.regulatory.capital', title: 'Capital', guiLocation: 'Risk & Regulatory / Capital', source: ['src/presentation/reports/capital.ts', 'src/presentation/reports/regulatory.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.regulatory.rwa', title: 'Risk-weighted assets', guiLocation: 'Risk & Regulatory / RWA', source: ['src/presentation/reports/rwa.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.regulatory.leverage', title: 'Leverage', guiLocation: 'Risk & Regulatory / Leverage', source: ['src/presentation/reports/leverage.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.regulatory.lcr', title: 'Liquidity coverage ratio', guiLocation: 'Risk & Regulatory / LCR', source: ['src/presentation/reports/lcr.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.regulatory.nsfr', title: 'Net stable funding ratio', guiLocation: 'Risk & Regulatory / NSFR', source: ['src/presentation/reports/nsfr.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.capital_history', title: 'Capital and risk history', guiLocation: 'Risk & Regulatory / Capital history', source: ['src/presentation/reports/capitalHistory.ts'], availability: 'history', presentation: 'shared-builder' },
  { id: 'report.performance', title: 'Performance', guiLocation: 'Performance', source: ['src/presentation/reports/performance.ts'], availability: 'history', presentation: 'shared-builder' },
  { id: 'report.accounts', title: 'Accounts', guiLocation: 'Accounts', source: ['src/presentation/reports/accounts.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.share_price', title: 'Share price', guiLocation: 'Share Price', source: ['src/presentation/reports/sharePrice.ts'], availability: 'history', presentation: 'shared-builder' },
  { id: 'report.loans', title: 'Loan portfolio', guiLocation: 'Lending / Loan portfolio', source: ['src/presentation/reports/loans.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.credit_losses', title: 'Credit losses', guiLocation: 'Lending / Credit losses', source: ['src/presentation/reports/creditLosses.ts'], availability: 'history', presentation: 'shared-builder' },
  { id: 'report.costs', title: 'Costs', guiLocation: 'Finance & Capital / Costs', source: ['src/presentation/reports/costs.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.events', title: 'Event log', guiLocation: 'Settings / Event log', source: ['src/components/EventLog.tsx', 'src/application/playerSession.ts'], availability: 'active-run', presentation: 'session-data' },
  { id: 'report.reconciliations', title: 'Reconciliations', guiLocation: 'Settings / Reconciliations', source: ['src/presentation/reports/reconciliations.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.scenario', title: 'Scenario briefing and progress', guiLocation: 'Scenarios', source: ['src/presentation/reports/scenario.ts', 'src/game/scenarioBriefing.ts', 'src/game/scenarioDebrief.ts'], availability: 'scenario', presentation: 'shared-builder' },
  { id: 'report.help', title: 'Help', guiLocation: 'Help', source: ['src/presentation/help.ts'], availability: 'always', presentation: 'shared-builder' },
  { id: 'report.preview', title: 'Next-close preview', guiLocation: 'Management areas / Next close', source: ['src/presentation/playerPreviews.ts'], availability: 'valid-draft', presentation: 'shared-builder' },
  { id: 'report.player_export', title: 'Player run extract', guiLocation: 'Masthead / Export run', source: ['src/application/playerExport.ts'], availability: 'active-run', presentation: 'shared-builder' },
  { id: 'report.past_games', title: 'Past games', guiLocation: 'Past games', source: ['src/ui/useRunSession.ts'], availability: 'history', presentation: 'session-data' },
  { id: 'report.quote', title: 'Capital-market quote', guiLocation: 'Finance & Capital / Treasury ticket', source: ['src/presentation/quotes.ts'], availability: 'valid-draft', presentation: 'shared-builder' },
  { id: 'report.validation', title: 'Input validation', guiLocation: 'Management controls', source: ['src/application/playerControls.ts'], availability: 'always', presentation: 'shared-builder' },
];

export const getPlayerReportDefinition = (id: string): PlayerReportDefinition | undefined =>
  PLAYER_REPORT_REGISTRY.find((report) => report.id === id);
