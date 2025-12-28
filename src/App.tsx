import { useEffect, useMemo, useRef, useState } from 'react';
import { initialState } from './config/initialState';
import { baseConfig } from './config/baseConfig';
import { BankState } from './domain/bankState';
import { PlayerAction } from './domain/actions';
import {
  AssetProductType,
  LiabilityProductType,
  BalanceSheetSide,
} from './domain/enums';
import TopMetricsPanel from './components/TopMetricsPanel';
import ActionsPanel, { ActionFormState } from './components/ActionsPanel';
import EventLog from './components/EventLog';
import ScenarioSelector from './components/ScenarioSelector';
import { getScenarioInitialState, getScheduledShocksForStep, scenarios, applyScenarioConfig } from './config/scenarios';
import { SimulationEvent } from './engine/simulation';
import { ComplianceStatus, RiskMetrics } from './domain/risks';
import RegMetricsPanel from './components/RegMetricsPanel';
import LoansPanel from './components/LoansPanel';
import CostsPanel from './components/CostsPanel';
import ReconciliationPanel from './components/ReconciliationPanel';
import { SimulationConfig } from './domain/config';
import { calculateRiskMetrics, evaluateCompliance } from './engine/metrics';
import { SimulationController } from './ui/simulationController';
import AccountsPanel from './components/AccountsPanel';
import ExogenousVariablesPanel from './components/ExogenousVariablesPanel';

const controller = new SimulationController(baseConfig);
const tabs = ['Overview', 'Scenarios', 'Accounts', 'Regulatory', 'Loans', 'Costs', 'Events', 'Reconciliations'];

