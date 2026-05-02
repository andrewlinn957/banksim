import { ChangeEvent, ReactNode } from 'react';
import { Recommendation } from '../engine/recommendations';
import HelpLink from './HelpLink';
import InfoTooltip from './InfoTooltip';

export interface ActionFormState {
  retailDepositRate: string;
  corporateDepositRate: string;
  mortgageRate: string;
  corporateLoanRate: string;
  mortgageUnderwritingTightness: string;
  corporateUnderwritingTightness: string;
  issueLTDebtAmount: string;
  issueEquityAmount: string;
  dividendPayoutRatio: string;
  at1CouponMode: 'auto' | 'pay' | 'skip';
  hedgeDirection: 'none' | 'payFixedReceiveFloat' | 'receiveFixedPayFloat';
  hedgeNotional: string;
  hedgeFixedRate: string;
  hedgeMaturityMonths: string;
}

interface Props {
  state: ActionFormState;
  onChange: (next: ActionFormState) => void;
  onSubmit: () => void;
  disabled?: boolean;
  errors?: Partial<Record<keyof ActionFormState, string>>;
  hasValidationErrors?: boolean;
  recommendations?: Recommendation[];
  onNavigateHelp?: (sectionId: string) => void;
}

interface FieldHelp {
  sectionId: string;
  tooltip: ReactNode;
  linkLabel?: string;
}

