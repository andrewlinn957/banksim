import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import type { ActionTimelineEntry } from '../domain/runHistory';
import type { SimulationEvent } from '../engine/simulation';
import type { Shock } from '../domain/shocks';
import type { PlayerAction } from '../domain/actions';
import { AssetProductType, BalanceSheetSide } from '../domain/enums';
import { PRODUCTS } from '../products/catalogue';
import { loanCarryingAmounts } from '../products/loanBalances';
import { capitalReconciliation } from '../engine/capitalReconciliation';
import { creditStageDiagnostics } from '../engine/creditStageDiagnostics';
import { customerDeposits } from '../game/management';

export interface PlayerRunExportInput {
  bankState: BankState;
  stateHistory: BankState[];
  simConfig: SimulationConfig;
  timeline: ActionTimelineEntry[];
  events: SimulationEvent[];
}

/** The exact player-visible run extract formerly assembled by the GUI click handler. */
export const buildPlayerRunExtract = ({ bankState, stateHistory, simConfig, timeline: currentTimeline, events: eventLog }: PlayerRunExportInput) => {
  const round = (value: number) => Math.round(value * 100) / 100;
  const roundPrecise = (value: number) => Math.round(value * 10_000) / 10_000;
  const roundPerShare = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  const millions = (value: number) => round(value / 1_000_000);
  const loanBalanceHistory = stateHistory.map(loanCarryingAmounts);
  const flowValue = (state: BankState, key: keyof NonNullable<BankState['periodFlows']>, product?: string): number => {
    const flow = state.periodFlows;
    if (!flow || product === undefined) return 0;
    const field = flow[key];
    return typeof field === 'object' && field !== null && product in field
      ? Number((field as Record<string, unknown>)[product] ?? 0)
      : 0;
  };
  const periodProductKeys = [...new Set(stateHistory.flatMap((state) => {
    const flow = state.periodFlows;
    if (!flow) return [];
    return [
      ...Object.keys(flow.interestIncomeByProduct),
      ...Object.keys(flow.fundingCostByProduct),
      ...Object.keys(flow.newLendingByProduct),
      ...Object.keys(flow.renewalsByProduct),
      ...Object.keys(flow.scheduledRepaymentsByProduct),
      ...Object.keys(flow.prepaymentsByProduct),
      ...Object.keys(flow.defaultsByProduct),
      ...Object.keys(flow.recoveriesByProduct),
      ...Object.keys(flow.provisionBridge?.fundedAllowanceMovementByProduct ?? {}),
      ...Object.keys(flow.provisionBridge?.workoutWriteoffsByProduct ?? {}),
      ...Object.keys(flow.provisionBridge?.oneOffLoanWriteDownsByProduct ?? {}),
    ];
  }))].filter((product) => stateHistory.some((state) => {
    const flow = state.periodFlows;
    if (!flow) return false;
    return [
      flow.interestIncomeByProduct[product as keyof typeof flow.interestIncomeByProduct],
      flow.fundingCostByProduct[product as keyof typeof flow.fundingCostByProduct],
      flow.newLendingByProduct[product as keyof typeof flow.newLendingByProduct],
      flow.renewalsByProduct[product as keyof typeof flow.renewalsByProduct],
      flow.scheduledRepaymentsByProduct[product as keyof typeof flow.scheduledRepaymentsByProduct],
      flow.prepaymentsByProduct[product as keyof typeof flow.prepaymentsByProduct],
      flow.defaultsByProduct[product as keyof typeof flow.defaultsByProduct],
      flow.recoveriesByProduct[product as keyof typeof flow.recoveriesByProduct],
      flow.provisionBridge?.fundedAllowanceMovementByProduct[product as keyof typeof flow.provisionBridge.fundedAllowanceMovementByProduct],
      flow.provisionBridge?.workoutWriteoffsByProduct[product as keyof typeof flow.provisionBridge.workoutWriteoffsByProduct],
      flow.provisionBridge?.oneOffLoanWriteDownsByProduct[product as keyof typeof flow.provisionBridge.oneOffLoanWriteDownsByProduct],
    ].some((value) => Math.abs(value ?? 0) > 0.01);
  })).sort();
  const loanProductKeys = periodProductKeys.filter((product) => Boolean(PRODUCTS[product as keyof typeof PRODUCTS]?.behaviour?.isLoan));
  const sumMap = (map: Partial<Record<string, number>> | undefined) => Object.values(map ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);
  const alignedFlowSeries = (metric: keyof NonNullable<BankState['periodFlows']>, product?: string) =>
    stateHistory.map((state, index) => index === 0 || !state.periodFlows
      ? null
      : millions(flowValue(state, metric, product)));
  const vintageTotals = new Map<string, { product: string; vintage: string; originations: number; defaults: number; recoveries: number; realizedLosses: number }>();
  const vintageLabel = (originationStep: number | null, fallbackDate: Date) => {
    if (originationStep === null || originationStep <= (stateHistory[0]?.time.step ?? 0)) return 'pre-run';
    const origination = stateHistory.find((state) => state.time.step === originationStep)?.time.date ?? fallbackDate;
    return String(origination.getUTCFullYear());
  };
  const vintageTotal = (product: string, vintage: string) => {
    const key = `${product}|${vintage}`;
    let value = vintageTotals.get(key);
    if (!value) {
      value = { product, vintage, originations: 0, defaults: 0, recoveries: 0, realizedLosses: 0 };
      vintageTotals.set(key, value);
    }
    return value;
  };
  stateHistory.slice(1).forEach((state) => {
    const flow = state.periodFlows;
    if (!flow) return;
    const originatedProducts = new Set([
      ...Object.keys(flow.newLendingByProduct),
      ...Object.keys(flow.renewalsByProduct),
    ]);
    originatedProducts.forEach((product) => {
      const total = vintageTotal(product, vintageLabel(state.time.step, state.time.date));
      total.originations += (flow.newLendingByProduct[product as keyof typeof flow.newLendingByProduct] ?? 0) +
        (flow.renewalsByProduct[product as keyof typeof flow.renewalsByProduct] ?? 0);
    });
    flow.defaultsByVintage.forEach((row) => {
      vintageTotal(row.productType, vintageLabel(row.originationStep, state.time.date)).defaults += row.amount;
    });
    flow.recoveriesByVintage.forEach((row) => {
      vintageTotal(row.productType, vintageLabel(row.originationStep, state.time.date)).recoveries += row.amount;
    });
    flow.realizedLossesByVintage.forEach((row) => {
      vintageTotal(row.productType, vintageLabel(row.originationStep, state.time.date)).realizedLosses += row.amount;
    });
  });
  Object.entries(loanBalanceHistory[0].byProduct).forEach(([product, amounts]) => {
    vintageTotal(product, 'pre-run').originations = amounts.gross;
  });
  const creditVintages = [...vintageTotals.values()]
    .sort((a, b) => a.vintage.localeCompare(b.vintage) || a.product.localeCompare(b.product))
    .map((row) => [
      row.product,
      row.vintage,
      millions(row.originations),
      millions(row.defaults),
      millions(row.recoveries),
      millions(row.realizedLosses),
      row.originations > 0 ? round((row.defaults / row.originations) * 100) : null,
    ]);
  const productFlows = Object.fromEntries(periodProductKeys.map((product) => {
    const isLoan = Boolean(PRODUCTS[product as keyof typeof PRODUCTS]?.behaviour?.isLoan);
    const hasInterestIncome = stateHistory.some((state) => Math.abs(flowValue(state, 'interestIncomeByProduct', product)) > 0.01);
    const hasFundingCost = stateHistory.some((state) => Math.abs(flowValue(state, 'fundingCostByProduct', product)) > 0.01);
    const row: Record<string, (number | null)[]> = {};
    if (hasInterestIncome) row.ii = alignedFlowSeries('interestIncomeByProduct', product);
    if (hasFundingCost) row.fc = alignedFlowSeries('fundingCostByProduct', product);
    if (isLoan) {
      row.nl = alignedFlowSeries('newLendingByProduct', product);
      row.rn = alignedFlowSeries('renewalsByProduct', product);
      row.sp = alignedFlowSeries('scheduledRepaymentsByProduct', product);
      row.pp = alignedFlowSeries('prepaymentsByProduct', product);
      row.df = alignedFlowSeries('defaultsByProduct', product);
      row.og = stateHistory.map((state, index) => index === 0 || !state.periodFlows ? null : millions(state.periodFlows.openingLoanExposureByProduct[product as keyof typeof state.periodFlows.openingLoanExposureByProduct] ?? 0));
      row.dr = stateHistory.map((state, index) => {
        if (index === 0 || !state.periodFlows) return null;
        const defaults = flowValue(state, 'defaultsByProduct', product);
        const openingExposure = state.periodFlows.openingLoanExposureByProduct[product as keyof typeof state.periodFlows.openingLoanExposureByProduct] ?? 0;
        return openingExposure > 0 ? round((defaults / openingExposure) * 100) : null;
      });
      row.rc = alignedFlowSeries('recoveriesByProduct', product);
      row.al = stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
        ? null
        : millions(state.periodFlows.provisionBridge.fundedAllowanceMovementByProduct[product as keyof typeof state.periodFlows.provisionBridge.fundedAllowanceMovementByProduct] ?? 0));
      row.wo = stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
        ? null
        : millions(state.periodFlows.provisionBridge.workoutWriteoffsByProduct[product as keyof typeof state.periodFlows.provisionBridge.workoutWriteoffsByProduct] ?? 0));
      row.xd = stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
        ? null
        : millions(state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct[product as keyof typeof state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct] ?? 0));
    }
    return [product, row];
  }));
  const capitalBridgeHistory = stateHistory.map(state => capitalReconciliation(state, simConfig));
  const nullableRound = (value: number | null) => value === null ? null : roundPrecise(value);
  const summarizeCapital = (state: BankState) => {
    const c = capitalReconciliation(state, simConfig);
    return {
      capturedAtClose: c.captured,
      capitalM: Object.fromEntries(['coreCet1', 'accumulatedOCI', 'includedOCI', 'excludedOCI', 'regulatoryDeductions', 'otherAdjustments', 'regulatoryCet1', 'at1', 'eligibleTier2', 'tier1', 'totalCapital', 'creditRwa', 'commitmentRwa', 'operationalRiskRwa', 'counterpartyRiskRwa', 'otherRwa', 'rwa', 'leverageExposure'].map(key => {
        const value = c[key as keyof typeof c] as number | null;
        return [key, value === null ? null : roundPrecise(value / 1_000_000)];
      })),
      ociInclusionRate: c.ociInclusionRate,
      reportedCet1Pct: roundPrecise(c.reportedCet1Ratio * 100),
      recalculatedCet1Pct: c.recalculatedCet1Ratio === null ? null : roundPrecise(c.recalculatedCet1Ratio * 100),
      ratioDifferencePp: c.cet1RatioDifference === null ? null : roundPrecise(c.cet1RatioDifference * 100),
      book: { accountingEquityM: roundPrecise(c.accountingEquity / 1_000_000), at1M: roundPrecise(c.at1 / 1_000_000), commonBookEquityM: roundPrecise(c.commonBookEquity / 1_000_000), capitalLedgerCommonEquityM: roundPrecise(c.capitalLedgerCommonEquity / 1_000_000), bookEquityDifferenceM: roundPrecise(c.bookEquityDifference / 1_000_000), sharesM: roundPrecise(c.sharesOutstanding / 1_000_000), calculatedBvps: nullableRound(c.calculatedBvps), reportedBvps: nullableRound(c.reportedBvps), calculatedPb: nullableRound(c.calculatedPriceToBook), reportedPb: nullableRound(c.reportedPriceToBook) },
    };
  };
  const summarizeState = (state: BankState) => {
    const byProduct = (side: BalanceSheetSide) => state.financial.balanceSheet.items
      .filter((item) => item.side === side)
      .reduce<Record<string, number>>((totals, item) => {
        totals[item.productType] = round((totals[item.productType] ?? 0) + item.balance / 1_000_000);
        return totals;
      }, {});
    const total = (side: BalanceSheetSide) => millions(state.financial.balanceSheet.items
      .filter((item) => item.side === side)
      .reduce((sum, item) => sum + item.balance, 0));
    const loanAmounts = loanCarryingAmounts(state);
    const loanAmountsM = (amounts: typeof loanAmounts.total) => Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, roundPrecise(value / 1_000_000)]));
    const risk = state.risk.riskMetrics;
    return {
      date: state.time.date.toISOString().slice(0, 10),
      step: state.time.step,
      balanceSheetM: { assets: total(BalanceSheetSide.Asset), liabilities: total(BalanceSheetSide.Liability), loansGross: millions(loanAmounts.total.gross), loansFundedAllowance: millions(loanAmounts.total.fundedAllowance), loansNet: millions(loanAmounts.total.net), deposits: millions(customerDeposits(state)), assetsByProduct: byProduct(BalanceSheetSide.Asset), liabilitiesByProduct: byProduct(BalanceSheetSide.Liability) },
      loanCarryingAmountsM: { total: loanAmountsM(loanAmounts.total), byProduct: Object.fromEntries(Object.entries(loanAmounts.byProduct).map(([product, amounts]) => [product, loanAmountsM(amounts)])) },
      capitalReconciliation: summarizeCapital(state),
      capitalM: { coreCet1: millions(state.financial.capital.cet1), at1: millions(state.financial.capital.at1), tier2: millions(state.financial.capital.tier2 ?? 0), oci: millions(state.financial.capital.accumulatedOCI), rwa: millions(risk.rwa) },
      ratiosPct: { cet1: round(risk.cet1Ratio * 100), cet1Requirement: round(risk.cet1Requirement * 100), leverage: round(risk.leverageRatio * 100), lcr: round(risk.lcr * 100), nsfr: round(risk.nsfr * 100) },
      lastMonthPnLM: { nii: millions(state.financial.incomeStatement.netInterestIncome), fees: millions(state.financial.incomeStatement.feeIncome), provisions: millions(state.financial.incomeStatement.provisionCharge), expenses: millions(state.financial.incomeStatement.operatingExpenses), net: millions(state.financial.incomeStatement.netIncome) },
      share: { price: roundPerShare(state.equityMarket.sharePrice), fairValue: round(state.equityMarket.fairValuePerShare ?? state.equityMarket.sharePrice), marketCapM: millions(state.equityMarket.marketCap), smoothedAnnualisedEps: roundPerShare(state.equityMarket.epsTtm), ttmEps: state.equityMarket.trailingEps == null ? null : roundPerShare(state.equityMarket.trailingEps), ttmMonths: state.equityMarket.trailingEarningsMonths ?? 0, modelPe: roundPerShare(state.equityMarket.peMultiple), quotedPeSmoothed: state.equityMarket.epsTtm > 0 ? roundPerShare(state.equityMarket.sharePrice / state.equityMarket.epsTtm) : null, quotedPeTtm: (state.equityMarket.trailingEps ?? 0) > 0 ? roundPerShare(state.equityMarket.sharePrice / state.equityMarket.trailingEps!) : null, pb: roundPerShare(state.equityMarket.priceToBook ?? 0) },
      competitorPricingPct: Object.fromEntries(Object.entries(state.periodFlows?.competitorPricing ?? {
        retailCurrentAccount: state.market.competitorRetailCurrentAccountRate,
        retailTermDeposit: state.market.competitorTermDepositRate,
        corporateDeposit: state.market.competitorCorporateDepositRate ?? null,
        mortgage: state.market.competitorMortgageRate,
        consumerLoan: state.market.competitorConsumerLoanRate,
        corporateLoan: state.market.riskFreeLong + state.market.corporateLoanSpread,
      }).map(([key, value]) => [key, value === null ? null : round(value * 100)])),
      status: { ...state.status },
    };
  };
  const opening = stateHistory[0] ?? bankState;
  const compactAction = (action: PlayerAction): unknown[] => {
    switch (action.type) {
      case 'adjustRate': return ['rate', action.productType, round(action.newRate * 100)];
      case 'buySellAsset': return ['asset', action.productType, millions(action.amountDelta), action.rate === undefined ? null : round(action.rate * 100), action.tenorMonths ?? null];
      case 'launchCapitalMarketsTransaction': return ['issue', action.instrument, millions(action.targetAmount), action.maxDiscount === undefined ? null : round(action.maxDiscount * 100), action.maxSpreadBps ?? null, action.tenorMonths ?? null];
      case 'drawBoeFunding': return ['boe', action.facility, millions(action.amount)];
      case 'setUnderwriting': return ['underwriting', action.productType, round(action.tightness * 100)];
      case 'setMortgagePolicy': return ['mortgage', round(action.maxLtv * 100), action.fixedPeriodMonths];
      case 'setTermDepositPolicy': return ['term', action.tenorMonths];
      case 'enterHedge': return ['hedge', action.direction, millions(action.notional), round(action.fixedRate * 100), action.maturityMonths ?? null];
      case 'setCapitalPolicy': return ['capitalPolicy', round(action.dividendPayoutRatio * 100), action.at1CouponMode ?? null];
      case 'setRiskAppetite': return ['targets', action.targets ? Object.fromEntries(Object.entries(action.targets).map(([key, value]) => [key, value === undefined ? null : round(value * 100)])) : null];
    }
  };
  const compactShock = (shock: Shock): unknown[] => {
    switch (shock.type) {
      case 'depositCompetition': return ['depositCompetition', round(shock.retailRateIncrease * 100), shock.corporateRateIncrease === undefined ? null : round(shock.corporateRateIncrease * 100)];
      case 'marketSpreadShock': return ['marketSpread', shock.wholesaleSpreadBps, shock.loanSpreadBps, round(shock.repoHaircutIncreasePct)];
      case 'idiosyncraticRun': return ['depositRun', round(shock.outflowRateMultiplier * 100)];
      case 'macroDownturn': return ['downturn', round(shock.pdMultiplier * 100), round(shock.lgdMultiplier * 100)];
      case 'counterpartyDefault': return ['counterpartyDefault', shock.productType, millions(shock.lossAmount)];
      case 'rolloverStress': return ['rolloverStress', round(shock.accessMultiplier * 100), shock.spreadBps];
    }
  };
  const decisions = currentTimeline.map((entry) => [
    entry.step - opening.time.step,
    entry.actions.map(compactAction),
    entry.shocks.map(compactShock),
  ] as [number, unknown[][], unknown[][]]).filter((entry) => entry[1].length || entry[2].length);
  const notableEvents = eventLog
    .filter((event) => event.severity !== 'info' || /filled|partial|capital|dividend|default|breach|failed|maturit|settled/i.test(event.message))
    .slice(-24)
    .map(({ severity, message, tags }) => [severity, message.slice(0, 180), ...(tags?.length ? [tags] : [])]);
  const flowMaps = (select: (state: BankState) => Partial<Record<string, number>> | undefined) =>
    stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
      ? null
      : millionsPrecise(sumMap(select(state))));
  const millionsPrecise = (value: number) => roundPrecise(value / 1_000_000);
  const provisionBridge = {
    note: 'Funded allowance is opening to closing ECL by stage and product; undrawn commitment ECL is shown separately. P&L provision charge components reconcile to the posted charge. Gross defaults enter workout and are not charge-offs. Workout write-offs are recorded when a bucket resolves, as principal less recoveries. One-off loan write-downs, securities impairment, and workout discount unwind are separate; discount unwind is included in the model provisionCharge field. Funded allowance movement is a portfolio ECL remeasurement, not a counterfactual decomposition of exposure, stage, PD, LGD, or macro effects.',
    stageLegend: '[opening Stage 1, Stage 2, Stage 3 £m, closing Stage 1, Stage 2, Stage 3 £m]',
    fundedAllowanceByStage: stateHistory.map((state, index) => {
      const bridge = state.periodFlows?.provisionBridge;
      if (index === 0 || !bridge) return null;
      const opening = bridge.fundedAllowanceOpeningByStage;
      const closing = bridge.fundedAllowanceClosingByStage;
      return [opening.stage1, opening.stage2, opening.stage3, closing.stage1, closing.stage2, closing.stage3].map(millionsPrecise);
    }),
    fundedAllowanceByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => {
      const bridge = state.periodFlows?.provisionBridge;
      if (index === 0 || !bridge) return null;
      const opening = bridge.fundedAllowanceOpeningByProduct[product as keyof typeof bridge.fundedAllowanceOpeningByProduct] ?? 0;
      const closing = bridge.fundedAllowanceClosingByProduct[product as keyof typeof bridge.fundedAllowanceClosingByProduct] ?? 0;
      const movement = bridge.fundedAllowanceMovementByProduct[product as keyof typeof bridge.fundedAllowanceMovementByProduct] ?? closing - opening;
      return [opening, closing, movement].map(millionsPrecise);
    })])),
    fundedAllowanceProductLegend: '[opening, closing, movement £m]',
    commitmentAllowance: stateHistory.map((state, index) => {
      const bridge = state.periodFlows?.provisionBridge;
      if (index === 0 || !bridge) return null;
      return [bridge.commitmentAllowanceOpening, bridge.commitmentAllowanceClosing, bridge.commitmentAllowanceClosing - bridge.commitmentAllowanceOpening].map(millionsPrecise);
    }),
    commitmentAllowanceLegend: '[opening, closing, movement £m]',
    pnlComponents: {
      workoutWriteoffs: flowMaps((state) => state.periodFlows?.provisionBridge?.workoutWriteoffsByProduct),
      oneOffLoanWriteDowns: flowMaps((state) => state.periodFlows?.provisionBridge?.oneOffLoanWriteDownsByProduct),
      fundedAllowanceMovement: flowMaps((state) => state.periodFlows?.provisionBridge?.fundedAllowanceMovementByProduct),
      commitmentAllowanceMovement: stateHistory.map((state, index) => {
        const bridge = state.periodFlows?.provisionBridge;
        return index === 0 || !bridge ? null : millionsPrecise(bridge.commitmentAllowanceClosing - bridge.commitmentAllowanceOpening);
      }),
      securitiesImpairment: flowMaps((state) => state.periodFlows?.provisionBridge?.securityImpairmentByProduct),
      workoutDiscountUnwind: flowMaps((state) => state.periodFlows?.provisionBridge?.workoutDiscountUnwindByProduct),
      provisionCharge: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge ? null : millionsPrecise(state.periodFlows.provisionBridge.provisionCharge)),
      reconciliationDifference: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge ? null : millionsPrecise(state.periodFlows.provisionBridge.reconciliationDifference)),
    },
    writeoffsByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
      ? null
      : millionsPrecise(state.periodFlows.provisionBridge.workoutWriteoffsByProduct[product as keyof typeof state.periodFlows.provisionBridge.workoutWriteoffsByProduct] ?? 0))])),
    oneOffLoanWriteDownsByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
      ? null
      : millionsPrecise(state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct[product as keyof typeof state.periodFlows.provisionBridge.oneOffLoanWriteDownsByProduct] ?? 0))])),
    workoutDiscountUnwindByProduct: Object.fromEntries(loanProductKeys.map((product) => [product, stateHistory.map((state, index) => index === 0 || !state.periodFlows?.provisionBridge
      ? null
      : millionsPrecise(state.periodFlows.provisionBridge.workoutDiscountUnwindByProduct[product as keyof typeof state.periodFlows.provisionBridge.workoutDiscountUnwindByProduct] ?? 0))])),
  };
  const macroAtValuation = {
    gdpGrowthMoMPct: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.shareValuation ? null : roundPrecise(state.periodFlows.shareValuation.gdpGrowthMoM * 100)),
    unemploymentPct: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.shareValuation ? null : roundPrecise(state.periodFlows.shareValuation.unemploymentRate * 100)),
    creditSpreadPct: stateHistory.map((state, index) => index === 0 || !state.periodFlows?.shareValuation ? null : roundPrecise(state.periodFlows.shareValuation.creditSpread * 100)),
  };
  const valuationDiagnostics = {
    legend: '[opening EPS, annualised period EPS, smoothing alpha, smoothed annualised EPS, BVPS, ROE proxy %, cost of equity %, profitability score, CET1 headroom pp, leverage headroom pp, capital score, macro score, deposit franchise, franchise score, weighted profitability, weighted capital, weighted macro, weighted franchise, raw weighted score, absolute-weight denominator, normalized score, model PE, model PB, stressed EPS, earnings value, book value, earnings reliability, earnings weight, book weight, pre-stress fair value, capital discount, failure discount, fair value, prior price, unconstrained price, max move factor, closing share price, quoted PE (price / unrounded smoothed EPS)]',
    rows: stateHistory.map((state, index) => {
      const v = state.periodFlows?.shareValuation;
      if (index === 0 || !v) return null;
      return [
        v.epsTtmOpening, v.annualisedEps, v.epsAlpha, v.epsTtm, v.bvps,
        v.roeProxy * 100, v.costOfEquity * 100, v.profitabilityScore,
        v.cet1Headroom * 100, v.leverageHeadroom * 100, v.capitalScore,
        v.macroScore, v.franchiseStrength, v.franchiseScore,
        v.weightedProfitability, v.weightedCapital, v.weightedMacro, v.weightedFranchise,
        v.rawWeightedScore, v.scoreWeightDenominator, v.normalizedScore,
        v.modelPe, v.modelPb, v.stressedEarningsBase, v.earningsValue, v.bookValue,
        v.earningsReliability, v.earningsWeight, v.bookWeight, v.fairValueBeforeStress,
        v.capitalDiscount, v.failureDiscount, v.fairValue, v.priorSharePrice,
        v.unconstrainedSharePrice, v.moveLimitFactor, v.sharePrice, v.quotedPe,
      ].map((value) => value === null ? null : roundPrecise(value));
    }),
  };
  const extract = {
    format: 'banksim-run-extract',
    formatVersion: 6,
    filename: `banksim-run-${bankState.time.date.toISOString().slice(0, 10)}.json`,
    prompt: 'Put the supervisor in the bank executive’s seat. Explain the business model the board is pursuing—products, customers, funding, pricing, growth and returns—using recorded plans and decisions; label inferred aims. Choose 2–3 turning points and trace each decision or shock through volumes, prices, margins and cash flows to profit, balance sheet, capital, liquidity and valuation. Show board priorities and trade-offs: growth vs margin, risk vs return, funding cost vs stability, dividends vs resilience. Use dated figures to explain accounting and prudential consequences. Reconcile gross/net loans and ECL, provision charges vs write-offs, CET1/RWA, leverage, LCR/NSFR and dividends where possible; flag gaps. Separate facts from interpretation; timing alone does not prove cause. Distinguish model P/E, quoted P/E, smoothed annualised EPS and TTM EPS where available. End with three strategic business-model lessons for supervisors about choice, execution and resilience, and the evidence to seek.',
    run: {
      period: [opening.time.date.toISOString().slice(0, 10), bankState.time.date.toISOString().slice(0, 10), bankState.time.step - opening.time.step],
      opening: summarizeState(opening),
      ending: summarizeState(bankState),
      series: {
        months: stateHistory.map((s) => s.time.date.toISOString().slice(0, 7)),
        note: 'Arrays align with months. Money is £m; rates are %. Opening-period flows and diagnostics are null. Macro inputs in macroAtValuation and the valuation tuple are captured when price is calculated, before the market advances. Cash-flow categories are signed monthly net flows; LCR is a regulatory-weighted 30-day projection.',
        units: { assets: '£m', liabilities: '£m', loansGross: '£m', loansFundedAllowance: '£m', loansNet: '£m', loansReconciliationDifference: '£m', deposits: '£m', nii: '£m/period', netProfit: '£m/period', creditLosses: '£m/period', provisions: '£m/period', rwa: '£m', dividends: '£m/period', at1Coupons: '£m/period', cet1: '%', cet1Requirement: '%', leverage: '%', lcr: '%', nsfr: '%', sharePrice: '£', smoothedAnnualisedEps: '£/share (6 dp)', ttmEps: '£/share (6 dp)', ttmMonths: 'months', modelPe: 'multiple (6 dp)', quotedPeSmoothed: 'multiple (6 dp)', quotedPeTtm: 'multiple (6 dp)', pb: 'multiple', fairValue: '£/share', bvps: '£/share', marketCap: '£m', competitorPricing: '%', macro: '%' },
        keys: { assets: 'total assets', liabilities: 'total liabilities', loansGross: 'gross carrying amount including unresolved workouts', loansFundedAllowance: 'funded loan ECL contra-asset', loansNet: 'net loan carrying amount included in total assets', loansReconciliationDifference: 'gross minus funded allowance minus recorded net', deposits: 'customer deposits', nii: 'net interest income', netProfit: 'net profit', creditLosses: 'credit losses expensed, including non-loan shock losses', provisions: 'posted provision charge; see provisionBridge for components', rwa: 'risk-weighted assets', dividends: 'cash dividends paid', at1Coupons: 'AT1 coupons paid', cet1: 'CET1 ratio', cet1Requirement: 'CET1 requirement', leverage: 'leverage ratio', lcr: 'liquidity coverage ratio', nsfr: 'net stable funding ratio', sharePrice: 'share price', smoothedAnnualisedEps: 'exponentially smoothed annualised common EPS; not trailing earnings', ttmEps: '12-month common earnings / time-weighted ordinary shares; null before 12 observed months', ttmMonths: 'observed earnings history, capped at 12 months', modelPe: 'score-derived PE used to value earnings; not price/EPS', quotedPeSmoothed: 'share price divided by unrounded smoothed annualised EPS', quotedPeTtm: 'share price divided by positive conventional TTM EPS; otherwise null', pb: 'quoted price/book multiple', fairValue: 'model fair value', bvps: 'book value/share', marketCap: 'market capitalisation', cashFlow: 'realised monthly net cash-flow statement category; negative is outflow', lcr30d: '30-day regulatory-weighted forecast' },
        macroAtValuation,
        valuationDiagnostics,
        provisionBridge,
        capitalReconciliation: {
          note: 'Close-captured regulatory inputs. Core CET1 + included OCI - deductions + other adjustments = regulatory CET1; divide by RWA for the regulatory ratio. OCI inclusion is a model parameter. Book equity = assets - liabilities - AT1; BVPS uses ordinary shares. Legacy rows without captured inputs use current configuration and retain reported RWA; component RWA is null.',
          legend: '[captured 1/0, core CET1 £m, OCI £m, OCI inclusion %, included OCI £m, excluded OCI £m, deductions £m, other adjustments £m, regulatory CET1 £m, credit RWA £m, commitment RWA £m, operational RWA £m, counterparty RWA £m, other RWA £m, total RWA £m, reported CET1 %, recalculated CET1 %, difference pp, accounting equity £m, AT1 £m, common book equity £m, capital-ledger/common-book difference £m, shares million, calculated BVPS, reported BVPS, calculated P/B, reported P/B]',
          rows: capitalBridgeHistory.map(c => [Number(c.captured), c.coreCet1 / 1e6, c.accumulatedOCI / 1e6, c.ociInclusionRate * 100, c.includedOCI / 1e6, c.excludedOCI / 1e6, c.regulatoryDeductions / 1e6, c.otherAdjustments / 1e6, c.regulatoryCet1 / 1e6, ...[c.creditRwa, c.commitmentRwa, c.operationalRiskRwa, c.counterpartyRiskRwa, c.otherRwa].map(v => v === null ? null : v / 1e6), c.rwa / 1e6, c.reportedCet1Ratio * 100, c.recalculatedCet1Ratio === null ? null : c.recalculatedCet1Ratio * 100, c.cet1RatioDifference === null ? null : c.cet1RatioDifference * 100, c.accountingEquity / 1e6, c.at1 / 1e6, c.commonBookEquity / 1e6, c.bookEquityDifference / 1e6, c.sharesOutstanding / 1e6, c.calculatedBvps, c.reportedBvps, c.calculatedPriceToBook, c.reportedPriceToBook].map(nullableRound)),
        },
        creditStages: {
          legend: '[Stage 1 gross £m, Stage 2 gross £m, Stage 3 gross £m, performing reference annual PD %, performing current annual PD %, Stage 2 cure-probation gross £m]',
          rows: stateHistory.map(state => {
            const c = creditStageDiagnostics(state);
            return [c.stageGross.stage1 / 1e6, c.stageGross.stage2 / 1e6, c.stageGross.stage3 / 1e6, c.performingReferenceAnnualPd === null ? null : c.performingReferenceAnnualPd * 100, c.performingCurrentAnnualPd === null ? null : c.performingCurrentAnnualPd * 100, c.stage2CureProbationGross / 1e6].map(nullableRound);
          }),
          note: 'SICR compares current annual PD with origination-reference annual PD as a lifetime-risk proxy. Stage 2 cures require sustained improvement. Seeded seasoned borrower affordability is dispersed; Stage 1 new lending starts without that historical deterioration. ECL uses a flat annual PD hazard, amortising balances and discounted scenario-weighted losses: 12-month default horizon for Stage 1 and remaining lifetime for Stage 2. Stage 3 includes unresolved workouts.',
        },
        earningsHistory: {
          legend: '[observed months, net income £m, common income after AT1 coupons £m, time-weighted shares million]; TTM EPS is common income / weighted shares only when observed months = 12. Multi-month observations are allocated pro rata at the rolling-window boundary. Legacy history is not invented.',
          rows: stateHistory.map(s => s.equityMarket.trailingEarningsMonths ? [s.equityMarket.trailingEarningsMonths, (s.equityMarket.trailingNetIncome ?? 0) / 1e6, (s.equityMarket.trailingCommonIncome ?? 0) / 1e6, (s.equityMarket.trailingWeightedAverageShares ?? 0) / 1e6].map(roundPrecise) : null),
        },
        valuationRiskDiagnostics: {
          legend: '[base cost of equity %, spread premium pp, uncertainty premium pp, capital-risk premium pp, profitability signal, capital signal, macro signal, franchise signal, earnings volatility, downside surprise, total uncertainty, abnormal-earnings persistence, persistent EPS, discount-rate factor, distributable-capital proxy £m, excess capital/share]',
          rows: stateHistory.map((state, index) => {
            const v = state.periodFlows?.shareValuation;
            if (index === 0 || v?.baseCostOfEquity === undefined) return null;
            return [v.baseCostOfEquity * 100, v.creditSpreadPremium * 100, v.uncertaintyPremium * 100, v.capitalRiskPremium * 100, v.profitabilitySignal, v.capitalSignal, v.macroSignal, v.franchiseSignal, v.earningsVolatility, v.earningsDownsideSurprise, v.earningsUncertainty, v.earningsPersistence, v.persistentEps, v.discountRateFactor, v.distributableCapitalProxy / 1e6, v.excessCapitalPerShare].map(roundPrecise);
          }),
        },
        values: {
          assets: stateHistory.map((s) => millions(s.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Asset).reduce((n, i) => n + i.balance, 0))),
          liabilities: stateHistory.map((s) => millions(s.financial.balanceSheet.items.filter((i) => i.side === BalanceSheetSide.Liability).reduce((n, i) => n + i.balance, 0))),
          loansGross: loanBalanceHistory.map(({ total }) => roundPrecise(total.gross / 1_000_000)),
          loansFundedAllowance: loanBalanceHistory.map(({ total }) => roundPrecise(total.fundedAllowance / 1_000_000)),
          loansNet: loanBalanceHistory.map(({ total }) => roundPrecise(total.net / 1_000_000)),
          loansReconciliationDifference: loanBalanceHistory.map(({ total }) => roundPrecise(total.reconciliationDifference / 1_000_000)),
          deposits: stateHistory.map((s) => millions(customerDeposits(s))),
          nii: stateHistory.map((s) => millions(s.financial.incomeStatement.netInterestIncome)),
          netProfit: stateHistory.map((s) => millions(s.financial.incomeStatement.netIncome)),
          creditLosses: stateHistory.map((s) => millions(s.financial.incomeStatement.creditLosses)),
          provisions: stateHistory.map((s) => millions(s.financial.incomeStatement.provisionCharge)),
          cet1: stateHistory.map((s) => round(s.risk.riskMetrics.cet1Ratio * 100)),
          cet1Requirement: stateHistory.map((s) => round(s.risk.riskMetrics.cet1Requirement * 100)),
          leverage: stateHistory.map((s) => round(s.risk.riskMetrics.leverageRatio * 100)),
          lcr: stateHistory.map((s) => round(s.risk.riskMetrics.lcr * 100)),
          nsfr: stateHistory.map((s) => round(s.risk.riskMetrics.nsfr * 100)),
          sharePrice: stateHistory.map((s) => roundPerShare(s.equityMarket.sharePrice)),
          rwa: stateHistory.map((s) => millions(s.risk.riskMetrics.rwa)),
          dividends: stateHistory.map((s) => millions(s.financial.incomeStatement.dividendsPaid)),
          at1Coupons: stateHistory.map((s) => millions(s.financial.incomeStatement.at1CouponExpense)),
          smoothedAnnualisedEps: stateHistory.map((s) => roundPerShare(s.equityMarket.epsTtm)),
          ttmEps: stateHistory.map((s) => s.equityMarket.trailingEps == null ? null : roundPerShare(s.equityMarket.trailingEps)),
          ttmMonths: stateHistory.map((s) => s.equityMarket.trailingEarningsMonths ?? 0),
          quotedPeTtm: stateHistory.map((s) => (s.equityMarket.trailingEps ?? 0) > 0 ? roundPerShare(s.equityMarket.sharePrice / s.equityMarket.trailingEps!) : null),
          modelPe: stateHistory.map((s) => roundPerShare(s.equityMarket.peMultiple)),
          quotedPeSmoothed: stateHistory.map((s, index) => {
            const exact = index > 0 ? s.periodFlows?.shareValuation?.quotedPe : null;
            const computed = s.equityMarket.epsTtm > 0 ? s.equityMarket.sharePrice / s.equityMarket.epsTtm : null;
            const value = exact ?? computed;
            return value === null ? null : roundPerShare(value);
          }),
          pb: stateHistory.map((s) => roundPerShare(s.equityMarket.priceToBook ?? 0)),
          fairValue: stateHistory.map((s) => roundPerShare(s.equityMarket.fairValuePerShare ?? s.equityMarket.sharePrice)),
          bvps: stateHistory.map((s) => roundPerShare(s.equityMarket.bookValuePerShare ?? 0)),
          marketCap: stateHistory.map((s) => millions(s.equityMarket.marketCap)),
          periodMonths: stateHistory.map((s, index) => index === 0 ? null : s.periodFlows?.periodMonths ?? null),
          competitorPricingPct: {
            retailCurrentAccount: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.retailCurrentAccount : s.market.competitorRetailCurrentAccountRate) * 100)),
            retailTermDeposit: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.retailTermDeposit : s.market.competitorTermDepositRate) * 100)),
            corporateDeposit: stateHistory.map((s, index) => {
              const rate = index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.corporateDeposit : s.market.competitorCorporateDepositRate ?? null;
              return rate === null ? null : round(rate * 100);
            }),
            mortgage: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.mortgage : s.market.competitorMortgageRate) * 100)),
            consumerLoan: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.consumerLoan : s.market.competitorConsumerLoanRate) * 100)),
            corporateLoan: stateHistory.map((s, index) => round((index > 0 && s.periodFlows ? s.periodFlows.competitorPricing.corporateLoan : s.market.riskFreeLong + s.market.corporateLoanSpread) * 100)),
          },
          cashFlowM: {
            operating: stateHistory.map((s) => millions(s.financial.cashFlowStatement.operatingCashFlow)),
            investing: stateHistory.map((s) => millions(s.financial.cashFlowStatement.investingCashFlow)),
            financing: stateHistory.map((s) => millions(s.financial.cashFlowStatement.financingCashFlow)),
            netChange: stateHistory.map((s) => millions(s.financial.cashFlowStatement.netChange)),
            cashEnd: stateHistory.map((s) => millions(s.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CashReserves)?.balance ?? 0)),
          },
          lcr30dM: {
            weightedOutflows: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.weightedOutflows) : null),
            weightedInflows: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.weightedInflows) : null),
            netOutflow: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.netOutflow) : null),
            hqla: stateHistory.map((s) => s.periodFlows ? millions(s.periodFlows.lcr30d.hqla) : null),
          },
        },
        loanCarryingAmountsByProduct: {
          legend: '[gross, funded allowance, net, gross-minus-allowance-minus-net], all £m; rows align with months',
          rows: Object.fromEntries([...new Set(loanBalanceHistory.flatMap(book => Object.keys(book.byProduct)))].sort().map(product => [product,
            loanBalanceHistory.map(book => {
              const row = book.byProduct[product as keyof typeof book.byProduct];
              return row ? [row.gross, row.fundedAllowance, row.net, row.reconciliationDifference].map(value => roundPrecise(value / 1_000_000)) : [0, 0, 0, 0];
            }),
          ])),
        },
        loanAccountingBasis: 'Gross carrying amount includes cohort principal and unresolved workout principal. Funded allowance excludes undrawn commitment provisions and securities ECL. Gross minus funded allowance equals net, subject to rounding; reconciliation differences expose any mismatch. Total assets and assetsByProduct use recorded net carrying values for loans. Use gross for gross loan growth, default-rate denominators, allowance/gross coverage and gross product shares; use net for accounting balance-sheet comparisons. Regulatory exposure measures retain their own prescribed bases.',
        productFlows: {
          legend: { ii: 'interest income, including loan workout discount unwind', fc: 'funding cost', nl: 'new lending', rn: 'renewals/refinancing', sp: 'scheduled principal repayments', pp: 'prepayments including loan sales', og: 'opening gross loan carrying amount used as the default-rate denominator', df: 'gross principal defaults entering workout', dr: 'period defaults / opening gross loan exposure (%)', rc: 'recovery cash', al: 'funded ECL allowance movement (closing less opening)', wo: 'realised workout charge-offs on resolution', xd: 'one-off loan write-downs from shocks' },
          rows: productFlows,
        },
        creditVintages,
        creditVintageLegend: '[product, origination year or pre-run, originations £m, gross defaults £m, recovery cash £m, realised workout losses £m, cumulative gross-default rate %]; pre-run denominator is opening gross exposure.',
      },
      shareValuationModel: {
        formula: 'Signals for ROE versus variable cost of equity, capital headroom, macro conditions and deposit franchise use softsign x/(1+abs(x)), then a normalized weighted score sets PE and PB via neutral multiple * exp(sensitivity * score), with explicit multiple caps. Cost of equity = clamp(base + spread beta*(credit spread-neutral) + uncertainty premium*uncertainty/(1+uncertainty) + capital-shortfall premium*max(0,-capital score)). Uncertainty = rolling annualised common-EPS volatility / max(EPS floor,abs(mean)) + downside surprise against opening smoothed EPS. Persistence = 1/(1+sensitivity*uncertainty); it fades positive abnormal earnings above costOfEquity*BVPS. Earnings value = stressed persistent EPS * model PE * base/current cost of equity. Reliability = EPS-level reliability/(1+uncertainty); unreliable earnings shift weight to book. Capital headroom above CET1/leverage targets is valued at par; remaining common book is valued at model PB. That headroom is a valuation proxy, not legal distributable reserves. Blend earnings and book components, apply breach/failure discounts and price floor; price mean-reverts subject to a move cap. These are configurable game assumptions, not an estimated market valuation model. Quoted PE is price/EPS and can rise when EPS collapses even as model PE falls.',
      },
      decisionLegend: {
        tuple: '[elapsed month, action tuples, shock tuples]; elapsed month 1 is the first simulated month.',
        actions: {
          rate: '[type, product, new rate %]', asset: '[type, product, amount £m, rate %, tenor months]', issue: '[type, instrument, target £m, max discount %, max spread bp, tenor months]', boe: '[type, facility, amount £m]', underwriting: '[type, product, selectivity %]', mortgage: '[type, max LTV %, fixed months]', term: '[type, term months]', hedge: '[type, direction, notional £m, fixed rate %, maturity months]', capitalPolicy: '[type, dividend payout % of positive profit, AT1 coupon mode]', targets: '[type, risk targets as percentages or null]'
        },
        shocks: {
          depositCompetition: '[type, retail rate increase pp, corporate rate increase pp]', marketSpread: '[type, wholesale spread bp, loan spread bp, repo haircut increase]', depositRun: '[type, outflow multiplier %]', downturn: '[type, PD multiplier %, LGD multiplier %]', counterpartyDefault: '[type, product, loss £m]', rolloverStress: '[type, access multiplier %, spread bp]'
        },
      },
      decisions,
      eventLegend: ['[severity, message, optional tags]'],
      events: notableEvents,
    },
  };

  return extract;
};
