from pathlib import Path
import re

# Settlement uses the catalogue-backed product mapping and existing position factory.
p = Path('src/engine/simulation.ts')
s = p.read_text()
import_anchor = "import { PRODUCTS } from '../products/catalogue';"
replacement_imports = """import { PRODUCTS } from '../products/catalogue';
import { createPosition } from '../products/factory';
import { findProductPosition } from '../products/selectors';
import { hasCapability, productTypesWithCapability } from '../products/capabilities';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';"""
assert import_anchor in s
s = s.replace(import_anchor, replacement_imports, 1)

block = re.search(r"const genericFundingBuckets = .*?\n};\n\nconst capitalMarketsPricingLabel", s, re.S)
assert block, 'funding helper block not found'
replacement = '''const genericFundingBuckets = (state: BankState, productType: ProductType): FundingMaturityBucket[] => {
  state.fundingLadders ??= {};
  return state.fundingLadders[productType] ?? (state.fundingLadders[productType] = []);
};

const maturityBucketForMonths = (months: number): MaturityBucket => {
  if (months <= 12) return MaturityBucket.LessThan1Y;
  if (months <= 36) return MaturityBucket.OneToThreeY;
  if (months <= 60) return MaturityBucket.ThreeToFiveY;
  return MaturityBucket.GreaterThan5Y;
};

const addContractualFundingPosition = (
  state: BankState,
  config: SimulationConfig,
  productType: ProductType,
  amount: number,
  rate: number,
  tenorMonths: number
): void => {
  const issued = Math.max(0, amount);
  if (issued <= 0) return;
  let line = findProductPosition(state.financial.balanceSheet, productType);
  if (!line) {
    line = createPosition(config, {
      productType,
      balance: 0,
      interestRate: rate,
      maturityBucket: maturityBucketForMonths(tenorMonths),
    });
    state.financial.balanceSheet.items.push(line);
  }
  const openingBalance = Math.max(0, line.balance);
  genericFundingBuckets(state, productType).push({
    tenorMonths,
    monthsToMaturity: tenorMonths,
    notional: issued,
    rate,
  });
  line.balance = openingBalance + issued;
  line.interestRate = blendRate(openingBalance, line.interestRate, issued, rate);
  if (PRODUCTS[productType].regulatory.capital === 'tier2OwnFunds') {
    state.financial.capital.tier2 = (state.financial.capital.tier2 ?? 0) + issued;
  }
};

const applyIssueTier2 = (state: BankState, config: SimulationConfig, amount: number, maturityMonths: number | undefined, events: SimulationEvent[]): void => {
  const issued = Math.max(0, amount);
  if (!issued) return;
  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;
  const tenor = Math.max(60, Math.round(maturityMonths ?? 60));
  const rate = Math.max(0, state.market.riskFreeLong + state.market.seniorDebtSpread + .015);
  addContractualFundingPosition(state, config, LiabilityProductType.Tier2Debt, issued, rate, tenor);
  cash.balance += issued;
  events.push(createEvent('info', `Issued Tier 2 ${issued.toFixed(2)} at ${(rate * 100).toFixed(2)}% for ${tenor}m`, ['capital','funding']));
};

const capitalMarketsPricingLabel'''
s = s[:block.start()] + replacement + s[block.end():]

