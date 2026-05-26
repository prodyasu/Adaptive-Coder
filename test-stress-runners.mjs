#!/usr/bin/env node
/**
 * test-stress-runners.mjs — no-model tests for stress-suite runner helpers.
 * These tests intentionally avoid evalProblem/model calls.
 */
import assert from 'assert';
import {
  STRESS_PROBLEMS,
  loadStressReferenceSolutions,
  calibrateReferences,
  summarizeRun,
  writeCompactReport,
} from './stress-runner-utils.js';

const refs = loadStressReferenceSolutions();
assert.deepStrictEqual(STRESS_PROBLEMS, ['edit-distance', 'word-break', 'detect-cycle', 'valid-sudoku']);
assert.deepStrictEqual(Object.keys(refs).sort(), STRESS_PROBLEMS.slice().sort());

const calibration = calibrateReferences({ problems: STRESS_PROBLEMS, referenceSolutions: refs });
assert.strictEqual(calibration.allClean, true, 'stress reference calibration should be clean');
for (const problem of STRESS_PROBLEMS) {
  const r = calibration.results[problem];
  assert.strictEqual(r.primaryPassRate, 1, `${problem} primary reference pass rate`);
  assert.strictEqual(r.heldOutPassRate, 1, `${problem} held-out reference pass rate`);
  assert.strictEqual(r.cohAtrRisk, 0, `${problem} reference cohAtrRisk`);
}

const fakeRawResults = {
  'edit-distance': {
    passAt1Count: 1,
    passAt1Rate: 0.5,
    trials: [
      { trial: 1, passAt1: true, eventualPass: true, repairEligible: false, repairConverted: false, cohAtrRisk: 0, heldOutPassRate: 1, failureClass: null },
      { trial: 2, passAt1: false, eventualPass: true, repairEligible: true, repairConverted: true, cohAtrRisk: 0.4, heldOutAfterRepairRate: 0.6, failureClass: 'logic_assertion' },
    ],
  },
  'word-break': {
    passAt1Count: 0,
    passAt1Rate: 0,
    trials: [
      { trial: 1, passAt1: false, eventualPass: false, repairEligible: true, repairConverted: false, cohAtrRisk: 1, heldOutAfterRepairRate: 0, failureClass: 'timeout' },
    ],
  },
};
const summary = summarizeRun({ runType: 'stress-baseline', baseline: 'reasoning_os_v0', k: 2, problems: Object.keys(fakeRawResults), rawResults: fakeRawResults });
assert.strictEqual(summary.passAt1.count, 1);
assert.strictEqual(summary.passAt1.total, 3);
assert.strictEqual(summary.passAtN.count, 2);
assert.strictEqual(summary.passAtN.total, 3);
assert.strictEqual(summary.repairEligibleCount, 2);
assert(Math.abs(summary.heldOutRate.count - 1.6) < 1e-9);
assert.strictEqual(summary.heldOutRate.total, 3);
assert(Math.abs(summary.heldOutRate.rate - (1.6 / 3)) < 1e-9);
assert.strictEqual(summary.failureClassBreakdown.logic_assertion, 1);
assert.strictEqual(summary.failureClassBreakdown.timeout, 1);
assert(summary.avgCohAtrRisk > 0.4 && summary.avgCohAtrRisk < 0.5);

const report = writeCompactReport({ summary, rawResults: fakeRawResults, runDir: false });
assert(report.includes('pass@1: 1/3'));
assert(report.includes('pass@N: 2/3'));
assert(report.includes('repair-eligible: 2'));
assert(report.includes('failure classes: logic_assertion=1, timeout=1'));

// No-model smoke test for run-stress-icg.mjs runner
// This test intentionally avoids evalProblem/model calls.
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Test 1: syntax check
const syntaxResult = spawnSync('node', ['--check', 'run-stress-icg.mjs'], { cwd: __dirname });
assert.strictEqual(syntaxResult.status, 0, `Syntax check failed: ${syntaxResult.stderr?.toString()}`);

// Test 2: k=0 smoke — must complete without model calls and write a report
// Run in a subprocess so it gets a fresh module state
const smokeResult = spawnSync('node', ['run-stress-icg.mjs', '--k=0'], { cwd: __dirname, timeout: 30_000 });
assert.strictEqual(smokeResult.status, 0, `k=0 smoke failed: ${smokeResult.stderr?.toString()}\n${smokeResult.stdout?.toString()}`);

// Verify a report was written (find the most recent stress-icg-...-k0-... dir)
const validationRuns = readdirSync('validation-runs').filter(n => n.startsWith('stress-icg-'));
assert.ok(validationRuns.length > 0, 'Expected at least one stress-icg validation run directory');
const latestRun = validationRuns.sort().at(-1);
assert.ok(latestRun.startsWith('stress-icg-'), `Unexpected run dir name: ${latestRun}`);
const runDir = join(__dirname, 'validation-runs', latestRun);
assert.ok(existsSync(runDir), `Run dir should exist: ${runDir}`);
assert.ok(existsSync(join(runDir, 'summary.json')), 'summary.json should be written');
assert.ok(existsSync(join(runDir, 'compact-report.md')), 'compact-report.md should be written');
const reportContent = readFileSync(join(runDir, 'compact-report.md'), 'utf8');
assert.ok(reportContent.includes('stress-icg'), 'Report should mention run type');
assert.ok(reportContent.includes('reasoning_os_v0'), 'Report should mention baseline');
assert.ok(reportContent.includes('pass@1:'), 'Report should contain pass@1 line');

// Verify the raw-results.json has the correct structure for k=0
const rawResults = JSON.parse(readFileSync(join(runDir, 'raw-results.json'), 'utf8'));
for (const problem of STRESS_PROBLEMS) {
  assert.ok(rawResults[problem], `raw-results should include ${problem}`);
  assert.strictEqual(rawResults[problem].trials.length, 0, `k=0 should produce 0 trials`);
}

console.log(`k=0 smoke validated against: ${latestRun}`);
console.log('test-stress-runners: all assertions passed');
