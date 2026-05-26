#!/usr/bin/env node
/**
 * run-os-v0-k8.mjs — reasoning_os_v0 k=5 validation on N=8 problems.
 * Fresh process for proper A/B comparison.
 */
import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii', 'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree'];
const BASELINE = 'reasoning_os_v0';
const K = 5;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `reasoning-os_v0-n8-k5-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');

mkdirSync(TRACE_DIR, { recursive: true });

console.log(`\n${'='.repeat(60)}`);
console.log(`=== ${BASELINE} N=8 k=5 Validation ===`);
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

      const passAt1 = entries[0]?.[1]?.pass || false;
      const passAtN = entries.some(([,v]) => v.pass);
      if (passAt1) passes++;

      // Check sig-repair
      let sigRepair = 'none';
      for (const [,v] of entries) {
        if (v?.trace?.sigRepair) { sigRepair = v.trace.sigRepair; break; }
      }

      trialResults.push({ trial: trial + 1, passAt1, passAtN, sigRepair });
      const p1 = passAt1 ? '✓' : '✗';
      console.log(`    pass@1: ${p1}  pass@N: ${passAtN ? '✓' : '✗'}  attempts: ${entries.length}  sigRepair: ${sigRepair === 'none' ? 'none' : 'yes'}`);
    } catch (err) {
      console.log(`    ERROR: ${err.message?.slice(0, 120)}`);
      trialResults.push({ trial: trial + 1, passAt1: false, passAtN: false, error: err.message });
    }
  }

  results[problem] = {
    passAt1: `${passes}/${K}`,
    passAt1Rate: passes / K,
    passAtN: trialResults.some(t => t.passAtN) ? `${K}/${K}` : `${trialResults.filter(t => t.passAtN).length}/${K}`,
    trials: trialResults,
  };

  console.log(`  → pass@1: ${passes}/${K} (${(passes/K*100).toFixed(0)}%), pass@N: ${results[problem].passAtN}`);
}

const summary = {
  baseline: BASELINE,
  problems: PROBLEMS,
  K,
  timestamp: TIMESTAMP,
  results,
  totalPassAt1: `${Object.values(results).reduce((s, r) => s + parseInt(r.passAt1), 0)}/${PROBLEMS.length * K}`,
  totalPassAt1Rate: Object.values(results).reduce((s, r) => s + r.passAt1Rate, 0) / PROBLEMS.length,
};

writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n${'='.repeat(60)}`);
console.log(`SUMMARY: ${BASELINE} N=${PROBLEMS.length} k=${K}`);
console.log(`Total pass@1: ${summary.totalPassAt1} (${(summary.totalPassAt1Rate * 100).toFixed(1)}%)`);
for (const [p, r] of Object.entries(results)) {
  console.log(`  ${p}: pass@1=${r.passAt1} pass@N=${r.passAtN}`);
}
console.log(`Run dir: ${RUN_DIR}`);
console.log(`${'='.repeat(60)}`);