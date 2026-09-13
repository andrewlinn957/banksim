from pathlib import Path

path = Path('src/engine/simulation.ts')
text = path.read_text()

cashflow_import = "import { CashFlowStatement } from '../domain/cashflow';\n"
if cashflow_import not in text:
    raise SystemExit('CashFlowStatement import not found')
text = text.replace(cashflow_import, '', 1)

import_anchor = "import type { CapitalMarketsBookbuildResult } from '../domain/capitalMarkets';\n"
new_import = "import { buildStatements, type BuildStatementsResult } from './simulationStatements';\n"
if import_anchor not in text:
    raise SystemExit('Import anchor not found')
text = text.replace(import_anchor, import_anchor + new_import, 1)

advance_block = """const advanceDateByMonths = (date: Date, months: number): Date => {
  const wholeMonths = Math.max(0, Math.round(months));
  const next = new Date(date.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + wholeMonths);
  const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, daysInMonth));
  return next;
};

"""
if advance_block not in text:
    raise SystemExit('advanceDateByMonths block not found')
text = text.replace(advance_block, '', 1)

start = text.find('export interface BuildStatementsResult {')
end_marker = '/**\n * Validates post-step invariants and flags the bank as failed if they are violated.'
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit(f'Could not locate statement block: start={start}, end={end}')
text = text[:start] + text[end:]

path.write_text(text)