block = re.search(r"const settleCapitalMarketsBookbuild = \(.*?\n};\n\nconst applyBoeFunding", s, re.S)
assert block, 'settlement block not found'
replacement = '''const settleCapitalMarketsBookbuild = (
  state: BankState,
  config: SimulationConfig,
  book: CapitalMarketsBookbuildResult,
  events: SimulationEvent[]
): void => {
  state.capitalMarkets ??= { transactions: [] };
  state.capitalMarkets.transactions.push({
    ...book,
    step: state.time.step,
    date: state.time.date.toISOString(),
  });

  const definition = getCapitalMarketsInstrument(book.instrument);
  const instrumentLabel = definition.label;
  if (book.executedAmount <= 0) {
    const reason = book.status === 'failed-price'
      ? 'management price limit was inside the clearing level'
      : 'insufficient market demand';
    events.push(createEvent(
      'warning',
      `${instrumentLabel} bookbuild failed: ${reason}; demand ${(book.demandAmount / 1e6).toFixed(0)}m for target ${(book.targetAmount / 1e6).toFixed(0)}m`,
      ['capital','funding','market']
    ));
    return;
  }

  const cash = findItem(state.financial.balanceSheet, AssetProductType.CashReserves);
  if (!cash) return;

  if (definition.settlement.kind === 'cet1') {
    ensureEquityMarketState(state, config);
    state.financial.capital.cet1 += book.netProceeds;
    cash.balance += book.netProceeds;
    const issuePrice = Math.max(1e-6, book.issuePrice ?? state.equityMarket.sharePrice);
    state.equityMarket.sharesOutstanding += book.grossProceeds / issuePrice;
    state.equityMarket.marketCap = state.equityMarket.sharePrice * state.equityMarket.sharesOutstanding;
  } else if (definition.settlement.kind === 'at1') {
    const oldBalance = Math.max(0, state.financial.capital.at1);
    const oldCoupon = state.capitalMarkets.at1CouponRateAnnual ?? config.riskLimits.capitalPolicy.at1CouponRateAnnual;
    const newCoupon = Math.max(
      0,
      (book.marketReferenceRate ?? state.market.riskFreeLong) + (book.clearingSpreadBps ?? 0) / 10000
    );
    state.financial.capital.at1 += book.netProceeds;
    cash.balance += book.netProceeds;
    state.capitalMarkets.at1CouponRateAnnual = blendRate(oldBalance, oldCoupon, book.netProceeds, newCoupon);
  } else {
    const rate = Math.max(
      0,
      (book.marketReferenceRate ?? state.market.riskFreeLong) + (book.clearingSpreadBps ?? 0) / 10000
    );
    const tenor = Math.max(1, Math.round(book.tenorMonths ?? definition.defaultTenorMonths ?? 12));
    addContractualFundingPosition(
      state,
      config,
      definition.settlement.productType,
      book.executedAmount,
      rate,
      tenor
    );
    cash.balance += book.executedAmount;
  }

  events.push(createEvent(
    book.status === 'partial' ? 'warning' : 'info',
    `${instrumentLabel} bookbuild ${book.status}: target ${(book.targetAmount / 1e6).toFixed(0)}m, demand ${(book.demandAmount / 1e6).toFixed(0)}m (${book.coverageRatio.toFixed(2)}x), executed ${(book.executedAmount / 1e6).toFixed(0)}m at ${capitalMarketsPricingLabel(book)}`,
    ['capital','funding','market']
  ));
};

const applyBoeFunding'''
s = s[:block.start()] + replacement + s[block.end():]

