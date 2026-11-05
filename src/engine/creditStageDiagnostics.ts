import type { BankState } from '../domain/bankState';

/** Gross funded exposures; PD averages cover performing cohorts only. */
export const creditStageDiagnostics = (state: BankState) => {
  const stageGross = { stage1: 0, stage2: 0, stage3: 0 };
  let performingGross = 0, referencePdSum = 0, currentPdSum = 0, stage2CureProbationGross = 0;
  for (const cohorts of Object.values(state.loanCohorts)) {
    for (const c of cohorts ?? []) {
      const gross = Math.max(0, c.outstandingPrincipal);
      stageGross[c.stage] += gross;
      if (c.stage !== 'stage3') {
        performingGross += gross;
        referencePdSum += gross * (c.sicrReferenceAnnualPd ?? c.annualPd);
        currentPdSum += gross * (c.effectiveAnnualPd ?? c.annualPd);
      }
      if (c.stage === 'stage2' && (c.sicrCureMonths ?? 0) > 0) stage2CureProbationGross += gross;
    }
  }
  for (const buckets of Object.values(state.workoutPipelines ?? {})) {
    for (const b of buckets ?? []) stageGross.stage3 += Math.max(0, b.defaultedPrincipal);
  }
  return {
    stageGross,
    performingReferenceAnnualPd: performingGross > 0 ? referencePdSum / performingGross : null,
    performingCurrentAnnualPd: performingGross > 0 ? currentPdSum / performingGross : null,
    stage2CureProbationGross,
  };
};
