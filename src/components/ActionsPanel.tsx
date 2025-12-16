import { ChangeEvent } from 'react';

export interface ActionFormState {
  retailDepositRate: string;
  corporateDepositRate: string;
  mortgageRate: string;
  corporateLoanRate: string;
  issueLTDebtAmount: string;
  issueEquityAmount: string;
}

interface Props {
  state: ActionFormState;
  onChange: (next: ActionFormState) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

const ActionsPanel = ({ state, onChange, onSubmit, disabled }: Props) => {
  const handleChange = (field: keyof ActionFormState) => (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...state, [field]: e.target.value });
  };

  return (
    <div className="stack">
      <div className="muted">Enter decimal rates (e.g. 0.025 for 2.5%). Amounts in GBP.</div>
      {disabled && (
        <div className="alert danger">
          Scenario ended due to failure. Actions are disabled.
        </div>
      )}
      <div className="form-row">
        <LabeledInput
          label="Retail deposit rate"
          value={state.retailDepositRate}
          onChange={handleChange('retailDepositRate')}
          placeholder="0.020"
          disabled={disabled}
        />
        <LabeledInput
          label="Corporate deposit rate"
          value={state.corporateDepositRate}
          onChange={handleChange('corporateDepositRate')}
          placeholder="0.030"
          disabled={disabled}
        />
        <LabeledInput
          label="Mortgage rate"
          value={state.mortgageRate}
          onChange={handleChange('mortgageRate')}
          placeholder="0.055"
          disabled={disabled}
        />
        <LabeledInput
          label="Corporate loan rate"
          value={state.corporateLoanRate}
          onChange={handleChange('corporateLoanRate')}
          placeholder="0.065"
          disabled={disabled}
        />
        <LabeledInput
          label="Issue long-term wholesale debt (GBP)"
          value={state.issueLTDebtAmount}
          onChange={handleChange('issueLTDebtAmount')}
          placeholder="1000000000"
          disabled={disabled}
        />
        <LabeledInput
          label="Issue equity (GBP)"
          value={state.issueEquityAmount}
          onChange={handleChange('issueEquityAmount')}
          placeholder="500000000"
          disabled={disabled}
        />
      </div>
      <button className="button primary" onClick={onSubmit} disabled={disabled}>
        Run next month
      </button>
    </div>
  );
};

const LabeledInput = ({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
}) => (
  <label className="field">
    <span>{label}</span>
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="decimal"
    />
  </label>
);

export default ActionsPanel;
