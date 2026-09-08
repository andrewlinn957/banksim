from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'Missing expected source for {label}')
    return text.replace(old, new, 1)

# --- LoansPanel: make product, accounting and cohort labels accurate ---
path = Path('src/components/LoansPanel.tsx')
text = path.read_text()

text = replace_once(
    text,
    "import { LoanCohort, LoanWorkoutBucket } from '../domain/loanCohorts';",
    "import { LoanCohort, LoanGeography, LoanSector, LoanStage, LoanWorkoutBucket } from '../domain/loanCohorts';",
    'loan cohort type imports',
)

text = replace_once(
    text,
    "const PORTFOLIO_LABEL: Record<LoanPortfolioType, string> = {\n  [AssetProductType.Mortgages]: 'Mortgages',\n  [AssetProductType.ConsumerLoans]: 'Personal Credit',\n  [AssetProductType.CorporateLoans]: 'SME & Business',\n};",
    "const PORTFOLIO_LABEL: Record<LoanPortfolioType, string> = {\n  [AssetProductType.Mortgages]: 'Residential mortgages',\n  [AssetProductType.ConsumerLoans]: 'Personal loans & revolving credit',\n  [AssetProductType.CorporateLoans]: 'SME & business lending',\n};",
    'portfolio labels',
)

text = replace_once(
    text,
    "const REMAINING_TERM_THRESHOLDS = { greenMax: 120, amberMax: 300 };\n",
    "",
    'remaining term thresholds',
)

anchor = "const GEOGRAPHY_ORDER = ['london', 'south', 'midlands', 'north', 'scotland', 'wales', 'northernIreland', 'other'] as const;\n"
labels = """const GEOGRAPHY_ORDER = ['london', 'south', 'midlands', 'north', 'scotland', 'wales', 'northernIreland', 'other'] as const;\n\nconst STAGE_LABEL: Record<LoanStage, string> = {\n  stage1: 'Stage 1',\n  stage2: 'Stage 2',\n  stage3: 'Stage 3',\n};\n\nconst SECTOR_LABEL: Record<LoanSector, string> = {\n  retailMortgage: 'Residential mortgage',\n  consumer: 'Consumer',\n  commercialRealEstate: 'Commercial real estate',\n  sme: 'SME',\n  largeCorporate: 'Large corporate',\n  other: 'Other',\n};\n\nconst GEOGRAPHY_LABEL: Record<LoanGeography, string> = {\n  london: 'London',\n  south: 'South',\n  midlands: 'Midlands',\n  north: 'North',\n  scotland: 'Scotland',\n  wales: 'Wales',\n  northernIreland: 'Northern Ireland',\n  other: 'Other',\n};\n\nconst cohortSector = (cohort: LoanCohort): LoanSector => cohort.sector ?? 'other';\nconst cohortGeography = (cohort: LoanCohort): LoanGeography => cohort.geography ?? 'other';\n"""
text = replace_once(text, anchor, labels, 'human-readable cohort labels')

text = replace_once(
    text,
    "    placeholder: 'stage1|2|3',\n    value: (cohort) => (cohort.stage === 'stage3' ? 3 : cohort.stage === 'stage2' ? 2 : 1),\n    display: (cohort) => cohort.stage,\n    cell: (cohort) => cohort.stage,",
    "    placeholder: 'e.g. Stage 2',\n    value: (cohort) => (cohort.stage === 'stage3' ? 3 : cohort.stage === 'stage2' ? 2 : 1),\n    display: (cohort) => STAGE_LABEL[cohort.stage],\n    cell: (cohort) => STAGE_LABEL[cohort.stage],",
    'stage display',
)

text = replace_once(
    text,
    "    placeholder: 'e.g. sme',\n    value: (cohort) =>\n      Math.max(0, SECTOR_ORDER.indexOf((cohort.sector ?? 'other') as (typeof SECTOR_ORDER)[number])),\n    display: (cohort) => cohort.sector ?? 'other',\n    cell: (cohort) => cohort.sector ?? 'other',",
    "    placeholder: 'e.g. SME',\n    value: (cohort) =>\n      Math.max(0, SECTOR_ORDER.indexOf(cohortSector(cohort) as (typeof SECTOR_ORDER)[number])),\n    display: (cohort) => SECTOR_LABEL[cohortSector(cohort)],\n    cell: (cohort) => SECTOR_LABEL[cohortSector(cohort)],",
    'sector display',
)

text = replace_once(
    text,
    "    placeholder: 'e.g. north',\n    value: (cohort) =>\n      Math.max(0, GEOGRAPHY_ORDER.indexOf((cohort.geography ?? 'other') as (typeof GEOGRAPHY_ORDER)[number])),\n    display: (cohort) => cohort.geography ?? 'other',\n    cell: (cohort) => cohort.geography ?? 'other',",
    "    placeholder: 'e.g. North',\n    value: (cohort) =>\n      Math.max(0, GEOGRAPHY_ORDER.indexOf(cohortGeography(cohort) as (typeof GEOGRAPHY_ORDER)[number])),\n    display: (cohort) => GEOGRAPHY_LABEL[cohortGeography(cohort)],\n    cell: (cohort) => GEOGRAPHY_LABEL[cohortGeography(cohort)],",
    'geography display',
)

