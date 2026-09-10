// Public simulation entrypoint. The large core engine is preserved byte-for-byte in simulationCore.ts;
// passive treasury lifecycle mechanics are composed around it rather than inserted into management logic.
export * from './simulationCore';
export { createSimulationEngineWithTreasuryLifecycle as createSimulationEngine } from './simulationFacade';
