from pathlib import Path
import re

app = Path('src/App.tsx')
text = app.read_text()

text = text.replace(
    "import { ActionFormState, type CapitalMarketsPlanImpact } from './components/ActionsPanel';\n",
    "import { ActionFormState, type CapitalMarketsPlanImpact } from './components/ActionsPanel';\nimport { createActionFormState, clearOneOffTransactions } from './ui/actionFormState';\n",
)

text = re.sub(
    r"\nconst formatRateInputPct = \(rate: number \| null \| undefined\): string => \{.*?\n\};\n",
    "\n",
    text,
    count=1,
    flags=re.S,
)

text, n = re.subn(
    r"  const \[actionForm, setActionForm\] = useState<ActionFormState>\(\{.*?\n  \}\);\n  const \[lastAttribution",
    "  const [actionForm, setActionForm] = useState<ActionFormState>(() => createActionFormState(initialState, baseConfig));\n  const [lastAttribution",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit('Could not replace initial action form construction')

old_clear = """    setActionForm(prev => ({
      ...prev,
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
    }));"""
if old_clear not in text:
    raise SystemExit('Could not find one-off transaction reset block')
text = text.replace(old_clear, "    setActionForm(clearOneOffTransactions);", 1)

text, n = re.subn(
    r"    setActionForm\(\{\n      retailCurrentAccountRate:.*?\n    \}\);\n  \};\n\n  const openHelpSection",
    "    setActionForm(createActionFormState(scenarioState, scenarioConfig));\n  };\n\n  const openHelpSection",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit('Could not replace scenario action form construction')

text, n = re.subn(
    r"\nconst getGroupDepositRate = \(state: BankState, segment: 'retail' \| 'corporate'\): number => \{.*?\n\};\n\ninterface ScenarioBriefingView",
    "\ninterface ScenarioBriefingView",
    text,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit('Could not remove App-local deposit-rate helper')
app.write_text(text)

reg = Path('src/components/RegMetricsPanel.tsx')
r = reg.read_text()
r = r.replace(
    "  const fields = { capital: 'cet1Ratio', rwa: 'rwa', leverage: 'leverageRatio', lcr: 'lcr', nsfr: 'nsfr' } as const;\n",
    "",
)
r, n = re.subn(
    r"    \{metric === 'capital' \? <CapitalDashboard state=\{state\} config=\{config\}/> : metric === 'lcr' \? <LcrDashboard state=\{state\} config=\{config\} history=\{history\}/> : metric === 'nsfr' \? <NsfrDashboard state=\{state\} config=\{config\} history=\{history\}/> : metric === 'leverage' \? <LeverageDashboard state=\{state\} config=\{config\} history=\{history\}/> : metric === 'rwa' \? <RwaDashboard state=\{state\} config=\{config\} history=\{history\}/> : <div className=\"regulatory-grid\">.*?\n    \}\n    \{metric === 'capital'",
    "    {metric === 'capital' ? <CapitalDashboard state={state} config={config}/> : metric === 'lcr' ? <LcrDashboard state={state} config={config} history={history}/> : metric === 'nsfr' ? <NsfrDashboard state={state} config={config} history={history}/> : metric === 'leverage' ? <LeverageDashboard state={state} config={config} history={history}/> : <RwaDashboard state={state} config={config} history={history}/>}\n    {metric === 'capital'",
    r,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit('Could not replace unreachable regulatory rendering fallback')
reg.write_text(r)

Path('src/ui/actionFormState.ts').write_text("""import { ActionFormState } from '../components/ActionsPanel';
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
""")

Path('src/ui/actionFormState.test.ts').write_text("""import { describe, expect, it } from 'vitest';
import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { clearOneOffTransactions, createActionFormState } from './actionFormState';

describe('action form state', () => {
  it('constructs policy defaults from bank state and config', () => {
    const form = createActionFormState(initialState, baseConfig);
    expect(form.retailCurrentAccountRate).toMatch(/%$/);
    expect(form.termDepositTenorMonths).toBe(String(initialState.behaviour.termDepositTenorMonths ?? 12));
    expect(form.dividendPayoutRatio).toBe(String(initialState.behaviour.capitalPolicy?.dividendPayoutRatio ?? baseConfig.riskLimits.capitalPolicy.defaultDividendPayoutRatio));
    expect(form.capitalMarketsInstrument).toBe('none');
    expect(form.hedgeDirection).toBe('none');
  });

  it('clears one-off transactions without changing recurring policy settings', () => {
    const base = createActionFormState(initialState, baseConfig);
    const queued: typeof base = {
      ...base,
      retailCurrentAccountRate: '2.25%',
      capitalMarketsInstrument: 'cet1',
      capitalMarketsTargetAmount: '250m',
      giltTradeDirection: 'buy',
      giltTradeAmount: '50m',
      boeFacility: 'indexedLtRepo',
      boeFundingAmount: '100m',
      hedgeDirection: 'payFixed',
      hedgeNotional: '75m',
    };
    const cleared = clearOneOffTransactions(queued);
    expect(cleared.retailCurrentAccountRate).toBe('2.25%');
    expect(cleared.capitalMarketsInstrument).toBe('none');
    expect(cleared.capitalMarketsTargetAmount).toBe('');
    expect(cleared.giltTradeDirection).toBe('none');
    expect(cleared.giltTradeAmount).toBe('');
    expect(cleared.boeFacility).toBe('none');
    expect(cleared.boeFundingAmount).toBe('');
    expect(cleared.hedgeDirection).toBe('none');
    expect(cleared.hedgeNotional).toBe('');
  });
});
""")
