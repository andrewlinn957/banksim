import { HQLALevel, ProductType } from './enums';

export interface LiquidityTag {
  productType: ProductType;
  hqlaLevel: HQLALevel;
  lcrOutflowRate?: number;
  lcrInflowRate?: number;
  nsfrAsfFactor?: number;
  nsfrRsfFactor?: number;
}

export interface Encumbrance {
  encumberedAmount: number;
}
