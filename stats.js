/**
 * stats.js — bounded Phase 1 statistics helpers for small-N evals.
 *
 * Intended for tiny harness runs (e.g. N=4), where normal approximations are
 * misleading. Prefer exact/binomial/permutation methods and clearly report
 * uncertainty.
 */

function assertInteger(value, name) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
}

function normalizeBinary(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('values must be a non-empty array');
  }
  return values.map((value, index) => {
    if (value === true || value === 1) return 1;
    if (value === false || value === 0) return 0;
    throw new Error(`values[${index}] must be boolean or 0/1`);
  });
}

export function passRate(values) {
  const xs = normalizeBinary(values);
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

// Lanczos approximation for log-gamma; sufficient for CI inversion here.
function logGamma(z) {
  const p = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }

  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return Math.sqrt(2 * Math.PI) === 0
    ? NaN
    : 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaContinuedFraction(a, b, x) {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const fpmin = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }

  return h;
}

function regularizedIncompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x)
  );

  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

function inverseRegularizedIncompleteBeta(p, a, b) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    const cdf = regularizedIncompleteBeta(mid, a, b);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function exactBinomialCI(successes, n, confidence = 0.95) {
  assertInteger(successes, 'successes');
  assertInteger(n, 'n');
  if (n <= 0) throw new Error('n must be positive');
  if (successes < 0 || successes > n) throw new Error('successes must be between 0 and n');
  if (!(confidence > 0 && confidence < 1)) throw new Error('confidence must be in (0, 1)');

  const alpha = 1 - confidence;
  const lower = successes === 0
    ? 0
    : inverseRegularizedIncompleteBeta(alpha / 2, successes, n - successes + 1);
  const upper = successes === n
    ? 1
    : inverseRegularizedIncompleteBeta(1 - alpha / 2, successes + 1, n - successes);

  return { lower, upper, confidence, method: 'clopper-pearson' };
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted, q) {
  if (sorted.length === 0) throw new Error('cannot quantile empty array');
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[sorted.length - 1];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(base + 1, sorted.length - 1)];
  return sorted[base] + rest * (next - sorted[base]);
}

export function bootstrapCI(values, options = {}) {
  const xs = normalizeBinary(values);
  const iterations = options.iterations ?? 10000;
  const confidence = options.confidence ?? 0.95;
  if (!Number.isInteger(iterations) || iterations <= 0) throw new Error('iterations must be a positive integer');
  if (!(confidence > 0 && confidence < 1)) throw new Error('confidence must be in (0, 1)');

  const rng = options.rng ?? mulberry32(options.seed ?? 0xC0FFEE);
  const rates = [];
  for (let i = 0; i < iterations; i++) {
    let successes = 0;
    for (let j = 0; j < xs.length; j++) {
      successes += xs[Math.floor(rng() * xs.length)];
    }
    rates.push(successes / xs.length);
  }
  rates.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  return {
    lower: quantile(rates, alpha / 2),
    upper: quantile(rates, 1 - alpha / 2),
    confidence,
    iterations,
    method: 'bootstrap-percentile',
  };
}

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return result;
}

export function passAtK({ n, c, k }) {
  assertInteger(n, 'n');
  assertInteger(c, 'c');
  assertInteger(k, 'k');
  if (n <= 0) throw new Error('n must be positive');
  if (c < 0 || c > n) throw new Error('c must be between 0 and n');
  if (k <= 0 || k > n) throw new Error('k must be between 1 and n');
  if (n - c < k) return 1;
  return 1 - choose(n - c, k) / choose(n, k);
}

function combinations(n, k, visit, start = 0, combo = []) {
  if (combo.length === k) {
    visit(combo);
    return;
  }
  for (let i = start; i <= n - (k - combo.length); i++) {
    combo.push(i);
    combinations(n, k, visit, i + 1, combo);
    combo.pop();
  }
}

