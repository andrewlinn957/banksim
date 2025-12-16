/**
 * UK Market Model (macro + rates + spreads)
 *
 * Purpose:
 * - Provides a small, self-contained "UK-ish" macro/market simulation model.
 * - Steps a `MarketState` forward in time and updates rates, yield curve, and credit/funding spreads.
 *
 * Exports:
 * - `fitNelsonSiegelFrom3Points(...)`: fits a yield curve shape from 3 yields.
 * - `nelsonSiegelYield(...)`: evaluates a Nelson-Siegel curve at a maturity.
 * - `advanceUkMarketState(market, dtMonths)`: mutates `market` in-place to advance the simulation.
 *
 * Side effects:
 * - Mutates the passed-in `MarketState` object (in `advanceUkMarketState`).
 * - Performs some numeric precomputation at module load time (see `UK_FACTOR_CHOL`), which can throw.
 *
 * Errors:
 * - Some helpers throw `Error` when inputs are invalid (e.g. Cholesky decomposition failures).
 * - `fitNelsonSiegelFrom3Points` throws if it is not given exactly 3 points.
 *
 * TypeScript notes:
 * - This file uses explicit type annotations (`: number`, `: void`, etc.) so the compiler can catch mistakes.
 * - Some types use TypeScript "utility types" like `Omit<...>` (a generic type).
 */
import { GdpRegime, MarketState, NelsonSiegelFactors, UkMacroFactors } from '../domain/market';

/**
 * Purpose: Clamp a number into a safe range.
 * Parameters:
 * - `v: number`: the value we want to limit.
 * - `min: number`: lower bound (inclusive).
 * - `max: number`: upper bound (inclusive).
 * Returns: `number` within `[min, max]`.
 * Side effects: none.
 * Errors: none.
 */
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

/**
 * Purpose: Smoothly maps any real number to the 0..1 range (logistic function).
 * Parameters: `x: number`.
 * Returns: `number` in (0, 1).
 * Side effects: none.
 * Errors: none.
 *
 * Note: The `if (x >= 0)` split is a numeric-stability trick to avoid overflow in `exp(...)`.
 */
const sigmoid = (x: number): number => {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
};

/**
 * Purpose: Inverse of sigmoid for probabilities (log-odds).
 * Parameters: `p: number` (usually a probability in (0, 1)).
 * Returns: `number`.
 * Side effects: none.
 * Errors: none (but `p` outside (0,1) can produce `Infinity` or `NaN`).
 *
 * TODO: Consider guarding `p` here too; callers must ensure `p` is not 0 or 1.
 */
const logit = (p: number): number => Math.log(p / (1 - p));

/**
 * Purpose: Nelson-Siegel "loading" term 1 for a given maturity.
 * Parameters:
 * - `lambda: number`: curve decay parameter.
 * - `mYears: number`: maturity in years.
 * Returns: `number`.
 * Side effects: none.
 * Errors: none.
 *
 * TODO: If `mYears` is 0, this divides by 0. Callers should keep maturities > 0.
 */
const nsLoad1 = (lambda: number, mYears: number): number => (1 - Math.exp(-lambda * mYears)) / (lambda * mYears);

/**
 * Purpose: Nelson-Siegel "loading" term 2 for a given maturity.
 * Parameters: same as `nsLoad1`.
 * Returns: `number`.
 * Side effects: none.
 * Errors: none.
 */
const nsLoad2 = (lambda: number, mYears: number): number => nsLoad1(lambda, mYears) - Math.exp(-lambda * mYears);

/**
 * Purpose: Solve a 3x3 linear system `A * x = b` using Gaussian elimination.
 * Parameters:
 * - `A: number[][]`: 3x3 matrix (array-of-arrays).
 * - `b: number[]`: length-3 right-hand side vector.
 * - `eps: number` (optional): small threshold to treat values as "too close to 0".
 * Returns: a tuple `[level, slope, curvature]` or `null` if unsolvable/unstable.
 * Side effects: none (builds a local augmented matrix `M`).
 * Errors: none (uses `null` instead of throwing).
 *
 * TypeScript notes:
 * - The return type is a union type: `[number, number, number] | null`.
 *   That means "either a 3-number tuple OR `null`", and callers must handle both cases.
 *
 * TODO: Gaussian elimination can be numerically fragile; this uses partial pivoting, but extreme inputs may still fail.
 */
