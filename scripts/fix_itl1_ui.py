from pathlib import Path

root = Path(__file__).resolve().parents[1]

loans = root / 'src/components/LoansPanel.tsx'
text = loans.read_text()
text = text.replace(
    "import { LoanCohort, LoanGeography, LoanSector, LoanStage, LoanWorkoutBucket } from '../domain/loanCohorts';\n",
    "import { LoanCohort, LoanGeography, LoanSector, LoanStage, LoanWorkoutBucket } from '../domain/loanCohorts';\nimport { canonicalLoanGeography, UK_ITL1_LABELS, UK_ITL1_REGIONS } from '../domain/ukItl1';\n",
    1,
)
text = text.replace(
    "const GEOGRAPHY_ORDER = ['london', 'south', 'midlands', 'north', 'scotland', 'wales', 'northernIreland', 'other'] as const;",
    "const GEOGRAPHY_ORDER = UK_ITL1_REGIONS;",
    1,
)
old_labels = """const GEOGRAPHY_LABEL: Record<LoanGeography, string> = {
  london: 'London',
  south: 'South',
  midlands: 'Midlands',
  north: 'North',
  scotland: 'Scotland',
  wales: 'Wales',
  northernIreland: 'Northern Ireland',
  other: 'Other',
};

const cohortSector = (cohort: LoanCohort): LoanSector => cohort.sector ?? 'other';
const cohortGeography = (cohort: LoanCohort): LoanGeography => cohort.geography ?? 'other';
"""
new_labels = """const GEOGRAPHY_LABEL: Record<LoanGeography, string> = {
  ...UK_ITL1_LABELS,
  south: 'South',
  midlands: 'Midlands',
  north: 'North',
  other: 'Other',
};

const cohortSector = (cohort: LoanCohort): LoanSector => cohort.sector ?? 'other';
const cohortGeography = (cohort: LoanCohort): LoanGeography =>
  canonicalLoanGeography(cohort.geography, cohort.cohortId);
"""
if old_labels not in text:
    raise RuntimeError('Loan geography label block not found')
text = text.replace(old_labels, new_labels, 1)
text = text.replace("placeholder: 'e.g. North',", "placeholder: 'e.g. London',", 1)
loans.write_text(text)

rwa = root / 'src/components/RwaDashboard.tsx'
rwa_text = rwa.read_text()
old_title = "<title>{UK_ITL1_LABELS[region]} · {formatCurrency(regionalRwa[region])} RWA</title>"
new_title = "<title>{`${UK_ITL1_LABELS[region]} · ${formatCurrency(regionalRwa[region])} RWA`}</title>"
if old_title not in rwa_text:
    raise RuntimeError('RWA SVG title not found')
rwa.write_text(rwa_text.replace(old_title, new_title, 1))

(root / 'scripts/fix_itl1_ui.py').unlink(missing_ok=True)
(root / '.github/workflows/fix-itl1-ui.yml').unlink(missing_ok=True)