block = re.search(r"const stepContractualRetailFunding = \(.*?\n};\n\nconst applyEnterHedge", s, re.S)
assert block, 'contractual funding lifecycle block not found'
replacement = '''const stepContractualRetailFunding = (state: BankState, config: SimulationConfig, dtMonths: number, events: SimulationEvent[]): void => {
  const capitalMarketsContractualProducts = productTypesWithCapability('capitalMarketsFunding')
    .filter(productType => !hasCapability(productType, 'wholesaleFunding'));
  const products: ProductType[] = [
    LiabilityProductType.RetailTermDeposits,
    LiabilityProductType.BankOfEnglandFunding,
    ...capitalMarketsContractualProducts,
  ];
  for (const productType of products) {
    const buckets = genericFundingBuckets(state, productType);
    if (!buckets.length) continue;
    let matured = 0;
    const before = buckets.reduce((sum, bucket) => sum + bucket.notional, 0);
    const keep: FundingMaturityBucket[] = [];
    for (const bucket of buckets) {
      const monthsToMaturity = bucket.monthsToMaturity - dtMonths;
      if (monthsToMaturity <= 0) matured += Math.max(0, bucket.notional);
      else keep.push({ ...bucket, monthsToMaturity });
    }
    state.fundingLadders[productType] = keep;
    if (matured <= 0) continue;
    const paid = applyCashOutflowOrFail(state, matured, events);
    const line = findItem(state.financial.balanceSheet, productType);
    if (line) line.balance = Math.max(0, (line.balance ?? before) - paid);
    if (PRODUCTS[productType].regulatory.capital === 'tier2OwnFunds') {
      state.financial.capital.tier2 = Math.max(0, (state.financial.capital.tier2 ?? 0) - paid);
    }
    if (productType === LiabilityProductType.BankOfEnglandFunding) {
      const gilts = findItem(state.financial.balanceSheet, AssetProductType.Gilts);
      if (gilts?.encumbrance && before > 0) {
        const releasedCollateral = (gilts.encumbrance.encumberedAmount ?? 0) * Math.min(1, paid / before);
        gilts.encumbrance.encumberedAmount = Math.max(
          0,
          (gilts.encumbrance.encumberedAmount ?? 0) - releasedCollateral
        );
      }
    }
    events.push(createEvent('info', `${PRODUCTS[productType]?.label ?? productType} matured ${paid.toFixed(2)}`, ['funding']));
  }
};

const applyEnterHedge'''
s = s[:block.start()] + replacement + s[block.end():]
p.write_text(s)

