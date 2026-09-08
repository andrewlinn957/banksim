from pathlib import Path

p = Path('src/engine/tier2Requirement.test.ts')
text = p.read_text()
text = text.replace(
    "import { LiabilityProductType } from '../domain/enums';",
    "import { LiabilityProductType, MaturityBucket } from '../domain/enums';"
)
anchor = "import { eligibleTier2OwnFunds } from '../products/regulatory';\n"
if anchor not in text:
    raise SystemExit('Tier 2 test import anchor missing')
text = text.replace(anchor, anchor + "import { createPosition } from '../products/factory';\n", 1)
old = """    const line = s.financial.balanceSheet.items.find((item) => item.productType === LiabilityProductType.Tier2Debt)!;\n\n    line.balance = 1;\n"""
new = """    const line = createPosition(baseConfig, {\n      productType: LiabilityProductType.Tier2Debt,\n      balance: 1,\n      interestRate: 0.05,\n      maturityBucket: MaturityBucket.GreaterThan5Y,\n    });\n    s.financial.balanceSheet.items.push(line);\n"""
if old not in text:
    raise SystemExit('Tier 2 test setup anchor missing')
p.write_text(text.replace(old, new, 1))
