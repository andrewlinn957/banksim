import { BankState } from '../domain/bankState';
import type { CapitalMarketsBookbuildResult } from '../domain/capitalMarkets';
import { Department, departmentSummary } from '../game/departments';
import ActionsPanel, { ActionFormState, type CapitalMarketsPlanImpact } from './ActionsPanel';
import { periodHistory } from '../game/management';
import { formatPct } from '../utils/formatters';
import { nelsonSiegelYield } from '../engine/ukMarketModel';

interface Props {
 department:Department; state:BankState; history:BankState[]; form:ActionFormState;
 errors:Partial<Record<keyof ActionFormState,string>>; hasErrors:boolean;
 onChange:(form:ActionFormState)=>void;
 onReport:(tab:string)=>void; onHelp:(id:string)=>void; estimate:BankState|null;
 capitalMarketsQuote?:CapitalMarketsBookbuildResult; capitalMarketsPlanImpact?:CapitalMarketsPlanImpact;
}

export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange,capitalMarketsQuote,capitalMarketsPlanImpact}:Props) {
 const summary=departmentSummary(department,state,history);
 const period=periodHistory(history,3).at(-1);
 const competitorRates=department==='Customers'
  ? [
    ['Instant savings',state.market.competitorRetailCurrentAccountRate],
    ['1y fixed savings',state.market.competitorTermDepositRate],
    ['Business deposits',state.market.competitorCorporateDepositRate??state.market.competitorRetailCurrentAccountRate],
   ] as const
  : department==='Lending'
   ? [
     ['New mortgages',state.market.competitorMortgageRate],
     ['Personal credit',state.market.competitorConsumerLoanRate],
     ['SME/business',state.market.riskFreeLong+state.market.corporateLoanSpread],
    ] as const
   : [];
 const selectedGiltMaturity = Math.max(.25, Number(form.giltDurationYears) || 5);
 const giltQuotedYield = department==='Treasury'
  ? nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, selectedGiltMaturity)
  : undefined;
 return <div className="department-office">
  <p className="office-status">{summary.status}<small>{period?`${period.label} · ${period.months}/3 months closed`:'Opening position · no months closed'}</small></p>
  <dl className="department-metrics">{summary.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
  <p className="department-consequence">{summary.explanation}</p>
  {competitorRates.length>0&&<section className="competitor-rates" aria-label="Competitor rates"><div><strong>Market reference</strong><small>Current competing offers</small></div><dl>{competitorRates.map(([label,rate])=><div key={label}><dt>{label}</dt><dd>{formatPct(rate)}</dd></div>)}</dl></section>}
  <ActionsPanel department={department} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} giltQuotedYield={giltQuotedYield} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact}/>
 </div>;
}
