/**
 * test-r4-metrics.js — No-model tests for R4 repair conversion metrics
 *
 * Tests computeModeMetrics() and classifyTrial() from r4-metrics.js
 * using synthetic trial data. No model calls required.
 */

import { computeModeMetrics, classifyTrial } from './r4-metrics.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${message} — expected "${expected}", got "${actual}"`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  if (actual !== null && actual !== undefined && Math.abs(actual - expected) <= tolerance) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${message} — expected ~${expected} ±${tolerance}, got "${actual}"`);
  }
}

// ═══════════════════════════════════════════════════
// classifyTrial tests
// ═══════════════════════════════════════════════════

console.log('\n=== classifyTrial ===\n');

// 1. First attempt passes → not repair-eligible
const t1 = classifyTrial([
  ['0', { pass: true }],
]);
assert(!t1.repairEligible, '1: first-attempt pass → not repair-eligible');
assert(!t1.repairConverted, '1: first-attempt pass → not repair-converted');
assert(t1.passAt1, '1: passAt1 = true');
assert(t1.eventualPass, '1: eventualPass = true');
assertEqual(t1.attemptsToPass, 1, '1: attemptsToPass = 1');

// 2. First attempt fails, repair triggered, repair passes → conversion
const t2 = classifyTrial([
  ['0', { pass: false }],
  ['1', { pass: false, informedRepairFeedback: 'test info', autorepairCycles: 1 }],
  ['2', { pass: true, informedRepairFeedback: 'test info retry', autorepairCycles: 1 }],
]);
assert(t2.repairEligible, '2: first fail + repair triggered → repair-eligible');
assert(t2.repairConverted, '2: repair succeeded → repair-converted');
assert(!t2.passAt1, '2: passAt1 = false');
assert(t2.eventualPass, '2: eventualPass = true');
assertEqual(t2.attemptsToPass, 3, '2: attemptsToPass = 3');

// 3. First attempt fails, repair triggered, repair fails → no conversion
const t3 = classifyTrial([
  ['0', { pass: false }],
  ['1', { pass: false, informedRepairFeedback: 'info', autorepairCycles: 1 }],
  ['2', { pass: false, informedRepairFeedback: 'info2', autorepairCycles: 2 }],
]);
assert(t3.repairEligible, '3: first fail + repair triggered → repair-eligible');
assert(!t3.repairConverted, '3: repair failed → not repair-converted');
assert(!t3.passAt1, '3: passAt1 = false');
assert(!t3.eventualPass, '3: eventualPass = false');
assertEqual(t3.attemptsToPass, null, '3: attemptsToPass = null (never passed)');

// 4. First attempt fails, no repair triggered → not repair-eligible
const t4 = classifyTrial([
  ['0', { pass: false }],
]);
assert(!t4.repairEligible, '4: first fail + no repair → not repair-eligible');
assert(!t4.repairConverted, '4: not repair-converted');
assert(!t4.passAt1, '4: passAt1 = false');

// 5. Multiple attempts, repair on attempt 1, held-out captured
const t5 = classifyTrial([
  ['0', { pass: false }],
  ['1', { pass: true, informedRepairFeedback: 'sig feedback', autorepairCycles: 1, heldOutPassRate: 0.85 }],
]);
assert(t5.repairEligible, '5: repair triggered → eligible');
assert(t5.repairConverted, '5: repair passed → converted');
assertEqual(t5.heldOutAfterRepairRate, 0.85, '5: heldOutAfterRepairRate = 0.85');
assertEqual(t5.attemptsToPass, 2, '5: attemptsToPass = 2');

// 6. Failure class extracted
const t6 = classifyTrial([
  ['0', { pass: false, failureKind: 'logic' }],
  ['1', { pass: false, informedRepairFeedback: 'info', failureKind: 'timeout', autorepairCycles: 1 }],
]);
assertEqual(t6.failureClass, 'logic', '6: first failure class = logic');
assert(t6.failureClasses.includes('logic'), '6: failureClasses includes logic');
assert(t6.failureClasses.includes('timeout'), '6: failureClasses includes timeout');

// 7. Empty entries
const t7 = classifyTrial([]);
assert(!t7.repairEligible, '7: empty → not eligible');
assert(!t7.repairConverted, '7: empty → not converted');
assert(!t7.passAt1, '7: empty → passAt1 = false');

// ═══════════════════════════════════════════════════
// computeModeMetrics tests
// ═══════════════════════════════════════════════════

console.log('\n=== computeModeMetrics ===\n');

// 8. All pass@1, no repair eligible → conversion rate null
const m8 = computeModeMetrics({
  'binary-search': {
    passAt1Count: 5,
    passAt1Rate: 1.0,
    trials: [
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
    ],
  },
});
assertEqual(m8.repairConversionRate, null, '8: no eligible trials → null conversion rate');
assertEqual(m8.repairEligible, 0, '8: 0 eligible');
assertEqual(m8.passAt1Rate, 1.0, '8: pass@1 = 100%');
assertEqual(m8.finalSuccessRate, 1.0, '8: final success = 100%');
assertApprox(m8.avgAttemptsToPass, 1.0, 0.01, '8: avg attempts-to-pass = 1');

