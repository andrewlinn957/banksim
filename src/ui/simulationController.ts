import { createSimulationEngine, SimulationStepOutput } from '../engine/simulation';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { PlayerAction } from '../domain/actions';
import { Shock } from '../domain/shocks';

export class SimulationController {
  private engine = createSimulationEngine();
  private config: SimulationConfig;

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  setConfig(config: SimulationConfig) {
    this.config = config;
  }

  step(state: BankState, actions: PlayerAction[], shocks: Shock[]): SimulationStepOutput {
    return this.engine.step({ state, config: this.config, actions, shocks });
  }
}
