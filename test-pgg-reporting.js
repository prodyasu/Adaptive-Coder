/**
 * test-pgg-reporting.js — No-model regression tests for PGG multi-arm reporting.
 *
 * The Phase 1 runner stores results as arm -> problem -> trials. The generic
 * summarizeRun() expects problem -> trials, so using it directly on multi-arm
 * data produced bogus 0/0 top-level reports. These tests pin the intended
 * canonical multi-arm summary shape.
 */

import {
  buildMultiArmComparison,
  buildMultiArmSummary,
  multiArmReportText,
} from './stress-runner-utils.js';

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
    console.log(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function trial({ passAt1, eventualPass = passAt1, pggResamples = 0, failureClass = null }) {
  return {
    passAt1,
    eventualPass,
    repairEligible: !passAt1,
    repairConverted: false,
    heldOutPassRate: eventualPass ? 1 : null,
    cohAtrRisk: eventualPass ? 0 : null,
    pggResamples,
    failureClass,
    failureClasses: failureClass ? [failureClass] : [],
  };
}

const rawResults = {
  a: {
    'edit-distance': { trials: [trial({ passAt1: true })] },
    'word-break': { trials: [trial({ passAt1: false, eventualPass: false, failureClass: 'logic_assertion' })] },
  },
  b: {
    'edit-distance': { trials: [trial({ passAt1: true }), trial({ passAt1: true })] },
    'word-break': { trials: [trial({ passAt1: true }), trial({ passAt1: false, eventualPass: true, failureClass: 'timeout' })] },
  },
  c: {
    'edit-distance': { trials: [trial({ passAt1: false, eventualPass: true, pggResamples: 2, failureClass: 'timeout' })] },
    'word-break': { trials: [trial({ passAt1: false, eventualPass: false, pggResamples: 3, failureClass: 'timeout' })] },
  },
};

const armMeta = {
  a: { label: 'single-shot' },
  b: { label: 'best-of-5' },
  c: { label: 'PGG-5' },
};

console.log('\n=== PGG multi-arm reporting ===\n');

const comparison = buildMultiArmComparison(rawResults, { armMeta });
assertEqual(comparison.a.passAt1.count, 1, 'A pass@1 count is aggregated from problem trials');
assertEqual(comparison.a.passAt1.total, 2, 'A total trials is aggregated from problem trials');
assertEqual(comparison.b.passAtN.count, 4, 'B pass@N counts eventual passes');
assertEqual(comparison.c.pggResamples, 5, 'C sums PGG resamples across problems');
assertEqual(comparison.c.perProblem['word-break'].passAt1.count, 0, 'per-problem pass@1 count preserved');
assertEqual(comparison.c.perProblem['word-break'].passAt1.total, 1, 'per-problem total preserved');

const summary = buildMultiArmSummary({
  runType: 'pgg-phase1-comparison',
  baseline: 'multi-arm',
  k: 'varies',
  problems: ['edit-distance', 'word-break'],
  rawResults,
  armMeta,
});

assertEqual(summary.totalTrials, 8, 'multi-arm summary totalTrials is nonzero and includes all arms');
assertEqual(summary.passAt1.count, 4, 'multi-arm summary pass@1 count includes all arms');
assertEqual(summary.passAtN.count, 6, 'multi-arm summary pass@N count includes all arms');
assertEqual(summary.byArm.c.passAt1.count, 0, 'summary exposes per-arm PGG pass@1 count');
assertEqual(summary.byArm.c.pggResamples, 5, 'summary exposes per-arm PGG resamples');

const report = multiArmReportText({ summary });
assert(report.includes('## per-arm'), 'report has per-arm section');
assert(report.includes('A (single-shot): pass@1=1/2 (50.0%)'), 'report renders arm A pass@1 fraction');
assert(report.includes('C (PGG-5): pass@1=0/2 (0.0%)'), 'report renders arm C pass@1 fraction');
assert(!report.includes('0/0 (N/A)'), 'report does not show bogus 0/0 totals for populated arms');

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFAILED');
  process.exit(1);
}

console.log('\nPASSED');