// 9. Mixed: some repair-eligible, some conversions
const m9 = computeModeMetrics({
  'two-sum': {
    passAt1Count: 2,
    passAt1Rate: 0.4,
    trials: [
      // pass@1 → not eligible
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [], cohAtrRisk: 0.1 },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [], cohAtrRisk: 0.1 },
      // fail → repair → pass → conversion
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 3, heldOutAfterRepairRate: 0.8, failureClass: 'logic', failureClasses: ['logic'], cohAtrRisk: 0.2 },
      // fail → repair → fail → no conversion
      { passAt1: false, repairEligible: true, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: 'timeout', failureClasses: ['timeout'], cohAtrRisk: 0.3 },
      // fail → no repair → not eligible
      { passAt1: false, repairEligible: false, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [], cohAtrRisk: 0.4 },
    ],
  },
});
assertEqual(m9.repairEligible, 2, '9: 2 repair-eligible trials');
assertEqual(m9.repairConverted, 1, '9: 1 repair-converted');
assertEqual(m9.repairConversionRate, 0.5, '9: conversion rate = 50%');
assertEqual(m9.passAt1Rate, 0.4, '9: pass@1 = 40%');
assertEqual(m9.finalSuccessRate.toFixed(2), '0.60', '9: final success = 60% (3/5)');
assertApprox(m9.avgAttemptsToPass, (1 + 1 + 3) / 3, 0.01, '9: avg attempts-to-pass = 5/3');
assertEqual(m9.heldOutAfterRepairN, 1, '9: 1 held-out measurement');
assertEqual(m9.heldOutAfterRepairRate, 0.8, '9: held-out after repair = 80%');
assertApprox(m9.avgCohAtrRisk, (0.1 + 0.1 + 0.2 + 0.3 + 0.4) / 5, 0.01, '9: avg cohAtrRisk = 0.22');

// 10. Failure class breakdown
assert(m9.byFailureClass['logic'] !== undefined, '10: logic failure class exists');
assertEqual(m9.byFailureClass['logic'].eligible, 1, '10: logic eligible = 1');
assertEqual(m9.byFailureClass['logic'].converted, 1, '10: logic converted = 1');
assert(m9.byFailureClass['timeout'] !== undefined, '10: timeout failure class exists');
assertEqual(m9.byFailureClass['timeout'].eligible, 1, '10: timeout eligible = 1');
assertEqual(m9.byFailureClass['timeout'].converted, 0, '10: timeout converted = 0');

// 11. Per-problem metrics
assert(m9.byProblem['two-sum'] !== undefined, '11: two-sum in byProblem');
assertEqual(m9.byProblem['two-sum'].repairConversion, 0.5, '11: two-sum repairConversion = 50%');
assertEqual(m9.byProblem['two-sum'].repairEligible, 2, '11: two-sum repairEligible = 2');

// 12. Multiple problems
const m12 = computeModeMetrics({
  'binary-search': {
    passAt1Count: 3,
    passAt1Rate: 0.6,
    trials: [
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 2, heldOutAfterRepairRate: 0.9, failureClass: 'signature', failureClasses: ['signature'] },
      { passAt1: false, repairEligible: true, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: 'signature', failureClasses: ['signature'] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
    ],
  },
  'two-sum': {
    passAt1Count: 1,
    passAt1Rate: 0.2,
    trials: [
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 2, heldOutAfterRepairRate: 0.7, failureClass: 'import', failureClasses: ['import'] },
      { passAt1: false, repairEligible: true, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: 'logic', failureClasses: ['logic'] },
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 3, heldOutAfterRepairRate: 0.6, failureClass: 'logic', failureClasses: ['logic'] },
      { passAt1: false, repairEligible: false, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
    ],
  },
});
// Total: 5 eligible (2 + 3), 3 converted (1 + 2) → 60%
assertEqual(m12.repairEligible, 5, '12: total eligible = 5');
assertEqual(m12.repairConverted, 3, '12: total converted = 3');
assertEqual(m12.repairConversionRate, 0.6, '12: overall conversion = 60%');
assertEqual(m12.totalTrials, 10, '12: total trials = 10');
assertEqual(m12.passAt1Rate, 0.4, '12: overall pass@1 = 40%');
// final success: binary-search 3 + two-sum 3 = 6/10
assertEqual(m12.finalSuccessRate, 0.7, '12: final success = 70%');
// held-out after repair: 0.9 + 0.7 + 0.6 = 3 values
assertEqual(m12.heldOutAfterRepairN, 3, '12: held-out n = 3');
assertApprox(m12.heldOutAfterRepairRate, (0.9 + 0.7 + 0.6) / 3, 0.01, '12: held-out avg');