export function exactPermutationTest(aValues, bValues, options = {}) {
  const a = normalizeBinary(aValues);
  const b = normalizeBinary(bValues);
  if (a.length !== b.length) {
    throw new Error('exactPermutationTest currently expects equal group sizes');
  }
  const alternative = options.alternative ?? 'two-sided';
  if (!['greater', 'less', 'two-sided'].includes(alternative)) {
    throw new Error('alternative must be greater, less, or two-sided');
  }

  const pooled = [...a, ...b];
  const nA = a.length;
  const observedDiff = passRate(b) - passRate(a);
  let extreme = 0;
  let totalPermutations = 0;
  const epsilon = 1e-12;

  combinations(pooled.length, nA, (indices) => {
    const inA = new Set(indices);
    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < pooled.length; i++) {
      if (inA.has(i)) sumA += pooled[i];
      else sumB += pooled[i];
    }
    const diff = sumB / (pooled.length - nA) - sumA / nA;
    totalPermutations += 1;
    if (alternative === 'greater' && diff >= observedDiff - epsilon) extreme += 1;
    else if (alternative === 'less' && diff <= observedDiff + epsilon) extreme += 1;
    else if (alternative === 'two-sided' && Math.abs(diff) >= Math.abs(observedDiff) - epsilon) extreme += 1;
  });

  return {
    observedDiff,
    pValue: extreme / totalPermutations,
    totalPermutations,
    alternative,
    method: 'exact-permutation-unpaired-binary',
  };
}

export function exactMcNemarTest(aValues, bValues, options = {}) {
  const a = normalizeBinary(aValues);
  const b = normalizeBinary(bValues);
  if (a.length !== b.length) throw new Error('paired samples must have equal length');
  const alternative = options.alternative ?? 'two-sided';
  if (!['greater', 'less', 'two-sided'].includes(alternative)) {
    throw new Error('alternative must be greater, less, or two-sided');
  }

  let aWins = 0; // a succeeds where b fails
  let bWins = 0; // b succeeds where a fails
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 1 && b[i] === 0) aWins += 1;
    if (a[i] === 0 && b[i] === 1) bWins += 1;
  }
  const discordant = aWins + bWins;
  let pValue = 1;
  if (discordant > 0) {
    if (alternative === 'greater') {
      // B is greater than A: P(X >= bWins), X ~ Binomial(discordant, 0.5)
      pValue = 0;
      for (let x = bWins; x <= discordant; x++) pValue += choose(discordant, x) / (2 ** discordant);
    } else if (alternative === 'less') {
      // B is less than A: P(X <= bWins), X ~ Binomial(discordant, 0.5)
      pValue = 0;
      for (let x = 0; x <= bWins; x++) pValue += choose(discordant, x) / (2 ** discordant);
    } else {
      // Exact two-sided binomial sign test over discordant pairs.
      const observed = Math.min(aWins, bWins);
      pValue = 0;
      for (let x = 0; x <= discordant; x++) {
        if (x <= observed || x >= discordant - observed) {
          pValue += choose(discordant, x) / (2 ** discordant);
        }
      }
      pValue = Math.min(1, pValue);
    }
  }

  return {
    aWins,
    bWins,
    discordant,
    pValue,
    alternative,
    method: 'exact-mcnemar-binomial-sign',
  };
}

export function summarizeBinaryRun(label, values, options = {}) {
  const xs = normalizeBinary(values);
  const successes = xs.reduce((sum, x) => sum + x, 0);
  return {
    label,
    n: xs.length,
    successes,
    failures: xs.length - successes,
    rate: successes / xs.length,
    exactCI: exactBinomialCI(successes, xs.length, options.confidence ?? 0.95),
    bootstrapCI: bootstrapCI(xs, {
      iterations: options.bootstrapIterations ?? options.iterations ?? 10000,
      confidence: options.confidence ?? 0.95,
      seed: options.seed,
      rng: options.rng,
    }),
  };
}
