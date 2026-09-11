import { Department } from '../game/departments';

interface Props {
  activeTab: string;
  activeDepartment: Department | null;
  onBoardroom: () => void;
  onDepartment: (department: Department) => void;
  onReport: (tab: string) => void;
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
    className={`functional-nav-button ${activeTab === 'Boardroom' && activeDepartment === department ? 'active' : ''}`}
    aria-current={activeTab === 'Boardroom' && activeDepartment === department ? 'page' : undefined}
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
  const riskActive = activeTab === 'Overview' || activeTab === 'Regulatory';
  return (
    <nav className="functional-navigation" aria-label="Bank areas">
      <div className="functional-nav-group boardroom-nav-group">
        <span className="functional-nav-label">Boardroom</span>
        <button
          className={`functional-nav-button ${activeTab === 'Boardroom' && activeDepartment === null ? 'active' : ''}`}
          aria-current={activeTab === 'Boardroom' && activeDepartment === null ? 'page' : undefined}
          onClick={onBoardroom}
        >
          Bank
        </button>
      </div>
      <div className="functional-nav-group">
        <span className="functional-nav-label">Run the bank</span>
        <DepartmentButton department="Customers" label="Deposits" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />
        <DepartmentButton department="Lending" label="Lending" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />
        <DepartmentButton department="Treasury" label="Treasury & Funding" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />
      </div>
      <div className="functional-nav-group">
        <span className="functional-nav-label">Control the bank</span>
        <DepartmentButton department="Capital" label="Finance & Capital" activeDepartment={activeDepartment} activeTab={activeTab} onDepartment={onDepartment} />
        <button className={`functional-nav-button ${riskActive ? 'active' : ''}`} aria-current={riskActive ? 'page' : undefined} onClick={() => onReport('Regulatory')}>Risk & Regulatory</button>
      </div>
      <div className="functional-nav-group functional-nav-group-secondary">
        <span className="functional-nav-label">Other</span>
        <button className={`functional-nav-button ${activeTab === 'Scenarios' ? 'active' : ''}`} onClick={() => onReport('Scenarios')}>Scenarios</button>
        <button className={`functional-nav-button ${activeTab === 'Past games' ? 'active' : ''}`} onClick={() => onReport('Past games')}>Past games</button>
        <button className={`functional-nav-button ${activeTab === 'Help' ? 'active' : ''}`} onClick={() => onReport('Help')}>Help</button>
      </div>
    </nav>
  );
}
