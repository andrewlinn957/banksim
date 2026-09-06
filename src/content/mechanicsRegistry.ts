import { MechanicsDisplayContext } from './mechanicsContext';

export type MechanicCategory =
  | 'Controls'
  | 'Deposits'
  | 'Loans'
  | 'Funding & Liquidity'
  | 'Capital & Compliance'
  | 'Market & Scenarios'
  | 'Diagnostics';

export interface MechanicEntry {
  id: string;
  category: MechanicCategory;
  title: string;
  plainDescription: string;
  whyItMatters: string;
  driverSummary: string[];
  formula?: string;
  thresholds?: Array<{ label: string; value: string }>;
  relatedMetrics?: string[];
  relatedActions?: string[];
}

const metric = (name: string): string => name;

const action = (name: string): string => name;

export const buildMechanicsRegistry = (ctx: MechanicsDisplayContext): MechanicEntry[] => [
  {
    id: 'core-monthly-loop',
    category: 'Controls',
    title: 'Monthly Step Pipeline',
    plainDescription:
      'Each month processes shocks, actions, behavior dynamics, P&L, losses, capital, compliance, and then market evolution.',
    whyItMatters:
      'Your action effect is path-dependent because later subsystems can amplify or offset earlier gains.',
    driverSummary: [
      'Shocks and actions happen before behavior and losses.',
      'Capital distributions happen after initial metric computation.',
      'Market state is advanced at the end of the step.',
    ],
    relatedMetrics: [metric('CET1 Ratio'), metric('LCR'), metric('NSFR'), metric('Net Income')],
  },
  {
    id: 'actions-pricing-and-underwriting',
    category: 'Controls',
    title: 'Pricing and Underwriting Levers',
    plainDescription:
      'Rate levers update offered pricing directly, while underwriting tightness adjusts approvals and selection pressure.',
    whyItMatters:
      'Aggressive pricing can improve short-run volume or margin but may hurt franchise, defaults, and conduct risk.',
    driverSummary: [
      'Deposit rates feed deposit growth/churn and franchise dynamics.',
      'Loan rates feed demand and adverse selection multipliers.',
      'Underwriting tightness reduces approval rates and risk loading.',
    ],
    relatedActions: [
      action('adjustRate'),
      action('setUnderwriting'),
      action('setCapitalPolicy'),
      action('enterHedge'),
    ],
  },
  {
    id: 'autopilot-and-run-history',
    category: 'Controls',
    title: 'Autopilot, Stop Rules, and Replay',
    plainDescription:
      'Auto advances individual months under standing pricing, underwriting and payout policies. One-off debt, equity and swap orders execute once. Quarter/year controls stop at reporting boundaries; safety interruption defaults on.',
    whyItMatters:
      'You can test strategy stability quickly and verify deterministic replay for the same timeline.',
    driverSummary: [
      'Choose one month, quarter end, year end or continuous play. Safety pauses are enabled by default; configure them under Game.',
      'Saved runs keep snapshots plus action/shock timeline.',
      'Replay compares final metrics for deterministic consistency.',
    ],
  },
  {
    id: 'deposit-behaviour',
    category: 'Deposits',
    title: 'Deposit Behavior and Franchise',
    plainDescription:
      'Deposits reprice with lag against competitor benchmarks and then grow/churn based on rate gap, policy conditions, and underpricing duration.',
    whyItMatters:
      'Persistent underpricing can silently erode franchise quality before hard liquidity ratios break.',
    driverSummary: [
      'Pass-through lag stores rate memory by product.',
      'Underpricing months increase convex churn penalties.',
      'Mix migration shifts balances toward less stable buckets in stress.',
    ],
    relatedMetrics: [metric('LCR'), metric('NSFR'), metric('Deposit Quality'), metric('Funding Confidence')],
    relatedActions: [action('adjustRate')],
  },
  {
    id: 'loan-pipeline',
    category: 'Loans',
    title: 'Loan Pipeline (Demand to Drawdown)',
    plainDescription:
      'Each loan book runs monthly demand, approval, cancellation, commitment, and drawdown, subject to cash availability.',
    whyItMatters:
      'Pipeline volume can look healthy while hidden selection pressure and future defaults accumulate.',
    driverSummary: [
      'Demand uses pricing gap and macro signal.',
      'Approval drops with tighter underwriting.',
      'Drawdown is capped by committed amount and available cash.',
      'Adverse selection can uplift PD on new originations.',
    ],
    relatedMetrics: [metric('Net Income'), metric('CET1 Ratio'), metric('Board Pressure')],
    relatedActions: [action('adjustRate'), action('setUnderwriting')],
  },
  {
    id: 'loan-cohorts-and-ifrs9',
    category: 'Loans',
    title: 'Loan Cohorts, Defaults, and IFRS9 Staging',
    plainDescription:
      'Loans are tracked as cohorts that amortize, prepay, renew, migrate stage, default, and enter workout buckets.',
    whyItMatters:
      'Credit risk is driven by both current pricing and the quality/age distribution of prior originations.',
    driverSummary: [
      'SICR compares current PD with origination risk. Macro deterioration alone does not establish credit impairment.',
      'Defaults feed workout pipeline with lagged recoveries.',
      'Probability-weighted discounted ECL is held separately from borrower principal. Stage 1 uses defaults within 12 months; stage 2 uses remaining life.',
    ],
    formula: 'Monthly default probability ~= 1 - (1 - annualPd)^(1/12)',
    relatedMetrics: [metric('Credit Losses'), metric('CET1 Ratio'), metric('Sector Concentration')],
  },
  {
    id: 'funding-ladder-and-rollover',
    category: 'Funding & Liquidity',
    title: 'Funding Ladder and Rollover Access',
    plainDescription:
      'Wholesale ST/LT funding matures by bucket and is refinanced only up to an access level shaped by stress and confidence.',
    whyItMatters:
      'Rollover cliffs can produce sudden cash failures even if last month looked compliant.',
    driverSummary: [
      'Access depends on spreads, liquidity stress, franchise quality, and confidence state.',
      'Shortfalls can roll as overdue high-rate funding.',
      'Maturity walls are visible in <=3m and <=12m funding metrics.',
    ],
    relatedMetrics: [metric('LCR'), metric('NSFR'), metric('Funding <=3m'), metric('Funding <=12m')],
    relatedActions: [action('issueDebt'), action('issueEquity')],
  },
  {
    id: 'liquidity-ratios',
    category: 'Funding & Liquidity',
    title: 'LCR and NSFR Mechanics',
    plainDescription:
      'LCR compares HQLA to stressed 30-day net outflows, while NSFR compares available stable funding to required stable funding.',
    whyItMatters:
      'Breaches require recovery and reduce confidence. A liquidity ratio shortfall alone does not end the game.',
    driverSummary: [
      'Regulatory outflows use prescribed product factors and contractual maturities.',
      'Inflows are capped (75% of outflows for LCR).',
      'Behavioural runoff and ASF haircuts affect separate management stress estimates.',
    ],
    thresholds: [
      { label: 'Min LCR', value: ctx.formatted.minLcr },
      { label: 'Min NSFR', value: ctx.formatted.minNsfr },
      { label: 'Current LCR', value: ctx.formatted.currentLcr ?? 'N/A' },
      { label: 'Current NSFR', value: ctx.formatted.currentNsfr ?? 'N/A' },
    ],
    formula: 'LCR = HQLA / max(Outflows - min(Inflows, 75% of Outflows), 0)',
    relatedMetrics: [metric('LCR'), metric('NSFR'), metric('Deposit Quality')],
  },
  {
    id: 'capital-policy-and-distributions',
    category: 'Capital & Compliance',
    title: 'Capital Policy, Dividends, and AT1 Coupons',
    plainDescription:
      'Requested distributions are clipped by regulatory and internal capital rules, then limited by distributable CET1 and cash.',
    whyItMatters:
      'You can appear profitable but still be distribution-constrained by internal target logic.',
    driverSummary: [
      'Dividend ratio is capped by max payout ratio.',
      'Bank policy suspends dividends and AT1 coupons inside combined buffers, including manual pay mode. This is not the PRA MDA amount.',
      'Paid distributions reduce CET1 and cash immediately.',
    ],
    thresholds: [
      { label: 'AT1 discretionary CET1 threshold', value: ctx.formatted.at1DiscretionaryCet1Threshold },
    ],
    relatedMetrics: [metric('Max Payout Ratio'), metric('Internal CET1 Headroom'), metric('CET1 Ratio')],
    relatedActions: [action('setCapitalPolicy')],
  },
  {
    id: 'risk-metrics-and-compliance',
    category: 'Capital & Compliance',
    title: 'Capital and Hard Breach Limits',
    plainDescription:
      'CET1, Tier 1, total capital, leverage, LCR and NSFR are recomputed each month. The game ends for capital minimum or cash failures; liquidity ratios can recover.',
    whyItMatters:
      'These are the run-ending constraints, so strategy should be framed around preserving headroom, not only profitability.',
    driverSummary: [
      'CET1 ratio uses adjusted CET1 over RWA.',
      'Leverage uses Tier 1 over total exposure.',
      'Compliance booleans are checked every step.',
    ],
    thresholds: [
      { label: 'Min CET1 ratio', value: ctx.formatted.minCet1Ratio },
      { label: 'Min leverage ratio', value: ctx.formatted.minLeverageRatio },
      { label: 'Combined CET1 requirement (MDA line)', value: ctx.formatted.combinedCet1Requirement },
      { label: 'Current CET1 ratio', value: ctx.formatted.currentCet1Ratio ?? 'N/A' },
      { label: 'Current leverage ratio', value: ctx.formatted.currentLeverageRatio ?? 'N/A' },
    ],
    relatedMetrics: [metric('CET1 Ratio'), metric('Leverage Ratio'), metric('CET1 Headroom')],
  },
  {
    id: 'confidence-state-machine',
    category: 'Capital & Compliance',
    title: 'Funding Confidence State Machine',
    plainDescription:
      'Funding confidence transitions among strong/stable/watch/stressed states and modifies access, spreads, and equity issuance execution.',
    whyItMatters:
      'State downgrades can materially tighten funding and capital flexibility in just a few months.',
    driverSummary: [
      'Downgrades are immediate; upgrades require sustained improvement.',
      'Hard gates use LCR/NSFR/CET1 headroom to force watch or stressed.',
      'Impacts apply to debt issuance, rollover, and equity raises.',
    ],
    thresholds: [
      { label: 'Strong min score', value: ctx.formatted.confidenceStrongMinScore },
      { label: 'Stable min score', value: ctx.formatted.confidenceStableMinScore },
      { label: 'Watch min score', value: ctx.formatted.confidenceWatchMinScore },
      { label: 'Hard LCR watch gate', value: ctx.formatted.confidenceHardLcrWatch },
      { label: 'Hard LCR stressed gate', value: ctx.formatted.confidenceHardLcrStressed },
    ],
    relatedMetrics: [metric('Funding Confidence'), metric('Confidence State'), metric('Funding Stress Index')],
  },
  {
    id: 'conduct-risk',
    category: 'Capital & Compliance',
    title: 'Conduct Risk and Event Costs',
    plainDescription:
      'Conduct score builds from pricing severity and underwriting looseness; high score can trigger costly events with franchise/reputation damage.',
    whyItMatters:
      'Conduct events can rapidly reverse earnings and resilience, especially when buffers are already thin.',
    driverSummary: [
      'Deposit underpricing and lending overpricing both contribute.',
      'Event probability rises with score and is cooldown-limited.',
      'Triggered events add fines/remediation and reduce franchise/reputation.',
    ],
    relatedMetrics: [metric('Conduct Risk Score'), metric('Net Income'), metric('Deposit Franchise')],
  },
  {
    id: 'market-and-curve-engine',
    category: 'Market & Scenarios',
    title: 'Macro, Curve, and Spread Engine',
    plainDescription:
      'A deterministic seeded UK macro model updates GDP, inflation, unemployment, policy rate, gilt curve, and spreads each step.',
    whyItMatters:
      'Market drift changes competitor benchmarks and risk costs even when your own actions are unchanged.',
    driverSummary: [
      'Correlated latent factors and regime switching drive macro path.',
      'Credit and funding spreads pass through to pricing references.',
      'Stored RNG seed preserves replay determinism for fixed timelines.',
    ],
    relatedMetrics: [metric('Base Rate'), metric('Credit Spread'), metric('Competitor Rates')],
  },
  {
    id: 'scenario-system',
    category: 'Market & Scenarios',
    title: 'Scenarios, Scheduled Shocks, and Arc Triggers',
    plainDescription:
      'Starting a scenario can override starting state/config and inject both scheduled shocks and trigger-based arc shocks.',
    whyItMatters:
      'Different scenarios can change both the environment and your operating constraints, not just shock timing.',
    driverSummary: [
      'Arc triggers can depend on metrics and action requirements.',
      'Milestones are emitted to the event log for narrative context.',
      'Scenario score includes objective completion and quality penalty.',
    ],
    relatedMetrics: [metric('Scenario completion %'), metric('Quality penalty')],
  },
  {
    id: 'board-pressure',
    category: 'Diagnostics',
    title: 'Board Pressure Signal',
    plainDescription:
      'Board pressure is a soft governance signal combining earnings volatility, franchise underperformance, and risk appetite gaps.',
    whyItMatters:
      'It does not directly fail the bank, but persistent high pressure highlights unstable strategy before hard capital or liquidity breaches appear.',
    driverSummary: [
      'Higher earnings volatility raises pressure.',
      'Franchise score below target increases pressure.',
      'Low CET1 headroom versus appetite increases pressure.',
    ],
    relatedMetrics: [metric('Board Pressure'), metric('Funding Confidence'), metric('CET1 Headroom')],
  },
  {
    id: 'share-price-model',
    category: 'Market & Scenarios',
    title: 'Share Price Model',
    plainDescription:
      'Share price evolves from smoothed EPS, capital headroom, macro state, and franchise score through a bounded P/E framework.',
    whyItMatters:
      'Market valuation can diverge from safety metrics; high price does not guarantee solvency resilience.',
    driverSummary: [
      'P/E is bounded and score-sensitive.',
      'Price mean-reverts toward model fair value each step.',
      'Equity issuance dilutes via discounted issue price.',
    ],
    relatedMetrics: [metric('Share Price'), metric('Market Cap'), metric('P/E'), metric('EPS TTM')],
  },
  {
    id: 'preview-and-recommendations',
    category: 'Diagnostics',
    title: 'Preview Paths and Recommendations',
    plainDescription:
      'Preview runs baseline and stress paths for one-step risk deltas, while recommendations rank candidate actions by deficit improvement.',
    whyItMatters:
      'This gives forward-looking guardrails before committing a month.',
    driverSummary: [
      'Preview includes macro, funding, and run stresses.',
      'Recommendation score balances ratio improvements against earnings drag and board pressure.',
      'Select a department on the bank screen for standing policies, one-off orders and a next-close estimate.',
    ],
  },
  {
    id: 'attribution-events-reconciliation',
    category: 'Diagnostics',
    title: 'Attribution, Event Links, and Reconciliations',
    plainDescription:
      'Step attribution decomposes metric moves into drivers and links them to events; reconciliation checks ensure accounting consistency.',
    whyItMatters:
      'Use this chain to diagnose why a run failed and which lever to change next.',
    driverSummary: [
      'Attribution exposes top positive/negative drivers by metric.',
      'Event links filter the log to relevant step events.',
      'Balance-sheet and cash-flow tie-outs can independently fail the run.',
    ],
    relatedMetrics: [metric('CET1 delta attribution'), metric('LCR/NSFR attribution'), metric('CF mismatch')],
  },
];
