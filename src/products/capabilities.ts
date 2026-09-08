import {
  ASSET_PRODUCTS,
  LIABILITY_PRODUCTS,
  PRODUCTS,
  ProductCapabilities,
  ProductDefinition,
  ProductType,
} from './catalogue';

export type ProductCapability = keyof ProductCapabilities;

type CatalogueProduct =
  | (typeof ASSET_PRODUCTS)[keyof typeof ASSET_PRODUCTS]
  | (typeof LIABILITY_PRODUCTS)[keyof typeof LIABILITY_PRODUCTS];

export type ProductWithCapability<C extends ProductCapability> =
  CatalogueProduct extends infer P
    ? P extends { productType: infer T extends ProductType; capabilities: Record<C, unknown> }
      ? T
      : never
    : never;

export type CustomerDepositProductType = ProductWithCapability<'customerDeposit'>;
export type LoanProductType = ProductWithCapability<'loan'>;
export type WholesaleFundingProductType = ProductWithCapability<'wholesaleFunding'>;

export const getCapability = <C extends ProductCapability>(
  productType: ProductType,
  capability: C
): ProductCapabilities[C] | undefined => PRODUCTS[productType].capabilities[capability];

export const hasCapability = <C extends ProductCapability>(
  productType: ProductType,
  capability: C
): productType is ProductWithCapability<C> => getCapability(productType, capability) !== undefined;

export const productsWithCapability = <C extends ProductCapability>(
  capability: C
): ProductDefinition<ProductWithCapability<C>>[] =>
  Object.values(PRODUCTS).filter(product => product.capabilities[capability] !== undefined) as ProductDefinition<
    ProductWithCapability<C>
  >[];

export const productTypesWithCapability = <C extends ProductCapability>(
  capability: C
): ProductWithCapability<C>[] => productsWithCapability(capability).map(product => product.productType);
