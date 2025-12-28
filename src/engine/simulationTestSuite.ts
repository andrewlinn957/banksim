import { baseConfig } from '../config/baseConfig';
import { initialState } from '../config/initialState';
import { PlayerAction } from '../domain/actions';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType, LiabilityProductType, ProductType } from '../domain/enums';
import { Shock } from '../domain/shocks';
import { cloneBankState } from './clone';
import { checkInvariants } from './invariants';
import { createSimulationEngine, SimulationEngine } from './simulation';

export interface SimulationTestResult {
  id: string;
  name: string;
  group: string;
  passed: boolean;
  detail: string;
}

export interface SimulationTestContext {
  engine: SimulationEngine;
  config: SimulationConfig;
  createState: () => BankState;
}

export interface SimulationTestCase {
  id: string;
  name: string;
  group: string;
  run: (ctx: SimulationTestContext) => string;
}

export interface RunSimulationTestSuiteOptions {
  engine?: SimulationEngine;
  config?: SimulationConfig;
  createState?: () => BankState;
  filter?: (testCase: SimulationTestCase) => boolean;
}

export const createSimulationTestContext = (options: RunSimulationTestSuiteOptions = {}): SimulationTestContext => ({
  engine: options.engine ?? createSimulationEngine(),
  config: options.config ?? baseConfig,
  createState: options.createState ?? (() => cloneBankState(initialState)),
});

const formatBn = (value: number) => `${(value / 1e9).toFixed(2)}bn`;
const formatPct = (value: number) => `${(value * 100).toFixed(2)}%`;

const getItem = (state: BankState, productType: ProductType) => {
  const item = state.financial.balanceSheet.items.find((i) => i.productType === productType);
  if (!item) {
    throw new Error(`Missing balance sheet line for ${productType}`);
  }
  return item;
};

const getBalance = (state: BankState, productType: ProductType): number => getItem(state, productType).balance;

const step = (
  ctx: SimulationTestContext,
  state: BankState,
  actions: PlayerAction[] = [],
  shocks: Shock[] = []
): BankState =>
  ctx.engine.step({
    state,
    config: ctx.config,
    actions,
    shocks,
  }).nextState;

const assertAccountingOk = (state: BankState, label: string): void => {
  const errs = checkInvariants(state);
  if (errs.length > 0) {
    throw new Error(`Invariant violations (${label}): ${errs.join('; ')}`);
  }
  const CF_TOLERANCE = 1e-3;
  const cf = state.financial.cashFlowStatement;
  const rollMismatch = cf.cashStart + cf.netChange - cf.cashEnd;
  if (Math.abs(rollMismatch) > CF_TOLERANCE) {
    throw new Error(
      `Cash rollforward mismatch (${label}): start ${cf.cashStart.toFixed(2)} + net change ${cf.netChange.toFixed(
        2
      )} != end ${cf.cashEnd.toFixed(2)} (diff ${rollMismatch.toFixed(6)})`
    );
  }
  const componentsMismatch = cf.operatingCashFlow + cf.investingCashFlow + cf.financingCashFlow - cf.netChange;
  if (Math.abs(componentsMismatch) > CF_TOLERANCE) {
    throw new Error(
      `Cash flow statement mismatch (${label}): operating ${cf.operatingCashFlow.toFixed(
        2
      )} + investing ${cf.investingCashFlow.toFixed(2)} + financing ${cf.financingCashFlow.toFixed(
        2
      )} != net change ${cf.netChange.toFixed(2)} (diff ${componentsMismatch.toFixed(6)})`
    );
  }
};

