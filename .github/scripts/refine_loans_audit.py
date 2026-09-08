from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'Missing expected source for {label}')
    return text.replace(old, new, 1)

path = Path('src/components/LoansPanel.tsx')
text = path.read_text()

text = replace_once(
    text,
    "import { AssetProductType, ProductType } from '../domain/enums';",
    "import { AssetProductType, MaturityBucket, ProductType } from '../domain/enums';",
    'maturity type import',
)

# Remove arbitrary RAG thresholds: PD/LGD are risk measures, not pass/fail limits.
for line, label in [
    ("const PD_THRESHOLDS = { greenMax: 0.005, amberMax: 0.02 };\n", 'PD thresholds'),
    ("const LGD_THRESHOLDS = { greenMax: 0.25, amberMax: 0.45 };\n", 'LGD thresholds'),
    ("const PDXLGD_THRESHOLDS = { greenMax: 0.002, amberMax: 0.008 };\n", 'PDxLGD thresholds'),
]:
    text = replace_once(text, line, '', label)

start = "type RagTone = 'rag-green' | 'rag-amber' | 'rag-red';\nconst ragClass = (value: number, thresholds: { greenMax: number; amberMax: number }): RagTone => {\n  if (!Number.isFinite(value)) return 'rag-amber';\n  if (value <= thresholds.greenMax) return 'rag-green';\n  if (value <= thresholds.amberMax) return 'rag-amber';\n  return 'rag-red';\n};\n\n"
text = replace_once(text, start, '', 'RAG helper')

maturity_anchor = "const cohortGeography = (cohort: LoanCohort): LoanGeography => cohort.geography ?? 'other';\n"
maturity_block = """const cohortGeography = (cohort: LoanCohort): LoanGeography => cohort.geography ?? 'other';\n\nconst MATURITY_LABEL: Record<MaturityBucket, string> = {\n  [MaturityBucket.Overnight]: 'Overnight',\n  [MaturityBucket.LessThan1Y]: '<1 year',\n  [MaturityBucket.OneToThreeY]: '1–3 years',\n  [MaturityBucket.ThreeToFiveY]: '3–5 years',\n  [MaturityBucket.GreaterThan5Y]: '>5 years',\n  [MaturityBucket.Perpetual]: 'Perpetual',\n};\n\nconst maturityLabel = (bucket: MaturityBucket | undefined): string => bucket ? MATURITY_LABEL[bucket] : '—';\nconst currentPd = (cohort: LoanCohort): number => cohort.effectiveAnnualPd ?? cohort.annualPd;\nconst currentLgd = (cohort: LoanCohort): number => cohort.effectiveLgd ?? cohort.lgd;\n"""
text = replace_once(text, maturity_anchor, maturity_block, 'maturity and current risk helpers')

text = replace_once(
    text,
    "    label: 'PD',\n    filterUnit: 'percent',\n    placeholder: '% (e.g. > 2)',\n    value: (cohort) => cohort.annualPd,\n    display: (cohort) => formatRate(cohort.annualPd),\n    cell: (cohort) => (\n      <span className={`rag-badge ${ragClass(cohort.annualPd, PD_THRESHOLDS)}`}>{formatRate(cohort.annualPd)}</span>\n    ),",
    "    label: 'Current PD',\n    filterUnit: 'percent',\n    placeholder: '% (e.g. > 2)',\n    value: currentPd,\n    display: (cohort) => formatRate(currentPd(cohort)),\n    cell: (cohort) => formatRate(currentPd(cohort)),",
    'current PD column',
)
text = replace_once(
    text,
    "    label: 'LGD',\n    filterUnit: 'percent',\n    placeholder: '% (e.g. > 45)',\n    value: (cohort) => cohort.lgd,\n    display: (cohort) => formatRate(cohort.lgd),\n    cell: (cohort) => <span className={`rag-badge ${ragClass(cohort.lgd, LGD_THRESHOLDS)}`}>{formatRate(cohort.lgd)}</span>,",
    "    label: 'Current LGD',\n    filterUnit: 'percent',\n    placeholder: '% (e.g. > 45)',\n    value: currentLgd,\n    display: (cohort) => formatRate(currentLgd(cohort)),\n    cell: (cohort) => formatRate(currentLgd(cohort)),",
    'current LGD column',
)
text = replace_once(
    text,
    "    label: 'PD×LGD',\n    filterUnit: 'percent',\n    placeholder: '% (e.g. > 0.8)',\n    value: (cohort) => cohort.annualPd * cohort.lgd,\n    display: (cohort) => formatRate(cohort.annualPd * cohort.lgd),\n    cell: (cohort) => {\n      const risk = cohort.annualPd * cohort.lgd;\n      return <span className={`rag-badge ${ragClass(risk, PDXLGD_THRESHOLDS)}`}>{formatRate(risk)}</span>;\n    },",
    "    label: 'PD×LGD',\n    filterUnit: 'percent',\n    placeholder: '% (e.g. > 0.8)',\n    value: (cohort) => currentPd(cohort) * currentLgd(cohort),\n    display: (cohort) => formatRate(currentPd(cohort) * currentLgd(cohort)),\n    cell: (cohort) => formatRate(currentPd(cohort) * currentLgd(cohort)),",
    'current PDxLGD column',
)

text = replace_once(text, "    const weightedPd = weightedAverage(visibleCohorts, (cohort) => cohort.annualPd);", "    const weightedPd = weightedAverage(visibleCohorts, currentPd);", 'summary current PD')
text = replace_once(text, "    const weightedLgd = weightedAverage(visibleCohorts, (cohort) => cohort.lgd);", "    const weightedLgd = weightedAverage(visibleCohorts, currentLgd);", 'summary current LGD')
text = replace_once(text, "    const weightedRisk = weightedAverage(visibleCohorts, (cohort) => cohort.annualPd * cohort.lgd);", "    const weightedRisk = weightedAverage(visibleCohorts, (cohort) => currentPd(cohort) * currentLgd(cohort));", 'summary current risk')

# Human-readable maturity values in filter, sort and table rendering.
text = replace_once(
    text,
    "      if (maturityNeedle && !String(loan.maturityBucket ?? '').toLowerCase().includes(maturityNeedle)) return false;",
    "      if (maturityNeedle && !maturityLabel(loan.maturityBucket).toLowerCase().includes(maturityNeedle)) return false;",
    'maturity filter',
)
text = replace_once(
    text,
    "        return compareStrings(String(a.maturityBucket ?? ''), String(b.maturityBucket ?? '')) * dir;",
    "        return compareStrings(maturityLabel(a.maturityBucket), maturityLabel(b.maturityBucket)) * dir;",
    'maturity sort',
)
text = replace_once(
    text,
    "                  <td>{loan.maturityBucket}</td>",
    "                  <td>{maturityLabel(loan.maturityBucket)}</td>",
    'maturity cell',
)
path.write_text(text)

# UI test: assert enum implementation names do not leak into the page.
path = Path('src/ui/loansPanelRetail.test.tsx')
text = path.read_text()
needle = "  expect(html).toContain('Maturity bucket');\n});"
replacement = "  expect(html).toContain('Maturity bucket');\n  expect(html).toContain('3–5 years');\n  expect(html).not.toContain('ThreeToFiveY');\n  expect(html).toContain('Current PD');\n  expect(html).toContain('Current LGD');\n});"
text = replace_once(text, needle, replacement, 'UI maturity/risk labels')
path.write_text(text)
