import { describe, expect, it } from 'vitest';
import { LCR_PRODUCT_RULES } from '../products/lcr';
import { PRODUCTS } from '../products/catalogue';

describe('COR011 product coverage', () => {
  it('requires an LCR mapping whenever a new typed product is added', () => {
    expect(Object.keys(LCR_PRODUCT_RULES).sort()).toEqual(Object.keys(PRODUCTS).sort());
  });
});
