import { BankState } from '../domain/bankState';
import { BalanceSheetSide } from '../domain/enums';

export function checkInvariants(state: BankState): string[] {
  const errors: string[] = [];
  const items = state.financial.balanceSheet.items;
  for (const i of items) {
    if (![i.balance, i.interestRate, i.lossAllowance ?? 0].every(Number.isFinite)) errors.push(`Non-finite balance, rate or allowance on ${i.productType}`);
    if ((i.lossAllowance ?? 0) < 0) errors.push(`Negative allowance on ${i.productType}`);
    if (state.loanCohorts?.[i.productType] || state.workoutPipelines?.[i.productType]) {
      const gross = (state.loanCohorts?.[i.productType] ?? []).reduce((sum, c) => sum + c.outstandingPrincipal, 0) + (state.workoutPipelines?.[i.productType] ?? []).reduce((sum, b) => sum + b.defaultedPrincipal, 0);
      if (!Number.isFinite(gross) || Math.abs(gross - (i.lossAllowance ?? 0) - i.balance) > 1) errors.push(`Loan principal and allowance mismatch on ${i.productType}`);
    }
  }
  if (!Object.values(state.financial.capital).every(Number.isFinite)) errors.push('Non-finite capital');
  const allowances = items.reduce((sum, i) => sum + (i.lossAllowance ?? 0), 0);
  if (!Number.isFinite(state.financial.provisionStock.total) || Math.abs(allowances - state.financial.provisionStock.total) > 1) errors.push('Provision stock does not match allowances');


  const assets = state.financial.balanceSheet.items
    .filter((i) => i.side === BalanceSheetSide.Asset)
    .reduce((s, i) => s + i.balance, 0);
  const liabilities = state.financial.balanceSheet.items
    .filter((i) => i.side === BalanceSheetSide.Liability)
    .reduce((s, i) => s + i.balance, 0);
  const equity =
    state.financial.capital.cet1 + state.financial.capital.at1 + state.financial.capital.accumulatedOCI;

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