const solve3x3 = (A: number[][], b: number[], eps = 1e-12): [number, number, number] | null => {
  // Build an "augmented matrix" with `b` as the last column: [A | b]
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];

  for (let col = 0; col < 3; col++) {
    // Pick the best pivot row for this column (partial pivoting improves stability).
    let pivotRow = col;
    let pivotAbs = Math.abs(M[col][col]);
    for (let row = col + 1; row < 3; row++) {
      const abs = Math.abs(M[row][col]);
      if (abs > pivotAbs) {
        pivotAbs = abs;
        pivotRow = row;
      }
    }

    // If the pivot is ~0 or non-finite, the system is singular or unstable.
    if (!Number.isFinite(pivotAbs) || pivotAbs < eps) return null;
    if (pivotRow !== col) {
      // Swap rows to move the best pivot into place.
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < eps) return null;

    for (let row = col + 1; row < 3; row++) {
      const factor = M[row][col] / pivot;
      if (!Number.isFinite(factor)) return null;
      for (let k = col; k < 4; k++) {
        // Eliminate this column entry, turning `A` into an upper-triangular matrix.
        M[row][k] -= factor * M[col][k];
      }
    }
  }

  // Back-substitution. These checks avoid dividing by ~0.
  if (Math.abs(M[2][2]) < eps || Math.abs(M[1][1]) < eps || Math.abs(M[0][0]) < eps) return null;
  const curvature = M[2][3] / M[2][2];
  const slope = (M[1][3] - M[1][2] * curvature) / M[1][1];
  const level = (M[0][3] - M[0][2] * curvature - M[0][1] * slope) / M[0][0];

  if (!Number.isFinite(level) || !Number.isFinite(slope) || !Number.isFinite(curvature)) return null;
  return [level, slope, curvature];
};

/**
 * Purpose: Fit Nelson-Siegel curve factors from exactly 3 yield observations.
 * Parameters:
 * - `lambda: number`: Nelson-Siegel decay parameter (must be > 0 to be meaningful).
 * - `points: Array<{ mYears: number; y: number }>`: 3 points: maturity (years) and yield.
 * - `fallback?: Omit<NelsonSiegelFactors, 'lambda'>`: optional fallback factors if fitting fails.
 * Returns: `Omit<NelsonSiegelFactors, 'lambda'>` (level/slope/curvature only; caller supplies `lambda`).
 * Side effects: none.
 * Errors:
 * - Throws `Error` if `points.length !== 3`.
 *
 * TypeScript notes:
 * - `Array<{ ... }>` is an "inline object type": each element must have `mYears` and `y` numbers.
 * - `Omit<T, 'k'>` is a generic utility type meaning "all properties of `T` except `'k'`".
 * - `fallbackSafe ?? yFallback()` uses nullish coalescing (`??`) to choose a fallback only when the left side is `null`/`undefined`.
 */
