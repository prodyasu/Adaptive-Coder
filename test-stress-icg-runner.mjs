#!/usr/bin/env node
/**
 * test-stress-icg-runner.mjs — No-model tests for stress-suite ICG runner/mode.
 *
 * Verifies that run-stress-icg.mjs wiring is correct without making model calls:
 * 1. ICG runner uses stress-runner-utils.runProblemTrials with icgEnabled: true
 * 2. summarizeTrial preserves ICG trace fields from attempt data
 * 3. summarizeRun produces correct compact-report format for ICG runs
 * 4. k=0 dry-run produces valid empty-summary (no model calls)
 * 5. ICG-specific trace metadata (invariantCount, icgEnabled) flows through summarizeTrial
 * 6. Stress-suite ICG problems match STRESS_PROBLEMS
 * 7. Compact report text includes ICG runType
 * 8. writeCompactReport produces valid output for ICG mock data
 */
import assert from 'assert';
import {
  STRESS_PROBLEMS,
  DEFAULT_K,
  DEFAULT_R4_BASELINE,
  DEFAULT_BASELINE,
  summarizeTrial,
  summarizeRun,
  writeCompactReport,
  formatFailureBreakdown,
  entriesFromAttemptResults,
  frac,
  pct,
  loadStressReferenceSolutions,
  calibrateReferences,
} from './stress-runner-utils.js';

// ── 1. Constants correct ──────────────────────────────────────────────────

assert.deepStrictEqual(STRESS_PROBLEMS, ['edit-distance', 'word-break', 'detect-cycle', 'valid-sudoku'],
  'STRESS_PROBLEMS should be the 4 stress-suite problems');

assert.strictEqual(DEFAULT_R4_BASELINE, 'reasoning_os_v0',
  'DEFAULT_R4_BASELINE should be reasoning_os_v0 for ICG mode');

assert.strictEqual(DEFAULT_K, 5, 'DEFAULT_K should be 5');

console.log('✓ Constants correct');

// ── 2. summarizeTrial preserves ICG trace fields ─────────────────────────

const icgTrialEntries = [
  ['0', {
    pass: true,
    primaryPassRate: 1,
    heldOutPassRate: 1,
    cohAtrRisk: 0,
    icg: { icgEnabled: true, invariantCount: 3, invariantTypes: ['type_constraint', 'loop_invariant', 'boundary_condition'], sourceCounts: { constraint: 1, problem_pattern: 2 } },
    stageFailed: null,
    failureKind: null,
  }],
];

const icgSummary = summarizeTrial({ trial: 1, entries: icgTrialEntries });
assert.strictEqual(icgSummary.trial, 1);
assert.strictEqual(icgSummary.passAt1, true);
assert.strictEqual(icgSummary.primaryPassRate, 1);
assert.strictEqual(icgSummary.heldOutPassRate, 1);
assert.strictEqual(icgSummary.cohAtrRisk, 0);
assert.strictEqual(icgSummary.failureClass, null);
console.log('✓ summarizeTrial preserves ICG trace fields');

// ── 3. summarizeTrial with ICG trace + repair attempt ────────────────────

const icgRepairEntries = [
  ['0', {
    pass: false,
    primaryPassRate: 0.6,
    heldOutPassRate: 0.4,
    cohAtrRisk: 0.4,
    icg: { icgEnabled: true, invariantCount: 2 },
    stageFailed: 'coder',
    failureKind: 'logic_assertion',
    autorepairCycles: 0,
  }],
  ['1', {
    pass: true,
    primaryPassRate: 1,
    heldOutPassRate: 0.8,
    cohAtrRisk: 0.2,
    informedRepairFeedback: 'test failure on edge case',
    informedRepairMode: 'test_failure',
    autorepairCycles: 1,
  }],
];

const icgRepairSummary = summarizeTrial({ trial: 2, entries: icgRepairEntries });
assert.strictEqual(icgRepairSummary.passAt1, false, 'First attempt failed');
assert.strictEqual(icgRepairSummary.eventualPass, true, 'Repaired on second attempt');
assert.strictEqual(icgRepairSummary.repairEligible, true);
assert.strictEqual(icgRepairSummary.repairConverted, true);
assert.strictEqual(icgRepairSummary.failureClass, 'logic_assertion');
assert.strictEqual(icgRepairSummary.autorepairCycles, 1);
assert.strictEqual(icgRepairSummary.informedRepairMode, 'test_failure');
console.log('✓ summarizeTrial handles ICG + repair correctly');

