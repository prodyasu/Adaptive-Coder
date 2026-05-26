#!/usr/bin/env node
/**
 * run-os-v0-n8-heldout.mjs — reasoning_os_v0 k=5 validation with held-out discriminativity.
 * Runs N=8 problems and collects:
 *   - pass@1 (primary, binary)
 *   - primaryPassRate (continuous, e.g. 3/5)
 *   - heldOutPassRate (continuous)
 *   - cohAtrRisk = max(0, 1 - heldOutPassRate / primaryPassRate)
 */
import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii', 'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree'];
const BASELINE = 'reasoning_os_v0';
const K = 5;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `reasoning-os_v0-heldout-n8-k5-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');

mkdirSync(TRACE_DIR, { recursive: true });

console.log(`\n${'='.repeat(60)}`);
console.log(`=== ${BASELINE} N=8 k=5 Validation (with held-out discriminativity) ===`);
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Problems: ${PROBLEMS.length}, Trials: ${K}`);
console.log(`${'='.repeat(60)}\n`);

const results = {};

for (const problem of PROBLEMS) {
  console.log(`\n--- ${problem} (${BASELINE}) ---`);
  const problemTraceDir = join(TRACE_DIR, problem);
  if (!existsSync(problemTraceDir)) mkdirSync(problemTraceDir, { recursive: true });

  let passes = 0;
  const trialResults = [];

  for (let trial = 0; trial < K; trial++) {
    console.log(`  Trial ${trial + 1}/${K}...`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);

      const result = await evalProblem(problem, BASELINE, null, {
        signal: controller.signal,
        traceDir: join(problemTraceDir, `trial-${trial}`),
      });
      clearTimeout(timeout);

      const entries = Object.entries(result)
        .filter(([k]) => !isNaN(k))
        .sort(([a],[b]) => Number(a) - Number(b));

      const firstAttempt = entries[0]?.[1];
      const passAt1 = firstAttempt?.pass || false;
      const passAtN = entries.some(([,v]) => v.pass);
      if (passAt1) passes++;

      // Collect held-out discriminativity metrics from first successful or first attempt
      let primaryPassRate = null, heldOutPassRate = null, cohAtrRisk = null;
      for (const [,v] of entries) {
        if (v?.trace?.primaryPassRate !== undefined) {
          primaryPassRate = v.trace.primaryPassRate;
          heldOutPassRate = v.trace.heldOutPassRate ?? null;
          cohAtrRisk = v.trace.cohAtrRisk ?? null;
          break; // take from first attempt that has it
        }
      }

      // Check sig-repair
      let sigRepair = 'none';
      for (const [,v] of entries) {
        if (v?.trace?.sigRepair) { sigRepair = v.trace.sigRepair; break; }
      }

      trialResults.push({
        trial: trial + 1,
        passAt1,
        passAtN,
        sigRepair,
        primaryPassRate,
        heldOutPassRate,
        cohAtrRisk,
      });
      const p1 = passAt1 ? '✓' : '✗';
      const cohStr = cohAtrRisk !== null ? ` cohRisk=${(cohAtrRisk * 100).toFixed(0)}%` : '';
      const hoStr = heldOutPassRate !== null ? ` held=${(heldOutPassRate * 100).toFixed(0)}%` : '';
      console.log(`    pass@1: ${p1}  pass@N: ${passAtN ? '✓' : '✗'}  attempts: ${entries.length}  sigRepair: ${sigRepair === 'none' ? 'none' : 'yes'}${hoStr}${cohStr}`);
    } catch (err) {
      console.log(`    ERROR: ${err.message?.slice(0, 120)}`);
      trialResults.push({ trial: trial + 1, passAt1: false, passAtN: false, error: err.message });
    }
  }

  // Compute aggregate held-out metrics for this problem
  const validTrials = trialResults.filter(t => t.primaryPassRate !== null);
  const avgPrimaryPassRate = validTrials.length > 0 ? validTrials.reduce((s, t) => s + t.primaryPassRate, 0) / validTrials.length : null;
  const avgHeldOutPassRate = validTrials.length > 0 && validTrials.every(t => t.heldOutPassRate !== null)
    ? validTrials.reduce((s, t) => s + t.heldOutPassRate, 0) / validTrials.length
    : null;
  const avgCohAtrRisk = validTrials.length > 0 && validTrials.every(t => t.cohAtrRisk !== null)
    ? validTrials.reduce((s, t) => s + t.cohAtrRisk, 0) / validTrials.length
    : null;

  results[problem] = {
    passAt1: `${passes}/${K}`,
    passAt1Rate: passes / K,
    passAtN: trialResults.some(t => t.passAtN) ? `${K}/${K}` : `${trialResults.filter(t => t.passAtN).length}/${K}`,
    avgPrimaryPassRate,
    avgHeldOutPassRate,
    avgCohAtrRisk,
    trials: trialResults,
  };

  const hoStr = avgHeldOutPassRate !== null ? `  held=${(avgHeldOutPassRate * 100).toFixed(0)}%  cohRisk=${avgCohAtrRisk !== null ? (avgCohAtrRisk * 100).toFixed(0) + '%' : 'N/A'}` : '';
  console.log(`  → pass@1: ${passes}/${K} (${(passes/K*100).toFixed(0)}%)  primary=${avgPrimaryPassRate !== null ? (avgPrimaryPassRate * 100).toFixed(0) + '%' : 'N/A'}${hoStr}`);
}

