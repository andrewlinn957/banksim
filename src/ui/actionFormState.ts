import { ActionFormState } from '../components/ActionsPanel';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, LiabilityProductType } from '../domain/enums';

const formatRateInputPct = (rate: number | null | undefined): string => {
  if (rate === undefined || rate === null || !Number.isFinite(rate)) return '';
  return `${(rate * 100).toFixed(2)}%`;
};

const getGroupDepositRate = (state: BankState, segment: 'retail' | 'corporate'): number => {
  const productTypes: Array<LiabilityProductType> = segment === 'retail'
    ? [LiabilityProductType.RetailCurrentAccounts]
    : [LiabilityProductType.CorporateOperatingDeposits, LiabilityProductType.CorporateNonOperatingDeposits];
  const selected = state.financial.balanceSheet.items.filter((item) => productTypes.includes(item.productType as LiabilityProductType));
  const total = selected.reduce((sum, item) => sum + item.balance, 0);
  if (total <= 0) {
    return segment === 'retail'
      ? state.market.competitorRetailCurrentAccountRate
      : state.market.competitorCorporateDepositRate ?? state.market.competitorRetailCurrentAccountRate;
  }
  return selected.reduce((sum, item) => sum + item.balance * item.interestRate, 0) / total;
};

export const createActionFormState = (state: BankState, config: SimulationConfig): ActionFormState => ({
  retailCurrentAccountRate: formatRateInputPct(state.financial.balanceSheet.items.find(i=>i.productType===LiabilityProductType.RetailCurrentAccounts)?.interestRate ?? state.market.competitorRetailCurrentAccountRate),
  termDepositRate: formatRateInputPct(state.financial.balanceSheet.items.find(i=>i.productType===LiabilityProductType.RetailTermDeposits)?.interestRate ?? state.market.competitorTermDepositRate),
  termDepositTenorMonths: String(state.behaviour.termDepositTenorMonths ?? 12),
  corporateDepositRate: formatRateInputPct(getGroupDepositRate(state, 'corporate')),
  mortgageRate: formatRateInputPct(state.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)?.interestRate),
  consumerLoanRate: formatRateInputPct(state.financial.balanceSheet.items.find(i=>i.productType===AssetProductType.ConsumerLoans)?.interestRate ?? state.market.competitorConsumerLoanRate),
  corporateLoanRate: formatRateInputPct(state.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans)?.interestRate),
  mortgageUnderwritingTightness: (state.behaviour.underwritingTightness?.[AssetProductType.Mortgages] ?? 0).toString(),
  consumerUnderwritingTightness: (state.behaviour.underwritingTightness?.[AssetProductType.ConsumerLoans] ?? 0.35).toString(),
  corporateUnderwritingTightness: (state.behaviour.underwritingTightness?.[AssetProductType.CorporateLoans] ?? 0).toString(),
  mortgageMaxLtv: String(state.behaviour.mortgagePolicy?.maxLtv ?? .85),
  mortgageFixedPeriodMonths: String(state.behaviour.mortgagePolicy?.fixedPeriodMonths ?? 24),
  capitalMarketsInstrument: 'none',
  capitalMarketsTargetAmount: '',
  capitalMarketsMaxDiscount: '15%',
  capitalMarketsMaxSpreadBps: '1000',
  capitalMarketsTenorMonths: '60',
  dividendPayoutRatio: (state.behaviour.capitalPolicy?.dividendPayoutRatio ?? config.riskLimits.capitalPolicy.defaultDividendPayoutRatio).toString(),
  at1CouponMode: state.behaviour.capitalPolicy?.at1CouponMode ?? 'auto',
  giltTradeDirection: 'none',
  giltTradeAmount: '',
  giltDurationYears: String(state.behaviour.treasuryPolicy?.giltDurationYears ?? 5),
  boeFacility: 'none',
  boeFundingAmount: '',
  hedgeDirection: 'none',
  hedgeNotional: '',
  hedgeFixedRate: '',
  hedgeMaturityMonths: '24',
});

export const clearOneOffTransactions = (state: ActionFormState): ActionFormState => ({
  ...state,
  giltTradeDirection: 'none',
  giltTradeAmount: '',
  capitalMarketsInstrument: 'none',
  capitalMarketsTargetAmount: '',
  capitalMarketsMaxDiscount: '15%',
  capitalMarketsMaxSpreadBps: '1000',
  capitalMarketsTenorMonths: '60',
  boeFacility: 'none',
  boeFundingAmount: '',
  hedgeDirection: 'none',
  hedgeNotional: '',
});