# Management UI derives labels and tenor options from the same registry.
p = Path('src/components/ActionsPanel.tsx')
s = p.read_text()
s = s.replace(
    "import type { CapitalMarketsBookbuildResult } from '../domain/capitalMarkets';",
    "import type { CapitalMarketsBookbuildResult, CapitalMarketsInstrument } from '../domain/capitalMarkets';\nimport { CAPITAL_MARKETS_INSTRUMENT_ORDER, getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';",
    1,
)
s = s.replace(
    "  capitalMarketsInstrument: 'none' | 'cet1' | 'at1' | 'tier2' | 'senior';",
    "  capitalMarketsInstrument: 'none' | CapitalMarketsInstrument;",
    1,
)
block = re.search(r"const instrumentLabel = .*?\n};\n\nexport default function ActionsPanel", s, re.S)
assert block, 'ActionsPanel ticket block not found'
replacement = '''const tenorLabel = (months: number): string =>
  months % 12 === 0 ? `${months / 12} years` : `${months} months`;

const CapitalMarketsTicket = ({state,update,disabled,errors,quote,planImpact}:{state:ActionFormState;update:(key:keyof ActionFormState,value:string)=>void;disabled?:boolean;errors?:Partial<Record<keyof ActionFormState,string>>;quote?:CapitalMarketsBookbuildResult;planImpact?:CapitalMarketsPlanImpact}) => {
  const instrument = state.capitalMarketsInstrument;
  const definition = instrument === 'none' ? undefined : getCapitalMarketsInstrument(instrument);
  const isDiscountPriced = definition?.pricingKind === 'discount';
  const tenors = definition?.permittedTenorMonths ?? [];
  const allInYield = quote?.marketReferenceRate !== undefined && quote.clearingSpreadBps !== undefined
    ? quote.marketReferenceRate + quote.clearingSpreadBps / 10000
    : undefined;
  return <section className="policy-disclosure capital-markets-ticket" aria-label="Capital markets">
    <div className="policy-section-title"><h3>Capital markets</h3><small>One transaction ticket. Market demand and clearing terms determine what actually settles.</small></div>
    <div className="policy-fields policy-fields-primary">
      <label className="field"><strong>Instrument</strong><select value={instrument} disabled={disabled} onChange={e=>update('capitalMarketsInstrument',e.target.value)}><option value="none">No transaction queued</option>{CAPITAL_MARKETS_INSTRUMENT_ORDER.map(key => { const item=getCapitalMarketsInstrument(key); return <option key={key} value={key}>{item.label}</option>; })}</select><small>Choose the claim you want investors to buy.</small></label>
      <Field field="capitalMarketsTargetAmount" label="Target size (£)" hint="The book can be partially filled if investor demand is smaller than your target." state={state} update={update} disabled={disabled||!definition} error={errors?.capitalMarketsTargetAmount} placeholder="e.g. 150m"/>
      {isDiscountPriced
        ? <Field field="capitalMarketsMaxDiscount" label="Maximum acceptable discount" hint="The deal fails rather than price below this limit." state={state} update={update} disabled={disabled} error={errors?.capitalMarketsMaxDiscount} placeholder="e.g. 12%"/>
        : <Field field="capitalMarketsMaxSpreadBps" label="Maximum acceptable spread (bp)" hint="The deal fails if the clearing spread is wider than this limit." state={state} update={update} disabled={disabled||!definition} error={errors?.capitalMarketsMaxSpreadBps} placeholder="e.g. 750"/>}
      {tenors.length>0&&<label className="field"><strong>Tenor</strong><select value={state.capitalMarketsTenorMonths} disabled={disabled} onChange={e=>update('capitalMarketsTenorMonths',e.target.value)}>{tenors.map(tenor=><option key={tenor} value={tenor}>{tenorLabel(tenor)}</option>)}</select><small>Longer debt locks in the clearing cost for longer.</small></label>}
    </div>
    {definition&&quote&&<div className={`alert ${quote.status.startsWith('failed')?'warning':'info'} capital-markets-book`}>
      <strong>Indicative book · {definition.label}</strong>
      <div className="muted">Demand {formatCurrency(quote.demandAmount)} · coverage {quote.coverageRatio.toFixed(2)}× · executable {formatCurrency(quote.executedAmount)} of {formatCurrency(quote.targetAmount)}</div>
      <div className="muted">{isDiscountPriced?`Clearing discount ${formatPct(quote.clearingDiscount??0)} · issue price £${(quote.issuePrice??0).toFixed(3)}`:`Clearing spread ${(quote.clearingSpreadBps??0).toFixed(0)}bp${allInYield!==undefined?` · all-in yield ${formatPct(allInYield)}`:''}`} · {quote.status.replace('-', ' ')}</div>
      {quote.fees>0&&<div className="muted">Fees {formatCurrency(quote.fees)} · net proceeds {formatCurrency(quote.netProceeds)}</div>}
      {quote.recentIssuanceRatio>0&&<div className="muted">Recent issuance is reducing market capacity and worsening clearing terms.</div>}
    </div>}
    {definition&&planImpact&&<div className="capital-markets-plan-impact"><strong>Three-Year Plan impact</strong><div className="muted">One-month preview: CET1 {formatPct(planImpact.cet1Before)} → {formatPct(planImpact.cet1After)} · EPS {(planImpact.epsBefore*100).toFixed(1)}p → {(planImpact.epsAfter*100).toFixed(1)}p.</div><div className="muted">There is no direct Board Confidence effect: the transaction matters only through the plan metrics it changes.</div></div>}
    <p className="muted">Bookbuild terms are indicative until the monthly close. A failed price limit records the attempt but settles no capital or funding.</p>
  </section>;
};

export default function ActionsPanel'''
s = s[:block.start()] + replacement + s[block.end():]
p.write_text(s)

# App validation/order construction uses instrument metadata rather than instrument-name switches.
p = Path('src/App.tsx')
s = p.read_text()
s = s.replace(
    "import { buildCapitalMarketsBook } from './engine/capitalMarkets';",
    "import { buildCapitalMarketsBook } from './engine/capitalMarkets';\nimport { getCapitalMarketsInstrument } from './capitalMarkets/catalogue';",
    1,
)
old = """    if(state.capitalMarketsInstrument==='cet1') {
      const parsed=parseRateInput(state.capitalMarketsMaxDiscount);
      if(parsed.error) errors.capitalMarketsMaxDiscount=parsed.error;
      else if(parsed.value===undefined||parsed.value<0||parsed.value>0.5) errors.capitalMarketsMaxDiscount='Maximum discount must be between 0% and 50%';
      else values.capitalMarketsMaxDiscount=parsed.value;
    } else {
      const spread=Number(state.capitalMarketsMaxSpreadBps);
      if(!Number.isFinite(spread)||spread<=0||spread>5000) errors.capitalMarketsMaxSpreadBps='Maximum spread must be between 1 and 5,000 bp';
      else values.capitalMarketsMaxSpreadBps=spread;
    }
    if(state.capitalMarketsInstrument==='tier2'||state.capitalMarketsInstrument==='senior') {
      const tenor=Number(state.capitalMarketsTenorMonths);
      if(!Number.isFinite(tenor)||tenor<=0) errors.capitalMarketsTenorMonths='Select a positive debt tenor';
      else values.capitalMarketsTenorMonths=Math.round(tenor);
    }"""
