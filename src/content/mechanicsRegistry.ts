import { MechanicsDisplayContext } from './mechanicsContext';

export type MechanicCategory =
  | 'Start Here'
  | 'Customers'
  | 'Lending'
  | 'Treasury'
  | 'Capital'
  | 'Risk Measures'
  | 'Market & Reports';

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
    category: 'Start Here',
    title: 'What happens when you close a month',
    plainDescription:
      'The game applies your queued actions and standing policies. It then updates customers, loans, funding, profit, losses, capital, liquidity, and the market.',
    whyItMatters:
      'One action can change more than one result. For example, a higher savings rate can improve deposit growth and reduce profit at the same time.',
    driverSummary: [
      'Standing policies stay in force until you change them.',
      'One-off transactions execute once and then clear from the queue.',
      'The market moves after the bank completes the monthly close.',
      'The game checks capital, leverage, liquidity, cash, and concentration after each close.',
    ],
    relatedMetrics: [metric('Net income'), metric('CET1 ratio'), metric('LCR'), metric('NSFR')],
  },
  {
    id: 'actions-pricing-and-underwriting',
    category: 'Start Here',
    title: 'How to read a policy control',
    plainDescription:
      'Most controls change one of four things: price, volume, risk, or funding. A change can improve one result and weaken another result.',
    whyItMatters:
      'Do not judge a policy from one metric. Check profit, capital, liquidity, and future maturities together.',
    driverSummary: [
      'A higher deposit rate can attract funding. It also increases interest expense.',
      'A lower loan rate can increase demand. It also reduces margin.',
      'Looser underwriting can increase approvals. It also increases expected credit loss.',
      'More capital increases resilience. It can reduce return on equity or dilute shareholders.',
    ],
  },
  {
    id: 'autopilot-and-run-history',
    category: 'Start Here',
    title: 'Run controls and saved games',
    plainDescription:
      'You can run one month, to quarter end, to year end, or continuously. The game uses your standing policies for each new month.',
    whyItMatters:
      'A policy can look safe for one month and fail after several quarters. Use longer runs to test the full funding and credit cycle.',
    driverSummary: [
      'Safety pauses can stop a run when the bank needs attention.',
      'Saved runs keep snapshots and the action timeline.',
      'Replay uses the same timeline and random seed to check that the result is deterministic.',
    ],
  },

  {
    id: 'deposit-behaviour',
    category: 'Customers',
    title: 'Retail current accounts and business deposits',
    plainDescription:
      'You set the rate for retail current accounts and SME or business deposits. The game compares your rate with the market rate.',
    whyItMatters:
      'A higher rate can grow deposits and improve funding. A higher rate also increases interest expense. A low rate can cause customers to leave.',
    driverSummary: [
      'Retail current accounts balances respond to the price gap and franchise strength.',
      'A negative price gap increases churn if it stays in place for several months.',
      'Weak franchise strength and poor deposit quality can increase deposit runoff in stress.',
      'A high insured retail share and a low large-depositor share improve deposit quality.',
    ],
    formula: 'Deposit price gap = your deposit rate - competitor deposit rate',
    relatedMetrics: [metric('Deposit quality'), metric('Funding confidence'), metric('LCR'), metric('NSFR')],
    relatedActions: [action('Retail current account rate'), action('SME/business deposit offer')],
  },
  {
    id: 'term-savings',
    category: 'Customers',
    title: 'Fixed-term savings',
    plainDescription:
      'You set a fixed-term savings rate and a term of one, two, or three years. New balances stay in a contractual maturity bucket until they mature.',
    whyItMatters:
      'Fixed-term savings give the bank more stable funding. They also create a future maturity wall and lock in the deposit rate for longer.',
    driverSummary: [
      'A higher fixed-term rate can attract more balances.',
      'A longer term keeps the funding stable for longer.',
      'Maturing balances can leave the bank or roll into new funding.',
      'A larger term-deposit share can improve funding confidence and NSFR.',
    ],
    formula: 'Term deposit share = fixed-term retail deposits / total customer deposits',
    relatedMetrics: [metric('Term deposit share'), metric('Funding <=12m'), metric('NSFR')],
    relatedActions: [action('Fixed-term savings offer'), action('Term')],
  },

  {
    id: 'loan-pipeline',
    category: 'Lending',
    title: 'Loan price, demand, and approvals',
    plainDescription:
      'The game models mortgages, personal credit, and SME or business lending. Each product has its own price and selectivity control.',
    whyItMatters:
      'A lower loan rate can increase demand but reduce margin. Looser selectivity can increase approvals but increase credit risk.',
    driverSummary: [
      'The game compares your loan rate with the market rate.',
      'Selectivity uses a scale from 0 to 1. A value of 0 is loose. A value of 1 is tight.',
      'Demand changes with the economy and the price gap.',
      'Approved loans first become commitments. Customers then draw the loans if the bank has cash.',
    ],
    formula: 'Loan price gap = your loan rate - market loan rate',
    relatedMetrics: [metric('Approvals'), metric('Undrawn commitments'), metric('Loan balance'), metric('Net interest income')],
    relatedActions: [action('Loan rate'), action('Selectivity')],
  },
  {
    id: 'mortgage-structure',
    category: 'Lending',
    title: 'Mortgage LTV and fixed period',
    plainDescription:
      'You set the maximum loan-to-value ratio and the initial fixed-rate period for new mortgages.',
    whyItMatters:
      'A higher LTV can increase demand but increases loss severity. A longer fixed period reduces near-term repricing but increases duration risk.',
    driverSummary: [
      'The LTV limit applies to new mortgage business.',
      'Higher LTV loans are more exposed to a fall in house prices.',
      'A longer fixed period makes mortgage cash flows stay fixed for longer.',
      'Long fixed periods can make EVE more sensitive to a rise in rates.',
    ],
    formula: 'LTV = mortgage amount / property value',
    relatedMetrics: [metric('Mortgage balance'), metric('Credit losses'), metric('EVE +100bp')],
    relatedActions: [action('Maximum LTV'), action('Initial fixed period')],
  },
  {
    id: 'loan-cohorts-and-ifrs9',
    category: 'Lending',
    title: 'Credit losses and IFRS 9 stages',
    plainDescription:
      'The game keeps loan cohorts by age and risk. Loans can prepay, amortize, move between IFRS 9 stages, default, and enter workout.',
    whyItMatters:
      'A bad lending decision can create losses many months after origination. Current profit can therefore hide future credit cost.',
    driverSummary: [
      'Stage 1 uses expected defaults over the next 12 months.',
      'Stage 2 uses expected defaults over the remaining life of the loan.',
      'A large increase in credit risk can move a cohort to Stage 2.',
      'Defaulted loans enter workout. Recoveries arrive later and depend on LGD.',
    ],
    formula: 'Monthly default probability ≈ 1 - (1 - annual PD)^(1/12)',
    relatedMetrics: [metric('Credit losses'), metric('CET1 ratio'), metric('Sector concentration')],
  },

  {
    id: 'treasury-liquidity-portfolio',
    category: 'Treasury',
    title: 'Reserves, gilts, and gilt duration',
    plainDescription:
      'You set the share of liquid assets held as gilts. The rest stays as reserves. You also set the duration of the gilt portfolio.',
    whyItMatters:
      'Reserves give immediate liquidity. Gilts can add yield but create fair-value and interest-rate risk. Long-duration gilts create more EVE risk.',
    driverSummary: [
      'The game rebalances only when the actual gilt share moves outside a tolerance band.',
      'Unencumbered reserves and eligible gilts can count as HQLA.',
      'Encumbered gilts do not count as available HQLA.',
      'Longer gilt duration increases the balance-sheet response to a rate shock.',
    ],
    formula: 'Gilt share = gilts / (reserves + gilts)',
    relatedMetrics: [metric('HQLA'), metric('LCR'), metric('EVE +100bp')],
    relatedActions: [action('Gilt share of liquid assets'), action('Gilt portfolio duration')],
  },
  {
    id: 'funding-ladder-and-rollover',
    category: 'Treasury',
    title: 'Long-term debt and funding maturities',
    plainDescription:
      'You can issue long-term debt as a one-off funding action. The debt enters a maturity ladder and remains until it matures or is refinanced.',
    whyItMatters:
      'Long-term debt can support stable funding. It also adds interest expense and a future refinancing need.',
    driverSummary: [
      'Fixed-term savings are the main contractual retail funding tool in this version of the game.',
      'Long-term debt gives another source of stable funding when retail funding is not enough.',
      'The game reports funding that matures within 3 months and 12 months.',
      'Weak funding confidence can make market funding less effective or more expensive.',
    ],
    relatedMetrics: [metric('Funding <=3m'), metric('Funding <=12m'), metric('NSFR'), metric('Funding confidence')],
    relatedActions: [action('Raise long-term debt once')],
  },
  {
    id: 'boe-secured-funding',
    category: 'Treasury',
    title: 'Bank of England secured funding',
    plainDescription:
      'You can draw secured reserves from the Bank of England. The game supports STR and ILTR. The drawing uses eligible gilt collateral.',
    whyItMatters:
      'The drawing increases reserves but encumbers collateral. It can solve a short-term cash need without creating new equity.',
    driverSummary: [
      'STR is short-term secured funding.',
      'ILTR stays outstanding for six months in the game.',
      'A haircut limits the amount that you can borrow against gilts.',
      'The game releases the collateral when the borrowing matures.',
    ],
    formula: 'Maximum secured drawing is limited by eligible collateral after the haircut',
    relatedMetrics: [metric('Cash and reserves'), metric('HQLA'), metric('Funding <=12m')],
    relatedActions: [action('Bank of England facility'), action('BoE drawing once')],
  },
  {
    id: 'liquidity-ratios',
    category: 'Risk Measures',
    title: 'LCR and NSFR',
    plainDescription:
      'LCR measures 30-day liquidity. NSFR measures structural funding over a longer horizon.',
    whyItMatters:
      'Low liquidity can reduce funding confidence and limit your options. A liquidity-ratio breach does not end the game by itself, but a cash failure can end the game.',
    driverSummary: [
      'LCR increases when HQLA increases or stressed net outflows decrease.',
      'The LCR inflow cap is 75% of outflows.',
      'NSFR increases when available stable funding increases or required stable funding decreases.',
      'The game also calculates management-stress versions of LCR and NSFR.',
    ],
    formula: 'LCR = HQLA / [Outflows - min(Inflows, 75% × Outflows)]\nNSFR = ASF / RSF',
    thresholds: [
      { label: 'Minimum LCR', value: ctx.formatted.minLcr },
      { label: 'Minimum NSFR', value: ctx.formatted.minNsfr },
      { label: 'Current LCR', value: ctx.formatted.currentLcr ?? 'N/A' },
      { label: 'Current NSFR', value: ctx.formatted.currentNsfr ?? 'N/A' },
    ],
    relatedMetrics: [metric('HQLA'), metric('LCR'), metric('NSFR'), metric('Deposit quality')],
  },
  {
    id: 'irrbb-and-swaps',
    category: 'Treasury',
    title: 'Interest-rate risk and swaps',
    plainDescription:
      'The game measures the effect of a 1 percentage point rise in rates on net interest income and economic value. You can use swaps to change this exposure.',
    whyItMatters:
      'A bank can have strong capital and liquidity but still have a large interest-rate risk. Mortgage fixes, gilt duration, deposits, debt, and swaps all change this risk.',
    driverSummary: [
      'Pay fixed and receive floating when you want to reduce excess fixed-rate asset duration.',
      'Receive fixed and pay floating when you want the opposite effect.',
      'A swap changes interest-rate exposure. It does not remove credit risk or funding risk.',
      'A longer swap has a larger duration effect in the model.',
    ],
    formula: 'EVE +100bp ≈ -1% × (asset duration value - liability duration value + hedge effect)',
    relatedMetrics: [metric('NII +100bp'), metric('EVE +100bp')],
    relatedActions: [action('Swap direction'), action('Swap notional'), action('Swap term')],
  },

  {
    id: 'capital-policy-and-distributions',
    category: 'Capital',
    title: 'Profit payout and retained earnings',
    plainDescription:
      'You set the share of profit that the bank pays to shareholders. The bank keeps the rest as retained earnings.',
    whyItMatters:
      'A lower payout builds CET1 faster. A higher payout returns more cash to shareholders but leaves less capital for growth and losses.',
    driverSummary: [
      'Paid dividends reduce cash and CET1.',
      'The game can reduce or stop distributions when capital headroom is too low.',
      'AT1 coupons run automatically in the current game.',
      'Your internal CET1 target can restrict payout before the regulatory minimum is breached.',
    ],
    relatedMetrics: [metric('CET1 ratio'), metric('Internal CET1 headroom'), metric('Max payout ratio')],
    relatedActions: [action('Share of profit paid out')],
  },
  {
    id: 'tier2-and-equity',
    category: 'Capital',
    title: 'Equity and Tier 2 issuance',
    plainDescription:
      'You can raise CET1 equity or Tier 2 capital as a one-off action.',
    whyItMatters:
      'Equity improves CET1, Tier 1, total capital, and leverage. Tier 2 improves total capital only. Equity can dilute existing shareholders.',
    driverSummary: [
      'CET1 equity is the strongest form of capital in the game.',
      'Tier 2 does not increase CET1.',
      'Tier 2 does not increase the leverage ratio because leverage uses Tier 1 capital.',
      'Capital issuance can give the bank room to absorb losses or grow RWA.',
    ],
    formula: 'Tier 1 capital = CET1 + AT1\nTotal capital = CET1 + AT1 + Tier 2',
    relatedMetrics: [metric('CET1 ratio'), metric('Tier 1 ratio'), metric('Total capital ratio'), metric('Leverage ratio')],
    relatedActions: [action('Raise CET1 equity once'), action('Raise Tier 2 once')],
  },
  {
    id: 'risk-metrics-and-compliance',
    category: 'Risk Measures',
    title: 'CET1, total capital, and leverage',
    plainDescription:
      'The game recalculates capital ratios after each close. Capital protects the bank against losses and supports asset growth.',
    whyItMatters:
      'A capital failure can end the game. Low headroom can also stop distributions and reduce funding confidence before a hard breach occurs.',
    driverSummary: [
      'CET1 can rise through retained profit or new equity.',
      'CET1 can fall through losses, dividends, and some valuation changes.',
      'RWA rises when the bank grows riskier assets or commitments.',
      'The leverage ratio uses Tier 1 capital and a broad exposure measure instead of RWA.',
    ],
    formula: 'CET1 ratio = adjusted CET1 / RWA\nLeverage ratio = Tier 1 capital / leverage exposure',
    thresholds: [
      { label: 'Minimum CET1 ratio', value: ctx.formatted.minCet1Ratio },
      { label: 'Combined CET1 requirement', value: ctx.formatted.combinedCet1Requirement },
      { label: 'Minimum leverage ratio', value: ctx.formatted.minLeverageRatio },
      { label: 'Current CET1 ratio', value: ctx.formatted.currentCet1Ratio ?? 'N/A' },
      { label: 'Current leverage ratio', value: ctx.formatted.currentLeverageRatio ?? 'N/A' },
    ],
    relatedMetrics: [metric('RWA'), metric('CET1 ratio'), metric('Leverage ratio'), metric('CET1 headroom')],
  },
  {
    id: 'confidence-state-machine',
    category: 'Risk Measures',
    title: 'Funding confidence',
    plainDescription:
      'The game rates funding confidence as strong, stable, watch, or stressed. Weak confidence makes funding and capital actions harder.',
    whyItMatters:
      'A bank can enter funding stress before it runs out of cash. The confidence state gives an early warning of this problem.',
    driverSummary: [
      'Management LCR and management NSFR affect funding confidence.',
      'CET1 headroom, franchise strength, deposit quality, and funding maturities also affect it.',
      'Large uninsured or concentrated deposits can reduce confidence.',
      'The game can downgrade confidence quickly. An upgrade needs sustained improvement.',
    ],
    thresholds: [
      { label: 'Strong score starts at', value: ctx.formatted.confidenceStrongMinScore },
      { label: 'Stable score starts at', value: ctx.formatted.confidenceStableMinScore },
      { label: 'Watch score starts at', value: ctx.formatted.confidenceWatchMinScore },
      { label: 'LCR watch gate', value: ctx.formatted.confidenceHardLcrWatch },
      { label: 'LCR stressed gate', value: ctx.formatted.confidenceHardLcrStressed },
    ],
    relatedMetrics: [metric('Funding confidence'), metric('Funding stress index'), metric('Deposit quality')],
  },
  {
    id: 'risk-appetite',
    category: 'Risk Measures',
    title: 'Risk appetite',
    plainDescription:
      'Risk appetite sets internal targets for CET1, leverage, LCR, and NSFR.',
    whyItMatters:
      'An internal target is not the same as a regulatory minimum. A higher target gives more safety but can restrict payout or growth sooner.',
    driverSummary: [
      "Management chooses the bank's internal prudential targets.",
      'The game still enforces the regulatory floors underneath those targets.',
      'Internal CET1 headroom can restrict distributions before MDA is triggered.',
      'Risk appetite changes the point at which the game treats a position as too close to the limit.',
    ],
    relatedMetrics: [metric('Internal CET1 headroom'), metric('Risk appetite')],
  },

  {
    id: 'market-and-curve-engine',
    category: 'Market & Reports',
    title: 'The market moves without you',
    plainDescription:
      'The UK macro model changes growth, inflation, unemployment, Bank Rate, the gilt curve, credit spreads, and competitor rates.',
    whyItMatters:
      'A standing policy can become uncompetitive even when you do not change it. Review price gaps after the market moves.',
    driverSummary: [
      'Competitor deposit and loan rates move with the market.',
      'Credit conditions change loan demand and default risk.',
      'Funding spreads change the cost of market funding.',
      'The game keeps a seeded random path so the same timeline can be replayed.',
    ],
    relatedMetrics: [metric('Bank Rate'), metric('Gilt curve'), metric('Credit spread'), metric('Competitor rates')],
  },
  {
    id: 'scenario-system',
    category: 'Market & Reports',
    title: 'Scenarios and shocks',
    plainDescription:
      'A scenario can change the starting bank, the market path, or both. A scenario can also add scheduled or trigger-based shocks.',
    whyItMatters:
      'A policy that works in the base game can fail in a recession or funding shock. Use scenarios to test the policy under stress.',
    driverSummary: [
      'Some shocks happen on a fixed month.',
      'Some shocks start only after a metric or action reaches a trigger.',
      'Scenario goals score the final result and can include quality penalties.',
    ],
    relatedMetrics: [metric('Scenario completion'), metric('Quality penalty')],
  },
  {
    id: 'share-price-model',
    category: 'Market & Reports',
    title: 'Share price',
    plainDescription:
      'The game estimates share price from earnings, capital headroom, the economy, and franchise strength. It uses a bounded price-to-earnings framework.',
    whyItMatters:
      'A safe bank can still destroy shareholder value. A high share price also does not prove that the bank is safe.',
    driverSummary: [
      'Higher sustainable earnings can increase fair value.',
      'Weak capital headroom or franchise strength can reduce fair value.',
      'New equity can dilute existing shares because the issue price can include a discount.',
      'The market price moves toward model fair value over time.',
    ],
    relatedMetrics: [metric('Share price'), metric('Market capitalization'), metric('P/E'), metric('EPS')],
  },
  {
    id: 'preview-and-recommendations',
    category: 'Market & Reports',
    title: 'Guardrails and forward checks',
    plainDescription:
      'The game can calculate short forward paths and guardrail warnings before you advance time. These checks use the full bank, not one department in isolation.',
    whyItMatters:
      'Use a warning as a reason to inspect the bank. Do not treat a forward check as a guarantee of the next result.',
    driverSummary: [
      'Forward checks include market and funding stress.',
      'A warning can identify a likely capital, liquidity, or cash problem.',
      'The department cards no longer show a separate next-close estimate.',
    ],
  },
  {
    id: 'attribution-events-reconciliation',
    category: 'Market & Reports',
    title: 'Find the cause of a result',
    plainDescription:
      'Use attribution, Events, Accounts, and Reconciliations to find why a metric changed. Each view answers a different question.',
    whyItMatters:
      'A ratio can move because of profit, asset growth, funding changes, market values, or several effects at the same time.',
    driverSummary: [
      'Attribution shows the main positive and negative drivers of a metric change.',
      'Events show shocks and important state changes.',
      'Accounts show the balance-sheet and income-statement entries.',
      'Reconciliations check that accounting and cash movements tie out.',
    ],
    relatedMetrics: [metric('CET1 attribution'), metric('LCR/NSFR attribution'), metric('Cash-flow reconciliation')],
  },
];