// Failure class breakdown across problems
assertEqual(m12.byFailureClass['signature'].eligible, 2, '12: signature eligible = 2');
assertEqual(m12.byFailureClass['signature'].converted, 1, '12: signature converted = 1');
assertEqual(m12.byFailureClass['import'].eligible, 1, '12: import eligible = 1');
assertEqual(m12.byFailureClass['import'].converted, 1, '12: import converted = 1');
assertEqual(m12.byFailureClass['logic'].eligible, 2, '12: logic eligible = 2');
assertEqual(m12.byFailureClass['logic'].converted, 1, '12: logic converted = 1');

// Per-problem repair conversion
assertEqual(m12.byProblem['binary-search'].repairConversion, 0.5, '12: binary-search conversion = 50%');
assertApprox(m12.byProblem['two-sum'].repairConversion, 2/3, 0.01, '12: two-sum conversion = 66.7%');

// 13. Edge case: all trials fail, none eligible
const m13 = computeModeMetrics({
  'climbing-stairs': {
    passAt1Count: 0,
    passAt1Rate: 0,
    trials: [
      { passAt1: false, repairEligible: false, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: false, repairEligible: false, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
    ],
  },
});
assertEqual(m13.repairConversionRate, null, '13: no eligible → null');
assertEqual(m13.repairEligible, 0, '13: 0 eligible');
assertEqual(m13.finalSuccessRate, 0, '13: final success = 0');

// 14. Edge case: all eligible, all converted → 100%
const m14 = computeModeMetrics({
  'coin-change-ii': {
    passAt1Count: 0,
    passAt1Rate: 0,
    trials: [
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 2, heldOutAfterRepairRate: 0.95, failureClass: 'logic', failureClasses: ['logic'] },
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 2, heldOutAfterRepairRate: 0.9, failureClass: 'logic', failureClasses: ['logic'] },
    ],
  },
});
assertEqual(m14.repairConversionRate, 1.0, '14: 100% conversion');
assertEqual(m14.passAt1Rate, 0, '14: pass@1 = 0% (all needed repair)');
assertEqual(m14.finalSuccessRate, 1.0, '14: final success = 100% (all repaired successfully)');
assertApprox(m14.avgAttemptsToPass, 2.0, 0.01, '14: attempts-to-pass = 2');

// ═══════════════════════════════════════════════════
// Key causal distinction tests
// ═══════════════════════════════════════════════════

console.log('\n=== Causal distinction: repair conversion ≠ pass@1 ===\n');

// 15. Two modes with IDENTICAL pass@1 but DIFFERENT repair conversion
// Mode A: 3/5 pass@1 (all first-attempt), 0 repair eligible
// Mode B: 3/5 pass@1 (all repaired), 5/5 repair eligible, 3/5 converted
const modeA = {
  'test': {
    passAt1Count: 3,
    passAt1Rate: 0.6,
    trials: [
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: true, repairEligible: false, repairConverted: false, eventualPass: true, attemptsToPass: 1, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: false, repairEligible: false, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
      { passAt1: false, repairEligible: false, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: null, failureClasses: [] },
    ],
  },
};
const modeB = {
  'test': {
    passAt1Count: 0,
    passAt1Rate: 0,
    trials: [
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 2, heldOutAfterRepairRate: 0.8, failureClass: 'logic', failureClasses: ['logic'] },
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 2, heldOutAfterRepairRate: 0.7, failureClass: 'timeout', failureClasses: ['timeout'] },
      { passAt1: false, repairEligible: true, repairConverted: true, eventualPass: true, attemptsToPass: 3, heldOutAfterRepairRate: 0.9, failureClass: 'logic', failureClasses: ['logic'] },
      { passAt1: false, repairEligible: true, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: 'signature', failureClasses: ['signature'] },
      { passAt1: false, repairEligible: true, repairConverted: false, eventualPass: false, attemptsToPass: null, heldOutAfterRepairRate: null, failureClass: 'timeout', failureClasses: ['timeout'] },
    ],
  },
};

const mA = computeModeMetrics(modeA);
const mB = computeModeMetrics(modeB);

assertEqual(mA.passAt1Rate, 0.6, '15A: pass@1 = 60%');
assertEqual(mB.passAt1Rate, 0, '15B: pass@1 = 0%');
assertEqual(mA.repairConversionRate, null, '15A: conversion = null (no eligible trials)');
assertEqual(mB.repairConversionRate, 0.6, '15B: conversion = 60% (3/5)');
// pass@1 says modeA is better; conversion says modeB has a working repair mechanism
// This demonstrates why pass@1 is the WRONG metric for evaluating repair efficacy

// ═══════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════

console.log(`\n${'='.repeat(50)}`);
console.log(`R4 metrics tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}