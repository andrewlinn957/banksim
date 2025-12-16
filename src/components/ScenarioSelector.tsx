import { Scenario } from '../config/scenarios';

interface Props {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStart: () => void;
  description?: string;
}

const ScenarioSelector = ({ scenarios, selectedId, onSelect, onStart, description }: Props) => (
  <div className="card scenario-card">
    <div>
      <div className="eyebrow">Scenario</div>
      <h3>Guide the bank through different worlds</h3>
    </div>
    <div className="form-row" style={{ alignItems: 'flex-end' }}>
      <div className="field">
        <label htmlFor="scenario">Choose a scenario</label>
        <select
          id="scenario"
          value={selectedId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="" disabled>
            Select scenario...
          </option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <button className="button primary" onClick={onStart} disabled={!selectedId}>
        Start scenario
      </button>
    </div>
    {description && <p className="muted">{description}</p>}
  </div>
);

export default ScenarioSelector;