export const fitNelsonSiegelFrom3Points = (
  lambda: number,
  points: Array<{ mYears: number; y: number }>,
  fallback?: Omit<NelsonSiegelFactors, 'lambda'>
): Omit<NelsonSiegelFactors, 'lambda'> => {
  if (points.length !== 3) throw new Error('fitNelsonSiegelFrom3Points requires exactly 3 points');

  // Only accept a fallback if all of its numbers are finite. Otherwise we ignore it.
  const fallbackSafe =
    fallback &&
    Number.isFinite(fallback.level) &&
    Number.isFinite(fallback.slope) &&
    Number.isFinite(fallback.curvature)
      ? fallback
      : undefined;

  // "Last resort" fallback that uses the average of valid yields as the level and zeroes the other factors.
  const yFallback = (): Omit<NelsonSiegelFactors, 'lambda'> => {
    const ys = points.map((p) => p.y).filter((y) => Number.isFinite(y));
    const level = ys.length === 0 ? 0 : ys.reduce((a, y) => a + y, 0) / ys.length;
    return { level, slope: 0, curvature: 0 };
  };

  // If lambda is invalid, fitting is meaningless; use a safe fallback instead.
  if (!Number.isFinite(lambda) || lambda <= 0) {
    return fallbackSafe ?? yFallback();
  }

  // Ensure each point has finite numbers before we try to solve a linear system.
  if (!points.every(({ mYears, y }) => Number.isFinite(mYears) && Number.isFinite(y))) {
    return fallbackSafe ?? yFallback();
  }

  // The Nelson-Siegel model is linear in (level, slope, curvature) once lambda is fixed:
  // y(m) = level + slope*L1(m) + curvature*L2(m). With 3 points we can solve exactly.
  const A = points.map(({ mYears }) => [1, nsLoad1(lambda, mYears), nsLoad2(lambda, mYears)]);
  const b = points.map(({ y }) => y);
  const solved = solve3x3(A, b);
  if (solved) {
    const [level, slope, curvature] = solved;
    if (Number.isFinite(level) && Number.isFinite(slope) && Number.isFinite(curvature)) {
      return { level, slope, curvature };
    }
  }

  // If the "exact" solve failed, fall back to the provided prior (if safe).
  if (fallbackSafe) return fallbackSafe;

  // Pick the longest maturity point to anchor the level (long end ~ level in Nelson-Siegel).
  // TODO: This nested ternary is hard to read; consider rewriting for clarity if you later refactor.
  const idxLong =
    points[0].mYears >= points[1].mYears
      ? points[0].mYears >= points[2].mYears
        ? 0
        : 2
      : points[1].mYears >= points[2].mYears
        ? 1
        : 2;
  const pLong = points[idxLong];
  const other = points.filter((_, i) => i !== idxLong);
  const [pA, pB] = other;

  // Fix `level` to the long point, then solve a 2x2 for (slope, curvature).
  const level = pLong.y;
  const a11 = nsLoad1(lambda, pA.mYears);
  const a12 = nsLoad2(lambda, pA.mYears);
  const a21 = nsLoad1(lambda, pB.mYears);
  const a22 = nsLoad2(lambda, pB.mYears);
  const d = a11 * a22 - a12 * a21;

  if (Number.isFinite(d) && Math.abs(d) > 1e-12) {
    const rhs1 = pA.y - level;
    const rhs2 = pB.y - level;
    const slope = (rhs1 * a22 - a12 * rhs2) / d;
    const curvature = (a11 * rhs2 - rhs1 * a21) / d;
    if (Number.isFinite(level) && Number.isFinite(slope) && Number.isFinite(curvature)) {
      return { level, slope, curvature };
    }
  }

  return yFallback();
};

/**
 * Purpose: Compute the model-implied yield from Nelson-Siegel factors at a given maturity.
 * Parameters:
 * - `factors: NelsonSiegelFactors`: includes `level`, `slope`, `curvature`, and `lambda`.
 * - `mYears: number`: maturity in years.
 * Returns: `number` yield.
 * Side effects: none.
 * Errors: none.
 */
export const nelsonSiegelYield = (factors: NelsonSiegelFactors, mYears: number): number =>
  factors.level + factors.slope * nsLoad1(factors.lambda, mYears) + factors.curvature * nsLoad2(factors.lambda, mYears);

/**
 * Purpose: Describe the shape of a deterministic random-number generator used by this model.
 * Properties:
 * - `seed: number`: allows saving/restoring RNG state (so simulations are reproducible).
 * - `uniform(): number`: random value in [0, 1).
 * - `normal(): number`: random value roughly ~ N(0, 1) (standard normal).
 * Side effects: Calling `uniform()` / `normal()` advances internal RNG state.
 */
interface Rng {
  seed: number;
  uniform: () => number;
  normal: () => number;
}

/**
 * Purpose: Create a small fast RNG from a seed (deterministic; no `Math.random()`).
 * Parameters: `seed: number`.
 * Returns: `Rng`.
 * Side effects: The returned object keeps internal mutable state; calling it changes future outputs.
 * Errors: none.
 *
 * TypeScript notes:
 * - The returned object includes a getter/setter for `seed`, which still satisfies the `Rng` interface.
 */
