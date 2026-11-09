import { describe, expect, it } from 'vitest';
import { applySafetyPauseToggle, boundedContinuousAdvance, monthsForPlayerAdvance } from './playerTime';

describe('shared advance-time choices', () => {
  it('aligns quarter and year runs to the current opening-relative period boundary', () => {
    expect(monthsForPlayerAdvance(0, 0, 'quarter')).toBe(3);
    expect(monthsForPlayerAdvance(0, 1, 'quarter')).toBe(2);
    expect(monthsForPlayerAdvance(4, 7, 'quarter')).toBe(3);
    expect(monthsForPlayerAdvance(0, 12, 'year')).toBe(12);
    expect(monthsForPlayerAdvance(0, 14, 'year')).toBe(10);
    expect(monthsForPlayerAdvance(0, 14, 'month')).toBe(1);
  });

  it('bounds a continuous request for month-by-month checkpoints', () => {
    expect(boundedContinuousAdvance(10, 3)).toBe(3);
    expect(() => boundedContinuousAdvance(0, 3)).toThrow(/positive integer/);
  });

  it('preserves the GUI two-step safety disable and pauses a running clock first', () => {
    const running = applySafetyPauseToggle({ enabled: true, disableArmed: false, automaticRunActive: true }, false);
    expect(running).toMatchObject({ enabled: true, disableArmed: true, automaticRunActive: false, stopAutomaticRun: true });

    const confirmed = applySafetyPauseToggle({ enabled: true, disableArmed: true, automaticRunActive: false }, false);
    expect(confirmed).toMatchObject({ enabled: false, disableArmed: false, stopAutomaticRun: false });

    const restored = applySafetyPauseToggle({ enabled: false, disableArmed: true, automaticRunActive: false }, true);
    expect(restored).toMatchObject({ enabled: true, disableArmed: false, stopAutomaticRun: false });
  });
});