export const simulationTestCases: SimulationTestCase[] = [
  {
    id: 'retail-rate-advantage',
    group: 'Simulation engine',
    name: 'increasing retail deposit rate above competitor increases retail balances vs equal rate',
    run: (ctx) => {
      const stateEqual = ctx.createState();
      getItem(stateEqual, LiabilityProductType.RetailDeposits).interestRate =
        stateEqual.market.competitorRetailDepositRate;
      const baseline = step(ctx, stateEqual);
      assertAccountingOk(baseline, 'baseline');

      const stateAdvantage = ctx.createState();
      const advantaged = step(ctx, stateAdvantage, [
        {
          type: 'adjustRate',
          productType: LiabilityProductType.RetailDeposits,
          newRate: stateAdvantage.market.competitorRetailDepositRate + 0.01,
        },
      ]);
      assertAccountingOk(advantaged, 'advantaged');

      const baselineRetail = getBalance(baseline, LiabilityProductType.RetailDeposits);
      const advantagedRetail = getBalance(advantaged, LiabilityProductType.RetailDeposits);
      if (advantagedRetail <= baselineRetail) {
        throw new Error(
          `Retail balances did not improve with higher rate (${formatBn(advantagedRetail)} <= ${formatBn(
            baselineRetail
          )})`
        );
      }

      return `Retail deposits baseline ${formatBn(baselineRetail)} vs advantaged ${formatBn(advantagedRetail)}`;
    },
  },
  {
    id: 'sell-gilts-lower-lcr',
    group: 'Simulation engine',
    name: 'selling gilts increases cash but leaves HQLA/LCR roughly unchanged (cash is also HQLA)',
    run: (ctx) => {
      const base = step(ctx, ctx.createState());
      assertAccountingOk(base, 'baseline');

      const afterSale = step(ctx, ctx.createState(), [
        {
          type: 'buySellAsset',
          productType: AssetProductType.Gilts,
          amountDelta: -10e9,
        },
      ]);
      assertAccountingOk(afterSale, 'after sale');

      const baseCash = getBalance(base, AssetProductType.CashReserves);
      const saleCash = getBalance(afterSale, AssetProductType.CashReserves);
      if (saleCash <= baseCash) {
        throw new Error(`Cash did not rise after selling gilts (${formatBn(saleCash)} <= ${formatBn(baseCash)})`);
      }

      const hqlaDiff = Math.abs(afterSale.risk.riskMetrics.hqla - base.risk.riskMetrics.hqla);
      const lcrDiff = Math.abs(afterSale.risk.riskMetrics.lcr - base.risk.riskMetrics.lcr);
      const hqlaTol = Math.max(base.risk.riskMetrics.hqla * 0.001, 1e6); // 0.1% or >= 1m tolerance for rounding
      const lcrTol = 1e-4;

      if (hqlaDiff > hqlaTol) {
        throw new Error(
          `HQLA changed after selling gilts (${formatBn(afterSale.risk.riskMetrics.hqla)} vs ${formatBn(base.risk.riskMetrics.hqla)})`
        );
      }
      if (lcrDiff > lcrTol) {
        throw new Error(
          `LCR moved after selling gilts (${formatPct(afterSale.risk.riskMetrics.lcr)} vs ${formatPct(base.risk.riskMetrics.lcr)})`
        );
      }

      return `Cash ${formatBn(baseCash)} -> ${formatBn(saleCash)}, HQLA unchanged ${formatBn(
        base.risk.riskMetrics.hqla
      )}, LCR ${formatPct(base.risk.riskMetrics.lcr)}`;
    },
  },
  {
    id: 'macro-downturn-capital-hit',
    group: 'Simulation engine',
    name: 'macro downturn shock with high PD/LGD multipliers reduces CET1 and CET1 ratio',
    run: (ctx) => {
      const baseline = step(ctx, ctx.createState());
      assertAccountingOk(baseline, 'baseline');

      const stressed = step(
        ctx,
        ctx.createState(),
        [],
        [
          {
            type: 'macroDownturn',
            pdMultiplier: 3,
            lgdMultiplier: 2,
          },
        ]
      );
      assertAccountingOk(stressed, 'stressed');

      if (stressed.financial.capital.cet1 >= baseline.financial.capital.cet1) {
        throw new Error(
          `CET1 did not fall under downturn (${formatBn(stressed.financial.capital.cet1)} >= ${formatBn(
            baseline.financial.capital.cet1
          )})`
        );
      }
      if (stressed.risk.riskMetrics.cet1Ratio >= baseline.risk.riskMetrics.cet1Ratio) {
        throw new Error(
          `CET1 ratio did not fall (${formatPct(stressed.risk.riskMetrics.cet1Ratio)} >= ${formatPct(
            baseline.risk.riskMetrics.cet1Ratio
          )})`
        );
      }

      return `CET1 ${formatBn(baseline.financial.capital.cet1)} -> ${formatBn(
        stressed.financial.capital.cet1
      )}, ratio ${formatPct(baseline.risk.riskMetrics.cet1Ratio)} -> ${formatPct(stressed.risk.riskMetrics.cet1Ratio)}`;
    },
  },
  {
    id: 'random-rate-tweaks-balanced',
    group: 'Targeted invariants and behaviours',
    name: 'balance sheet stays balanced after 30 random rate tweaks',
    run: (ctx) => {
      let state = ctx.createState();
      const actions: PlayerAction[] = [];

      let seed = 42;
      const rand = () => {
        seed = (seed * 48271) % 0x7fffffff;
        return seed / 0x7fffffff;
      };

      const wiggle = 0.001; // tighter noise band to keep scenarios stable
      const iterations = 30;

      for (let stepNumber = 0; stepNumber < iterations; stepNumber++) {
        actions.length = 0;
        actions.push({
          type: 'adjustRate',
          productType: LiabilityProductType.RetailDeposits,
          newRate: state.market.competitorRetailDepositRate + (rand() - 0.5) * wiggle,
        });
        actions.push({
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: getItem(state, AssetProductType.Mortgages).interestRate + (rand() - 0.5) * wiggle,
        });

        const nextState = step(ctx, state, actions);
        assertAccountingOk(nextState, `step ${stepNumber + 1}`);
        state = nextState;
      }

      return `${iterations} random rate iterations kept invariants satisfied`;
    },
  },
  {
    id: 'wholesale-funding-lowers-liquidity',
    group: 'Targeted invariants and behaviours',
    name: 'raising ST wholesale funding and buying mortgages reduces LCR and NSFR',
    run: (ctx) => {
      const baseline = step(ctx, ctx.createState());
      assertAccountingOk(baseline, 'baseline');

      const stressed = step(ctx, ctx.createState(), [
        { type: 'issueDebt', productType: LiabilityProductType.WholesaleFundingST, amount: 20e9, rate: 0.055 },
        { type: 'buySellAsset', productType: AssetProductType.Mortgages, amountDelta: 20e9 },
      ]);
      assertAccountingOk(stressed, 'stressed');

      if (
        stressed.risk.riskMetrics.lcr >= baseline.risk.riskMetrics.lcr ||
        stressed.risk.riskMetrics.nsfr >= baseline.risk.riskMetrics.nsfr
      ) {
        throw new Error(
          `Liquidity ratios not lower (LCR ${formatPct(stressed.risk.riskMetrics.lcr)} vs ${formatPct(
            baseline.risk.riskMetrics.lcr
          )}, NSFR ${formatPct(stressed.risk.riskMetrics.nsfr)} vs ${formatPct(baseline.risk.riskMetrics.nsfr)})`
        );
      }

      return `LCR ${formatPct(baseline.risk.riskMetrics.lcr)} -> ${formatPct(
        stressed.risk.riskMetrics.lcr
      )}, NSFR ${formatPct(baseline.risk.riskMetrics.nsfr)} -> ${formatPct(stressed.risk.riskMetrics.nsfr)}`;
    },
  },
  {
    id: 'mortgage-rate-elasticity',
    group: 'Targeted invariants and behaviours',
    name: 'raising mortgage rate 100bps above reference reduces mortgage volume vs baseline',
    run: (ctx) => {
      const baselineState = ctx.createState();
      const baseline = step(ctx, baselineState, [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: baselineState.market.competitorMortgageRate,
        },
      ]);
      assertAccountingOk(baseline, 'baseline');

      const adjustedState = ctx.createState();
      const adjusted = step(ctx, adjustedState, [
        {
          type: 'adjustRate',
          productType: AssetProductType.Mortgages,
          newRate: adjustedState.market.competitorMortgageRate + 0.01,
        },
      ]);
      assertAccountingOk(adjusted, 'adjusted');

      const baseMort = getBalance(baseline, AssetProductType.Mortgages);
      const adjMort = getBalance(adjusted, AssetProductType.Mortgages);
      if (adjMort >= baseMort) {
        throw new Error(`Mortgage volume did not fall (${formatBn(adjMort)} >= ${formatBn(baseMort)})`);
      }

      return `Mortgage balance ${formatBn(baseMort)} -> ${formatBn(adjMort)}`;
    },
  },
  {
    id: 'idiosyncratic-run-lcr',
    group: 'Targeted invariants and behaviours',
    name: 'idiosyncratic run reduces deposits and worsens LCR',
    run: (ctx) => {
      const baseline = step(ctx, ctx.createState());
      assertAccountingOk(baseline, 'baseline');

      const runState = step(
        ctx,
        ctx.createState(),
        [],
        [
          {
            type: 'idiosyncraticRun',
            outflowRateMultiplier: 1.5,
          },
        ]
      );
      assertAccountingOk(runState, 'run');

      const baseRetail = getBalance(baseline, LiabilityProductType.RetailDeposits);
      const runRetail = getBalance(runState, LiabilityProductType.RetailDeposits);
      const baseCorp = getBalance(baseline, LiabilityProductType.CorporateDeposits);
      const runCorp = getBalance(runState, LiabilityProductType.CorporateDeposits);

      if (runRetail >= baseRetail || runCorp >= baseCorp) {
        throw new Error(
          `Deposits did not fall in run (retail ${formatBn(runRetail)} vs ${formatBn(
            baseRetail
          )}, corporate ${formatBn(runCorp)} vs ${formatBn(baseCorp)})`
        );
      }
      if (runState.risk.riskMetrics.lcr >= baseline.risk.riskMetrics.lcr) {
        throw new Error(
          `LCR did not worsen (${formatPct(runState.risk.riskMetrics.lcr)} >= ${formatPct(
            baseline.risk.riskMetrics.lcr
          )})`
        );
      }

      return `Retail ${formatBn(baseRetail)} -> ${formatBn(runRetail)}, Corporate ${formatBn(
        baseCorp
      )} -> ${formatBn(runCorp)}, LCR ${formatPct(baseline.risk.riskMetrics.lcr)} -> ${formatPct(
        runState.risk.riskMetrics.lcr
      )}`;
    },
  },
  {
    id: 'repo-borrow-encumbrance',
    group: 'Targeted invariants and behaviours',
    name: 'repo borrow creates repo line, increases cash, and encumbers collateral',
    run: (ctx) => {
      const state = ctx.createState();
      const repoAmount = 5e9;
      const gilts = state.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Gilts);
      if (!gilts) {
        throw new Error('Missing gilts line for repo test');
      }

      const { nextState } = ctx.engine.step({
        state,
        config: ctx.config,
        actions: [
          {
            type: 'enterRepo',
            direction: 'borrow',
            collateralProduct: AssetProductType.Gilts,
            amount: repoAmount,
            rate: 0.03,
          },
        ],
        shocks: [],
      });
      assertAccountingOk(nextState, 'after repo');

      const cashBefore = getBalance(state, AssetProductType.CashReserves);
      const cashAfter = getBalance(nextState, AssetProductType.CashReserves);
      const repoLine = nextState.financial.balanceSheet.items.find(
        (i) => i.productType === LiabilityProductType.RepurchaseAgreements
      );
      const giltsAfter = nextState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Gilts);
      if (!repoLine) {
        throw new Error('Repo liability line missing after trade');
      }
      if (!giltsAfter) {
        throw new Error('Gilts line missing after repo');
      }
      if (cashAfter <= cashBefore) {
        throw new Error(`Cash did not increase (${formatBn(cashAfter)} <= ${formatBn(cashBefore)})`);
      }
      if (repoLine.balance < repoAmount) {
        throw new Error(`Repo line smaller than expected (${formatBn(repoLine.balance)} < ${formatBn(repoAmount)})`);
      }
      if (giltsAfter.encumbrance.encumberedAmount <= gilts.encumbrance.encumberedAmount) {
        throw new Error('Collateral encumbrance did not rise after repo');
      }

      return `Cash ${formatBn(cashBefore)} -> ${formatBn(cashAfter)}, encumbrance ${formatBn(
        gilts.encumbrance.encumberedAmount
      )} -> ${formatBn(giltsAfter.encumbrance.encumberedAmount)}`;
    },
  },
  {
    id: 'counterparty-default-loss',
    group: 'Targeted invariants and behaviours',
    name: 'counterparty default reduces corporate loans roughly by the loss once (no double count)',
    run: (ctx) => {
      const state = ctx.createState();
      const loss = 10e9;
      const shock: Shock = {
        type: 'counterpartyDefault',
        productType: AssetProductType.CorporateLoans,
        lossAmount: loss,
      };

      const baseline = step(ctx, cloneBankState(state));
      assertAccountingOk(baseline, 'baseline');

      const shocked = step(ctx, cloneBankState(state), [], [shock]);
      assertAccountingOk(shocked, 'after default');

      const baseCorp = getBalance(baseline, AssetProductType.CorporateLoans);
      const shockedCorp = getBalance(shocked, AssetProductType.CorporateLoans);
      const incrementalReduction = baseCorp - shockedCorp;
      if (incrementalReduction <= loss * 0.8 || incrementalReduction >= loss * 1.2) {
        throw new Error(
          `Loss recognition out of bounds (${formatBn(incrementalReduction)} vs expected ~${formatBn(loss)})`
        );
      }

      return `Corporate loans incremental reduction ${formatBn(incrementalReduction)} (expected ~${formatBn(loss)})`;
    },
  },
  {
    id: 'baseline-deposit-growth',
    group: 'Targeted invariants and behaviours',
    name: 'baseline deposit growth is positive when matching competitor rates',
    run: (ctx) => {
      const state = ctx.createState();
      const retail = getItem(state, LiabilityProductType.RetailDeposits);
      retail.interestRate = state.market.competitorRetailDepositRate;

      const { nextState } = ctx.engine.step({ state, config: ctx.config, actions: [], shocks: [] });
      assertAccountingOk(nextState, 'after step');

      const retailAfter = getBalance(nextState, LiabilityProductType.RetailDeposits);
      if (retailAfter <= retail.balance) {
        throw new Error(`Deposit growth was not positive (${formatBn(retailAfter)} <= ${formatBn(retail.balance)})`);
      }

      return `Retail deposits ${formatBn(retail.balance)} -> ${formatBn(retailAfter)}`;
    },
  },
];

