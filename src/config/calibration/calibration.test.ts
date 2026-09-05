import { describe, expect, it } from 'vitest';
import { BalanceSheetSide } from '../../domain/enums';
import { sumLoanOutstanding } from '../../engine/loanCohorts';
import { calibrationPacks } from './index';

const balanceSheetDiff = (pack: (typeof calibrationPacks)[number]): number => {
  const assets = pack.initialState.financial.balanceSheet.items
    .filter((line) => line.side === BalanceSheetSide.Asset)
    .reduce((sum, line) => sum + line.balance, 0);
  const liabilities = pack.initialState.financial.balanceSheet.items
    .filter((line) => line.side === BalanceSheetSide.Liability)
    .reduce((sum, line) => sum + line.balance, 0);
  const equity =
    pack.initialState.financial.capital.cet1 +
    pack.initialState.financial.capital.at1 +
    pack.initialState.financial.capital.accumulatedOCI;

  return assets - liabilities - equity;
};

describe('calibration pack accounting', () => {
  it('keeps loan line items in sync with underlying cohort balances', () => {
    calibrationPacks.forEach((pack) => {
      Object.entries(pack.initialState.loanCohorts).forEach(([productType, cohorts]) => {
        const line = pack.initialState.financial.balanceSheet.items.find((item) => item.productType === productType);
        expect(line, `${pack.id}/${productType}`).toBeDefined();
        expect(line!.balance + (line!.lossAllowance ?? 0)).toBeCloseTo(sumLoanOutstanding(cohorts), -2);
      });
    });
  });

  it('starts each pack with a balanced balance sheet', () => {
    calibrationPacks.forEach((pack) => {
      expect(balanceSheetDiff(pack), pack.id).toBeCloseTo(0, 0);
    });
  });
});
