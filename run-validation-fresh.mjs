/**
 * run-validation-fresh.mjs
 * Fresh Reasoning OS v0 k=5 validation run — sig-repair re-run
 * 
 * Runs 4 problems × 5 attempts against reasoning_os_v0 baseline.
 * Uses minimax-m2.7:cloud for shaper/coder/verifier (current harness default).
 * Saves traces and summary to validation-runs/reasoning-os-v0-k5-rerun-TIMESTAMP/
 * 
 * Key difference from previous run: fresh Node ESM module cache so sig-repair fires.
 */

import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { performance } from 'perf_hooks';

const BASELINE = 'reasoning_os_v0';
const MODEL = 'minimax-m2.7:cloud';
const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii'];
const K = 5; // repetitions per problem

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const outDir = join(import.meta.dirname, 'validation-runs', `reasoning-os-v0-k5-rerun-${timestamp}`);
const traceDir = join(outDir, 'traces');

mkdirSync(outDir, { recursive: true });
mkdirSync(traceDir, { recursive: true });

console.log(`\n=== Reasoning OS v0 — Fresh k=5 Validation ===`);
console.log(`Output: ${outDir}`);
console.log(`Model: ${MODEL}`);
console.log(`Baseline: ${BASELINE}`);
console.log(`Problems: ${PROBLEMS.join(', ')}`);
console.log(`K=${K}\n`);

const results = [];
const byProblem = {};
const startTime = Date.now();

for (const problem of PROBLEMS) {
  byProblem[problem] = { n: K, passAt1: 0, passAtN: 0, timeouts: 0, failures: [], attempts: [] };
}

for (let rep = 1; rep <= K; rep++) {
  console.log(`\n--- Rep ${rep}/${K} ---`);
  for (const problem of PROBLEMS) {
    const t0 = performance.now();
    console.log(`  ${problem}...`);
    
    const result = await evalProblem(problem, BASELINE, MODEL, {
      signal: AbortSignal.timeout(120_000),
      traceDir,
    });
    
    const elapsed = Math.round(performance.now() - t0);
    const passAt1 = result[0]?.pass === true;
    const passAtN = Object.values(result).some(r => r.pass);
    const timeoutCount = Object.values(result).filter(r => r.stageFailed === 'timeout').length;
    const failures = Object.entries(result)
      .filter(([, r]) => !r.pass)
      .map(([attempt, r]) => ({
        attempt: parseInt(attempt),
        stageFailed: r.stageFailed,
        failureKind: r.failureKind,
        failureSubKind: r.failureSubKind,
        failureCode: r.failureCode,
        errorDetail: r.errorDetail,
        modelMs: r.modelMs,
        waitMs: r.waitMs || 0,
        autorepairCycles: r.autorepairCycles || 0,
      }));
    
    byProblem[problem].passAt1 += passAt1 ? 1 : 0;
    byProblem[problem].passAtN += passAtN ? 1 : 0;
    byProblem[problem].timeouts += timeoutCount;
    if (!passAtN) byProblem[problem].failures.push(...failures);
    byProblem[problem].attempts.push({ rep, result, elapsed, passAt1, passAtN, failures });

    const resultEntry = {
      rep,
      problem,
      baselineKind: BASELINE,
      model: MODEL,
      durationMs: elapsed,
      passAt1,
      passAtN,
      attempts: Object.keys(result).length,
      timeoutCount,
      failures,
      attemptsRaw: Object.entries(result).map(([attempt, r]) => ({
        attempt: parseInt(attempt),
        pass: r.pass,
        error: r.error || (r.pass ? 'success' : undefined),
        errorDetail: r.errorDetail,
        waitMs: r.waitMs || 0,
        modelMs: r.modelMs,
        autorepairCycles: r.autorepairCycles || 0,
        stageFailed: r.stageFailed,
        failureKind: r.failureKind,
        failureSubKind: r.failureSubKind,
        failureCode: r.failureCode,
        trace: r.trace?.path,
        sigRepair: r.trace?.sigRepair || undefined,
      })),
    };
    results.push(resultEntry);

    const status = passAt1 ? '✓' : '✗';
    const sigInfo = Object.values(result).some(r => r.trace?.sigRepair)
      ? ` [sig-repair: ${Object.values(result).find(r => r.trace?.sigRepair)?.trace?.sigRepair?.originalName}→${Object.values(result).find(r => r.trace?.sigRepair)?.trace?.sigRepair?.repairedName}]`
      : '';
    console.log(`    ${status} ${problem} (${elapsed}ms)${sigInfo}`);
  }
}

