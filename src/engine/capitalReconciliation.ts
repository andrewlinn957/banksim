import type { BankState } from '../domain/bankState';
import type { SimulationConfig } from '../domain/config';
import { BalanceSheetSide } from '../domain/enums';
import { eligibleTier2OwnFunds } from '../products/regulatory';

/**
 * Export the actual close inputs, rather than recalculating RWA after the next
 * month's market has advanced. Legacy snapshots lack the detailed RWA split;
 * their numerator is reconstructed using the supplied configuration and is
 * explicitly marked as not captured.
 */
export const capitalReconciliation = (state: BankState, config: SimulationConfig) => {
  const risk = state.risk.riskMetrics;
  const capital = state.financial.capital;
  const inclusionRate = Math.max(0, Math.min(1, config.behaviour.securitiesAccounting?.fvociCet1InclusionRate ?? 1));
  const includedOCI = capital.accumulatedOCI * inclusionRate;
  const regulatoryCet1 = capital.cet1 + includedOCI;
  const tier2 = eligibleTier2OwnFunds(state);
  const recorded = risk.capitalReconciliation;
  const bridge = recorded ?? {
    coreCet1: capital.cet1,
    accumulatedOCI: capital.accumulatedOCI,
    ociInclusionRate: inclusionRate,
    includedOCI,
    excludedOCI: capital.accumulatedOCI - includedOCI,
    regulatoryDeductions: 0,
    otherAdjustments: 0,
    regulatoryCet1,
    at1: capital.at1,
    eligibleTier2: tier2,
    tier1: regulatoryCet1 + capital.at1,
    totalCapital: regulatoryCet1 + capital.at1 + tier2,
    creditRwa: null,
    commitmentRwa: null,
    operationalRiskRwa: null,
    counterpartyRiskRwa: null,
    otherRwa: null,
    rwa: risk.rwa,
    leverageExposure: risk.leverageExposure,
  };
  const recalculatedCet1Ratio = bridge.rwa > 0 ? bridge.regulatoryCet1 / bridge.rwa : null;
  const accountingEquity = state.financial.balanceSheet.items.reduce(
    (sum, item) => sum + (item.side === BalanceSheetSide.Asset ? item.balance : -item.balance), 0
  );
  const commonBookEquity = accountingEquity - capital.at1;
  const capitalLedgerCommonEquity = capital.cet1 + capital.accumulatedOCI;
  const sharesOutstanding = state.equityMarket.sharesOutstanding;
  const calculatedBvps = sharesOutstanding > 0 ? commonBookEquity / sharesOutstanding : null;
  const reportedBvps = state.equityMarket.bookValuePerShare ?? null;
  const calculatedPriceToBook = calculatedBvps !== null && calculatedBvps > 0
    ? state.equityMarket.sharePrice / calculatedBvps : null;
  return {
    ...bridge,
    captured: Boolean(recorded),
    reportedCet1Ratio: risk.cet1Ratio,
    recalculatedCet1Ratio,
    cet1RatioDifference: recalculatedCet1Ratio === null ? null : risk.cet1Ratio - recalculatedCet1Ratio,
    accountingEquity,
    commonBookEquity,
    capitalLedgerCommonEquity,
    bookEquityDifference: capitalLedgerCommonEquity - commonBookEquity,
    sharesOutstanding,
    calculatedBvps,
    reportedBvps,
    bvpsDifference: calculatedBvps !== null && reportedBvps !== null ? reportedBvps - calculatedBvps : null,
    calculatedPriceToBook,
    reportedPriceToBook: state.equityMarket.priceToBook ?? null,
  };
};
