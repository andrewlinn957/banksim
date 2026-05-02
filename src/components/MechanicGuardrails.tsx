import { PreRunGuardrail } from '../content/guardrails';
import HelpLink from './HelpLink';
import WarningBanner from './WarningBanner';

interface Props {
  guardrails: PreRunGuardrail[];
  onNavigateHelp?: (sectionId: string) => void;
}

const MechanicGuardrails = ({ guardrails, onNavigateHelp }: Props) => {
  if (guardrails.length === 0) return null;

  return (
    <div className="card stack">
      <div className="eyebrow">Pre-run guardrails</div>
      {guardrails.map((guardrail) => (
        <WarningBanner key={guardrail.id} title={guardrail.title} severity={guardrail.severity}>
          <div>{guardrail.reason}</div>
          <div style={{ marginTop: 4 }}>
            <strong>Mitigation:</strong> {guardrail.mitigation}
          </div>
          {onNavigateHelp ? (
            <div className="guardrail-actions">
              <HelpLink
                label="Open mechanic"
                sectionId={guardrail.helpSectionId}
                onNavigate={onNavigateHelp}
              />
            </div>
          ) : null}
        </WarningBanner>
      ))}
    </div>
  );
};

export default MechanicGuardrails;
