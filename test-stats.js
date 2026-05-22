/**
 * test-stats.js — Phase 1 statistical rigor tests for small-N evals.
 *
 * Tests are intentionally deterministic and focused on N=4 behavior.
 */

import {
  passRate,
  exactBinomialCI,
  bootstrapCI,
  passAtK,
  exactPermutationTest,
  exactMcNemarTest,
  summarizeBinaryRun,
} from './stats.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function approx(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`FAIL: ${msg}: expected ${expected}, got ${actual}`);
  }
}

// passRate and validation
assert(passRate([true, false, true, false]) === 0.5, 'passRate handles booleans');
assert(passRate([1, 0, 1, 1]) === 0.75, 'passRate handles 0/1');
let threw = false;
try { passRate([]); } catch { threw = true; }
assert(threw, 'passRate rejects empty arrays');

// Clopper-Pearson exact 95% intervals for N=4.
let ci = exactBinomialCI(2, 4, 0.95);
approx(ci.lower, 0.0676, 0.001, '2/4 exact lower CI');
approx(ci.upper, 0.9324, 0.001, '2/4 exact upper CI');
ci = exactBinomialCI(4, 4, 0.95);
approx(ci.lower, 0.3976, 0.001, '4/4 exact lower CI');
assert(ci.upper === 1, '4/4 exact upper CI is 1');
ci = exactBinomialCI(0, 4, 0.95);
assert(ci.lower === 0, '0/4 exact lower CI is 0');
approx(ci.upper, 0.6024, 0.001, '0/4 exact upper CI');

// Bootstrap CI uses injectable RNG so reports can be reproducible.
const deterministic = bootstrapCI([true, true, false, false], {
  iterations: 2000,
  confidence: 0.95,
  seed: 12345,
});
assert(deterministic.lower >= 0 && deterministic.upper <= 1, 'bootstrap CI bounded');
assert(deterministic.lower <= 0.5 && deterministic.upper >= 0.5, 'bootstrap CI contains observed rate');
const deterministicAgain = bootstrapCI([true, true, false, false], {
  iterations: 2000,
  confidence: 0.95,
  seed: 12345,
});
assert(JSON.stringify(deterministic) === JSON.stringify(deterministicAgain), 'seeded bootstrap reproducible');

// pass@k estimator from Codex paper.
approx(passAtK({ n: 4, c: 2, k: 1 }), 0.5, 1e-12, 'pass@1 = c/n');
approx(passAtK({ n: 4, c: 2, k: 2 }), 5 / 6, 1e-12, 'pass@2 combinatorial estimator');
assert(passAtK({ n: 4, c: 2, k: 3 }) === 1, 'pass@k is 1 when k exceeds failures');

// Exact small-N permutation test for unpaired binary pipeline comparison.
const raw = [true, true, false, false];
const evolved = [true, true, true, true];
const perm = exactPermutationTest(raw, evolved, { alternative: 'greater' });
approx(perm.observedDiff, 0.5, 1e-12, 'observed difference');
approx(perm.pValue, 15 / 70, 1e-12, 'one-sided exact permutation p for 2/4 vs 4/4');
assert(perm.totalPermutations === 70, 'enumerates C(8,4) reallocations');

// Exact McNemar/sign test is better for paired same-problem comparisons.
const paired = exactMcNemarTest(raw, evolved, { alternative: 'greater' });
assert(paired.bWins === 2 && paired.aWins === 0, 'paired test counts discordant improvements');
approx(paired.pValue, 1 / 4, 1e-12, 'one-sided exact McNemar p for two discordant wins');
assert(paired.discordant === 2, 'paired test counts only discordant pairs');

// Higher-level summary combines exact and bootstrap intervals.
const summary = summarizeBinaryRun('gen18_evolved', evolved, { bootstrapIterations: 500, seed: 7 });
assert(summary.label === 'gen18_evolved', 'summary label preserved');
assert(summary.successes === 4 && summary.n === 4, 'summary counts successes');
assert(summary.rate === 1, 'summary rate is pass@1');
assert(summary.exactCI.lower < 1 && summary.exactCI.upper === 1, 'summary exact CI attached');
assert(summary.bootstrapCI.lower <= 1 && summary.bootstrapCI.upper === 1, 'summary bootstrap CI attached');

console.log('🎉 stats tests passed.');
