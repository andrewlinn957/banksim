// Public simulation entrypoint. The large core engine is kept separate so passive treasury
// lifecycle mechanics can be composed around it without entangling contractual cashflows with
// management decision logic.
export * from './simulationCore';
export { createSimulationEngineWithTreasuryLifecycle as createSimulationEngine } from './simulationFacade';
