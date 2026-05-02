import { BankState } from '../../domain/bankState';
import { SimulationConfig } from '../../domain/config';

export interface CalibrationEnvelope {
  cet1Ratio: [number, number];
  lcr: [number, number];
  nsfr: [number, number];
  roe: [number, number];
}

export interface CalibrationPack {
  id: string;
  name: string;
  description: string;
  config: SimulationConfig;
  initialState: BankState;
  envelope: CalibrationEnvelope;
}
