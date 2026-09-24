import { BankState } from '../domain/bankState';
import type { CapitalMarketsBookbuildResult } from '../domain/capitalMarkets';
import { AssetProductType } from '../domain/enums';
import { baseConfig } from '../config/baseConfig';
import { Department, departmentSummary } from '../game/departments';
import ActionsPanel, { ActionFormState, type CapitalMarketsPlanImpact } from './ActionsPanel';
import { periodHistory } from '../game/management';
import { formatPct } from '../utils/formatters';
import { parseMoneyInput } from '../utils/parsers';
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
 Treasury:[['Regulatory','Liquidity coverage','lcr'],['Regulatory','Stable funding','nsfr']],
};
const helpLinks:Record<Department,[string,string]>={
 Customers:['deposit-behaviour','How deposit pricing works'],
 Lending:['loan-pipeline','How pricing and selectivity affect lending'],
 Treasury:['funding-ladder-and-rollover','How funding and maturities work'],
 Capital:['tier2-and-equity','How capital instruments differ'],
};

export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange,onReport,onHelp,estimate,capitalMarketsQuote,capitalMarketsPlanImpact}:Props) {
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
 const giltQuotedYield = department==='Treasury' ? nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, selectedGiltMaturity) : undefined;
 const gilts=state.financial.balanceSheet.items.find(item=>item.productType===AssetProductType.Gilts);
 const unencumberedGilts=Math.max(0,(gilts?.balance??0)-(gilts?.encumbrance?.encumberedAmount??0));
 const queuedGiltSale=form.giltTradeDirection==='sell'?Math.max(0,parseMoneyInput(form.giltTradeAmount).value??0):0;
 const giltsAfterQueuedSale=Math.max(0,unencumberedGilts-Math.min(unencumberedGilts,queuedGiltSale));
 const boeHaircut=Math.min(.25,Math.max(baseConfig.behaviour.boeFunding?.levelAHaircut??.03,state.market.giltRepoHaircut));
 const maxBoeFunding=giltsAfterQueuedSale*(1-boeHaircut);
 const estimateCompliance=estimate?.risk.compliance;
 const projectedBreach=Boolean(estimate&&(estimate.status.hasFailed||estimateCompliance?.cet1Breached||estimateCompliance?.ownFundsBreached||estimateCompliance?.leverageBreached||estimateCompliance?.lcrBreached||estimateCompliance?.nsfrBreached));
 const reports=reportLinks[department]??[];
 const [helpId,helpLabel]=helpLinks[department];
 return <div className="department-office">
  <p className="office-status">{summary.status}<small>{period?`${period.label} · ${period.months}/3 months closed`:'Opening position · no months closed'}</small></p>
  <dl className="department-metrics">{summary.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>
  <p className="department-consequence">{summary.explanation}</p>
  {competitorRates.length>0&&<section className="competitor-rates" aria-label="Competitor rates"><strong>Market reference</strong><dl>{competitorRates.map(([label,rate])=><div key={label}><dt>{label}</dt><dd>{formatPct(rate)}</dd></div>)}</dl></section>}
  <ActionsPanel department={department} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} giltQuotedYield={giltQuotedYield} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact} maxGiltSaleAmount={unencumberedGilts} maxBoeFundingAmount={maxBoeFunding}/>
  {estimate&&<section className={`decision-forecast ${projectedBreach?'warning':'info'}`} aria-label="Next monthly close preview">
    <div className="forecast-heading"><strong>Next close</strong><span>{projectedBreach?'Projected breach':'No breach projected'}</span></div>
    <dl>
      <div><dt>CET1</dt><dd>{formatPct(state.risk.riskMetrics.cet1Ratio)} → <strong>{formatPct(estimate.risk.riskMetrics.cet1Ratio)}</strong></dd></div>
      <div><dt>Leverage</dt><dd>{formatPct(state.risk.riskMetrics.leverageRatio)} → <strong>{formatPct(estimate.risk.riskMetrics.leverageRatio)}</strong></dd></div>
      <div><dt>LCR</dt><dd>{formatPct(state.risk.riskMetrics.lcr)} → <strong>{formatPct(estimate.risk.riskMetrics.lcr)}</strong></dd></div>
      <div><dt>NSFR</dt><dd>{formatPct(state.risk.riskMetrics.nsfr)} → <strong>{formatPct(estimate.risk.riskMetrics.nsfr)}</strong></dd></div>
    </dl>
    {projectedBreach&&<small>Queued decisions put a prudential limit at risk.</small>}
  </section>}
  <section className="department-guidance" aria-label={`${labels[department]} decision guide`}><div><strong>Decision guide</strong><small>Open the relevant explanation without leaving this decision context behind.</small></div><button className="button ghost" onClick={()=>onHelp(helpId)}>{helpLabel} →</button></section>
  {reports.length>0&&<nav className="area-report-links" aria-label={`${labels[department]} reports`}><div><strong>Reports</strong><small>Open the detailed view when you need it.</small></div>{reports.map(([tab,label,metric])=><button key={`${tab}-${metric??label}`} className="button ghost" onClick={()=>onReport(tab,metric,department)}>{label} →</button>)}</nav>}
 </div>;
}
