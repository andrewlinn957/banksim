import { BankState } from '../domain/bankState';
import { BoardDecision, boardDecisions, mandateProgress, monthlyBrief, quarterlyReviews } from '../game/boardroom';
import { formatCurrency, formatPct, formatSignedPct } from '../utils/formatters';
interface Props { state: BankState; history: BankState[]; selected: string[]; campaign: boolean; hasErrors: boolean; onDecision: (d: BoardDecision) => void; onRun: () => void; onPlan: () => void; onRestart: () => void; onContinue: () => void; onNavigate: (tab: string) => void; }
export default function Boardroom({ state: s, history, selected, campaign, hasErrors, onDecision, onRun, onPlan, onRestart, onContinue, onNavigate }: Props) {
  const brief = monthlyBrief(s), progress = mandateProgress(history), m = s.risk.riskMetrics;
  const reviews = quarterlyReviews(history);
  const finished = campaign && progress.finished, prior = history.at(-2);
  const changes = prior ? [
    ['Share price', formatSignedPct(s.equityMarket.sharePrice / prior.equityMarket.sharePrice - 1)],
    ['Monthly profit', formatCurrency(s.financial.incomeStatement.netIncome)],
    ['Provision charge', formatCurrency(s.financial.incomeStatement.provisionCharge)],
    ['Customer strength', formatPct(s.behaviour.depositFranchiseStrength)],
  ] : [];
  return <div className="boardroom">
    <section className="board-scene"><div className="board-scene-copy"><div className="scene-kicker">BANKSIM / {campaign ? 'THE FIRST YEAR' : 'OPEN MANDATE'}</div><span className="scene-focus">{finished ? 'The board’s verdict' : brief.focus}</span>
      <h1>{finished ? (s.status.hasFailed ? 'A difficult end to the mandate.' : `${progress.stars} stars. A year in banking.`) : brief.title}</h1>
      <p>{finished ? 'Review what your decisions delivered. Try a different strategy, or keep running the bank.' : brief.detail}</p>
      <div className="scene-actions">{finished ? <><button className="button scene-primary" onClick={onRestart}>Start a fresh year ↗</button>{!s.status.hasFailed && <button className="button scene-secondary" onClick={onContinue}>Keep playing</button>}</> : <><button className="button scene-primary" onClick={onRun} disabled={s.status.hasFailed || hasErrors}>Close month {s.time.step + 1} →</button><button className="button scene-secondary" onClick={onPlan}>Set your own terms</button></>}</div>
      {hasErrors && <p role="alert">Your plan has an invalid input. Open “Set your own terms” to correct it.</p>}
    </div><div className="month-ruler" aria-label={`${progress.elapsed} of 12 months complete`}>{Array.from({ length: 12 }, (_, i) => <span key={i} className={i < progress.elapsed ? 'complete' : ''}>{String(i + 1).padStart(2, '0')}</span>)}</div></section>
    <div className="board-kpis">{[
      { label: 'Share price', value: `£${s.equityMarket.sharePrice.toFixed(2)}`, detail: 'Your shareholders’ verdict', tab: 'Share Price' },
      { label: 'Monthly earnings', value: formatCurrency(s.financial.incomeStatement.netIncome), detail: 'After tax and impairment', tab: 'Accounts' },
      { label: 'CET1 capital', value: formatPct(m.cet1Ratio), detail: `${formatPct(m.cet1Requirement)} with combined buffers`, tab: 'Regulatory' },
      { label: 'Liquidity coverage', value: formatPct(m.lcr), detail: '100% prudential minimum', tab: 'Regulatory' },
    ].map(k => <button className="board-kpi" key={k.label} onClick={() => onNavigate(k.tab)}><span>{k.label} ↗</span><strong>{k.value}</strong><small>{k.detail}</small></button>)}</div>
    {prior && <section className="monthly-receipt" aria-live="polite"><strong>Month {s.time.step} closed</strong>{changes.map(([label, value]) => <span key={label}>{label} <b>{value}</b></span>)}<button className="button ghost small" onClick={() => onNavigate('Events')}>Read the events →</button></section>}
    <section className="quarterly-reviews" aria-label="Quarterly board objectives">{reviews.map(r => <article key={r.quarter} className={r.earned ? 'earned' : r.active ? 'active' : ''}><small>Q{r.quarter} · month {r.deadline}</small><strong>{r.earned ? '★ ' : ''}{r.title}</strong><p>{r.detail}</p><span>{r.complete ? r.earned ? 'Badge earned' : 'Objective missed' : r.active ? 'On your agenda' : 'Coming up'}</span></article>)}</section>
    <div className="board-grid"><section><div className="section-heading"><div><div className="eyebrow">Around the table</div><h2>What’s on the agenda?</h2></div><button className="button ghost" onClick={onPlan}>Review your plan ↗</button></div><p className="muted">Back a proposal to add it to your plan. You can combine proposals; the most recent choice takes precedence where terms overlap.</p><div className="proposal-grid">{boardDecisions(s).map((d, i) => <article className={`proposal ${selected.includes(d.id) ? 'selected' : ''}`} key={d.id}><div className="proposal-meta"><span className="proposal-number">0{i + 1}</span>{d.voice}</div><h3>{d.title}</h3><p>{d.pitch}</p><dl><dt>Why do it</dt><dd>{d.benefit}</dd><dt>The price</dt><dd>{d.tradeoff}</dd></dl><button className={`button ${selected.includes(d.id) ? 'primary' : 'ghost'}`} disabled={finished || s.status.hasFailed} onClick={() => onDecision(d)}>{selected.includes(d.id) ? 'Added to plan ✓' : 'Back this proposal →'}</button></article>)}</div></section>
    <aside className="mandate-card"><div className="eyebrow">The board’s mandate</div><h2>Build a bank that lasts.</h2><div className="mandate-stars" aria-label={`${progress.stars} objectives currently met`}>{'★'.repeat(progress.stars)}{'☆'.repeat(3 - progress.stars)}</div><p>Three objectives. Twelve months. Finish within the prudential minima to earn your stars.</p>{progress.objectives.map(o => <div className="mandate-objective" key={o.label}><strong>{o.achieved ? '✓ ' : ''}{o.label}</strong><small>{o.detail}</small><progress max={1} value={o.progress} aria-label={o.label} /></div>)}<div className="mandate-foot"><span>Total shareholder return</span><strong>{formatPct(progress.shareholderReturn)}</strong></div>{!progress.sound && <p className="alert warning">Restore prudential minima before the year ends to earn stars.</p>}<p className="muted">The economy changes. Old loans remember old decisions. There is no free lunch.</p></aside></div>
  </div>;
}
