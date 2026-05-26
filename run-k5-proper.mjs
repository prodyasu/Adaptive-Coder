#!/usr/bin/env node
/**
 * run-k5-proper.mjs — Proper k=5 validation: 5 independent trials per problem.
 * Each trial is an independent call to evalProblem (which stops early on pass).
 * This gives 5 data points per problem, matching the original k=5 methodology.
 */
import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii', 'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree'];
const BASELINES = ['reasoning_os_v0', 'gen18_evolved'];
const K = 5; // 5 independent trials per problem
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

for (const baseline of BASELINES) {
  const RUN_DIR = join('validation-runs', `${baseline.replace('_', '-')}-k5-proper-${TIMESTAMP}`);
  const TRACE_DIR = join(RUN_DIR, 'traces');
  mkdirSync(TRACE_DIR, { recursive: true });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== ${baseline} k=5 Proper Validation ===`);
  console.log(`Run dir: ${RUN_DIR}`);
  console.log(`Trials: ${K} per problem`);
  console.log(`${'='.repeat(60)}\n`);

  const results = {};

  for (const problem of PROBLEMS) {
    console.log(`\n--- ${problem} (${baseline}) ---`);
    const problemTraceDir = join(TRACE_DIR, problem);
    if (!existsSync(problemTraceDir)) mkdirSync(problemTraceDir, { recursive: true });

    let passes = 0;
    const trialResults = [];

    for (let trial = 0; trial < K; trial++) {
      console.log(`  Trial ${trial + 1}/${K}...`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);

        const result = await evalProblem(problem, baseline, null, {
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

        // Check sig-repair via code content
        const firstCode = entries[0]?.[1]?.trace?.code;
        const codeStr = typeof firstCode === 'string' ? firstCode : (firstCode?.snippet || '');

        trialResults.push({
          trial,
          passAt1,
          passAtN,
          attempts: entries.length,
          sigRepair: entries[0]?.[1]?.trace?.sigRepair || null,
        });

        console.log(`    pass@1: ${passAt1 ? '✓' : '✗'}  pass@N: ${passAtN ? '✓' : '✗'}  attempts: ${entries.length}  sigRepair: ${entries[0]?.[1]?.trace?.sigRepair ? JSON.stringify(entries[0][1].trace.sigRepair) : 'none'}`);
      } catch (err) {
        console.log(`    ERROR: ${err.message?.slice(0, 80)}`);
        trialResults.push({ trial, passAt1: false, passAtN: false, attempts: 0, error: err.message });
      }
    }

    results[problem] = { passes, total: K, passAt1Rate: `${passes}/${K}`, trials: trialResults };
    console.log(`  Result: ${passes}/${K} pass@1 (${(passes/K*100).toFixed(0)}%)`);
  }

  // Summary
  let totalPasses = 0;
  let totalTrials = 0;
  for (const r of Object.values(results)) {
    totalPasses += r.passes;
    totalTrials += r.total;
  }

  const summary = {
    baseline,
    k: K,
    runDir: RUN_DIR,
    timestamp: TIMESTAMP,
    results,
    totalPasses,
    totalTrials,
    passAt1Rate: `${totalPasses}/${totalTrials}`,
  };

  writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n=== ${baseline} SUMMARY ===`);
  console.log(`pass@1: ${totalPasses}/${totalTrials} (${(totalPasses/totalTrials*100).toFixed(1)}%)`);
  for (const [problem, r] of Object.entries(results)) {
    console.log(`  ${problem}: ${r.passes}/${r.total}`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`DONE — Both baselines completed.`);