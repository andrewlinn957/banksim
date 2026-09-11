import { describe, expect, it } from 'vitest';
import { LcrContribution, LcrModel } from '../domain/lcr';
import { calculateLcr, calculateLcrNetOutflow } from './lcrEngine';

const hqla = (
  level: 'level1' | 'level2a' | 'level2b',
  weighted: number,
  id = level
): LcrContribution => ({
  template: 'C72',
  corep: `C72 ${id}`,
  label: id,
  sourceLabel: id,
  amount: weighted,
  factor: 1,
  weighted,
  hqlaLevel: level,
});

const outflow = (weighted: number, id = 'outflow'): LcrContribution => ({
  template: 'C73',
  corep: `C73 ${id}`,
  label: id,
  sourceLabel: id,
  amount: weighted,
  factor: 1,
  weighted,
});

const inflow = (
  weighted: number,
  capClass: '75' | '90' | 'exempt',
  id = capClass
): LcrContribution => ({
  template: 'C74',
  corep: `C74 ${id}`,
  label: id,
  sourceLabel: id,
  amount: weighted,
  factor: 1,
  weighted,
  capClass,
});

const model = (overrides: Partial<LcrModel> = {}): LcrModel => ({
  liquidAssets: [],
  outflows: [],
  inflows: [],
  hqlaAdjustments: [],
  ...overrides,
});

describe('standalone LCR engine', () => {
  it('calculates the LCR without any BankState or balance-sheet input', () => {
    const result = calculateLcr(model({
      liquidAssets: [hqla('level1', 100)],
      outflows: [outflow(80)],
      inflows: [inflow(100, '75')],
    }));

    expect(result.c76.liquidityBuffer).toBe(100);
    expect(result.c76.totalOutflows).toBe(80);
    expect(result.c76.reduction75).toBe(60);
    expect(result.c76.netLiquidityOutflow).toBe(20);
    expect(result.c76.lcr).toBe(5);
  });

  it('keeps fully exempt, 90%-cap and 75%-cap inflows as separate populations', () => {
    const result = calculateLcrNetOutflow(100, [
      { capClass: 'exempt', amount: 10 },
      { capClass: '90', amount: 100 },
      { capClass: '75', amount: 100 },
    ]);

    expect(result.reductionFullyExempt).toBe(10);
    expect(result.reduction90).toBe(81);
    expect(result.reduction75).toBe(0);
    expect(result.netLiquidityOutflow).toBe(9);
  });

  it('applies the 40% Level 2 and 15% Level 2B composition limits centrally', () => {
    const level2 = calculateLcr(model({
      liquidAssets: [hqla('level1', 60), hqla('level2a', 100)],
    }));
    expect(level2.c76.excessLiquidAssets).toBeCloseTo(60);
    expect(level2.c76.liquidityBuffer).toBeCloseTo(100);

    const level2b = calculateLcr(model({
      liquidAssets: [hqla('level1', 85), hqla('level2b', 100)],
    }));
    expect(level2b.c76.excessLiquidAssets).toBeCloseTo(85);
    expect(level2b.c76.liquidityBuffer).toBeCloseTo(100);
  });

  it('models secured-funding and collateral-swap effects as C76 HQLA adjustments', () => {
    const result = calculateLcr(model({
      liquidAssets: [hqla('level1', 97)],
      hqlaAdjustments: [
        {
          id: 'collateral-return',
          label: 'Collateral return',
          level: 'level1',
          kind: 'collateral',
          direction: 'inflow',
          amount: 100,
        },
        {
          id: 'cash-repayment',
          label: 'Cash repayment',
          level: 'level1',
          kind: 'securedCash',
          direction: 'outflow',
          amount: 97,
        },
      ],
    }));

    expect(result.c76.unadjustedLevel1).toBe(97);
    expect(result.c76.adjustedLevel1).toBe(100);
    expect(result.c76.liquidityBuffer).toBe(97);
    expect(result.c76.adjustmentsByLevel.level1.collateralInflows).toBe(100);
    expect(result.c76.adjustmentsByLevel.level1.securedCashOutflows).toBe(97);
  });

  it('can accept multiple independent cash-flow/netting-set lines without changing the engine', () => {
    const result = calculateLcr(model({
      liquidAssets: [hqla('level1', 100)],
      outflows: [outflow(20, 'set-a'), outflow(30, 'set-b')],
      inflows: [inflow(10, '75', 'set-c'), inflow(5, 'exempt', 'set-d')],
    }));

    expect(result.c76.totalOutflows).toBe(50);
    expect(result.c76.fullyExemptInflows).toBe(5);
    expect(result.c76.inflows75).toBe(10);
    expect(result.c76.netLiquidityOutflow).toBe(35);
  });

  it('returns an infinite ratio where there is no net liquidity outflow', () => {
    const result = calculateLcr(model({ liquidAssets: [hqla('level1', 10)] }));
    expect(result.c76.netLiquidityOutflow).toBe(0);
    expect(result.c76.lcr).toBe(Infinity);
  });
});
