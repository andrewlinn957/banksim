import { useCallback, useState } from 'react';
import { PlayerAction } from '../domain/actions';
import { BankState } from '../domain/bankState';
import { ActionTimelineEntry, RunRecord, RunSnapshot } from '../domain/runHistory';
import { Shock } from '../domain/shocks';
import { SimulationController } from './simulationController';

interface SaveRunArgs {
  scenarioId: string | null;
  initialState: BankState;
  finalState: BankState;
}

export const useRunSession = (controller: SimulationController, initialState: BankState) => {
  const [savedRuns, setSavedRuns] = useState<RunRecord[]>([]);
  const [currentTimeline, setCurrentTimeline] = useState<ActionTimelineEntry[]>([]);
  const [currentSnapshots, setCurrentSnapshots] = useState<RunSnapshot[]>([
    controller.createSnapshot(initialState),
  ]);
  const [runCounter, setRunCounter] = useState(1);

  const appendStep = useCallback((nextState: BankState, actions: PlayerAction[], shocks: Shock[]) => {
    setCurrentTimeline((previous) => [
      ...previous,
      {
        step: nextState.time.step,
        actions: actions.map((action) => ({ ...action })),
        shocks: shocks.map((shock) => ({ ...shock })),
      },
    ]);
    setCurrentSnapshots((previous) => [...previous, controller.createSnapshot(nextState)]);
  }, [controller]);

  const reset = useCallback((state: BankState) => {
    setCurrentTimeline([]);
    setCurrentSnapshots([controller.createSnapshot(state)]);
  }, [controller]);

  const saveCurrent = useCallback(({ scenarioId, initialState: runInitialState, finalState }: SaveRunArgs): RunRecord | null => {
    if (currentTimeline.length === 0 || currentSnapshots.length === 0) return null;
    const record = controller.toRunRecord({
      id: `run-${Date.now()}`,
      label: `${scenarioId ?? 'sandbox'} run ${runCounter}`,
      initialState: runInitialState,
      finalState,
      timeline: currentTimeline,
      snapshots: currentSnapshots,
    });
    setSavedRuns((previous) => [record, ...previous]);
    setRunCounter((previous) => previous + 1);
    return record;
  }, [controller, currentSnapshots, currentTimeline, runCounter]);

  return {
    savedRuns,
    currentTimeline,
    currentSnapshots,
    appendStep,
    reset,
    saveCurrent,
  };
};
