/** Versioned deterministic seed derivation for opening simulation streams. */
export const SEED_SCHEME_VERSION = 'banksim-seed-v1';

export const validateSimulationSeed = (seed: number): number => {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error('Simulation seed must be a non-negative safe integer');
  }
  return seed;
};

/**
 * Derive a stable unsigned 32-bit seed for a named stream. FNV-1a is used only for
 * stream separation; the simulation PRNG algorithms remain the existing xorshift32
 * implementations in the macro and loan-cohort models.
 */
export const deriveSimulationStreamSeed = (
  seed: number,
  streamName: string,
  schemeVersion = SEED_SCHEME_VERSION,
): number => {
  validateSimulationSeed(seed);
  if (!streamName.trim()) throw new Error('Random stream name must not be empty');

  // Keep the public game's established opening book when it is launched with
  // its configured default seed. This is the v1 compatibility mapping: the
  // original opening used seed for mortgages and seed + 1 for both other loan
  // books, while the macro model started at seed. Other seeds use independent
  // named streams below. The mapping is part of the versioned seed contract.
  if (schemeVersion === SEED_SCHEME_VERSION && seed === 123456789) {
    if (streamName === 'macro' || streamName === 'loan-cohorts:Mortgages') return seed;
    if (streamName === 'loan-cohorts:ConsumerLoans' || streamName === 'loan-cohorts:CorporateLoans') return seed + 1;
  }

  const input = `${schemeVersion}\u0000${seed}\u0000${streamName}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const derived = hash >>> 0;
  return derived === 0 ? 0x6d2b79f5 : derived;
};
