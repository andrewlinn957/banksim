import { cloneBankState } from './clone';
import {
  computeMetrics,
  createSimulationEngine as createCoreSimulationEngine,
  type SimulationEngine,
  type SimulationStepInput,
  type SimulationStepOutput,
} from './simulation';
import { advancePassiveGiltLifecycle, syncReserveRemuneration } from './treasuryLifecycle';

const lcrShockMultiplier = (input: SimulationStepInput): number =>
  input.shocks.reduce(
    (multiplier, shock) =>
      shock.type === 'idiosyncraticRun'
        ? multiplier * Math.max(0, shock.outflowRateMultiplier)
        : multiplier,
    1
  );

/**
 * Thin lifecycle wrapper around the core simulation step.
 *
 * It deliberately does not make treasury decisions. It only applies contractual/passive mechanics
 * that should occur even when the player chooses to do nothing:
 * - the BoE reserve account reprices to Bank Rate;
 * - existing gilt vintages age and mature into reserves;
 * - explicit gilt trades update the contractual ladder at the selected point on the gilt curve.
 */
export const createSimulationEngineWithTreasuryLifecycle = (): SimulationEngine => {
  const core = createCoreSimulationEngine();

  const step = (input: SimulationStepInput): SimulationStepOutput => {
    const openingState = cloneBankState(input.state);
    // Current-period reserve income uses the Bank Rate prevailing at the start of the period.
    syncReserveRemuneration(openingState);

    const output = core.step({ ...input, state: openingState });
    const dtMonths = Math.max(1, Math.round(openingState.time.stepLengthMonths));
    const lifecycle = advancePassiveGiltLifecycle({
      openingState,
      closingState: output.nextState,
      config: input.config,
      actions: input.actions,
      events: output.events,
      dtMonths,
    });

    if (lifecycle.maturedCarryingValue > 0) {
      // Maturity swaps one Level-1 liquid asset for another, but it can affect leverage exposure
      // because central-bank reserves receive different leverage treatment from gilts.
      computeMetrics(
        output.nextState,
        input.config,
        lcrShockMultiplier(input),
        output.events,
        false,
        false
      );
    }

    // The market model advances at the end of the core step. Store the new Bank Rate on the reserve
    // line so the displayed position and the next period both reflect the floating-rate asset.
    syncReserveRemuneration(output.nextState);

    return output;
  };

  return { step };
};
