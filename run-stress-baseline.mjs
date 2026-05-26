#!/usr/bin/env node
/**
 * run-stress-baseline.mjs — model-call baseline calibration on stress-suite MVP.
 *
 * Default baseline is gen18_evolved with minimax-m2.7 stage models as wired in
 * eval.js. Run this as a fresh `node run-stress-baseline.mjs` process; do not
 * import it into long-lived workers.
 */
import {
  STRESS_PROBLEMS,
  DEFAULT_BASELINE,
  DEFAULT_K,
  ensureRunDir,
  runProblemTrials,
  summarizeRun,
  writeCompactReport,
  frac,
} from './stress-runner-utils.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const baseline = argValue('baseline', DEFAULT_BASELINE);
const k = Number(argValue('k', String(DEFAULT_K)));
const timeoutMs = Number(argValue('timeout-ms', '120000'));
const problems = argValue('problems', STRESS_PROBLEMS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const RUN_DIR = ensureRunDir(`stress-baseline-${baseline}-k${k}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log('\n=== Stress-suite baseline calibration (MODEL CALLS) ===');
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Baseline: ${baseline}`);
console.log(`Model stages: minimax-m2.7:cloud via eval.js`);
console.log(`Problems: ${problems.join(', ')}`);
console.log(`k: ${k}\n`);

const rawResults = {};
for (const problem of problems) {
  console.log(`--- ${problem} ---`);
  rawResults[problem] = await runProblemTrials({ problem, baseline, k, traceDir: TRACE_DIR, timeoutMs });
  const r = rawResults[problem];
  const passAtN = r.trials.filter(t => t.eventualPass).length;
  console.log(`  pass@1: ${frac(r.passAt1Count, r.trials.length)}`);
  console.log(`  pass@N: ${frac(passAtN, r.trials.length)}`);
  console.log(`  repair-eligible: ${r.trials.filter(t => t.repairEligible).length}`);
}

const summary = summarizeRun({ runType: 'stress-baseline', baseline, k, problems, rawResults });
writeFileSync(join(RUN_DIR, 'raw-results.json'), JSON.stringify(rawResults, null, 2));
const report = writeCompactReport({ summary, rawResults, runDir: RUN_DIR });

console.log('\n' + report);
console.log(`\nResults saved to ${RUN_DIR}`);