const createRng = (seed: number): Rng => {
  // Bitwise ops in JS/TS convert numbers to 32-bit signed integers.
  let s = seed | 0;
  if (s === 0) s = 0x6d2b79f5;

  // Xorshift-style PRNG producing a 32-bit unsigned integer.
  const nextUint32 = (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };

  // Scale a 32-bit integer into a floating point number in [0, 1).
  const uniform = (): number => nextUint32() / 0x1_0000_0000;

  // Box-Muller transform: turns two uniforms into one standard-normal value.
  const normal = (): number => {
    let u1 = 0;
    // Avoid `log(0)` which would produce `-Infinity`.
    while (u1 <= 0) u1 = uniform();
    const u2 = uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  return {
    get seed() {
      return s >>> 0;
    },
    set seed(v: number) {
      s = v | 0;
      if (s === 0) s = 0x6d2b79f5;
    },
    uniform,
    normal,
  };
};

/**
 * Purpose: Compute a Cholesky factor `L` of a symmetric positive-definite matrix: `matrix = L * L^T`.
 * Parameters:
 * - `matrix: number[][]`: NxN matrix.
 * - `diagEps: number`: small threshold to detect non-positive diagonals.
 * Returns: `number[][]` lower-triangular matrix `L`.
 * Side effects: none.
 * Errors:
 * - Throws `Error` if the matrix is not square, or if the decomposition fails.
 *
 * TODO: Inputs are assumed symmetric; this does not check symmetry explicitly.
 */
const choleskyDecompositionOnce = (matrix: number[][], diagEps: number): number[][] => {
  const n = matrix.length;
  for (let i = 0; i < n; i++) {
    // Optional chaining `matrix[i]?.length` avoids crashing if `matrix[i]` is `undefined`.
    if (matrix[i]?.length !== n) throw new Error('Cholesky decomposition requires a square matrix');
  }

  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k++) {
        sum -= L[i][k] * L[j][k];
      }

      if (!Number.isFinite(sum)) throw new Error('Cholesky decomposition failed: non-finite intermediate value');

      if (i === j) {
        // Diagonal must be positive for SPD matrices.
        if (sum <= diagEps) {
          throw new Error(`Cholesky decomposition failed: matrix not SPD (diag ${i} = ${sum})`);
        }
        L[i][j] = Math.sqrt(sum);
      } else {
        const diag = L[j][j];
        if (diag <= diagEps) {
          throw new Error(`Cholesky decomposition failed: near-zero diagonal at ${j} (${diag})`);
        }
        L[i][j] = sum / diag;
      }
    }
  }
  return L;
};

/**
 * Purpose: Robust Cholesky decomposition with retries (adds small "jitter" to the diagonal if needed).
 * Parameters: `matrix: number[][]`.
 * Returns: `number[][]` lower-triangular `L`.
 * Side effects: none.
 * Errors:
 * - Throws the last encountered error if all attempts fail.
 *
 * TypeScript notes:
 * - `lastErr: unknown` is intentionally "unknown" until we check it.
 * - `lastErr instanceof Error` is type narrowing: inside the `?` branch, TypeScript knows it's an `Error`.
 */
const choleskyDecomposition = (matrix: number[][]): number[][] => {
  const diagEps = 1e-12;
  const maxAttempts = 8;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // If the matrix is "almost SPD" (tiny negative eigenvalues due to rounding),
    // adding a small diagonal jitter can make Cholesky succeed.
    const jitter = attempt === 0 ? 0 : diagEps * 10 ** (attempt - 1);
    const m =
      jitter === 0
        ? matrix
        : matrix.map((row, i) => row.map((v, j) => (i === j ? v + jitter : v)));
    try {
      return choleskyDecompositionOnce(m, diagEps);
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Cholesky decomposition failed');
};

/**
 * Purpose: Multiply a lower-triangular matrix `L` by a vector `z` (out = L * z).
 * Parameters:
 * - `L: number[][]`: lower-triangular NxN matrix.
 * - `z: number[]`: length-N vector.
 * Returns: `number[]` length-N.
 * Side effects: none.
 * Errors: none.
 */
const matVecLower = (L: number[][], z: number[]): number[] => {
  const n = L.length;
  const out = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j <= i; j++) {
      sum += L[i][j] * z[j];
    }
    out[i] = sum;
  }
  return out;
};

/**
 * Purpose: Convert standard deviations + correlation matrix into a covariance matrix.
 * Parameters:
 * - `sds: number[]`: standard deviations (volatilities).
 * - `corr: number[][]`: correlation matrix (values typically in [-1, 1]).
 * Returns: `number[][]` covariance matrix.
 * Side effects: none.
 * Errors: none.
 *
 * TODO: This assumes `corr` is square and matches `sds.length`; invalid input could throw later.
 */
const buildCovariance = (sds: number[], corr: number[][]): number[][] => {
  const n = sds.length;
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cov[i][j] = corr[i][j] * sds[i] * sds[j];
    }
  }
  return cov;
};