export const runSimulationTestSuite = (options: RunSimulationTestSuiteOptions = {}): SimulationTestResult[] => {
  const shouldInclude = options.filter ?? (() => true);
  return simulationTestCases.filter(shouldInclude).map((testCase) => {
    const ctx = createSimulationTestContext(options);
    try {
      const detail = testCase.run(ctx);
      return { ...testCase, passed: true, detail };
    } catch (err: any) {
      return {
        ...testCase,
        passed: false,
        detail: err?.message ?? String(err),
      };
    }
  });
};

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe('Simulation test suite metadata', () => {
    it('simulation test ids are unique', () => {
      const ids = new Set<string>();
      const dupes = new Set<string>();
      simulationTestCases.forEach((testCase) => {
        if (ids.has(testCase.id)) dupes.add(testCase.id);
        ids.add(testCase.id);
      });
      expect([...dupes]).toEqual([]);
    });
  });

  const groupedCases = simulationTestCases.reduce<Record<string, SimulationTestCase[]>>((acc, testCase) => {
    if (!acc[testCase.group]) {
      acc[testCase.group] = [];
    }
    acc[testCase.group].push(testCase);
    return acc;
  }, {});

  Object.entries(groupedCases).forEach(([group, cases]) => {
    describe(group, () => {
      cases.forEach((testCase) => {
        it(`${testCase.id}: ${testCase.name}`, () => {
          const ctx = createSimulationTestContext();
          const detail = testCase.run(ctx);
          expect(detail).toBeTypeOf('string');
          expect(detail.length).toBeGreaterThan(0);
        });
      });
    });
  });
}
