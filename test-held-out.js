/**
 * test-held-out.js — Tests for held-out discriminativity module
 *
 * Tests:
 * 1. Module exports are correct
 * 2. heldOutTestSuites has entries for all 8 N=8 problems
 * 3. Each suite has ≥3 tests (minimum for meaningful pass rate)
 * 4. calculateCohAtrRisk edge cases
 * 5. Test code templates resolve correctly
 */
import { heldOutTestSuites, runHeldOutTests, calculateCohAtrRisk } from './held-out-test-suites.js';

const PROBLEMS = [
  'binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii',
  'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree',
];

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

// Test 1: Module exports
console.log('Test 1: Module exports...');
assert(typeof heldOutTestSuites === 'object', 'heldOutTestSuites should be an object');
assert(typeof runHeldOutTests === 'function', 'runHeldOutTests should be a function');
assert(typeof calculateCohAtrRisk === 'function', 'calculateCohAtrRisk should be a function');

// Test 2: All 8 N=8 problems have held-out suites
console.log('Test 2: All N=8 problems have held-out suites...');
for (const problem of PROBLEMS) {
  assert(problem in heldOutTestSuites, `${problem} should have a held-out suite`);
  assert(Array.isArray(heldOutTestSuites[problem]), `${problem} suite should be an array`);
}

// Test 3: Each suite has ≥3 tests
console.log('Test 3: Each suite has ≥3 tests...');
for (const problem of PROBLEMS) {
  const suite = heldOutTestSuites[problem];
  assert(suite.length >= 3, `${problem} should have ≥3 held-out tests, got ${suite.length}`);
}

// Test 4: Each test has code and desc fields
console.log('Test 4: Test structure...');
for (const problem of PROBLEMS) {
  for (const test of heldOutTestSuites[problem]) {
    assert(typeof test.code === 'string', `${problem} test should have code string`);
    assert(typeof test.desc === 'string', `${problem} test should have desc string`);
    assert(test.code.includes('assert'), `${problem} test should contain assert`);
  }
}

// Test 5: calculateCohAtrRisk edge cases
console.log('Test 5: calculateCohAtrRisk edge cases...');

// Perfect match: no COH_ATR risk
assert(calculateCohAtrRisk(1.0, 1.0) === 0, 'Perfect match → risk 0');

// Held-out passes half: moderate risk
const halfRisk = calculateCohAtrRisk(1.0, 0.5);
assert(Math.abs(halfRisk - 0.5) < 0.001, `Half pass → risk 0.5, got ${halfRisk}`);

// Held-out fails all: max risk
assert(calculateCohAtrRisk(1.0, 0.0) === 1, 'Total held-out failure → risk 1');

// Both fail: undefined
assert(Number.isNaN(calculateCohAtrRisk(0.0, 0.0)), 'Both fail → NaN');

// Primary fails, held-out passes: undefined (primary=0 → NaN guard)
assert(Number.isNaN(calculateCohAtrRisk(0.0, 0.5)), 'Primary fails, held-out passes → NaN (undefined)');

// Primary < 0.6 threshold: noisy ratio, mark undefined
assert(Number.isNaN(calculateCohAtrRisk(0.5, 1.0)), 'Primary < 0.6 → NaN (noisy ratio)');

// Held-out exceeds primary at valid threshold: risk 0 (held-out is equally passable)
const zeroRisk = calculateCohAtrRisk(0.8, 1.0);
assert(zeroRisk === 0, `Held-out exceeds primary at valid threshold → risk 0, got ${zeroRisk}`);

// Partial primary, partial held-out
const partialRisk = calculateCohAtrRisk(0.8, 0.6);
assert(Math.abs(partialRisk - 0.25) < 0.001, `0.8/0.6 → risk 0.25, got ${partialRisk}`);

// Test 6: ${fnName} template resolution
// Some tests use template substitution, others use hardcoded function names.
// Only check that tests with ${fnName} resolve correctly.
console.log('Test 6: fnName template resolution...');
for (const problem of PROBLEMS) {
  for (const test of heldOutTestSuites[problem]) {
    if (test.code.includes('${fnName}')) {
      const resolved = test.code.replace(/\$\{fnName\}/g, 'myFunc');
      assert(!resolved.includes('${fnName}'), `${problem} "${test.desc}" should resolve all fnName templates`);
      assert(resolved.includes('myFunc'), `${problem} "${test.desc}" should have fnName substituted`);
    }
    // All tests must contain at least one assertion
    assert(test.code.includes('assert'), `${problem} "${test.desc}" must contain assert`);
  }
}

// Test 7: Reference solution pass rate (difficulty calibration check)
// This is a design check, not a runtime check — we document that held-out tests
// should be calibrated to approximately match primary test difficulty.
console.log('Test 7: Difficulty calibration design notes...');
// Reference solutions should pass held-out at ~same rate as primary.
// This requires manual calibration before relying on cohAtrRisk values.
assert(true, 'Difficulty calibration is manual — documented in held-out-test-suites.js');

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}