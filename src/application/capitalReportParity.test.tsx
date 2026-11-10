import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CapitalDashboard from '../components/CapitalDashboard';
import { prepareScenarioSession } from './scenarioSession';
import { createPlayerSessionState } from './playerSession';
import { SimulationController } from './simulationController';
import { buildPlayerReport } from './playerReports';
import { buildCapitalBuffersPresentation, buildPillar2AAssessmentPresentation } from '../presentation/reports/capitalAssessments';
import { capitalDashboardData } from '../presentation/reports/capital';

const asHtmlText = (text: string) => text
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#x27;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const numberValues = (value: unknown): number[] => {
  if (typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(numberValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numberValues);
  return [];
};

describe('rendered capital report and player API use the same assessment builders', () => {
  it('exposes every GUI-visible Pillar 2A and capital-buffer/O-SII value at the rendered precision', () => {
    const prepared = prepareScenarioSession(null, { seed: 7654321 });
    const controller = new SimulationController(prepared.config);
    const session = createPlayerSessionState({ runId: 'capital-report-parity', scenarioId: null, prepared, controller });
    const report = buildPlayerReport(session, controller, 'report.regulatory.capital');
    expect(report).toBeDefined();
    if (!report) return;

    const data = report.data as {
      dashboard: {
        capitalPosition: ReturnType<typeof capitalDashboardData>['display'];
        pillar2AAssessment: NonNullable<ReturnType<typeof buildPillar2AAssessmentPresentation>>['display'] | null;
        capitalBuffers: ReturnType<typeof buildCapitalBuffersPresentation>['display'];
      };
    };
    const expectedCapital = capitalDashboardData(session.bankState, session.config);
    const expectedPillar2A = buildPillar2AAssessmentPresentation(session.bankState, session.config);
    const expectedBuffers = buildCapitalBuffersPresentation(session.bankState, session.config);
    expect(expectedPillar2A).not.toBeNull();
    expect(data.dashboard.capitalPosition).toEqual(expectedCapital.display);
    expect(data.dashboard.pillar2AAssessment).toEqual(expectedPillar2A?.display);
    expect(data.dashboard.capitalBuffers).toEqual(expectedBuffers.display);
    expect(numberValues(data.dashboard)).toEqual([]);

    const markup = renderToStaticMarkup(<CapitalDashboard state={session.bankState} config={session.config} />);
    const capital = data.dashboard.capitalPosition;
    for (const card of capital.cards) {
      expect(markup).toContain(card.name);
      expect(markup).toContain(card.status);
      expect(markup).toContain(card.actual);
      expect(markup).toContain(card.amount);
      expect(markup).toContain(card.requirement);
      expect(markup).toContain(card.requiredAmount);
      expect(markup).toContain(card.gap);
      expect(markup).toContain(card.gapAmount);
      expect(markup).toContain(card.ariaLabel);
      for (const label of card.axisLabels) expect(markup).toContain(label);
    }
    expect(markup).toContain(capital.capitalPosition.totalCapitalRatio);
    expect(markup).toContain(capital.capitalPosition.totalCapitalAmount);
    expect(markup).toContain(capital.capitalPosition.rwa);
    for (const resource of capital.capitalPosition.resources) {
      expect(markup).toContain(resource.name);
      expect(markup).toContain(resource.ratio);
      expect(markup).toContain(resource.amount);
    }
    for (const level of capital.capitalPosition.levels) {
      for (const name of level.names) expect(markup).toContain(name);
      expect(markup).toContain(level.ratio);
      expect(markup).toContain(level.amount);
    }
    for (const [barIndex, bar] of capital.requirementComposition.entries()) {
      expect(markup).toContain(bar.name);
      expect(markup).toContain(bar.requirement);
      expect(markup).toContain(bar.amount);
      for (const [segmentIndex, segment] of bar.segments.entries()) {
        expect(markup).toContain(segment.label);
        expect(markup).toContain(segment.ratio);
        expect(markup).toContain(segment.amount);
        if (expectedCapital.requirementBars[barIndex].segments[segmentIndex].ratio > 1e-12) {
          expect(markup).toContain(asHtmlText(segment.title));
        }
      }
    }
    expect(markup).toContain(capital.payoutCap);
    const p2a = data.dashboard.pillar2AAssessment;
    if (!p2a) throw new Error('Seeded session did not produce the GUI Pillar 2A assessment.');
    expect(markup).toContain(p2a.summary.effectiveRate);
    expect(markup).toContain(p2a.summary.currentAmount);
    expect(markup).toContain(p2a.chart.ariaLabel);
    for (const tick of p2a.chart.axisTickLabels) expect(markup).toContain(tick);
    for (const bar of p2a.chart.bars) {
      for (const line of bar.lines) expect(markup).toContain(line);
      expect(markup, `${bar.label} chart value`).toContain(bar.value);
    }
    for (const row of p2a.detailRows) {
      expect(markup, row.label).toContain(row.label);
      expect(markup, `${row.label} amount`).toContain(row.amount);
      expect(markup, `${row.label} ratio`).toContain(row.ratio);
    }
    for (const row of p2a.drivers) {
      expect(markup, `${row.label} driver`).toContain(row.label);
      expect(markup, `${row.label} value`).toContain(row.value);
    }
    expect(markup).toContain(asHtmlText(p2a.methodologyNote));

    const buffers = data.dashboard.capitalBuffers;
    expect(markup).toContain(buffers.total.ratio);
    expect(markup).toContain(buffers.total.amount);
    for (const row of buffers.rows) {
      expect(markup).toContain(row.label);
      expect(markup).toContain(row.ratio);
      expect(markup).toContain(row.amount);
    }
    for (const row of buffers.details) {
      expect(markup).toContain(row.label);
      expect(markup).toContain(row.value);
    }

    const osii = buffers.threshold;
    expect(markup).toContain(osii.scopeLabel);
    expect(markup).toContain(osii.inScopeLabel);
    expect(markup).toContain(osii.currentLem);
    expect(markup).toContain(osii.threshold);
    expect(markup).toContain(osii.headroom);
    expect(markup).toContain(osii.startLabel);
    expect(markup).toContain(osii.currentProgressLabel);
    expect(markup).toContain(osii.endLabel);
    for (const row of osii.details) {
      expect(markup).toContain(row.label);
      expect(markup).toContain(row.value);
    }
    expect(markup).toContain(asHtmlText(osii.methodologyNote));
  });
});