const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [simConfig, setSimConfig] = useState<SimulationConfig>(baseConfig);
  const [bankState, setBankState] = useState<BankState>(initialState);
  const [stateHistory, setStateHistory] = useState<BankState[]>([initialState]);
  const [eventLog, setEventLog] = useState<SimulationEvent[]>([]);
  const [actionForm, setActionForm] = useState<ActionFormState>({
    retailDepositRate:
      bankState.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailDeposits)
        ?.interestRate.toString() ?? '',
    corporateDepositRate:
      bankState.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.CorporateDeposits)
        ?.interestRate.toString() ?? '',
    mortgageRate:
      bankState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)
        ?.interestRate.toString() ?? '',
    corporateLoanRate:
      bankState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans)
        ?.interestRate.toString() ?? '',
    issueLTDebtAmount: '',
    issueEquityAmount: '',
  });
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Overview');
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const actionsDrawerContentRef = useRef<HTMLDivElement | null>(null);

  const totalEquity = useMemo(
    () => bankState.financial.capital.cet1 + bankState.financial.capital.at1,
    [bankState.financial.capital]
  );
  const totalAssets = useMemo(
    () =>
      bankState.financial.balanceSheet.items
        .filter((i) => i.side === BalanceSheetSide.Asset)
        .reduce((sum, i) => sum + i.balance, 0),
    [bankState.financial.balanceSheet]
  );

  const roe = totalEquity > 0 ? (bankState.financial.incomeStatement.netIncome * 12) / totalEquity : 0;
  const nim = totalAssets > 0 ? (bankState.financial.incomeStatement.netInterestIncome * 12) / totalAssets : 0;

  const failureSummary = buildFailureSummary(bankState.risk.compliance, bankState.risk.riskMetrics);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isActionsOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsActionsOpen(false);
        return;
      }

      if (e.key !== 'Tab') return;

      const container = actionsDrawerContentRef.current;
      if (!container) return;

      const focusableSelector =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

      const focusableElements = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    actionsCloseButtonRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isActionsOpen]);

  const handleRunNextMonth = () => {
    const actions: PlayerAction[] = [];
    const parseNum = (val: string) => (val === '' ? undefined : Number(val));

    const retailRate = parseNum(actionForm.retailDepositRate);
    if (retailRate !== undefined && !Number.isNaN(retailRate)) {
      actions.push({
        type: 'adjustRate',
        productType: LiabilityProductType.RetailDeposits,
        newRate: retailRate,
      });
    }

    const corpDepRate = parseNum(actionForm.corporateDepositRate);
    if (corpDepRate !== undefined && !Number.isNaN(corpDepRate)) {
      actions.push({
        type: 'adjustRate',
        productType: LiabilityProductType.CorporateDeposits,
        newRate: corpDepRate,
      });
    }

    const mortgageRate = parseNum(actionForm.mortgageRate);
    if (mortgageRate !== undefined && !Number.isNaN(mortgageRate)) {
      actions.push({
        type: 'adjustRate',
        productType: AssetProductType.Mortgages,
        newRate: mortgageRate,
      });
    }

    const corpLoanRate = parseNum(actionForm.corporateLoanRate);
    if (corpLoanRate !== undefined && !Number.isNaN(corpLoanRate)) {
      actions.push({
        type: 'adjustRate',
        productType: AssetProductType.CorporateLoans,
        newRate: corpLoanRate,
      });
    }

    const issueDebtAmt = parseNum(actionForm.issueLTDebtAmount);
    if (issueDebtAmt && !Number.isNaN(issueDebtAmt) && issueDebtAmt > 0) {
      actions.push({
        type: 'issueDebt',
        productType: LiabilityProductType.WholesaleFundingLT,
        amount: issueDebtAmt,
        rate: 0,
      });
    }

    const issueEquityAmt = parseNum(actionForm.issueEquityAmount);
    if (issueEquityAmt && !Number.isNaN(issueEquityAmt) && issueEquityAmt > 0) {
      actions.push({
        type: 'issueEquity',
        amount: issueEquityAmt,
      });
    }

    const scheduledShocks = getScheduledShocksForStep(activeScenarioId, bankState.time.step);

    controller.setConfig(simConfig);
    const { nextState, events } = controller.step(bankState, actions, scheduledShocks);

    setBankState(nextState);
    setStateHistory((prev) => [...prev, nextState]);
    setEventLog((prev) => [...prev, ...events]);
  };

  const handleStartScenario = () => {
    if (!selectedScenarioId) return;
    const scenarioConfig = applyScenarioConfig(baseConfig, selectedScenarioId);
    const scenarioState = getScenarioInitialState(selectedScenarioId, scenarioConfig);
    const metrics = calculateRiskMetrics({ state: scenarioState, config: scenarioConfig });
    scenarioState.risk.riskMetrics = metrics;
    scenarioState.risk.compliance = evaluateCompliance(metrics, scenarioConfig.riskLimits);
    controller.setConfig(scenarioConfig);
    setSimConfig(scenarioConfig);
    setBankState(scenarioState);
    setStateHistory([scenarioState]);
    setEventLog([]);
    setActiveScenarioId(selectedScenarioId);
    setActionForm({
      retailDepositRate:
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.RetailDeposits)
          ?.interestRate.toString() ?? '',
      corporateDepositRate:
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === LiabilityProductType.CorporateDeposits)
          ?.interestRate.toString() ?? '',
      mortgageRate:
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.Mortgages)
          ?.interestRate.toString() ?? '',
      corporateLoanRate:
        scenarioState.financial.balanceSheet.items.find((i) => i.productType === AssetProductType.CorporateLoans)
          ?.interestRate.toString() ?? '',
      issueLTDebtAmount: '',
      issueEquityAmount: '',
    });
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-content">
          <div className="eyebrow">Bank strategy lab</div>
          <h1>UK Bank Simulator</h1>
          <p className="muted">Tune pricing, issue capital, and run scenarios to watch the balance sheet respond in real time.</p>
          <div className="hero-pills">
            <span className="pill">Month {bankState.time.step}</span>
            <button className="button small" type="button" onClick={() => setIsActionsOpen(true)}>
              Actions
            </button>
            <button
              className="button primary small"
              type="button"
              onClick={handleRunNextMonth}
              disabled={bankState.status.hasFailed}
            >
              Run next month
            </button>
            <span className={`pill ${bankState.status.hasFailed ? 'danger' : 'success'}`}>
              {bankState.status.hasFailed ? 'Resolution mode' : 'Going concern'}
            </span>
            <span className="pill warning">{activeScenarioId ? `Scenario: ${activeScenarioId}` : 'Sandbox mode'}</span>
          </div>
        </div>
        <div className="hero-side">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Theme</span>
            <button
              className="button ghost"
              onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
            >
              {theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            </button>
          </div>
          <div className="muted align-right">
            ROE {formatRatio(roe)} • NIM {formatRatio(nim)}
          </div>
          <div className="hero-pills" style={{ justifyContent: 'flex-end' }}>
            <span className="pill">Assets {formatCurrency(totalAssets)}</span>
            <span className="pill">Equity {formatCurrency(totalEquity)}</span>
          </div>
          <div className="muted" style={{ textAlign: 'right', fontSize: 13 }}>
            Use the Actions panel to adjust pricing, raise capital, and run the next month.
          </div>
        </div>
      </header>

      {bankState.status.hasFailed && (
        <div className="alert danger">
          <div style={{ fontWeight: 700 }}>Bank failed or regulatory breach occurred.</div>
          <div className="muted" style={{ marginTop: 6 }}>{failureSummary}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            <strong>Final metrics:</strong> CET1 {formatRatio(bankState.risk.riskMetrics.cet1Ratio)}, Leverage {formatRatio(bankState.risk.riskMetrics.leverageRatio)}, LCR {formatRatio(bankState.risk.riskMetrics.lcr)}, NSFR {formatRatio(bankState.risk.riskMetrics.nsfr)}.
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            <strong>Recent events:</strong>
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {eventLog.slice(-5).map((e) => (
                <li key={e.id}>[{e.severity.toUpperCase()}] {e.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Overview' && (
        <div className="section-grid">
          <div className="card">
            <TopMetricsPanel
              riskMetrics={bankState.risk.riskMetrics}
              equity={totalEquity}
              assets={totalAssets}
              roe={roe}
              nim={nim}
            />
          </div>
          <ExogenousVariablesPanel market={bankState.market} config={simConfig} />
        </div>
      )}

      {activeTab === 'Scenarios' && (
        <section className="stack">
          <h2>Scenarios</h2>
          <div className="grid-two">
            <ScenarioSelector
              scenarios={scenarios}
              selectedId={selectedScenarioId}
              onSelect={(id) => setSelectedScenarioId(id)}
              onStart={handleStartScenario}
              description={scenarios.find((s) => s.id === selectedScenarioId)?.description}
            />
            <div className="card stack">
              <div className="eyebrow">What to expect</div>
              <p className="muted">
                Starting a scenario reloads the bank with tailored settings and scheduled shocks. You can still tweak pricing and
                funding in the Actions panel once the scenario is active.
              </p>
              <div className="muted" style={{ marginTop: 8 }}>
                {activeScenarioId ? `Currently running: ${activeScenarioId}` : 'No scenario running; sandbox mode active.'}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'Accounts' && (
        <section className="stack">
          <h2>Accounts</h2>
          <AccountsPanel state={bankState} history={stateHistory} />
        </section>
      )}

      {activeTab === 'Regulatory' && (
        <section className="stack">
      <h2>Regulatory Metrics</h2>
      <RegMetricsPanel
        state={bankState}
        history={stateHistory}
        config={simConfig}
      />
    </section>
  )}

      {activeTab === 'Loans' && (
        <section className="stack">
          <h2>Loans</h2>
          <LoansPanel items={bankState.financial.balanceSheet.items} loanCohorts={bankState.loanCohorts} />
        </section>
      )}

      {activeTab === 'Costs' && (
        <section className="stack">
          <h2>Costs</h2>
          <CostsPanel income={bankState.financial.incomeStatement} />
        </section>
      )}

      {activeTab === 'Events' && (
        <section className="stack">
          <h2>Event Log</h2>
          <EventLog events={eventLog} />
        </section>
      )}

      {activeTab === 'Reconciliations' && (
        <section className="stack">
          <h2>Reconciliations</h2>
          <ReconciliationPanel state={bankState} />
        </section>
      )}

      <button
        type="button"
        className={`actions-handle ${isActionsOpen ? 'open' : ''}`}
        onClick={() => setIsActionsOpen(true)}
        aria-haspopup="dialog"
        aria-controls="actions-panel"
        aria-expanded={isActionsOpen}
        aria-hidden={isActionsOpen}
        tabIndex={isActionsOpen ? -1 : 0}
      >
        <span>Actions</span>
      </button>

      <div
        className={`actions-drawer-overlay ${isActionsOpen ? 'open' : ''}`}
        onClick={() => setIsActionsOpen(false)}
        aria-hidden={!isActionsOpen}
      />

      <aside
        id="actions-panel"
        className={`actions-drawer ${isActionsOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal={isActionsOpen ? true : undefined}
        aria-label="Actions panel"
        aria-hidden={!isActionsOpen}
      >
        <div ref={actionsDrawerContentRef} className="actions-drawer-content">
          <div className="actions-drawer-header">
            <div>
              <div className="eyebrow">Actions</div>
              <h2 style={{ marginTop: 6 }}>Next month levers</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                Adjust pricing, raise funding, and run the simulation from one place.
              </p>
            </div>
            <button
              ref={actionsCloseButtonRef}
              className="button icon"
              type="button"
              onClick={() => setIsActionsOpen(false)}
              aria-label="Close actions panel"
            >
              ✕
            </button>
          </div>

          <div className="card stack">
            <ActionsPanel
              state={actionForm}
              onChange={setActionForm}
              onSubmit={handleRunNextMonth}
              disabled={bankState.status.hasFailed}
            />
          </div>
        </div>
      </aside>

    </div>
  );
};

export default App;

const buildFailureSummary = (compliance: ComplianceStatus, risk: RiskMetrics): string => {
  if (!compliance) return '';
  if (compliance.lcrBreached) {
    return `Liquidity Coverage Ratio dropped below requirement; HQLA was insufficient versus net outflows (LCR=${formatRatio(risk.lcr)}).`;
  }
  if (compliance.nsfrBreached) {
    return `Stable funding shortfall; NSFR dipped below 1.0 (NSFR=${formatRatio(risk.nsfr)}).`;
  }
  if (compliance.cet1Breached) {
    return `CET1 ratio fell under the minimum buffer (CET1 ratio=${formatRatio(risk.cet1Ratio)}).`;
  }
  if (compliance.leverageBreached) {
    return `Leverage backstop breached (Leverage ratio=${formatRatio(risk.leverageRatio)}).`;
  }
  return `The bank failed due to unspecified breach.`;
};

const formatRatio = (value: number): string => {
  if (!Number.isFinite(value)) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
};

const formatCurrency = (value: number): string => {
  if (!Number.isFinite(value)) return 'N/A';
  return `£${(value / 1e9).toFixed(1)}bn`;
};