// Compute overall held-out discriminativity metrics
const allValidTrials = Object.values(results).flatMap(r => (r.trials || []).filter(t => t.primaryPassRate !== null));
const overallCohAtrRisk = allValidTrials.length > 0 && allValidTrials.every(t => t.cohAtrRisk !== null)
  ? allValidTrials.reduce((s, t) => s + t.cohAtrRisk, 0) / allValidTrials.length
  : null;
const overallPrimaryPassRate = allValidTrials.length > 0
  ? allValidTrials.reduce((s, t) => s + t.primaryPassRate, 0) / allValidTrials.length
  : null;
const overallHeldOutPassRate = allValidTrials.length > 0 && allValidTrials.every(t => t.heldOutPassRate !== null)
  ? allValidTrials.reduce((s, t) => s + t.heldOutPassRate, 0) / allValidTrials.length
  : null;

const summary = {
  baseline: BASELINE,
  problems: PROBLEMS,
  K,
  timestamp: TIMESTAMP,
  results,
  totalPassAt1: `${Object.values(results).reduce((s, r) => s + parseInt(r.passAt1), 0)}/${PROBLEMS.length * K}`,
  totalPassAt1Rate: Object.values(results).reduce((s, r) => s + r.passAt1Rate, 0) / PROBLEMS.length,
  overallPrimaryPassRate,
  overallHeldOutPassRate,
  overallCohAtrRisk,
};

writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${BASELINE} N=${PROBLEMS.length} k=${K}`);
console.log(`Total pass@1: ${summary.totalPassAt1} (${(summary.totalPassAt1Rate * 100).toFixed(1)}%)`);
if (overallPrimaryPassRate !== null) console.log(`Primary pass rate: ${(overallPrimaryPassRate * 100).toFixed(1)}%`);
if (overallHeldOutPassRate !== null) console.log(`Held-out pass rate: ${(overallHeldOutPassRate * 100).toFixed(1)}%`);
if (overallCohAtrRisk !== null) console.log(`COH_ATR risk: ${(overallCohAtrRisk * 100).toFixed(1)}%`);
for (const [p, r] of Object.entries(results)) {
  const hoStr = r.avgHeldOutPassRate !== null ? `  held=${(r.avgHeldOutPassRate * 100).toFixed(0)}%  cohRisk=${r.avgCohAtrRisk !== null ? (r.avgCohAtrRisk * 100).toFixed(0) + '%' : 'N/A'}` : '';
  console.log(`  ${p}: pass@1=${r.passAt1}${hoStr}`);
}
console.log(`Run dir: ${RUN_DIR}`);
console.log(`${'='.repeat(60)}`);