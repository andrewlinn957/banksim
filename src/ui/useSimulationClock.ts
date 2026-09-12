import { useCallback, useEffect, useRef, useState } from 'react';
import { BankState } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { clockAfterStep } from '../game/management';

interface UseSimulationClockArgs {
  canRun: boolean;
  onTick: () => void;
}

export const useSimulationClock = ({ canRun, onTick }: UseSimulationClockArgs) => {
  const [autoRemaining, setAutoRemaining] = useState<number | null>(null);
  const [clockSpeed, setClockSpeed] = useState(1500);
  const [pauseReason, setPauseReason] = useState('Ready. Set your policy, then run a quarter.');
  const [safetyPause, setSafetyPause] = useState(true);
  // Continuous mode uses Infinity for the remaining period. Because Infinity - 1 is still
  // Infinity, this sequence explicitly re-arms the timer after every automatic close.
  const [tickSequence, setTickSequence] = useState(0);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const clockRunning = autoRemaining !== null;

  const start = useCallback((months: number) => {
    if (!canRun) return;
    setPauseReason('');
    setAutoRemaining(months);
    setTickSequence((sequence) => sequence + 1);
  }, [canRun]);

  const stop = useCallback((reason?: string) => {
    setAutoRemaining(null);
    if (reason !== undefined) setPauseReason(reason);
  }, []);

  const pause = useCallback(() => {
    stop('Paused. Your policies remain in force.');
  }, [stop]);

  const afterAutomaticStep = useCallback((state: BankState, config: SimulationConfig) => {
    setAutoRemaining((remaining) => {
      const next = clockAfterStep(remaining, state, config, safetyPause);
      setPauseReason(next.reason);
      return next.remaining;
    });
    setTickSequence((sequence) => sequence + 1);
  }, [safetyPause]);

  const afterManualStep = useCallback(() => {
    setAutoRemaining(null);
    setPauseReason('Month closed. Review the position or continue your strategy.');
  }, []);

  const reset = useCallback((reason = 'New bank ready. Set a policy and give it time.') => {
    setAutoRemaining(null);
    setPauseReason(reason);
  }, []);

  useEffect(() => {
    if (!clockRunning || !canRun) return;
    const timer = window.setTimeout(() => onTickRef.current(), clockSpeed);
    return () => window.clearTimeout(timer);
  }, [autoRemaining, canRun, clockRunning, clockSpeed, tickSequence]);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [pause]);

  return {
    autoRemaining,
    clockRunning,
    clockSpeed,
    setClockSpeed,
    pauseReason,
    safetyPause,
    setSafetyPause,
    start,
    stop,
    pause,
    afterAutomaticStep,
    afterManualStep,
    reset,
  };
};
