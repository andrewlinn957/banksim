import { DepositBenchmark, LoanBenchmark } from './catalogue';
import {
  CustomerDepositProductType,
  LoanProductType,
  getCapability,
  productTypesWithCapability,
} from './capabilities';

/** Products that feed a named external customer-deposit benchmark. */
export const customerDepositProductsForBenchmark = (
  benchmark: DepositBenchmark
): CustomerDepositProductType[] =>
  productTypesWithCapability('customerDeposit').filter(
    productType => getCapability(productType, 'customerDeposit')?.benchmark === benchmark
  );

/** Loan products that feed a named external lending benchmark. */
export const loanProductsForBenchmark = (benchmark: LoanBenchmark): LoanProductType[] =>
  productTypesWithCapability('loan').filter(
    productType => getCapability(productType, 'loan')?.benchmark === benchmark
  );

/**
 * Engines that model one bank offer against one market benchmark use this
 * selector. It fails loudly if catalogue changes make that assumption false.
 */
export const requireLoanProductForBenchmark = (benchmark: LoanBenchmark): LoanProductType => {
  const products = loanProductsForBenchmark(benchmark);
  if (products.length !== 1) {
    throw new Error(`Expected one loan product for benchmark ${benchmark}, found ${products.length}`);
  }
  return products[0];
};
