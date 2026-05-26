#!/usr/bin/env node
/**
 * run-stress-icg.mjs — ICG (Invariant-Constrained Generation) on stress-suite MVP.
 *
 * Runs stress-suite problems with ICG enabled (icgEnabled: true) to compare
 * against baseline and R4 on the same 4 stress problems. This is a model-call
 * runner; run via a fresh Node process. Default baseline is reasoning_os_v0.
 *
 * Usage:
 *   node run-stress-icg.mjs [--k=5] [--timeout-ms=120000] [--problems=edit-distance,word-break]
 */
import {
  STRESS_PROBLEMS,
  DEFAULT_K,
  DEFAULT_R4_BASELINE,
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

const baseline = argValue('baseline', DEFAULT_R4_BASELINE);
const k = Number(argValue('k', String(DEFAULT_K)));
const timeoutMs = Number(argValue('timeout-ms', '120000'));
const problems = argValue('problems', STRESS_PROBLEMS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const RUN_DIR = ensureRunDir(`stress-icg-${baseline}-k${k}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log('\n=== Stress-suite ICG calibration (MODEL CALLS) ===');
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Baseline: ${baseline}`);
console.log(`Model stages: minimax-m2.7:cloud via eval.js`);
console.log(`Problems: ${problems.join(', ')}`);
console.log(`k: ${k}`);
console.log(`ICG: enabled\n`);

const rawResults = {};
for (const problem of problems) {
  console.log(`--- ${problem} ---`);
  rawResults[problem] = await runProblemTrials({
    problem,
    baseline,
    k,
    traceDir: join(TRACE_DIR, problem),
    timeoutMs,
    extraEvalOpts: { icgEnabled: true },
  });
  const r = rawResults[problem];
  const passAtN = r.trials.filter(t => t.eventualPass).length;
  console.log(`  pass@1: ${frac(r.passAt1Count, r.trials.length)}`);
  console.log(`  pass@N: ${frac(passAtN, r.trials.length)}`);
  console.log(`  repair-eligible: ${r.trials.filter(t => t.repairEligible).length}`);

  // Log average ICG trace fields if available
  const trialsWithICG = r.trials.filter(t => t.attempts?.some?.(a => a.icg));
  if (trialsWithICG.length > 0) {
    const avgInvariantCount = trialsWithICG
      .map(t => t.attempts?.find?.(a => a.icg)?.icg?.trace?.invariantCount ?? 0)
      .filter(v => v > 0);
    if (avgInvariantCount.length > 0) {
      const sum = avgInvariantCount.reduce((a, b) => a + b, 0);
      console.log(`  avg invariants: ${(sum / avgInvariantCount.length).toFixed(1)}`);
    }
  }
}

const summary = summarizeRun({ runType: 'stress-icg', baseline, k, problems, rawResults, modeMetrics: null });
writeFileSync(join(RUN_DIR, 'raw-results.json'), JSON.stringify(rawResults, null, 2));
const report = writeCompactReport({ summary, rawResults, runDir: RUN_DIR });

console.log('\n' + report);
console.log(`\nResults saved to ${RUN_DIR}`);