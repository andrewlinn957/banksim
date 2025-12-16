import { AssetProductType } from './enums';

export interface DepositCompetitionShock {
  type: 'depositCompetition';
  retailRateIncrease: number;
  corporateRateIncrease?: number;
}

export interface MarketSpreadShock {
  type: 'marketSpreadShock';
  wholesaleSpreadBps: number;
  loanSpreadBps: number;
  repoHaircutIncreasePct: number;
}

export interface IdiosyncraticRunShock {
  type: 'idiosyncraticRun';
  outflowRateMultiplier: number;
}

export interface MacroDownturnShock {
  type: 'macroDownturn';
  pdMultiplier: number;
  lgdMultiplier: number;
}

export interface CounterpartyDefaultShock {
  type: 'counterpartyDefault';
  productType: AssetProductType;
  lossAmount: number;
}

export type Shock =
  | DepositCompetitionShock
  | MarketSpreadShock
  | IdiosyncraticRunShock
  | MacroDownturnShock
  | CounterpartyDefaultShock;
