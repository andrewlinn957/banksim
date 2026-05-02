import { AttributionLineSelection } from '../domain/attribution';
import { getAttributionMechanicExplanation } from '../content/attributionExplainers';
import { formatSignedPct } from '../utils/formatters';
import HelpLink from './HelpLink';

interface Props {
  selection: AttributionLineSelection;
  onNavigateHelp?: (sectionId: string) => void;
}

const AttributionMechanicExplainer = ({ selection, onNavigateHelp }: Props) => {
  const explanation = getAttributionMechanicExplanation(selection);
  const impactClass =
    selection.effect > 0 ? 'positive' : selection.effect < 0 ? 'negative' : '';

  return (
    <div className="card stack attribution-explainer">
      <div className="eyebrow">Mechanic explainer</div>
      <h3>
        {selection.metricLabel}: {selection.lineLabel}
      </h3>
      <div className={`pill ${impactClass}`}>Impact {formatSignedPct(selection.effect)}</div>
      <div className="attribution-explainer-grid">
        <div>
          <div className="muted">Mechanism path</div>
          <div>{explanation.mechanismPath}</div>
        </div>
        <div>
          <div className="muted">Why this moved</div>
          <div>{explanation.whyItMoved}</div>
        </div>
        <div>
          <div className="muted">Mitigation lever</div>
          <div>{explanation.mitigation}</div>
        </div>
      </div>
      <div className="metric-help-actions">
        <span className="muted">
          Linked events: {selection.eventIds.length}
        </span>
        {onNavigateHelp ? (
          <HelpLink
            label="Open mechanic"
            sectionId={explanation.helpSectionId}
            onNavigate={onNavigateHelp}
          />
        ) : null}
      </div>
    </div>
  );
};

export default AttributionMechanicExplainer;
