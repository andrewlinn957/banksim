import { BankState } from '../domain/bankState';
import { BalanceSheetSide } from '../domain/enums';

export function checkInvariants(state: BankState): string[] {
  const errors: string[] = [];

  const assets = state.financial.balanceSheet.items
    .filter((i) => i.side === BalanceSheetSide.Asset)
    .reduce((s, i) => s + i.balance, 0);
  const liabilities = state.financial.balanceSheet.items
    .filter((i) => i.side === BalanceSheetSide.Liability)
    .reduce((s, i) => s + i.balance, 0);
  const equity = state.financial.capital.cet1 + state.financial.capital.at1;

  const diff = assets - (liabilities + equity);
  if (Math.abs(diff) > 1) {
    errors.push(`Balance sheet not balanced by ${diff}`);
  }

  const negativeBalances = state.financial.balanceSheet.items.filter((i) => i.balance < -1e-6);
  negativeBalances.forEach((i) => {
    errors.push(`Negative balance on ${i.productType}: ${i.balance}`);
  });

  const ratios = [
    { name: 'CET1', value: state.risk.riskMetrics.cet1Ratio },
    { name: 'Leverage', value: state.risk.riskMetrics.leverageRatio },
    { name: 'LCR', value: state.risk.riskMetrics.lcr },
    { name: 'NSFR', value: state.risk.riskMetrics.nsfr },
  ];
  ratios.forEach((r) => {
    if (Number.isNaN(r.value) || r.value === -Infinity) {
      errors.push(`${r.name} ratio is invalid (${r.value})`);
    }
  });

  return errors;
}
