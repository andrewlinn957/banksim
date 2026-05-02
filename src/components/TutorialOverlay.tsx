interface Props {
  visible: boolean;
  stepNumber: number;
  totalSteps: number;
  title: string;
  summary: string;
  instructions: string[];
  ready: boolean;
  readinessHint: string;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
  onPrevious?: () => void;
  onNext: () => void;
  onDismiss: () => void;
  isLastStep?: boolean;
}

const TutorialOverlay = ({
  visible,
  stepNumber,
  totalSteps,
  title,
  summary,
  instructions,
  ready,
  readinessHint,
  primaryActionLabel,
  onPrimaryAction,
  onPrevious,
  onNext,
  onDismiss,
  isLastStep,
}: Props) => {
  if (!visible) return null;

  return (
    <aside className="tutorial-overlay" role="dialog" aria-label="Guided tutorial">
      <div className="tutorial-overlay-header">
        <div>
          <div className="eyebrow">First-run tutorial</div>
          <h3>{title}</h3>
        </div>
        <button type="button" className="button icon" onClick={onDismiss} aria-label="Hide tutorial">
          x
        </button>
      </div>

      <div className="tutorial-progress">
        Step {stepNumber} / {totalSteps}
      </div>

      <p className="muted">{summary}</p>
      <ul className="help-list">
        {instructions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className={`tutorial-ready ${ready ? 'ready' : 'waiting'}`}>
        {ready ? 'Ready to continue.' : readinessHint}
      </div>

      <div className="tutorial-actions">
        {onPrevious ? (
          <button type="button" className="button ghost small" onClick={onPrevious}>
            Back
          </button>
        ) : null}
        {primaryActionLabel && onPrimaryAction ? (
          <button type="button" className="button small" onClick={onPrimaryAction}>
            {primaryActionLabel}
          </button>
        ) : null}
        <button type="button" className="button primary small" onClick={onNext} disabled={!ready}>
          {isLastStep ? 'Finish tutorial' : 'Next'}
        </button>
      </div>
    </aside>
  );
};

export default TutorialOverlay;
