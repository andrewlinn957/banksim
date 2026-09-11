import { Department } from '../game/departments';

interface Props {
  activeTab: string;
  onReport: (tab: string) => void;
  onManage: (department: Department) => void;
}

const financeReports = [
  ['Performance', 'Performance'],
  ['Accounts', 'Accounts'],
  ['Share Price', 'Share price'],
  ['Costs', 'Costs'],
] as const;

const riskReports = [
  ['Overview', 'Risk overview'],
  ['Regulatory', 'Regulatory detail'],
] as const;

export default function FunctionalReportNavigation({ activeTab, onReport, onManage }: Props) {
  if (activeTab === 'Loans') {
    return <nav className="functional-report-navigation" aria-label="Lending reports"><strong>Lending</strong><button className="button ghost" onClick={() => onManage('Lending')}>Manage lending</button><button className="button primary" aria-current="page">Loan portfolio</button></nav>;
  }

  if (financeReports.some(([tab]) => tab === activeTab)) {
    return <nav className="functional-report-navigation" aria-label="Finance and capital reports"><strong>Finance & Capital</strong><button className="button ghost" onClick={() => onManage('Capital')}>Manage capital</button>{financeReports.map(([tab,label]) => <button key={tab} className={`button ${activeTab === tab ? 'primary' : 'ghost'}`} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => onReport(tab)}>{label}</button>)}</nav>;
  }

  if (riskReports.some(([tab]) => tab === activeTab)) {
    return <nav className="functional-report-navigation" aria-label="Risk and regulatory reports"><strong>Risk & Regulatory</strong>{riskReports.map(([tab,label]) => <button key={tab} className={`button ${activeTab === tab ? 'primary' : 'ghost'}`} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => onReport(tab)}>{label}</button>)}</nav>;
  }

  return null;
}
