interface Props {
  label?: string;
  sectionId: string;
  onNavigate: (sectionId: string) => void;
}

const HelpLink = ({ label = 'Open help', sectionId, onNavigate }: Props) => (
  <button
    type="button"
    className="button ghost small help-link"
    aria-label={label}
    title={label}
    onClick={() => onNavigate(sectionId)}
  >
    <span className="help-link-icon" aria-hidden="true">
      H
    </span>
  </button>
);

export default HelpLink;
