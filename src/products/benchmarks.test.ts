import { describe, expect, it } from 'vitest';
import { AssetProductType, LiabilityProductType } from './catalogue';
import {
  customerDepositProductsForBenchmark,
  loanProductsForBenchmark,
  requireLoanProductForBenchmark,
} from './benchmarks';

describe('product benchmark registry', () => {
  it('derives deposit benchmark groups from catalogue capabilities', () => {
    expect(customerDepositProductsForBenchmark('retailCurrentAccount')).toEqual([
      LiabilityProductType.RetailCurrentAccounts,
    ]);
    expect(customerDepositProductsForBenchmark('termDeposit')).toEqual([
      LiabilityProductType.RetailTermDeposits,
    ]);
    expect(customerDepositProductsForBenchmark('corporateDeposit')).toEqual([
      LiabilityProductType.CorporateOperatingDeposits,
      LiabilityProductType.CorporateNonOperatingDeposits,
    ]);
  });

  it('derives lending benchmark products from catalogue capabilities', () => {
    expect(loanProductsForBenchmark('mortgage')).toEqual([AssetProductType.Mortgages]);
    expect(loanProductsForBenchmark('consumer')).toEqual([AssetProductType.ConsumerLoans]);
    expect(loanProductsForBenchmark('corporate')).toEqual([AssetProductType.CorporateLoans]);
    expect(requireLoanProductForBenchmark('mortgage')).toBe(AssetProductType.Mortgages);
  });
});