new = """    const definition=getCapitalMarketsInstrument(state.capitalMarketsInstrument);
    if(definition.pricingKind==='discount') {
      const parsed=parseRateInput(state.capitalMarketsMaxDiscount);
      if(parsed.error) errors.capitalMarketsMaxDiscount=parsed.error;
      else if(parsed.value===undefined||parsed.value<0||parsed.value>0.5) errors.capitalMarketsMaxDiscount='Maximum discount must be between 0% and 50%';
      else values.capitalMarketsMaxDiscount=parsed.value;
    } else {
      const spread=Number(state.capitalMarketsMaxSpreadBps);
      if(!Number.isFinite(spread)||spread<=0||spread>5000) errors.capitalMarketsMaxSpreadBps='Maximum spread must be between 1 and 5,000 bp';
      else values.capitalMarketsMaxSpreadBps=spread;
    }
    if(definition.permittedTenorMonths?.length) {
      const tenor=Math.round(Number(state.capitalMarketsTenorMonths));
      if(!Number.isFinite(tenor)||!definition.permittedTenorMonths.includes(tenor)) errors.capitalMarketsTenorMonths='Select a permitted debt tenor';
      else values.capitalMarketsTenorMonths=tenor;
    }"""
assert old in s, 'App validation block not found'
s = s.replace(old, new, 1)
old = """    return buildCapitalMarketsBook(bankState,simConfig,{
      instrument,
      targetAmount:target,
      maxDiscount:instrument==='cet1'?parsedActionForm.values.capitalMarketsMaxDiscount:undefined,
      maxSpreadBps:instrument==='cet1'?undefined:parsedActionForm.values.capitalMarketsMaxSpreadBps,
      tenorMonths:instrument==='tier2'||instrument==='senior'?parsedActionForm.values.capitalMarketsTenorMonths:undefined,
    });"""
new = """    const definition=getCapitalMarketsInstrument(instrument);
    return buildCapitalMarketsBook(bankState,simConfig,{
      instrument,
      targetAmount:target,
      maxDiscount:definition.pricingKind==='discount'?parsedActionForm.values.capitalMarketsMaxDiscount:undefined,
      maxSpreadBps:definition.pricingKind==='spread'?parsedActionForm.values.capitalMarketsMaxSpreadBps:undefined,
      tenorMonths:definition.permittedTenorMonths?.length?parsedActionForm.values.capitalMarketsTenorMonths:undefined,
    });"""
assert old in s, 'App quote block not found'
s = s.replace(old, new, 1)
old = """  if (formState.capitalMarketsInstrument !== 'none' && values.capitalMarketsTargetAmount !== undefined && values.capitalMarketsTargetAmount > 0) {
    actions.push({
      type: 'launchCapitalMarketsTransaction',
      instrument: formState.capitalMarketsInstrument,
      targetAmount: values.capitalMarketsTargetAmount,
      maxDiscount: formState.capitalMarketsInstrument === 'cet1' ? values.capitalMarketsMaxDiscount : undefined,
      maxSpreadBps: formState.capitalMarketsInstrument === 'cet1' ? undefined : values.capitalMarketsMaxSpreadBps,
      tenorMonths: formState.capitalMarketsInstrument === 'tier2' || formState.capitalMarketsInstrument === 'senior' ? values.capitalMarketsTenorMonths : undefined,
    });
  }"""
