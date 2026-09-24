import type { Scenario } from '../config/scenarios';
import type { ScenarioBriefingView } from '../game/scenarioBriefing';
import { scenarioArtwork } from './scenarioArtwork';

interface Props {
  scenario: Scenario | null;
  briefing: ScenarioBriefingView | null;
  isCurrent: boolean;
  hasSelection: boolean;
  onStart: () => void;
}

export default function ScenarioBriefingPanel({ scenario, briefing, isCurrent, hasSelection, onStart }: Props) {
  if (!scenario || !briefing) {
    return <section className="scenario-briefing scenario-briefing-empty" aria-live="polite">
      <div className="eyebrow">Scenario briefing</div>
      <p>Select a scenario to see its opening pressure and event sequence.</p>
    </section>;
  }

  return <section className="scenario-briefing" aria-live="polite">
    <div className="scenario-briefing-art">
      {scenarioArtwork[scenario.id]&&<img src={scenarioArtwork[scenario.id]} alt="" />}
      <span>{isCurrent?'Current run':'Scenario briefing'}</span>
    </div>
    <div className="scenario-briefing-body">
      <div className="scenario-title-row"><div><h3>{scenario.name}</h3><p>{scenario.description}</p></div></div>
      <div className="scenario-pressure-grid">
        <div><strong>Opening pressure</strong><span>{briefing.openingPressure}</span></div>
        <div><strong>First decision</strong><span>{briefing.firstDecision}</span></div>
      </div>
      <div className="scenario-timeline-block">
        <strong className="scenario-timeline-title">Pressure schedule</strong>
        <ol className="scenario-timeline">
          {briefing.timeline.map((beat) => (
            <li key={beat.stepNumber}>
              <span className="scenario-timeline-period">{beat.stepNumber===0?'At start':`Month ${beat.stepNumber}`}</span>
              {beat.scheduled.length>0&&<span className="scenario-timeline-event">{beat.scheduled.join(' · ')}</span>}
              {beat.conditional.length>0&&<span className="scenario-timeline-conditional"><small>Conditional</small>{beat.conditional.join(' / ')}</span>}
            </li>
          ))}
        </ol>
      </div>
      <button className="button primary scenario-start" disabled={!hasSelection} onClick={onStart}>
        {isCurrent&&hasSelection?'Restart this scenario':'Start scenario'}
      </button>
    </div>
  </section>;
}
