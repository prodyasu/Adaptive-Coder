/**
 * run-validation-v2.mjs — Fresh k=5 with per-problem timeout and sequential execution
 */
import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASELINE = 'reasoning_os_v0';
const MODEL = 'minimax-m2.7:cloud';
const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii'];
const K = 5;

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const outDir = join(import.meta.dirname, 'validation-runs', `reasoning-os-v0-k5-rerun2-${timestamp}`);
const traceDir = join(outDir, 'traces');
mkdirSync(outDir, { recursive: true });
mkdirSync(traceDir, { recursive: true });

const results = [];
const byProblem = {};
for (const p of PROBLEMS) byProblem[p] = { n: K, passAt1: 0, passAtN: 0, timeouts: 0, failures: [], attempts: [] };

// Set higher max listeners for EventEmitter warnings
import { setMaxListeners } from 'events';
setMaxListeners(50, process);

console.log(`\n=== Fresh k=5 Validation (v2) ===`);
console.log(`Output: ${outDir}`);
console.log(`Model: ${MODEL}, Baseline: ${BASELINE}, K=${K}\n`);

const startTime = Date.now();

for (let rep = 1; rep <= K; rep++) {
  console.log(`\n--- Rep ${rep}/${K} ---`);
  for (const problem of PROBLEMS) {
    const t0 = Date.now();
    console.log(`  ${problem}...`);
    
    let result;
    try {
      result = await evalProblem(problem, BASELINE, MODEL, {
        signal: AbortSignal.timeout(90_000),
        traceDir,
      });
    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      result = {};
    }
    
    const elapsed = Date.now() - t0;
    const entries = Object.entries(result);
    const passAt1 = result[0]?.pass === true;
    const passAtN = entries.some(([, r]) => r.pass);
    const failures = entries.filter(([, r]) => !r.pass).map(([at, r]) => ({
      attempt: parseInt(at),
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
    byProblem[problem].timeouts += entries.filter(([, r]) => r.stageFailed === 'timeout').length;
    byProblem[problem].attempts.push({ rep, result, elapsed, passAt1, passAtN, failures });

    const sigRepair = entries.find(([, r]) => r.trace?.sigRepair);
    const status = passAt1 ? '✓' : '✗';
    const srInfo = sigRepair ? ` [sig-repair: ${sigRepair[1].trace.sigRepair.originalName}→${sigRepair[1].trace.sigRepair.repairedName}]` : '';
    console.log(`    ${status} ${problem} (${elapsed}ms)${srInfo}`);

    results.push({
      rep, problem, baselineKind: BASELINE, model: MODEL,
      durationMs: elapsed, passAt1, passAtN,
      attempts: entries.length,
      timeoutCount: entries.filter(([, r]) => r.stageFailed === 'timeout').length,
      failures,
      attemptsRaw: entries.map(([at, r]) => ({
        attempt: parseInt(at), pass: r.pass,
        error: r.error || (r.pass ? 'success' : undefined),
        errorDetail: r.errorDetail, waitMs: r.waitMs || 0, modelMs: r.modelMs,
        autorepairCycles: r.autorepairCycles || 0,
        stageFailed: r.stageFailed,
        failureKind: r.failureKind, failureSubKind: r.failureSubKind, failureCode: r.failureCode,
        trace: r.trace?.path,
        sigRepair: r.trace?.sigRepair || undefined,
      })),
    });
  }
}

const total = K * PROBLEMS.length;
const totalPassAt1 = Object.values(byProblem).reduce((s, p) => s + p.passAt1, 0);
const totalPassAtN = Object.values(byProblem).reduce((s, p) => s + p.passAtN, 0);
const totalTimeouts = Object.values(byProblem).reduce((s, p) => s + p.timeouts, 0);

function wilsonCI(pass, total, z = 1.96) {
  if (total === 0) return { low: 0, high: 1 };
  const phat = pass / total;
  const denom = 1 + z * z / total;
  const centre = (phat + z * z / (2 * total)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total)) / denom;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

const ci = wilsonCI(totalPassAt1, total);
const sigRepairEvents = results.flatMap(r => r.attemptsRaw.filter(a => a.sigRepair?.originalName).map(a => ({ rep: r.rep, problem: r.problem, ...a.sigRepair })));

const summary = {
  started: new Date(startTime).toISOString(),
  finished: new Date().toISOString(),
  outDir, traceDir, baselineKind: BASELINE, model: MODEL,
  problems: PROBLEMS, repetitions: K,
  aggregate: { n: total, passAt1: totalPassAt1, passAtN: totalPassAtN, timeouts: totalTimeouts,
    passAt1Pct: `${totalPassAt1}/${total} = ${(totalPassAt1/total*100).toFixed(1)}%`,
    passAtNPct: `${totalPassAtN}/${total} = ${(totalPassAtN/total*100).toFixed(1)}%`,
    wilson95CI: `[${(ci.low*100).toFixed(1)}%, ${(ci.high*100).toFixed(1)}%]` },
  byProblem, sigRepairEvents,
  comparison: { previousRun: 'reasoning-os-v0-k5-2026-05-22T22-52-13-695Z', previousPassAt1: '16/20 (80.0%)', gen18EvolvedPassAt1: '17/20 (85.0%)' },
  results,
};

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(`\n\n========================================`);
console.log(`  VALIDATION COMPLETE`);
console.log(`========================================\n`);
console.log(`AGGREGATE:`);
console.log(`  pass@1: ${totalPassAt1}/${total} = ${(totalPassAt1/total*100).toFixed(1)}%  (Wilson 95% CI ${ci.low.toFixed(3)}–${ci.high.toFixed(3)})`);
console.log(`  pass@N: ${totalPassAtN}/${total} = ${(totalPassAtN/total*100).toFixed(1)}%`);
console.log(`  timeouts: ${totalTimeouts}\n`);
console.log(`PER-PROBLEM:`);
for (const [p, s] of Object.entries(byProblem)) {
  console.log(`  ${p}: pass@1 ${s.passAt1}/${K}  pass@N ${s.passAtN}/${K}  timeouts ${s.timeouts}`);
}
console.log(`\nSIG-REPAIR EVENTS (${sigRepairEvents.length}):`);
for (const ev of sigRepairEvents) console.log(`  rep=${ev.rep} ${ev.problem}: ${ev.originalName}→${ev.repairedName}`);
console.log(`\nCOMPARISON:`);
console.log(`  Current:  pass@1 ${totalPassAt1}/20`);
console.log(`  Previous: pass@1 16/20`);
console.log(`  gen18:    pass@1 17/20`);
console.log(`  Delta vs previous: ${totalPassAt1 >= 16 ? '+' : ''}${totalPassAt1 - 16}/20`);
console.log(`\nFull summary: ${join(outDir, 'summary.json')}`);
