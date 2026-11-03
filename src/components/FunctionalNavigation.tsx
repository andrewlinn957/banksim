import { Department } from '../game/departments';
import type { RegulatoryMetric } from './RegMetricsPanel';
import './FunctionalNavigation.css';

interface Props {
  activeTab: string;
  activeDepartment: Department | null;
  onBoardroom: () => void;
  onDepartment: (department: Department) => void;
  onReport: (tab: string, metric?: RegulatoryMetric, origin?: Department | null) => void;
}

const DepartmentButton = ({
  department,
  label,
  activeDepartment,
  activeTab,
  onDepartment,
}: {
  department: Department;
  label: string;
  activeDepartment: Department | null;
  activeTab: string;
  onDepartment: (department: Department) => void;
}) => (
  <button
    className={`functional-nav-button ${activeDepartment === department ? 'active' : ''}`}
    aria-current={activeDepartment === department ? 'page' : undefined}
    onClick={() => onDepartment(department)}
  >
    {label}
  </button>
);

export default function FunctionalNavigation({
  activeTab,
  activeDepartment,
  onBoardroom,
  onDepartment,
  onReport,
}: Props) {
  const riskActive = activeDepartment === null && (activeTab === 'Overview' || activeTab === 'Regulatory');
  const jumpMenu = (label: string, items: Array<[string, () => void]>) => <details className="area-jump-menu"><summary aria-label={`${label} screens`}>▾</summary><div>{items.map(([name, action]) => <button key={name} onClick={event => { action(); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{name}</button>)}</div></details>;
  return (
    <nav className="functional-navigation" aria-label="Bank areas">
      <div className="functional-nav-group boardroom-nav-group">
        <span className="functional-nav-label">Overview</span>
        <button
          className={`functional-nav-button ${activeTab === 'Boardroom' && activeDepartment === null ? 'active' : ''}`}
          aria-current={activeTab === 'Boardroom' && activeDepartment === null ? 'page' : undefined}
          onClick={onBoardroom}
        >
          Bank
        </button>
      </div>
      <div className="functional-nav-group">
        <span className="functional-nav-label">Operate</span>
        <DepartmentButton department="Customers" label="Deposits" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />
        <div className="area-nav-entry"><DepartmentButton department="Lending" label="Lending" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />{jumpMenu('Lending',[['Pricing & policy',()=>onDepartment('Lending')],['Loan portfolio',()=>onReport('Loans',undefined,'Lending')]])}</div>
        <div className="area-nav-entry"><DepartmentButton department="Treasury" label="Treasury & Funding" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />{jumpMenu('Treasury & Funding',[['Treasury actions',()=>onDepartment('Treasury')],['Liquidity coverage',()=>onReport('Regulatory','lcr','Treasury')],['Stable funding',()=>onReport('Regulatory','nsfr','Treasury')]])}</div>
      </div>
      <div className="functional-nav-group">
        <span className="functional-nav-label">Oversight</span>
        <div className="area-nav-entry"><DepartmentButton department="Capital" label="Finance & Capital" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />{jumpMenu('Finance & Capital',[['Capital & dividends',()=>onDepartment('Capital')],['Performance',()=>onReport('Performance',undefined,'Capital')],['Accounts',()=>onReport('Accounts',undefined,'Capital')],['Share price',()=>onReport('Share Price',undefined,'Capital')],['Costs',()=>onReport('Costs',undefined,'Capital')]])}</div>
        <button className={`functional-nav-button ${riskActive ? 'active' : ''}`} aria-current={riskActive ? 'page' : undefined} onClick={() => onReport('Regulatory')}>Risk & Regulatory</button>
      </div>
      <div className="functional-nav-group functional-nav-group-secondary">
        <span className="functional-nav-label">Review</span>
        <button className={`functional-nav-button ${activeTab === 'Scenarios' ? 'active' : ''}`} onClick={() => onReport('Scenarios')}>Scenarios</button>
        <button className={`functional-nav-button ${activeTab === 'Past games' ? 'active' : ''}`} onClick={() => onReport('Past games')}>Past games</button>
        <button className={`functional-nav-button ${activeTab === 'Help' ? 'active' : ''}`} onClick={() => onReport('Help')}>Help</button>
      </div>
    </nav>
  );
}