new = """  if (formState.capitalMarketsInstrument !== 'none' && values.capitalMarketsTargetAmount !== undefined && values.capitalMarketsTargetAmount > 0) {
    const definition=getCapitalMarketsInstrument(formState.capitalMarketsInstrument);
    actions.push({
      type: 'launchCapitalMarketsTransaction',
      instrument: formState.capitalMarketsInstrument,
      targetAmount: values.capitalMarketsTargetAmount,
      maxDiscount: definition.pricingKind === 'discount' ? values.capitalMarketsMaxDiscount : undefined,
      maxSpreadBps: definition.pricingKind === 'spread' ? values.capitalMarketsMaxSpreadBps : undefined,
      tenorMonths: definition.permittedTenorMonths?.length ? values.capitalMarketsTenorMonths : undefined,
    });
  }"""
assert old in s, 'App action block not found'
s = s.replace(old, new, 1)
p.write_text(s)

# Tests enforce the architecture boundary.
p = Path('src/products/capabilities.test.ts')
s = p.read_text()
marker = "  it('returns capability data without product-name branching', () => {"
addition = """  it('selects product-backed capital-market instruments from capabilities', () => {
    expect(productTypesWithCapability('capitalMarketsFunding').sort()).toEqual(
      [LiabilityProductType.WholesaleFundingLT, LiabilityProductType.Tier2Debt].sort()
    );
    expect(getCapability(LiabilityProductType.WholesaleFundingLT, 'capitalMarketsFunding')).toEqual({
      instrument: 'senior',
      defaultTenorMonths: 36,
      permittedTenorMonths: [24, 36, 60],
    });
    expect(getCapability(LiabilityProductType.Tier2Debt, 'capitalMarketsFunding')).toEqual({
      instrument: 'tier2',
      defaultTenorMonths: 60,
      permittedTenorMonths: [60, 84, 120],
    });
  });

"""
assert marker in s
s = s.replace(marker, addition + marker, 1)
p.write_text(s)

Path('src/capitalMarkets/catalogue.test.ts').write_text("""import { describe, expect, it } from 'vitest';
import { LiabilityProductType, getProduct } from '../products/catalogue';
import { getCapability } from '../products/capabilities';
import { CAPITAL_MARKETS_INSTRUMENT_ORDER, getCapitalMarketsInstrument } from './catalogue';

describe('capital-markets catalogue layering', () => {
  it('derives product-backed instrument identity and tenors from product capabilities', () => {
    const tier2 = getCapitalMarketsInstrument('tier2');
    const senior = getCapitalMarketsInstrument('senior');
    expect(tier2.label).toBe(getProduct(LiabilityProductType.Tier2Debt).label);
    expect(tier2.permittedTenorMonths).toEqual(
      getCapability(LiabilityProductType.Tier2Debt, 'capitalMarketsFunding')?.permittedTenorMonths
    );
    expect(tier2.settlement).toEqual({ kind: 'fundingProduct', productType: LiabilityProductType.Tier2Debt });
    expect(senior.label).toBe(getProduct(LiabilityProductType.WholesaleFundingLT).label);
    expect(senior.permittedTenorMonths).toEqual(
      getCapability(LiabilityProductType.WholesaleFundingLT, 'capitalMarketsFunding')?.permittedTenorMonths
    );
    expect(senior.settlement).toEqual({ kind: 'fundingProduct', productType: LiabilityProductType.WholesaleFundingLT });
  });

  it('exposes a single ordered registry for the management UI', () => {
    expect(CAPITAL_MARKETS_INSTRUMENT_ORDER).toEqual(['cet1', 'at1', 'tier2', 'senior']);
    expect(CAPITAL_MARKETS_INSTRUMENT_ORDER.map(key => getCapitalMarketsInstrument(key).label)).toEqual([
      'CET1 equity', 'AT1', 'Tier 2 subordinated debt', 'Long-Term Debt',
    ]);
  });
});
""")