// Parameter "knobs" for the UK-style macro + market dynamics.
const UK_PARAMS = {
  factors: {
    A: [0.85, 0.7, 0.8, 0.97],
    sds: [0.25, 0.22, 0.28, 0.08],
    corr: [
      [1, -0.2, -0.4, 0.1],
      [-0.2, 1, 0.2, 0.1],
      [-0.4, 0.2, 1, -0.1],
      [0.1, 0.1, -0.1, 1],
    ],
  },
  gdp: {
    trendMoM: 0.001,
    alphaD: 0.0018,
    alphaS: 0.0012,
    alphaF: 0.002,
    regime: {
      normal: { mean: 0, sd: 0.0035 },
      recession: { mean: -0.0035, sd: 0.0075 },
      enterProb: 0.03,
      stayProb: 0.9,
    },
  },
  unemployment: {
    uMin: 0.02,
    uMax: 0.12,
    uBar: 0.046,
    meanReversion: 0.08,
    okun: 2.5,
    stress: 0.08,
    latentNoiseSd: 0.02,
  },
  inflation: {
    piStar: 0.02,
    kappa: 0.85,
    bS: 0.004,
    bD: 0.0015,
    noiseSd: 0.0012,
    min: -0.02,
    max: 0.15,
  },
  policy: {
    rho: 0.9,
    rNeutralRealMean: 0.0125,
    rNeutralRealStd: 0.0045,
    phiPi: 1.5,
    phiD: 0.003,
    noiseSd: 0.0007,
    min: 0,
    max: 0.12,
    longRunMean: 0.0325,
  },
  termPremium: {
    mean: 0.0185,
    rho: 0.97,
    fLoading: 0.0025,
    piLoading: 0.08,
    noiseSd: 0.0012,
    min: 0,
    max: 0.06,
    scale5y: 0.27,
  },
  curve: {
    lambda: 0.7,
    y1Reversion: 0.3,
    y1InflationLoading: 0.15,
    y5PolicyWeight: 0.35,
    y1NoiseSd: 0.0006,
    y5NoiseSd: 0.0008,
    y20NoiseSd: 0.001,
  },
  credit: {
    mean: 0.011,
    rho: 0.88,
    fLoading: 0.004,
    uLoading: 0.15,
    gLoading: 0.25,
    noiseSd: 0.0015,
    min: 0,
    max: 0.05,
  },
  marketPassThrough: {
    speed: 0.7,
    noiseSd: 0.0003,
  },
};

// Precompute the Cholesky factor once so each simulation step can sample correlated shocks cheaply.
// Side effect: this runs during module import; if the covariance matrix is invalid, it can throw.
const UK_FACTOR_CHOL = choleskyDecomposition(buildCovariance(UK_PARAMS.factors.sds, UK_PARAMS.factors.corr));

/**
 * Purpose: Evolve macro factors one step forward using correlated shocks.
 * Parameters:
 * - `f: UkMacroFactors`: current factor values (e.g., demand/supply/financial/rate).
 * - `rng: Rng`: deterministic RNG for reproducibility.
 * Returns: `UkMacroFactors` (new factors).
 * Side effects: Advances RNG state.
 * Errors: none.
 */
const evolveFactors = (f: UkMacroFactors, rng: Rng): UkMacroFactors => {
  // Draw independent standard normals, then correlate them using the Cholesky factor.
  const z = [rng.normal(), rng.normal(), rng.normal(), rng.normal()];
  const eps = matVecLower(UK_FACTOR_CHOL, z);
  const [aD, aS, aF, aR] = UK_PARAMS.factors.A;
  return {
    D: aD * f.D + eps[0],
    S: aS * f.S + eps[1],
    F: aF * f.F + eps[2],
    R: aR * f.R + eps[3],
  };
};

/**
 * Purpose: Evolve GDP "regime" (normal vs recession) as a Markov chain.
 * Parameters:
 * - `prev: GdpRegime`: previous regime (a union of string literals like `'normal' | 'recession'`).
 * - `rng: Rng`: RNG.
 * Returns: `GdpRegime`.
 * Side effects: Advances RNG state.
 * Errors: none.
 *
 * TypeScript notes:
 * - `prev === 'recession'` narrows the union type inside the `if` block.
 */
const evolveRegime = (prev: GdpRegime, rng: Rng): GdpRegime => {
  const { enterProb, stayProb } = UK_PARAMS.gdp.regime;
  if (prev === 'recession') {
    return rng.uniform() < stayProb ? 'recession' : 'normal';
  }
  return rng.uniform() < enterProb ? 'recession' : 'normal';
};