const ActionsPanel = ({
  state,
  onChange,
  onSubmit,
  disabled,
  errors,
  hasValidationErrors,
  recommendations = [],
  onNavigateHelp,
}: Props) => {
  const handleChange = (field: keyof ActionFormState) => (e: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...state, [field]: e.target.value });
  };

  return (
    <div className="stack">
      <div className="muted">
        Rates accept decimal/percent/bps (e.g. 0.025, 2.5%, 250bps). Amounts accept GBP, bn, m, k.
      </div>
      {disabled && <div className="alert danger">Scenario ended due to failure. Actions are disabled.</div>}
      {!disabled && hasValidationErrors && (
        <div className="alert danger">Fix highlighted inputs before running the next month.</div>
      )}
      <div className="form-row">
        <LabeledInput
          label="Retail deposit rate"
          help={{
            sectionId: 'deposit-behaviour',
            tooltip:
              'Higher rates support retention and growth; persistent underpricing raises churn and can degrade deposit quality.',
          }}
          value={state.retailDepositRate}
          onChange={handleChange('retailDepositRate')}
          placeholder="0.020"
          disabled={disabled}
          error={errors?.retailDepositRate}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Corporate deposit rate"
          help={{
            sectionId: 'deposit-behaviour',
            tooltip:
              'Corporate balances reprice faster and are less sticky in stress, so gaps to market rates can trigger quicker runoff.',
          }}
          value={state.corporateDepositRate}
          onChange={handleChange('corporateDepositRate')}
          placeholder="0.030"
          disabled={disabled}
          error={errors?.corporateDepositRate}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Mortgage rate"
          help={{
            sectionId: 'loan-pipeline',
            tooltip:
              'Loan pricing shifts demand and margin; high spreads can reduce volume, while low spreads can add risk-weighted assets quickly.',
          }}
          value={state.mortgageRate}
          onChange={handleChange('mortgageRate')}
          placeholder="0.055"
          disabled={disabled}
          error={errors?.mortgageRate}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Corporate loan rate"
          help={{
            sectionId: 'loan-pipeline',
            tooltip:
              'Corporate pricing affects pipeline conversion and credit selection pressure; aggressive terms can worsen later credit outcomes.',
          }}
          value={state.corporateLoanRate}
          onChange={handleChange('corporateLoanRate')}
          placeholder="0.065"
          disabled={disabled}
          error={errors?.corporateLoanRate}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Mortgage underwriting tightness (0-1)"
          help={{
            sectionId: 'loan-cohorts-and-ifrs9',
            tooltip:
              'Higher tightness reduces approvals and curbs new risk intake, but can sacrifice near-term volume and income.',
          }}
          value={state.mortgageUnderwritingTightness}
          onChange={handleChange('mortgageUnderwritingTightness')}
          placeholder="0.00"
          disabled={disabled}
          error={errors?.mortgageUnderwritingTightness}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Corporate underwriting tightness (0-1)"
          help={{
            sectionId: 'loan-cohorts-and-ifrs9',
            tooltip:
              'Tight underwriting slows risk accumulation and stage migration pressure, at the cost of reduced loan growth.',
          }}
          value={state.corporateUnderwritingTightness}
          onChange={handleChange('corporateUnderwritingTightness')}
          placeholder="0.00"
          disabled={disabled}
          error={errors?.corporateUnderwritingTightness}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Issue long-term wholesale debt (GBP)"
          help={{
            sectionId: 'funding-ladder-and-rollover',
            tooltip:
              'Issuing LT debt increases stable funding and can relieve rollover walls, but raises future funding costs.',
          }}
          value={state.issueLTDebtAmount}
          onChange={handleChange('issueLTDebtAmount')}
          placeholder="1000000000"
          disabled={disabled}
          error={errors?.issueLTDebtAmount}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Issue equity (GBP)"
          help={{
            sectionId: 'capital-policy-and-distributions',
            tooltip:
              'Equity raises bolster CET1 and leverage buffers immediately but can dilute existing shareholders through issuance discounts.',
          }}
          value={state.issueEquityAmount}
          onChange={handleChange('issueEquityAmount')}
          placeholder="500000000"
          disabled={disabled}
          error={errors?.issueEquityAmount}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Dividend payout ratio (0-1)"
          help={{
            sectionId: 'capital-policy-and-distributions',
            tooltip:
              'Requested payout is constrained by MDA and internal capital target logic; high requests can still be clipped to preserve resilience.',
          }}
          value={state.dividendPayoutRatio}
          onChange={handleChange('dividendPayoutRatio')}
          placeholder="0.30"
          disabled={disabled}
          error={errors?.dividendPayoutRatio}
          onNavigateHelp={onNavigateHelp}
        />
        <label className="field">
          <FieldLabel
            label="AT1 coupon policy"
            help={{
              sectionId: 'capital-policy-and-distributions',
              tooltip:
                'Auto mode skips coupons when CET1 buffers are weak; forcing payment supports signaling but reduces capital and liquidity.',
            }}
            onNavigateHelp={onNavigateHelp}
          />
          <select
            value={state.at1CouponMode}
            onChange={(e) =>
              onChange({
                ...state,
                at1CouponMode: e.target.value as ActionFormState['at1CouponMode'],
              })
            }
            disabled={disabled}
          >
            <option value="auto">Auto (buffer-aware)</option>
            <option value="pay">Always pay</option>
            <option value="skip">Always skip</option>
          </select>
        </label>
        <label className="field">
          <FieldLabel
            label="Interest-rate hedge direction"
            help={{
              sectionId: 'actions-pricing-and-underwriting',
              tooltip:
                'Sets fixed-floating exposure direction for NII/EVE sensitivity management. Hedge effectiveness depends on notional, rate, and tenor.',
            }}
            onNavigateHelp={onNavigateHelp}
          />
          <select
            value={state.hedgeDirection}
            onChange={(e) =>
              onChange({
                ...state,
                hedgeDirection: e.target.value as ActionFormState['hedgeDirection'],
              })
            }
            disabled={disabled}
          >
            <option value="none">None</option>
            <option value="payFixedReceiveFloat">Pay fixed / receive float</option>
            <option value="receiveFixedPayFloat">Receive fixed / pay float</option>
          </select>
        </label>
        <LabeledInput
          label="Hedge notional (GBP)"
          help={{
            sectionId: 'actions-pricing-and-underwriting',
            tooltip:
              'Larger notionals shift risk more strongly but can increase carry costs or basis mismatch if over-sized versus balance-sheet exposure.',
          }}
          value={state.hedgeNotional}
          onChange={handleChange('hedgeNotional')}
          placeholder="2000000000"
          disabled={disabled}
          error={errors?.hedgeNotional}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Hedge fixed rate"
          help={{
            sectionId: 'actions-pricing-and-underwriting',
            tooltip:
              'Fixed leg rate determines carry versus floating benchmark; poor entry levels can drag earnings even if volatility falls.',
          }}
          value={state.hedgeFixedRate}
          onChange={handleChange('hedgeFixedRate')}
          placeholder="3.5%"
          disabled={disabled}
          error={errors?.hedgeFixedRate}
          onNavigateHelp={onNavigateHelp}
        />
        <LabeledInput
          label="Hedge maturity (months)"
          help={{
            sectionId: 'actions-pricing-and-underwriting',
            tooltip:
              'Longer maturities lock exposure for more months; shorter tenors require more frequent roll decisions and execution.',
          }}
          value={state.hedgeMaturityMonths}
          onChange={handleChange('hedgeMaturityMonths')}
          placeholder="24"
          disabled={disabled}
          error={errors?.hedgeMaturityMonths}
          onNavigateHelp={onNavigateHelp}
        />
      </div>
      <button className="button primary" onClick={onSubmit} disabled={disabled || Boolean(hasValidationErrors)}>
        Run next month
      </button>
      {recommendations.length > 0 && (
        <div className="stack">
          <div className="eyebrow">Recommendations</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Rationale</th>
                <th>Caveat</th>
                <th className="numeric">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec) => (
                <tr key={rec.id}>
                  <td>{rec.title}</td>
                  <td>{rec.rationale}</td>
                  <td>{rec.caveat}</td>
                  <td className="numeric">{rec.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const LabeledInput = ({
  label,
  help,
  value,
  onChange,
  placeholder,
  disabled,
  error,
  onNavigateHelp,
}: {
  label: string;
  help?: FieldHelp;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  onNavigateHelp?: (sectionId: string) => void;
}) => (
  <label className="field">
    <FieldLabel label={label} help={help} onNavigateHelp={onNavigateHelp} />
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="decimal"
    />
    {error ? (
      <span className="muted" style={{ color: 'var(--danger)' }}>
        {error}
      </span>
    ) : null}
  </label>
);

const FieldLabel = ({
  label,
  help,
  onNavigateHelp,
}: {
  label: string;
  help?: FieldHelp;
  onNavigateHelp?: (sectionId: string) => void;
}) => (
  <span className="field-label-row">
    <span className="field-label-text">{label}</span>
    {help ? (
      <InfoTooltip
        label={`About ${label}`}
        content={<span>{help.tooltip}</span>}
      />
    ) : null}
    {help && onNavigateHelp ? (
      <HelpLink
        label={help.linkLabel ?? 'Open help'}
        sectionId={help.sectionId}
        onNavigate={onNavigateHelp}
      />
    ) : null}
  </span>
);

export default ActionsPanel;