// Aggregate stats
const total = K * PROBLEMS.length;
const totalPassAt1 = Object.values(byProblem).reduce((s, p) => s + p.passAt1, 0);
const totalPassAtN = Object.values(byProblem).reduce((s, p) => s + p.passAtN, 0);
const totalTimeouts = Object.values(byProblem).reduce((s, p) => s + p.timeouts, 0);

// Compute Wilson CI for pass@1
function wilsonCI(pass, total, z = 1.96) {
  if (total === 0) return { low: 0, high: 1 };
  const phat = pass / total;
  const denom = 1 + z * z / total;
  const centre = (phat + z * z / (2 * total)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total)) / denom;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

const ci = wilsonCI(totalPassAt1, total);

// Detect sig-repair events across all results
const sigRepairEvents = results.flatMap(r =>
  r.attemptsRaw
    .filter(a => a.sigRepair && a.sigRepair.originalName)
    .map(a => ({ rep: r.rep, problem: r.problem, ...a.sigRepair }))
);

// Build summary
const summary = {
  started: new Date(startTime).toISOString(),
  finished: new Date().toISOString(),
  outDir,
  traceDir,
  baselineKind: BASELINE,
  model: MODEL,
  problems: PROBLEMS,
  repetitions: K,
  aggregate: {
    n: total,
    passAt1: totalPassAt1,
    passAtN: totalPassAtN,
    timeouts: totalTimeouts,
    passAt1Pct: `${totalPassAt1}/${total} = ${(totalPassAt1 / total * 100).toFixed(1)}%`,
    passAtNPct: `${totalPassAtN}/${total} = ${(totalPassAtN / total * 100).toFixed(1)}%`,
    wilson95CI: `[${(ci.low * 100).toFixed(1)}%, ${(ci.high * 100).toFixed(1)}%]`,
  },
  byProblem,
  sigRepairEvents,
  comparison: {
    previousRun: 'reasoning-os-v0-k5-2026-05-22T22-52-13-695Z',
    previousPassAt1: '16/20 (80.0%)',
    gen18EvolvedPassAt1: '17/20 (85.0%)',
  },
  results,
};

// Save summary.json
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

// Print final report
console.log(`\n\n========================================`);
console.log(`  VALIDATION COMPLETE — ${new Date().toISOString()}`);
console.log(`========================================\n`);

console.log(`AGGREGATE:`);
console.log(`  pass@1: ${totalPassAt1}/${total} = ${(totalPassAt1/total*100).toFixed(1)}%  (Wilson 95% CI ${ci.low.toFixed(3)}–${ci.high.toFixed(3)})`);
console.log(`  pass@N: ${totalPassAtN}/${total} = ${(totalPassAtN/total*100).toFixed(1)}%`);
console.log(`  timeouts: ${totalTimeouts}\n`);

console.log(`PER-PROBLEM:`);
for (const [p, s] of Object.entries(byProblem)) {
  console.log(`  ${p}: pass@1 ${s.passAt1}/${K}  pass@N ${s.passAtN}/${K}  timeouts ${s.timeouts}`);
}

console.log(`\nSIG-REPAIR:`);
if (sigRepairEvents.length === 0) {
  console.log(`  (no sig-repair events detected)`);
} else {
  for (const ev of sigRepairEvents) {
    console.log(`  rep=${ev.rep} ${ev.problem}: ${ev.originalName} → ${ev.repairedName}`);
  }
}

console.log(`\nCOMPARISON:`);
console.log(`  Current:  pass@1 ${totalPassAt1}/20`);
console.log(`  Previous: pass@1 16/20 (reasoning-os-v0-k5-2026-05-22T22-52-13-695Z)`);
console.log(`  gen18:    pass@1 17/20`);
console.log(`\n  Delta vs previous: ${totalPassAt1 >= 16 ? '+' : ''}${totalPassAt1 - 16}/20`);

console.log(`\nFull summary: ${join(outDir, 'summary.json')}`);
console.log(`Traces:      ${traceDir}`);