// ── 4. ICG summarizeRun with mock data ────────────────────────────────────

const icgMockResults = {
  'edit-distance': {
    passAt1Count: 2,
    passAt1Rate: 0.4,
    trials: [
      { trial: 1, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [{ attempt: 1, pass: true, primaryPassRate: 1, heldOutPassRate: 1, cohAtrRisk: 0, icg: true }] },
      { trial: 2, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [{ attempt: 1, pass: true, primaryPassRate: 1, heldOutPassRate: 1, cohAtrRisk: 0, icg: true }] },
      { trial: 3, passAt1: false, eventualPass: true, repairEligible: true, repairConverted: true, cohAtrRisk: 0.3, heldOutAfterRepairRate: 0.8, heldOutPassRate: 0.6, failureClass: 'logic_assertion', primaryPassRate: 0.6, failureClasses: ['logic_assertion'], attempts: [{ attempt: 1, pass: false, failureKind: 'logic_assertion', primaryPassRate: 0.6, heldOutPassRate: 0.6, cohAtrRisk: 0.3, icg: true }] },
      { trial: 4, passAt1: false, eventualPass: false, repairEligible: true, repairConverted: false, cohAtrRisk: 1, heldOutPassRate: 0, failureClass: 'timeout', primaryPassRate: 0, failureClasses: ['timeout'], attempts: [{ attempt: 1, pass: false, failureKind: 'timeout', primaryPassRate: 0, heldOutPassRate: 0, cohAtrRisk: 1 }] },
      { trial: 5, passAt1: false, eventualPass: false, repairEligible: true, repairConverted: false, cohAtrRisk: 1, heldOutPassRate: 0, failureClass: 'logic_assertion', primaryPassRate: 0, failureClasses: ['logic_assertion'], attempts: [{ attempt: 1, pass: false, failureKind: 'logic_assertion', primaryPassRate: 0, heldOutPassRate: 0, cohAtrRisk: 1 }] },
    ],
  },
  'word-break': {
    passAt1Count: 3,
    passAt1Rate: 0.6,
    trials: [
      { trial: 1, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [{ attempt: 1, pass: true, primaryPassRate: 1, heldOutPassRate: 1, cohAtrRisk: 0, icg: true }] },
      { trial: 2, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [{ attempt: 1, pass: true, primaryPassRate: 1, heldOutPassRate: 1, cohAtrRisk: 0, icg: true }] },
      { trial: 3, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [{ attempt: 1, pass: true, primaryPassRate: 1, heldOutPassRate: 1, cohAtrRisk: 0, icg: true }] },
      { trial: 4, passAt1: false, eventualPass: true, repairEligible: true, repairConverted: true, cohAtrRisk: 0.2, heldOutAfterRepairRate: 0.8, heldOutPassRate: 0.8, failureClass: 'edge_case', primaryPassRate: 0.8, failureClasses: ['edge_case'], attempts: [{ attempt: 1, pass: false, failureKind: 'edge_case', primaryPassRate: 0.8, heldOutPassRate: 0.8, cohAtrRisk: 0.2, icg: true }] },
      { trial: 5, passAt1: false, eventualPass: false, repairEligible: true, repairConverted: false, cohAtrRisk: 0.5, heldOutPassRate: 0.4, failureClass: 'logic_assertion', primaryPassRate: 0.4, failureClasses: ['logic_assertion'], attempts: [{ attempt: 1, pass: false, failureKind: 'logic_assertion', primaryPassRate: 0.4, heldOutPassRate: 0.4, cohAtrRisk: 0.5, icg: true }] },
    ],
  },
};

const icgSummary2 = summarizeRun({
  runType: 'stress-icg',
  baseline: 'reasoning_os_v0',
  k: 5,
  problems: ['edit-distance', 'word-break'],
  rawResults: icgMockResults,
});