text = replace_once(
    text,
    "    cell: (cohort) => {\n      const remaining = remainingTermMonths(cohort);\n      return <span className={`rag-badge ${ragClass(remaining, REMAINING_TERM_THRESHOLDS)}`}>{formatInt(remaining)}</span>;\n    },",
    "    cell: (cohort) => formatInt(remainingTermMonths(cohort)),",
    'remaining term risk badge',
)

text = replace_once(text, "Total loans: <strong>{formatCurrency(totalLoans)}</strong>", "Net loans: <strong>{formatCurrency(totalLoans)}</strong>", 'net loans label')
text = replace_once(text, '<div className="metric-label">Committed undrawn</div>', '<div className="metric-label">Approved, not yet drawn</div>', 'committed undrawn label')
text = replace_once(text, "                Balance\n", "                Net carrying amount\n", 'balance header')
text = replace_once(text, "                Rate\n", "                Offer rate\n", 'rate header')
text = replace_once(text, "                Maturity\n", "                Maturity bucket\n", 'maturity header')
text = replace_once(text, 'placeholder="Filter maturity"', 'placeholder="Filter bucket"', 'maturity filter placeholder')
text = replace_once(text, 'aria-label="Filter maturity bucket"', 'aria-label="Filter maturity bucket"', 'maturity aria no-op')
text = replace_once(text, '<div className="metric-label">Outstanding</div>', '<div className="metric-label">Performing cohort exposure</div>', 'outstanding metric label')
text = replace_once(text, '<div className="metric-label">Sector concentration</div>', '<div className="metric-label">Largest sector share</div>', 'sector concentration label')
text = replace_once(text, '<div className="metric-label">Geography concentration</div>', '<div className="metric-label">Largest geography share</div>', 'geography concentration label')
text = replace_once(text, '<div className="metric-label">Avg workout lag</div>', '<div className="metric-label">WA workout lag</div>', 'workout lag label')

# Text columns should not look numeric/right-aligned.
text = replace_once(
    text,
    "                    <th key={column.key} className=\"numeric\">",
    "                    <th key={column.key} className={['stage', 'sector', 'geography'].includes(column.key) ? undefined : 'numeric'}>",
    'cohort header alignment',
)
text = replace_once(
    text,
    "                    <th key={column.key} className=\"numeric\">\n                      <input",
    "                    <th key={column.key} className={['stage', 'sector', 'geography'].includes(column.key) ? undefined : 'numeric'}>\n                      <input",
    'cohort filter alignment',
)
text = replace_once(
    text,
    "                        <td key={column.key} className=\"numeric\">",
    "                        <td key={column.key} className={['stage', 'sector', 'geography'].includes(column.key) ? undefined : 'numeric'}>",
    'cohort cell alignment',
)

path.write_text(text)

# --- Cohort engine: use product-appropriate sectors and benchmark rates ---
path = Path('src/engine/loanCohorts.ts')
text = path.read_text()

text = replace_once(
    text,
    "const getLoanBenchmarkRate = (state: BankState, productType: ProductType): number =>\n  productType === AssetProductType.Mortgages\n    ? state.market.competitorMortgageRate\n    : state.market.riskFreeLong + state.market.corporateLoanSpread;",
    "const getLoanBenchmarkRate = (state: BankState, productType: ProductType): number => {\n  const benchmark = PRODUCT_META[productType]?.behaviour?.loanBenchmark;\n  if (benchmark === 'mortgage') return state.market.competitorMortgageRate;\n  if (benchmark === 'consumer') return state.market.competitorConsumerLoanRate;\n  return state.market.riskFreeLong + state.market.corporateLoanSpread;\n};",
    'product-specific loan benchmark',
)

text = replace_once(
    text,
    "const defaultSectorMix = (productType: ProductType): Array<{ key: LoanSector; weight: number }> => {\n  if (productType === AssetProductType.Mortgages) {\n    return [\n      { key: 'retailMortgage', weight: 0.9 },\n      { key: 'commercialRealEstate', weight: 0.05 },\n      { key: 'other', weight: 0.05 },\n    ];\n  }\n  return [\n    { key: 'largeCorporate', weight: 0.45 },\n    { key: 'sme', weight: 0.3 },\n    { key: 'commercialRealEstate', weight: 0.2 },\n    { key: 'other', weight: 0.05 },\n  ];\n};",
    "const defaultSectorMix = (productType: ProductType): Array<{ key: LoanSector; weight: number }> => {\n  if (productType === AssetProductType.Mortgages) {\n    return [{ key: 'retailMortgage', weight: 1 }];\n  }\n  if (productType === AssetProductType.ConsumerLoans) {\n    return [{ key: 'consumer', weight: 1 }];\n  }\n  return [\n    { key: 'sme', weight: 0.55 },\n    { key: 'commercialRealEstate', weight: 0.3 },\n    { key: 'largeCorporate', weight: 0.1 },\n    { key: 'other', weight: 0.05 },\n  ];\n};",
    'product-specific sector mixes',
)
path.write_text(text)

