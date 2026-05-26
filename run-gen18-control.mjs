#!/usr/bin/env node
/**
 * run-gen18-control.mjs — Run gen18_evolved k=5 control for A/B comparison
 */
import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii', 'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree'];
const BASELINE = 'gen18_evolved';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `gen18-evolved-k5-rerun-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');

mkdirSync(TRACE_DIR, { recursive: true });

console.log(`=== gen18_evolved k=5 Control ===`);
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Baseline: ${BASELINE}, MAX_ATTEMPTS=5`);

const results = {};

for (const problem of PROBLEMS) {
  console.log(`\n--- ${problem} ---`);
  const problemTraceDir = join(TRACE_DIR, problem);
  if (!existsSync(problemTraceDir)) mkdirSync(problemTraceDir, { recursive: true });

  let passAt1 = false;
  let passAtN = false;
  const attemptsData = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600_000);

    const result = await evalProblem(problem, BASELINE, null, {
      signal: controller.signal,
      traceDir: problemTraceDir,
    });
    clearTimeout(timeout);

    const entries = Object.entries(result)
      .filter(([k]) => !isNaN(k))
      .sort(([a],[b]) => Number(a) - Number(b));

    if (entries.length > 0) {
      passAt1 = entries[0][1]?.pass || false;
      passAtN = entries.some(([,v]) => v.pass);
    }

    for (const [idx, att] of entries) {
      attemptsData.push({
        attempt: parseInt(idx),
        pass: att.pass,
        stageFailed: att.stageFailed,
      });
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message?.slice(0, 100)}`);
  }

  results[problem] = { passAt1, passAtN, attempts: attemptsData };
  console.log(`  pass@1: ${passAt1 ? '✓' : '✗'}  pass@N: ${passAtN ? '✓' : '✗'}  attempts: ${attemptsData.length}`);
  for (const a of attemptsData) {
    console.log(`    Attempt ${a.attempt}: ${a.pass ? 'PASS' : `FAIL(${a.stageFailed})`}`);
  }
}

let totalPass1 = 0;
for (const r of Object.values(results)) { if (r.passAt1) totalPass1++; }

const summary = {
  baseline: BASELINE,
  k: 5,
  runDir: RUN_DIR,
  timestamp: TIMESTAMP,
  results,
  totalPass1,
  totalProblems: PROBLEMS.length,
};

writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(`\n=== SUMMARY ===`);
console.log(`pass@1: ${totalPass1}/${PROBLEMS.length}`);
console.log(`Per-problem:`);
for (const [problem, r] of Object.entries(results)) {
  console.log(`  ${problem}: pass@1=${r.passAt1 ? 1 : 0} pass@N=${r.passAtN ? 1 : 0} attempts=${r.attempts.length}`);
}