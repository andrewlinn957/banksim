import { BankState } from '../domain/bankState';
import type { CapitalMarketsBookbuildResult } from '../domain/capitalMarkets';
import { AssetProductType } from '../domain/enums';
import { baseConfig } from '../config/baseConfig';
import { Department, departmentSummary } from '../game/departments';
import ActionsPanel, { type ActionFormState, type CapitalMarketsPlanImpact, type QueuedTransactionSummary, type TransactionKind } from './ActionsPanel';
import { periodHistory } from '../game/management';
import { customerDeposits } from '../game/management';
import { formatPct } from '../utils/formatters';
import { parseMoneyInput } from '../utils/parsers';
import { nelsonSiegelYield } from '../engine/ukMarketModel';
import type { RegulatoryMetric } from './RegMetricsPanel';
import { debtFundingHeadroom } from '../engine/fundingHeadroom';

interface Props {
 department:Department; state:BankState; history:BankState[]; form:ActionFormState;
 errors:Partial<Record<keyof ActionFormState,string>>; hasErrors:boolean;
 onChange:(form:ActionFormState)=>void;
 onReport:(tab:string,metric?:RegulatoryMetric,origin?:Department)=>void; onHelp:(id:string)=>void; estimate:BankState|null;
 capitalMarketsQuote?:CapitalMarketsBookbuildResult; capitalMarketsPlanImpact?:CapitalMarketsPlanImpact;
 queuedTransactions?:QueuedTransactionSummary[]; onQueueTransaction?:(kind:TransactionKind)=>void; onCancelQueuedTransaction?:(id:number)=>void;
}

const labels:Record<Department,string>={Customers:'Deposits',Lending:'Lending',Capital:'Finance & Capital',Treasury:'Treasury & Funding'};
const treasuryReports:Array<[string,string,RegulatoryMetric]>=[['Regulatory','Liquidity coverage','lcr'],['Regulatory','Stable funding','nsfr']];
const helpLinks:Record<Department,[string,string]>={
 Customers:['deposit-behaviour','How deposit pricing works'],
 Lending:['loan-pipeline','How pricing and selectivity affect lending'],
 Treasury:['funding-ladder-and-rollover','How funding and maturities work'],
 Capital:['tier2-and-equity','How capital instruments differ'],
};

