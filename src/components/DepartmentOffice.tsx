import { BankState } from '../domain/bankState';
import { baseConfig } from '../config/baseConfig';
import { Department, departmentSummary } from '../game/departments';
import ActionsPanel, { ActionFormState } from './ActionsPanel';
import { periodHistory } from '../game/management';
import { nelsonSiegelYield } from '../engine/ukMarketModel';
import type { RegulatoryMetric } from './RegMetricsPanel';
import { buildDepartmentPreview } from '../presentation/playerPreviews';
import type { PlayerCapitalMarketsQuote } from '../presentation/quotes';
import { buildTreasuryTransactionLimits } from '../presentation/treasuryLimits';

interface Props {
 department:Department; state:BankState; history:BankState[]; form:ActionFormState;
 errors:Partial<Record<keyof ActionFormState,string>>; hasErrors:boolean;
 onChange:(form:ActionFormState)=>void;
 onReport:(tab:string,metric?:RegulatoryMetric,origin?:Department)=>void; onHelp:(id:string)=>void; estimate:BankState|null;
 capitalMarketsQuote?:PlayerCapitalMarketsQuote; capitalMarketsPlanImpactText?:string;
}

const labels:Record<Department,string>={Customers:'Deposits',Lending:'Lending',Capital:'Finance & Capital',Treasury:'Treasury & Funding'};
const treasuryReports:Array<[string,string,RegulatoryMetric]>=[['Regulatory','Liquidity coverage','lcr'],['Regulatory','Stable funding','nsfr']];
const helpLinks:Record<Department,[string,string]>={
 Customers:['deposit-behaviour','How deposit pricing works'],
 Lending:['loan-pipeline','How pricing and selectivity affect lending'],
 Treasury:['funding-ladder-and-rollover','How funding and maturities work'],
 Capital:['tier2-and-equity','How capital instruments differ'],
};

export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange,onReport,onHelp,estimate,capitalMarketsQuote,capitalMarketsPlanImpactText}:Props) {
 const summary=departmentSummary(department,state,history);
 const period=periodHistory(history,3).at(-1);
 const selectedGiltMaturity = Math.max(.25, Number(form.giltDurationYears) || 5);
 const giltQuotedYield = department==='Treasury' ? nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, selectedGiltMaturity) : undefined;
 const treasuryLimits=buildTreasuryTransactionLimits(state,baseConfig,form);
 const previewProjection=estimate?buildDepartmentPreview(department,state,estimate,summary.metrics[2]?.rawValue??0,Boolean(state.threeYearPlan?.enabled),form.capitalMarketsInstrument!=='none'):null;
 const [helpId,helpLabel]=helpLinks[department];
 return <div className="department-office">
  <p className="office-status">{summary.status}<small>{period?`${period.label} · ${period.months}/3 months closed`:'Opening position · no months closed'}</small></p>
  <dl className="department-metrics">{summary.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>

  <ActionsPanel department={department} bankState={state} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} giltQuotedYield={giltQuotedYield} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpactText={previewProjection?.capitalMarketsPlanImpactText ?? capitalMarketsPlanImpactText} maxGiltSaleAmount={treasuryLimits.maxGiltSaleAmount} maxBoeFundingAmount={treasuryLimits.maxBoeFundingAmount}/>
  {previewProjection&&<section className={`decision-forecast ${previewProjection.projectedBreach?'warning':'info'}`} aria-label="Next monthly close preview">
    <div className="forecast-heading"><strong>Next close</strong><span>{previewProjection.projectedBreach?'Projected breach':'No breach projected'}</span></div>
    <dl>{previewProjection.ratios.map((ratio)=><div key={ratio.label}><dt>{ratio.label}</dt><dd>{ratio.before} → <strong>{ratio.after}</strong></dd></div>)}</dl>
    <div className="forecast-commercial-impact" aria-label="Commercial forecast"><strong>{previewProjection.impactHeading}</strong><dl>{previewProjection.commercialImpact.map(({label,before,after})=><div key={label}><dt>{label}</dt><dd>{before} → <strong>{after}</strong></dd></div>)}</dl></div>
    {previewProjection.projectedBreach&&<small>Queued decisions put a prudential limit at risk.</small>}
  </section>}
  <section className="department-guidance" aria-label={`${labels[department]} decision guide`}><div><strong>Decision guide</strong></div><button className="button ghost" onClick={()=>onHelp(helpId)}>{helpLabel} →</button></section>
  {department==='Treasury'&&<nav className="area-report-links" aria-label="Treasury reports"><div><strong>Reports</strong></div>{treasuryReports.map(([tab,label,metric])=><button key={metric} className="button ghost" onClick={()=>onReport(tab,metric,'Treasury')}>{label} →</button>)}</nav>}
 </div>;
}