# --- Opening balance-sheet maturity buckets: align with configured loan terms ---
path = Path('src/config/initialState.ts')
text = path.read_text()
text = replace_once(
    text,
    "makeItem(BalanceSheetSide.Asset, AssetProductType.ConsumerLoans, 'Personal Loans & Revolving Credit', 0.7e9, 0.105, MaturityBucket.OneToThreeY)",
    "makeItem(BalanceSheetSide.Asset, AssetProductType.ConsumerLoans, 'Personal Loans & Revolving Credit', 0.7e9, 0.105, MaturityBucket.ThreeToFiveY)",
    'consumer maturity bucket',
)
text = replace_once(
    text,
    "makeItem(BalanceSheetSide.Asset, AssetProductType.CorporateLoans, 'SME & Business Lending', 2.261e9, 0.068, MaturityBucket.ThreeToFiveY)",
    "makeItem(BalanceSheetSide.Asset, AssetProductType.CorporateLoans, 'SME & Business Lending', 2.261e9, 0.068, MaturityBucket.GreaterThan5Y)",
    'business maturity bucket',
)
path.write_text(text)

# --- Engine regression: each opening portfolio gets an appropriate sector set ---
path = Path('src/engine/loanCohorts.test.ts')
text = path.read_text()
insert_after = "  it('seasoning generation is deterministic for a fixed seed', () => {"
new_test = """  it('seeds product-appropriate sectors for each retail loan portfolio', () => {\n    const mortgageSectors = new Set((initialState.loanCohorts[AssetProductType.Mortgages] ?? []).map((c) => c.sector));\n    const consumerSectors = new Set((initialState.loanCohorts[AssetProductType.ConsumerLoans] ?? []).map((c) => c.sector));\n    const businessSectors = new Set((initialState.loanCohorts[AssetProductType.CorporateLoans] ?? []).map((c) => c.sector));\n\n    expect([...mortgageSectors]).toEqual(['retailMortgage']);\n    expect([...consumerSectors]).toEqual(['consumer']);\n    expect(businessSectors.has('consumer')).toBe(false);\n    expect(businessSectors.has('retailMortgage')).toBe(false);\n    expect(businessSectors.has('sme')).toBe(true);\n  });\n\n"""
if insert_after not in text:
    raise RuntimeError('Missing deterministic seasoning test anchor')
text = text.replace(insert_after, new_test + insert_after, 1)
path.write_text(text)

# --- UI regression: force each portfolio as the only available selection ---
path = Path('src/ui/loansPanelRetail.test.tsx')
text = path.read_text()
text = replace_once(
    text,
    "  expect(html).toContain('Mortgages');\n  expect(html).toContain('Personal Credit');\n  expect(html).toContain('SME &amp; Business');",
    "  expect(html).toContain('Residential mortgages');\n  expect(html).toContain('Personal loans &amp; revolving credit');\n  expect(html).toContain('SME &amp; business lending');",
    'retail loan report labels',
)
text += """\n\nit('shows consumer cohorts as consumer rather than SME/corporate sectors',()=>{\n  const consumerItems = initialState.financial.balanceSheet.items.filter((item)=>item.productType===AssetProductType.ConsumerLoans);\n  const consumerCohorts = initialState.loanCohorts[AssetProductType.ConsumerLoans] ?? [];\n  const html=renderToStaticMarkup(<LoansPanel items={consumerItems} loanCohorts={{[AssetProductType.ConsumerLoans]: consumerCohorts}} loanPipelines={{[AssetProductType.ConsumerLoans]: initialState.loanPipelines?.[AssetProductType.ConsumerLoans]}} workoutPipelines={{[AssetProductType.ConsumerLoans]: initialState.workoutPipelines?.[AssetProductType.ConsumerLoans]}}/>);\n  expect(html).toContain('Cohort breakdown — Personal loans &amp; revolving credit');\n  expect(html).toContain('Consumer');\n  expect(html).not.toContain('Large corporate');\n  expect(html).not.toContain('Commercial real estate');\n  expect(html).not.toContain('>SME<');\n  expect(html).toContain('Net carrying amount');\n  expect(html).toContain('Offer rate');\n  expect(html).toContain('Maturity bucket');\n});\n"""
text = replace_once(
    text,
    "import { initialState } from '../config/initialState';",
    "import { initialState } from '../config/initialState';\nimport { AssetProductType } from '../domain/enums';",
    'AssetProductType test import',
)
path.write_text(text)
