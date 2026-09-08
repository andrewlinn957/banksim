import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';
import { BalanceSheetSide, Currency, MaturityBucket, ProductType } from '../domain/enums';
import { getProduct } from './catalogue';

export interface PositionInput<T extends ProductType = ProductType> {
  productType: T;
  balance: number;
  interestRate: number;
  maturityBucket: MaturityBucket;
  currency?: Currency;
  encumberedAmount?: number;
}

type PositionConfig = Pick<SimulationConfig, 'liquidityTags' | 'behaviour'>;

/**
 * Builds a balance-sheet position from the authoritative product catalogue and
 * the active simulation configuration.
 *
 * Product identity fields come from the catalogue. Position-specific values
 * such as balance, rate and maturity remain explicit inputs, while regulatory
 * and securities metadata are derived from the active config.
 */
export const createPosition = <T extends ProductType>(
  config: PositionConfig,
  input: PositionInput<T>
): BalanceSheetItem => {
  const product = getProduct(input.productType);
  const securitiesAccounting = config.behaviour.securitiesAccounting;
  const classification = securitiesAccounting?.defaultClassificationByProduct?.[input.productType];

  return {
    side: product.side === 'Asset' ? BalanceSheetSide.Asset : BalanceSheetSide.Liability,
    productType: input.productType,
    label: product.label,
    currency: input.currency ?? Currency.GBP,
    balance: input.balance,
    interestRate: input.interestRate,
    maturityBucket: input.maturityBucket,
    liquidityTag: config.liquidityTags[input.productType],
    encumbrance: { encumberedAmount: input.encumberedAmount ?? 0 },
    security: classification
      ? {
          classification,
          effectiveDurationYears:
            securitiesAccounting?.effectiveDurationYearsByProduct?.[input.productType] ?? 0,
          valuationReferenceYield: 0,
        }
      : undefined,
  };
};
