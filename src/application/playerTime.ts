export type PlayerAdvanceTarget = 'month' | 'quarter' | 'year' | 'continuous';

export interface SafetyPauseControlState {
  enabled: boolean;
  disableArmed: boolean;
  automaticRunActive: boolean;
}

export interface SafetyPauseToggleResult extends SafetyPauseControlState {
  stopAutomaticRun: boolean;
  message: string;
}

/** Preserve the GUI's confirmation and pause semantics for disabling automatic safety pauses. */
export const applySafetyPauseToggle = (
  state: SafetyPauseControlState,
  requestedEnabled: boolean,
): SafetyPauseToggleResult => {
  if (requestedEnabled) {
    return {
      enabled: true,
      disableArmed: false,
      automaticRunActive: state.automaticRunActive,
      stopAutomaticRun: false,
      message: 'Safety pauses are on. Automatic running will stop when buffers need attention.',
    };
  }
  if (state.automaticRunActive) {
    return {
      enabled: state.enabled,
      disableArmed: true,
      automaticRunActive: false,
      stopAutomaticRun: true,
      message: 'Simulation paused before changing a safety control. Safety pauses remain ON; toggle again to confirm disabling them.',
    };
  }
  if (!state.disableArmed) {
    return {
      enabled: state.enabled,
      disableArmed: true,
      automaticRunActive: false,
      stopAutomaticRun: false,
      message: 'Safety pauses remain ON. Toggle again to confirm that automatic running may continue while buffers need attention.',
    };
  }
  return {
    enabled: false,
    disableArmed: false,
    automaticRunActive: false,
    stopAutomaticRun: false,
    message: 'Safety pauses are OFF. Automatic running may continue while capital or liquidity buffers need attention.',
  };
};

/** GUI and API share the same elapsed-month boundary calculation. */
export const monthsForPlayerAdvance = (
  openingStep: number,
  currentStep: number,
  target: Exclude<PlayerAdvanceTarget, 'continuous'>,
): number => {
  if (target === 'month') return 1;
  const interval = target === 'quarter' ? 3 : 12;
  const elapsed = Math.max(0, currentStep - openingStep);
  return interval - (elapsed % interval);
};

/** A continuous request is deliberately chunked by the caller so durable services can checkpoint. */
export const boundedContinuousAdvance = (requestedMonths: number, maximumMonths: number): number => {
  if (!Number.isInteger(requestedMonths) || requestedMonths < 1) throw new Error('requestedMonths must be a positive integer');
  if (!Number.isInteger(maximumMonths) || maximumMonths < 1) throw new Error('maximumMonths must be a positive integer');
  return Math.min(requestedMonths, maximumMonths);
};
