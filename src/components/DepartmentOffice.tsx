import { BankState } from '../domain/bankState';
import type { CapitalMarketsBookbuildResult } from '../domain/capitalMarkets';
import { Department, departmentSummary } from '../game/departments';
import ActionsPanel, { ActionFormState, type CapitalMarketsPlanImpact } from './ActionsPanel';
import { periodHistory } from '../game/management';
import { formatPct } from '../utils/formatters';
import { nelsonSiegelYield } from '../engine/ukMarketModel';
import type { RegulatoryMetric } from './RegMetricsPanel';

interface Props {
 department:Department; state:BankState; history:BankState[]; form:ActionFormState;
 errors:Partial<Record<keyof ActionFormState,string>>; hasErrors:boolean;
 onChange:(form:ActionFormState)=>void;
 onReport:(tab:string,metric?:RegulatoryMetric,origin?:Department)=>void; onHelp:(id:string)=>void; estimate:BankState|null;
 capitalMarketsQuote?:CapitalMarketsBookbuildResult; capitalMarketsPlanImpact?:CapitalMarketsPlanImpact;
}

const labels:Record<Department,string>={Customers:'Deposits',Lending:'Lending',Capital:'Finance & Capital',Treasury:'Treasury & Funding'};
const reportLinks:Partial<Record<Department,Array<[string,string,RegulatoryMetric?]>>>={
 Lending:[['Loans','Loan portfolio']],
 Capital:[['Performance','Performance'],['Accounts','Accounts'],['Share Price','Share price'],['Costs','Costs']],
 Treasury:[['Regulatory','Liquidity coverage','lcr'],['Regulatory','Stable funding','nsfr']],
};
const helpLinks:Record<Department,[string,string]>={
 Customers:['deposit-behaviour','How deposit pricing works'],
 Lending:['loan-pipeline','How pricing and selectivity affect lending'],
 Treasury:['funding-ladder-and-rollover','How funding and maturities work'],
 Capital:['tier2-and-equity','How capital instruments differ'],
};

export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange,onReport,onHelp,capitalMarketsQuote,capitalMarketsPlanImpact}:Props) {
 const summary=departmentSummary(department,state,history);
 const period=periodHistory(history,3).at(-1);
 const competitorRates=department==='Customers'
  ? [
    ['Retail current accounts',state.market.competitorRetailCurrentAccountRate],
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
 const reports=reportLinks[department]??[];
 const [helpId,helpLabel]=helpLinks[department];
 return <div className="department-office">
  <p className="office-status">{summary.status}<small>{period?`${period.label} · ${period.months}/3 months closed`:'Opening position · no months closed'}</small></p>
  <dl className="department-metrics">{summary.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
  <p className="department-consequence">{summary.explanation}</p>
  {competitorRates.length>0&&<section className="competitor-rates" aria-label="Competitor rates"><div><strong>Market reference</strong><small>Current competing offers</small></div><dl>{competitorRates.map(([label,rate])=><div key={label}><dt>{label}</dt><dd>{formatPct(rate)}</dd></div>)}</dl></section>}
  <ActionsPanel department={department} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} giltQuotedYield={giltQuotedYield} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact}/>
  <section className="department-guidance" aria-label={`${labels[department]} decision guide`}><div><strong>Decision guide</strong><small>Open the relevant explanation without leaving this decision context behind.</small></div><button className="button ghost" onClick={()=>onHelp(helpId)}>{helpLabel} →</button></section>
  {reports.length>0&&<nav className="area-report-links" aria-label={`${labels[department]} reports`}><div><strong>Reports</strong><small>Open the detailed view when you need it.</small></div>{reports.map(([tab,label,metric])=><button key={`${tab}-${metric??label}`} className="button ghost" onClick={()=>onReport(tab,metric,department)}>{label} →</button>)}</nav>}
 </div>;
}
