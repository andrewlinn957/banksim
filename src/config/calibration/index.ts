import { CalibrationPack } from './types';
import { createRetailHeavyCalibration } from './retailHeavy';
import { createUniversalCalibration } from './universal';
import { createChallengerCalibration } from './challenger';
import { createExploitCarryCalibration } from './exploitCarry';

export const calibrationPacks: CalibrationPack[] = [
  createRetailHeavyCalibration(),
  createUniversalCalibration(),
  createChallengerCalibration(),
  createExploitCarryCalibration(),
];

export type { CalibrationPack } from './types';
