#!/usr/bin/env node
/**
 * run-k5-reval.mjs — Re-run Reasoning OS v0 k=5 validation
 * MAX_ATTEMPTS=5 in eval.js, each problem gets exactly 5 attempts
 * for comparable stats with the original k=5 run.
 */
import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii'];
const BASELINE = 'reasoning_os_v0';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `reasoning-os-v0-k5-rerun-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');

mkdirSync(TRACE_DIR, { recursive: true });

console.log(`=== Reasoning OS v0 k=5 Re-validation ===`);
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Baseline: ${BASELINE}, MAX_ATTEMPTS=5`);
console.log(`Problems: ${PROBLEMS.join(', ')}`);
console.log('');

const results = {};
let totalPass1 = 0;
let totalAttemptsAcrossProblems = 0;

for (const problem of PROBLEMS) {
  console.log(`\n--- ${problem} ---`);
  const problemTraceDir = join(TRACE_DIR, problem);
  if (!existsSync(problemTraceDir)) mkdirSync(problemTraceDir, { recursive: true });

  let passAt1 = false;
  let passAtN = false;
  let sigRepairCount = 0;
  const attemptsData = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600_000); // 10min per problem

    const result = await evalProblem(problem, BASELINE, null, {
      signal: controller.signal,
      traceDir: problemTraceDir,
    });
    clearTimeout(timeout);

    // result is an array-like object indexed by attempt number
    const entries = Object.entries(result)
      .filter(([k]) => !isNaN(k))
      .sort(([a],[b]) => Number(a) - Number(b));

    if (entries.length > 0) {
      passAt1 = entries[0][1]?.pass || false;
      passAtN = entries.some(([,v]) => v.pass);
    }

    for (const [idx, att] of entries) {
      // Check sig-repair by examining code for renamed functions
      const code = att.trace?.code;
      const codeStr = typeof code === 'string' ? code : (code?.snippet || '');
      if (att.trace?.sigRepair) sigRepairCount++;
      
      attemptsData.push({
        attempt: parseInt(idx),
        pass: att.pass,
        stageFailed: att.stageFailed,
        errorDetail: att.errorDetail,
      });
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message?.slice(0, 100)}`);
  }

  results[problem] = { passAt1, passAtN, sigRepairCount, attempts: attemptsData };
  if (passAt1) totalPass1++;
  totalAttemptsAcrossProblems += attemptsData.length;

  console.log(`  pass@1: ${passAt1 ? '✓' : '✗'}  pass@N: ${passAtN ? '✓' : '✗'}  attempts: ${attemptsData.length}  sigRepair events: ${sigRepairCount}`);
  for (const a of attemptsData) {
    console.log(`    Attempt ${a.attempt}: ${a.pass ? 'PASS' : `FAIL(${a.stageFailed})`}`);
  }
}

// Summary
const summary = {
  baseline: BASELINE,
  k: 5,
  runDir: RUN_DIR,
  timestamp: TIMESTAMP,
  results,
  totalPass1,
  totalProblems: PROBLEMS.length,
  pass1Rate: `${totalPass1}/${PROBLEMS.length}`,
  totalAttempts: totalAttemptsAcrossProblems,
};

writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

// Also compute pass@1 at attempt level (not just problem level)
let passAt1Attempts = 0;
let totalFirstAttempts = 0;
for (const [problem, r] of Object.entries(results)) {
  if (r.attempts.length > 0) {
    totalFirstAttempts++;
    if (r.passAt1) passAt1Attempts++;
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Problems: ${PROBLEMS.length}`);
console.log(`Total attempts across problems: ${totalAttemptsAcrossProblems}`);
console.log(`pass@1 (problems): ${totalPass1}/${PROBLEMS.length} (${(totalPass1/PROBLEMS.length*100).toFixed(1)}%)`);
console.log(`Previous OS v0 k=5: 16/20 (80%) — gen18: 17/20 (85%)`);
console.log(`\nPer-problem breakdown:`);
for (const [problem, r] of Object.entries(results)) {
  console.log(`  ${problem}: pass@1=${r.passAt1 ? 1 : 0} pass@N=${r.passAtN ? 1 : 0} attempts=${r.attempts.length}`);
}