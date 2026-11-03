import { Department } from '../game/departments';
import type { RegulatoryMetric } from './RegMetricsPanel';

interface Props {
  activeTab: string;
  activeDepartment?: Department | null;
  regulatoryMetric?: RegulatoryMetric;
  onReport: (tab: string, metric?: RegulatoryMetric, origin?: Department | null) => void;
  onManage: (department: Department) => void;
}
const financeReports = [['Performance','Performance'],['Accounts','Accounts'],['Share Price','Share price'],['Costs','Costs']] as const;

export default function FunctionalReportNavigation({ activeTab, activeDepartment=null, regulatoryMetric, onReport, onManage }: Props) {
  const department = activeDepartment ?? (activeTab==='Loans'?'Lending':financeReports.some(([tab])=>tab===activeTab)?'Capital':null);
  const manage = (label:string, area:Department) => <button className={`button ${activeTab==='Boardroom'?'primary':'ghost'}`} aria-current={activeTab==='Boardroom'?'page':undefined} onClick={()=>onManage(area)}>{label}</button>;
  const report = (tab:string,label:string,metric?:RegulatoryMetric,origin:Department|null=department) => {
    const active=activeTab===tab&&(!metric||metric===regulatoryMetric);
    return <button key={`${tab}-${metric??label}`} className={`button ${active?'primary':'ghost'}`} aria-current={active?'page':undefined} onClick={()=>onReport(tab,metric,origin)}>{label}</button>;
  };
  if(department==='Lending') return <nav className="functional-report-navigation" aria-label="Lending screens"><strong>Lending</strong>{manage('Pricing & policy','Lending')}{report('Loans','Loan portfolio')}</nav>;
  if(department==='Capital') return <nav className="functional-report-navigation" aria-label="Finance and capital screens"><strong>Finance & Capital</strong>{manage('Capital & dividends','Capital')}{financeReports.map(([tab,label])=>report(tab,label))}</nav>;
  if(department==='Treasury') return <nav className="functional-report-navigation" aria-label="Treasury screens"><strong>Treasury & Funding</strong>{manage('Treasury actions','Treasury')}{report('Regulatory','Liquidity coverage','lcr')}{report('Regulatory','Stable funding','nsfr')}</nav>;
  if(activeTab==='Overview'||activeTab==='Regulatory') return <nav className="functional-report-navigation" aria-label="Risk and regulatory screens"><strong>Risk & Regulatory</strong>{report('Overview','Risk overview')}{report('Regulatory','Capital','capital')}{report('Regulatory','RWA','rwa')}{report('Regulatory','Leverage','leverage')}{report('Regulatory','LCR','lcr')}{report('Regulatory','NSFR','nsfr')}</nav>;
  return null;
}