/**
 * Purpose: Simple mean reversion step toward a target.
 * Parameters: `current: number`, `target: number`, `speed: number` (0..1 is typical).
 * Returns: `number`.
 * Side effects: none.
 * Errors: none.
 *
 * TODO: If `speed` is outside [0,1], this can overshoot; callers must choose sensible values.
 */
const meanRevert = (current: number, target: number, speed: number): number => current + speed * (target - current);

/**
 * Purpose: Convert the "natural" unemployment rate (`uBar`) into latent space using logit.
 * Parameters: none (reads constants in `UK_PARAMS`).
 * Returns: `number` latent value.
 * Side effects: none.
 * Errors: none.
 *
 * Why:
 * - Unemployment is bounded (between `uMin` and `uMax`), so we model it in latent space where it's unbounded,
 *   then map back with `sigmoid(...)`.
 */
const unemploymentLatentBar = (): number => {
  const { uMin, uMax, uBar } = UK_PARAMS.unemployment;
  // Clamp probability away from 0/1 so `logit(p)` stays finite.
  const p = clamp((uBar - uMin) / (uMax - uMin), 1e-9, 1 - 1e-9);
  return logit(p);
};

/**
 * Purpose: Advance the UK market state forward by (roughly) `dtMonths` months.
 * Parameters:
 * - `market: MarketState`: the simulation state to update (mutated in place).
 * - `dtMonths: number`: time step in months (rounded to an integer number of months).
 * Returns: `void`.
 * Side effects:
 * - Mutates many fields on `market` (macro variables, rates, spreads, and RNG seed).
 * - Advances RNG state deterministically (so repeated runs with the same seed match).
 * Errors:
 * - No intentional throws here, but it can throw indirectly if upstream inputs are invalid (e.g., `market` missing expected fields).
 *
 * TODO: `dtMonths` less than 1 still advances by 1 month due to `Math.max(1, ...)`; ensure this matches intended gameplay/simulation.
 */