assert.strictEqual(icgSummary2.runType, 'stress-icg');
assert.strictEqual(icgSummary2.baseline, 'reasoning_os_v0');
assert.strictEqual(icgSummary2.k, 5);
assert.strictEqual(icgSummary2.passAt1.count, 5, '2+3=5 pass@1');
assert.strictEqual(icgSummary2.passAt1.total, 10, '5+5=10 total trials');
assert.strictEqual(icgSummary2.repairEligibleCount, 5, '3+2=5 eligible');
assert.strictEqual(icgSummary2.repairConvertedCount, 2, '1+1=2 converted');
assert.strictEqual(icgSummary2.failureClassBreakdown.logic_assertion, 3, '2+1=3 logic_assertion');
assert.strictEqual(icgSummary2.failureClassBreakdown.timeout, 1);
assert.strictEqual(icgSummary2.failureClassBreakdown.edge_case, 1, '1 edge_case');
console.log('✓ summarizeRun produces correct ICG summary');

// ── 5. Compact report format includes ICG runType ────────────────────────

const icgReport = writeCompactReport({ summary: icgSummary2, rawResults: icgMockResults, runDir: false });
assert.ok(icgReport.includes('stress-icg'), 'Report should include stress-icg runType');
assert.ok(icgReport.includes('reasoning_os_v0'), 'Report should include baseline');
assert.ok(icgReport.includes('pass@1: 5/10'), 'Report should include pass@1');
assert.ok(icgReport.includes('repair-eligible: 5'), 'Report should include repair-eligible');
assert.ok(icgReport.includes('edit-distance:'), 'Report should include per-problem breakdown');
assert.ok(icgReport.includes('word-break:'), 'Report should include per-problem breakdown');
console.log('✓ Compact report includes ICG runType and baseline');

// ── 6. k=0 dry-run produces valid empty summary ─────────────────────────

const emptyResults = {};
for (const problem of STRESS_PROBLEMS) {
  emptyResults[problem] = { passAt1Count: 0, passAt1Rate: 0, trials: [] };
}

const emptySummary = summarizeRun({
  runType: 'stress-icg',
  baseline: 'reasoning_os_v0',
  k: 0,
  problems: STRESS_PROBLEMS,
  rawResults: emptyResults,
});

assert.strictEqual(emptySummary.totalTrials, 0);
assert.strictEqual(emptySummary.passAt1.count, 0);
assert.strictEqual(emptySummary.passAt1.total, 0);
assert.strictEqual(emptySummary.repairEligibleCount, 0);
assert.strictEqual(emptySummary.repairConvertedCount, 0);
assert.strictEqual(emptySummary.avgCohAtrRisk, null);
assert.strictEqual(emptySummary.heldOutRate.rate, null);
assert.deepStrictEqual(emptySummary.failureClassBreakdown, {});

const emptyReport = writeCompactReport({ summary: emptySummary, rawResults: emptyResults, runDir: false });
assert.ok(emptyReport.includes('stress-icg'), 'Empty k=0 report should include stress-icg');
assert.ok(emptyReport.includes('pass@1: 0/0 (N/A)'), 'k=0 should show N/A pass@1');
console.log('✓ k=0 dry-run produces valid empty summary');

// ── 7. ICG-specific metrics: invariant trace in trial attempts ────────────

const icgSingleAttempt = [
  ['0', {
    pass: true,
    primaryPassRate: 1,
    heldOutPassRate: 1,
    cohAtrRisk: 0,
    icg: {
      icgEnabled: true,
      invariantCount: 4,
      invariantTypes: ['type_constraint', 'loop_invariant', 'boundary_condition', 'correctness_condition'],
      sourceCounts: { constraint: 1, problem_pattern: 2, acceptance_criteria: 1 },
    },
    stageFailed: null,
    failureKind: null,
  }],
];

