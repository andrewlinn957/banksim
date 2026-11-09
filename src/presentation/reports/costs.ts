import type { IncomeStatement } from '../../domain/pnl';

export const buildCostsReportData = (income: IncomeStatement) => [
  { label: 'Interest Income', value: income.interestIncome },
  { label: 'Interest Expense', value: income.interestExpense },
  { label: 'Net Interest Income', value: income.netInterestIncome, bold: true },
  { label: 'Fees', value: income.feeIncome },
  { label: 'Credit Losses', value: income.creditLosses },
  { label: 'Fixed operating costs', value: income.fixedOperatingCosts },
  { label: 'Servicing costs', value: income.servicingCosts },
  { label: 'Origination costs', value: income.originationCosts },
  { label: 'Workout costs', value: income.workoutCosts },
  { label: 'Operating Expenses', value: income.operatingExpenses },
  { label: 'Tax', value: income.tax },
  { label: 'Net Income', value: income.netIncome, bold: true },
];