export default function DepartmentOffice({department,state,history,form,errors,hasErrors,onChange,onReport,onHelp,estimate,capitalMarketsQuote,capitalMarketsPlanImpact,queuedTransactions,onQueueTransaction,onCancelQueuedTransaction}:Props) {
 const summary=departmentSummary(department,state,history);
 const period=periodHistory(history,3).at(-1);
 const selectedGiltMaturity = Math.max(.25, Number(form.giltDurationYears) || 5);
 const giltQuotedYield = department==='Treasury' ? nelsonSiegelYield(state.market.giltCurve.nelsonSiegel, selectedGiltMaturity) : undefined;
 const gilts=state.financial.balanceSheet.items.find(item=>item.productType===AssetProductType.Gilts);
 const unencumberedGilts=Math.max(0,(gilts?.balance??0)-(gilts?.encumbrance?.encumberedAmount??0));
 const queuedGiltSale=form.giltTradeDirection==='sell'?Math.max(0,parseMoneyInput(form.giltTradeAmount).value??0):0;
 const giltsAfterQueuedSale=Math.max(0,unencumberedGilts-Math.min(unencumberedGilts,queuedGiltSale));
 const boeHaircut=Math.min(.25,Math.max(baseConfig.behaviour.boeFunding?.levelAHaircut??.03,state.market.giltRepoHaircut));
 const maxBoeFunding=Math.min(giltsAfterQueuedSale*(1-boeHaircut),debtFundingHeadroom(state,baseConfig));
 const estimateCompliance=estimate?.risk.compliance;
 const projectedBreach=Boolean(estimate&&(estimate.status.hasFailed||estimateCompliance?.cet1Breached||estimateCompliance?.ownFundsBreached||estimateCompliance?.leverageBreached||estimateCompliance?.lcrBreached||estimateCompliance?.nsfrBreached));
 const loans=(s:BankState)=>Object.values(s.loanCohorts??{}).flat().reduce((sum,c)=>sum+c.outstandingPrincipal,0)+Object.values(s.workoutPipelines??{}).flat().reduce((sum,w)=>sum+w.defaultedPrincipal,0);
 const impact=estimate?department==='Customers'
  ? [['Customer deposits',customerDeposits(state),customerDeposits(estimate)],['Net interest income',state.financial.incomeStatement.netInterestIncome,estimate.financial.incomeStatement.netInterestIncome]] as const
  : department==='Lending'
   ? [['Gross loans',loans(state),loans(estimate)],['Credit losses',state.financial.incomeStatement.creditLosses,estimate.financial.incomeStatement.creditLosses]] as const
   : department==='Capital'
    ? [['Net profit',state.financial.incomeStatement.netIncome,estimate.financial.incomeStatement.netIncome],['CET1 capital',state.financial.capital.cet1,estimate.financial.capital.cet1]] as const
    : [['Cash reserves',state.financial.balanceSheet.items.filter(i=>i.productType===AssetProductType.CashReserves).reduce((n,i)=>n+i.balance,0),estimate.financial.balanceSheet.items.filter(i=>i.productType===AssetProductType.CashReserves).reduce((n,i)=>n+i.balance,0)],['Funding due',summary.metrics[2].rawValue,summary.metrics[2].rawValue]] as const
  : [];
 const moneyMillions=(value:number)=>`${value<0?'−':''}£${(Math.abs(value)/1e6).toFixed(1)}m`;
 const [helpId,helpLabel]=helpLinks[department];
 return <div className="department-office">
  <p className="office-status">{summary.status}<small>{period?`${period.label} · ${period.months}/3 months closed`:'Opening position · no months closed'}</small></p>
  <dl className="department-metrics">{summary.metrics.map(m=><div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl>

  <ActionsPanel department={department} bankState={state} state={form} onChange={onChange} disabled={state.status.hasFailed} errors={errors} hasValidationErrors={hasErrors} giltQuotedYield={giltQuotedYield} capitalMarketsQuote={capitalMarketsQuote} capitalMarketsPlanImpact={capitalMarketsPlanImpact} maxGiltSaleAmount={unencumberedGilts} maxBoeFundingAmount={maxBoeFunding} queuedTransactions={queuedTransactions} onQueueTransaction={onQueueTransaction} onCancelQueuedTransaction={onCancelQueuedTransaction}/>
  {estimate&&<section className={`decision-forecast ${projectedBreach?'warning':'info'}`} aria-label="Next monthly close preview">
    <div className="forecast-heading"><strong>Next close</strong><span>{projectedBreach?'Projected breach':'No breach projected'}</span></div>
    <dl>
      <div><dt>CET1</dt><dd>{formatPct(state.risk.riskMetrics.cet1Ratio)} → <strong>{formatPct(estimate.risk.riskMetrics.cet1Ratio)}</strong></dd></div>
      <div><dt>Leverage</dt><dd>{formatPct(state.risk.riskMetrics.leverageRatio)} → <strong>{formatPct(estimate.risk.riskMetrics.leverageRatio)}</strong></dd></div>
      <div><dt>LCR</dt><dd>{formatPct(state.risk.riskMetrics.lcr)} → <strong>{formatPct(estimate.risk.riskMetrics.lcr)}</strong></dd></div>
      <div><dt>NSFR</dt><dd>{formatPct(state.risk.riskMetrics.nsfr)} → <strong>{formatPct(estimate.risk.riskMetrics.nsfr)}</strong></dd></div>
    </dl>
    <div className="forecast-commercial-impact" aria-label="Commercial forecast"><strong>{department==='Customers'?'Funding & earnings':department==='Lending'?'Portfolio & credit':department==='Capital'?'Earnings & capital':'Cash & funding'}</strong><dl>{impact.map(([label,before,after])=><div key={label}><dt>{label}</dt><dd>{moneyMillions(before)} → <strong>{moneyMillions(after)}</strong></dd></div>)}</dl></div>
    {projectedBreach&&<small>Queued decisions put a prudential limit at risk.</small>}
  </section>}
  <section className="department-guidance" aria-label={`${labels[department]} decision guide`}><div><strong>Decision guide</strong></div><button className="button ghost" onClick={()=>onHelp(helpId)}>{helpLabel} →</button></section>
  {department==='Treasury'&&<nav className="area-report-links" aria-label="Treasury reports"><div><strong>Reports</strong></div>{treasuryReports.map(([tab,label,metric])=><button key={metric} className="button ghost" onClick={()=>onReport(tab,metric,'Treasury')}>{label} →</button>)}</nav>}
 </div>;
}