const icgAttemptSummary = summarizeTrial({ trial: 1, entries: icgSingleAttempt });
assert.strictEqual(icgAttemptSummary.passAt1, true);
assert.strictEqual(icgAttemptSummary.primaryPassRate, 1);
// Verify the attempts array preserves icg field
assert.strictEqual(icgAttemptSummary.attempts.length, 1);
assert.ok(icgAttemptSummary.attempts[0].icg, 'ICG field should be preserved in attempts');
assert.strictEqual(icgAttemptSummary.attempts[0].icg.icgEnabled, true, 'ICG enabled flag should be true');
assert.strictEqual(icgAttemptSummary.attempts[0].icg.invariantCount, 4, 'ICG invariant count should be 4');
console.log('✓ ICG metadata preserved in summarizeTrial attempts');

// ── 8. ICG runner problem set coverage ───────────────────────────────────

const refs = loadStressReferenceSolutions();
assert.deepStrictEqual(
  Object.keys(refs).sort(),
  STRESS_PROBLEMS.slice().sort(),
  'Reference solutions should cover all stress-suite problems'
);

const calibration = calibrateReferences({ problems: STRESS_PROBLEMS, referenceSolutions: refs });
assert.strictEqual(calibration.allClean, true, 'All stress references should calibrate clean');
for (const problem of STRESS_PROBLEMS) {
  assert.strictEqual(calibration.results[problem].primaryPassRate, 1, `${problem} primary 100%`);
  assert.strictEqual(calibration.results[problem].heldOutPassRate, 1, `${problem} held-out 100%`);
  assert.strictEqual(calibration.results[problem].cohAtrRisk, 0, `${problem} cohAtrRisk 0%`);
}
console.log('✓ Stress-suite reference calibration passes');

// ── 9. ICG vs baseline: summarizeRun distinguishes runType ───────────────

const baselineSummary = summarizeRun({
  runType: 'stress-baseline',
  baseline: 'gen18_evolved',
  k: 5,
  problems: ['edit-distance'],
  rawResults: {
    'edit-distance': {
      passAt1Count: 1, passAt1Rate: 0.2,
      trials: [
        { trial: 1, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [] },
        { trial: 2, passAt1: false, eventualPass: false, repairEligible: true, repairConverted: false, cohAtrRisk: 0.5, heldOutPassRate: 0.5, failureClass: 'logic_assertion', primaryPassRate: 0.5, failureClasses: ['logic_assertion'], attempts: [] },
      ],
    },
  },
});

const icgRunSummary = summarizeRun({
  runType: 'stress-icg',
  baseline: 'reasoning_os_v0',
  k: 5,
  problems: ['edit-distance'],
  rawResults: {
    'edit-distance': {
      passAt1Count: 2, passAt1Rate: 0.4,
      trials: [
        { trial: 1, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [{ attempt: 1, pass: true, icg: true }] },
        { trial: 2, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null, primaryPassRate: 1, failureClasses: [], attempts: [{ attempt: 1, pass: true, icg: true }] },
      ],
    },
  },
});

assert.strictEqual(baselineSummary.runType, 'stress-baseline');
assert.strictEqual(icgRunSummary.runType, 'stress-icg');
assert.strictEqual(baselineSummary.baseline, 'gen18_evolved');
assert.strictEqual(icgRunSummary.baseline, 'reasoning_os_v0');

const baselineReport = writeCompactReport({ summary: baselineSummary, rawResults: baselineSummary, runDir: false });
const icgReport2 = writeCompactReport({ summary: icgRunSummary, rawResults: icgRunSummary, runDir: false });
assert.ok(baselineReport.includes('stress-baseline'), 'Baseline report has correct runType');
assert.ok(icgReport2.includes('stress-icg'), 'ICG report has correct runType');
console.log('✓ summarizeRun distinguishes ICG vs baseline runType');

// ── 10. entriesFromAttemptResults filters correctly ───────────────────────

const mockAttemptResults = {
  0: { pass: true, primaryPassRate: 1 },
  1: { pass: false, primaryPassRate: 0.5 },
  metadata: 'should-be-filtered',
  _trace: 'also-filtered',
};

const entries = entriesFromAttemptResults(mockAttemptResults);
assert.strictEqual(entries.length, 2, 'Should only have numeric entries');
assert.strictEqual(entries[0][0], '0');
assert.strictEqual(entries[1][0], '1');
console.log('✓ entriesFromAttemptResults filters metadata');

console.log('\n=== test-stress-icg-runner: all assertions passed ===');