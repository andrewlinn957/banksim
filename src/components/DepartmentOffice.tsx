import { BankState } from '../domain/bankState';
import { Department, departmentSummary } from '../game/departments';
import { BoardDecision } from '../game/boardroom';
import ActionsPanel, { ActionFormState } from './ActionsPanel';
import { periodHistory } from '../game/management';
import { formatPct } from '../utils/formatters';

interface Props {
 department:Department; state:BankState; history:BankState[]; form:ActionFormState;
 errors:Partial<Record<keyof ActionFormState,string>>; hasErrors:boolean; selected:string[];
 onChange:(form:ActionFormState)=>void; onDecision:(decision:BoardDecision)=>void;
 onReport:(tab:string)=>void; onHelp:(id:string)=>void; estimate:BankState|null;
}

export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange}:Props) {
 const summary=departmentSummary(department,state,history);
 const period=periodHistory(history,3).at(-1);
 const competitorRates=department==='Customers'
  ? [
    ['Instant savings',state.market.competitorRetailDepositRate],
    ['1y fixed savings',state.market.competitorTermDepositRate],
    ['Business deposits',state.market.competitorCorporateDepositRate??state.market.competitorRetailDepositRate],
   ] as const
  : department==='Lending'
   ? [
     ['New mortgages',state.market.competitorMortgageRate],
     ['Personal credit',state.market.competitorConsumerLoanRate],
     ['SME/business',state.market.riskFreeLong+state.market.corporateLoanSpread],
    ] as const
   : [];
 return <div className="department-office">
  <p className="office-status">{summary.status}<small>{period?`${period.label} · ${period.months}/3 months closed`:'Opening position · no months closed'}</small></p>
  <dl className="department-metrics">{summary.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
  <p className="department-consequence">{summary.explanation}</p>
  {competitorRates.length>0&&<section className="competitor-rates" aria-label="Competitor rates"><div><strong>Market reference</strong><small>Current competing offers</small></div><dl>{competitorRates.map(([label,rate])=><div key={label}><dt>{label}</dt><dd>{formatPct(rate)}</dd></div>)}</dl></section>}
  <ActionsPanel department={department} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors}/>
 </div>;
}
