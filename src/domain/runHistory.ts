import { PlayerAction } from './actions';
import { BankState } from './bankState';
import { Shock } from './shocks';

export interface RunSnapshot {
  step: number;
  cet1Ratio: number;
  lcr: number;
  nsfr: number;
  roe: number;
  nim: number;
  netIncome: number;
  sharePrice: number;
  marketCap: number;
}

export interface ActionTimelineEntry {
  step: number;
  actions: PlayerAction[];
  shocks: Shock[];
}

export interface RunRecord {
  id: string;
  label: string;
  createdAt: number;
  initialState: BankState;
  finalState: BankState;
  snapshots: RunSnapshot[];
  timeline: ActionTimelineEntry[];
}
