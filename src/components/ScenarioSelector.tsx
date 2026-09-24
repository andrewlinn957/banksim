import { Scenario } from '../config/scenarios';
import { scenarioArtwork } from './scenarioArtwork';

interface Props {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const ScenarioSelector = ({ scenarios, selectedId, onSelect }: Props) => (
  <div className="scenario-choices" role="group" aria-label="Choose a scenario">
    {scenarios.map((scenario) => (
      <button
        key={scenario.id}
        type="button"
        className={`scenario-choice${selectedId === scenario.id ? ' selected' : ''}`}
        aria-pressed={selectedId === scenario.id}
        onClick={() => onSelect(scenario.id)}
      >
        {scenarioArtwork[scenario.id]&&<img src={scenarioArtwork[scenario.id]} alt="" loading="lazy" decoding="async" />}
        <span className="scenario-choice-copy">
          <strong>{scenario.name}</strong>
          <small>{scenario.description}</small>
        </span>
        <span className="scenario-choice-mark" aria-hidden="true">↗</span>
      </button>
    ))}
  </div>
);

export default ScenarioSelector;
