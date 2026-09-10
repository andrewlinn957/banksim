from pathlib import Path

path = Path('src/engine/passiveBankCalibration.test.ts')
text = path.read_text()

replacements = {
    "import { createSimulationEngineWithTreasuryLifecycle as createSimulationEngine } from './simulationFacade';":
        "import { createSimulationEngine } from './simulation';",
    "giltBuckets: state.fundingLadders[AssetProductType.Gilts]?.length ?? 0,":
        "giltBuckets: state.assetMaturityLadders?.[AssetProductType.Gilts]?.length ?? 0,",
    "/Gilt principal matured into BoE reserves/":
        "/principal matured into Cash & Reserves/",
}

for old, new in replacements.items():
    if text.count(old) != 1:
        raise RuntimeError(f'Expected one match in passiveBankCalibration.test.ts: {old!r}')
    text = text.replace(old, new, 1)

path.write_text(text)