export const advanceUkMarketState = (market: MarketState, dtMonths: number): void => {
  // We simulate in whole months for simplicity.
  const months = Math.max(1, Math.round(dtMonths));
  // Create an RNG from the state so the simulation is reproducible and "continuous" across calls.
  const rng = createRng(market.macroModel.rngSeed);
  const uBarLatent = unemploymentLatentBar();

  for (let i = 0; i < months; i++) {
    // 1) Evolve latent macro drivers (correlated factor shocks + regime switching).
    const fNext = evolveFactors(market.macroModel.factors, rng);
    const regimeNext = evolveRegime(market.macroModel.gdpRegime, rng);

    const regimeParams = UK_PARAMS.gdp.regime[regimeNext];
    // 2) GDP growth: trend + regime mean + factor loadings + noise.
    const gdp =
      UK_PARAMS.gdp.trendMoM +
      regimeParams.mean +
      UK_PARAMS.gdp.alphaD * fNext.D -
      UK_PARAMS.gdp.alphaS * fNext.S -
      UK_PARAMS.gdp.alphaF * fNext.F +
      rng.normal() * regimeParams.sd;
    const gdpGap = gdp - UK_PARAMS.gdp.trendMoM;

    const piPrev = market.inflationRate;
    // 3) Inflation: partially mean-reverting toward piStar, plus factor shocks.
    const piNext =
      (1 - UK_PARAMS.inflation.kappa) * UK_PARAMS.inflation.piStar +
      UK_PARAMS.inflation.kappa * piPrev +
      UK_PARAMS.inflation.bS * fNext.S +
      UK_PARAMS.inflation.bD * fNext.D +
      rng.normal() * UK_PARAMS.inflation.noiseSd;
    const inflation = clamp(piNext, UK_PARAMS.inflation.min, UK_PARAMS.inflation.max);

    const xPrev = market.macroModel.unemploymentLatent;
    // 4) Unemployment (latent): mean reversion + Okun's law + stress factor + noise.
    const xNext =
      xPrev +
      UK_PARAMS.unemployment.meanReversion * (uBarLatent - xPrev) -
      UK_PARAMS.unemployment.okun * 12 * gdpGap +
      UK_PARAMS.unemployment.stress * fNext.F +
      rng.normal() * UK_PARAMS.unemployment.latentNoiseSd;
    const unemployment =
      UK_PARAMS.unemployment.uMin +
      (UK_PARAMS.unemployment.uMax - UK_PARAMS.unemployment.uMin) * sigmoid(xNext);

    // 5) Policy rate: a Taylor-rule-like target plus smoothing (rho).
    const rNeutralReal = UK_PARAMS.policy.rNeutralRealMean + UK_PARAMS.policy.rNeutralRealStd * fNext.R;
    const policyTarget =
      rNeutralReal +
      inflation +
      UK_PARAMS.policy.phiPi * (inflation - UK_PARAMS.inflation.piStar) +
      UK_PARAMS.policy.phiD * fNext.D;
    const rPrev = market.baseRate;
    const bankRate =
      UK_PARAMS.policy.rho * rPrev +
      (1 - UK_PARAMS.policy.rho) * policyTarget +
      rng.normal() * UK_PARAMS.policy.noiseSd;
    const bankRateClamped = clamp(bankRate, UK_PARAMS.policy.min, UK_PARAMS.policy.max);

    // 6) Term premium: mean-reverting with macro loadings.
    const tpPrev = market.macroModel.termPremium;
    const tpNext =
      UK_PARAMS.termPremium.mean +
      UK_PARAMS.termPremium.rho * (tpPrev - UK_PARAMS.termPremium.mean) +
      UK_PARAMS.termPremium.fLoading * fNext.F +
      UK_PARAMS.termPremium.piLoading * (inflation - UK_PARAMS.inflation.piStar) +
      rng.normal() * UK_PARAMS.termPremium.noiseSd;
    const termPremium = clamp(tpNext, UK_PARAMS.termPremium.min, UK_PARAMS.termPremium.max);

    // 7) Build a simple yield curve and then fit a smooth Nelson-Siegel curve through 1y/5y/20y.
    const neutralNominal = rNeutralReal + UK_PARAMS.inflation.piStar;
    const y1 =
      bankRateClamped +
      UK_PARAMS.curve.y1Reversion * (neutralNominal - bankRateClamped) +
      UK_PARAMS.curve.y1InflationLoading * (inflation - UK_PARAMS.inflation.piStar) +
      rng.normal() * UK_PARAMS.curve.y1NoiseSd;
    const y5Expected = neutralNominal + UK_PARAMS.curve.y5PolicyWeight * (bankRateClamped - neutralNominal);
    const y5 = y5Expected + UK_PARAMS.termPremium.scale5y * termPremium + rng.normal() * UK_PARAMS.curve.y5NoiseSd;
    const y20 = neutralNominal + termPremium + rng.normal() * UK_PARAMS.curve.y20NoiseSd;

    // Optional chaining (`?.`) safely reads `market.giltCurve.nelsonSiegel` even if `giltCurve` is missing.
    const prevNs = market.giltCurve?.nelsonSiegel;
    // Nullish coalescing (`??`) falls back only when `prevNs?.lambda` is `null`/`undefined` (not when it's 0).
    const lambdaRaw = prevNs?.lambda ?? UK_PARAMS.curve.lambda;
    const lambda = Number.isFinite(lambdaRaw) && lambdaRaw > 1e-6 ? lambdaRaw : UK_PARAMS.curve.lambda;
    const nsFallback =
      prevNs && Number.isFinite(prevNs.level) && Number.isFinite(prevNs.slope) && Number.isFinite(prevNs.curvature)
        ? { level: prevNs.level, slope: prevNs.slope, curvature: prevNs.curvature }
        : undefined;
    const ns = fitNelsonSiegelFrom3Points(
      lambda,
      [
        { mYears: 1, y: y1 },
        { mYears: 5, y: y5 },
        { mYears: 20, y: y20 },
      ],
      nsFallback
    );
    // Type annotation here makes it explicit this object satisfies the `NelsonSiegelFactors` interface.
    const nsFactors: NelsonSiegelFactors = { ...ns, lambda };

    const yields = {
      y1: nelsonSiegelYield(nsFactors, 1),
      y2: nelsonSiegelYield(nsFactors, 2),
      y3: nelsonSiegelYield(nsFactors, 3),
      y5: nelsonSiegelYield(nsFactors, 5),
      y10: nelsonSiegelYield(nsFactors, 10),
      y20: nelsonSiegelYield(nsFactors, 20),
      y30: nelsonSiegelYield(nsFactors, 30),
    };

    // 8) Credit spread: mean reversion + macro loadings + noise.
    const spreadPrev = market.creditSpread;
    const spreadNext =
      UK_PARAMS.credit.mean +
      UK_PARAMS.credit.rho * (spreadPrev - UK_PARAMS.credit.mean) +
      UK_PARAMS.credit.fLoading * fNext.F +
      UK_PARAMS.credit.uLoading * (unemployment - UK_PARAMS.unemployment.uBar) -
      UK_PARAMS.credit.gLoading * gdpGap +
      rng.normal() * UK_PARAMS.credit.noiseSd;
    const creditSpread = clamp(spreadNext, UK_PARAMS.credit.min, UK_PARAMS.credit.max);

    // 9) Commit the macro/rates updates to the shared market state (this is mutation / side effect).
    market.gdpGrowthMoM = gdp;
    market.inflationRate = inflation;
    market.unemploymentRate = unemployment;
    market.baseRate = bankRateClamped;

    market.giltCurve = { nelsonSiegel: nsFactors, yields };
    market.riskFreeShort = yields.y1;
    market.riskFreeLong = yields.y30;

    market.creditSpread = creditSpread;

    // 10) Pass spreads through to product rates with some inertia/noise.
    const pass = UK_PARAMS.marketPassThrough.speed;
    const noise = UK_PARAMS.marketPassThrough.noiseSd;

    const targetWholesale = 0.003 + 0.7 * creditSpread;
    const targetSenior = 0.004 + 0.8 * creditSpread;
    const targetCorpLoan = 0.017 + 1.0 * creditSpread;
    const targetMortgage = 0.012 + 0.4 * creditSpread;

    market.wholesaleFundingSpread = clamp(
      meanRevert(market.wholesaleFundingSpread, targetWholesale, pass) + rng.normal() * noise,
      0,
      0.08
    );
    market.seniorDebtSpread = clamp(
      meanRevert(market.seniorDebtSpread, targetSenior, pass) + rng.normal() * noise,
      0,
      0.1
    );
    market.corporateLoanSpread = clamp(
      meanRevert(market.corporateLoanSpread, targetCorpLoan, pass) + rng.normal() * noise,
      0,
      0.12
    );
    market.mortgageSpread = clamp(
      meanRevert(market.mortgageSpread, targetMortgage, pass) + rng.normal() * noise,
      0,
      0.12
    );

    const giltHaircutTarget = 0.02 + 0.015 * Math.max(0, fNext.F) + 0.2 * creditSpread;
    const corpBondHaircutTarget = 0.05 + 0.05 * Math.max(0, fNext.F) + 0.5 * creditSpread;

    market.giltRepoHaircut = clamp(meanRevert(market.giltRepoHaircut, giltHaircutTarget, 0.25), 0.005, 0.2);
    market.corpBondRepoHaircut = clamp(
      meanRevert(market.corpBondRepoHaircut, corpBondHaircutTarget, 0.25),
      0.02,
      0.4
    );

    // Deposit rates are constrained to be non-negative and not exceed the base rate.
    const competitorDepositTarget = Math.max(0, bankRateClamped - 0.025);
    market.competitorRetailDepositRate = clamp(
      meanRevert(market.competitorRetailDepositRate, competitorDepositTarget, 0.25) + rng.normal() * noise,
      0,
      bankRateClamped
    );
    if (market.competitorCorporateDepositRate !== undefined) {
      // This `!== undefined` check narrows the type so TypeScript knows the field is safe to assign to.
      market.competitorCorporateDepositRate = clamp(
        meanRevert(market.competitorCorporateDepositRate, competitorDepositTarget + 0.005, 0.5) + rng.normal() * noise,
        0,
        bankRateClamped
      );
    }

    const competitorMortgageTarget = yields.y5 + market.mortgageSpread - 0.005;
    market.competitorMortgageRate = clamp(
      meanRevert(market.competitorMortgageRate, competitorMortgageTarget, 0.2) + rng.normal() * noise,
      0,
      0.2
    );

    market.macroModel = {
      ...market.macroModel,
      factors: fNext,
      gdpRegime: regimeNext,
      unemploymentLatent: xNext,
      termPremium,
    };
  }

  // Save the RNG state so the next call continues the same random sequence.
  market.macroModel.rngSeed = rng.seed;
};
