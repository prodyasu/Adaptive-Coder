#!/usr/bin/env node
/**
 * run-r6-icg.mjs — R6 Efficacy Test: Invariant-Constrained Generation (ICG)
 *
 * Tests whether ICG (Delta 6) improves first-attempt pass rate by deriving
 * structural invariants from the Shaper spec and injecting them into the
 * Coder prompt before code is generated.
 *
 * Design:
 * - N=8 problems (standard eval set), k=5 trials per problem per mode
 * - Two modes (A/B test):
 *   1. CONTROL (reasoning_os_v0, no ICG) — current pipeline, no invariant injection
 *   2. ICG (reasoning_os_v0 + icgEnabled) — Shaper→Invariants→Coder pipeline
 * - Both modes use identical model, identical problem set, identical baseline
 * - Only difference: ICG mode extracts invariants and appends them to Coder prompt
 *
 * PRIMARY DV: pass@1 delta (ICG vs control)
 * SECONDARY DVs:
 *   - Failure class breakdown (logic vs format vs timeout)
 *   - Held-out pass rate and cohAtrRisk
 *   - Invariant count and type distribution per problem
 *   - Autorepair exhaust rate
 *
 * HYPOTHESIS (from PERM_GRAD):
 *   ICG acts at generation time (before code is written), satisfying the
 *   PERM_GRAD requirement. Invariants constrain the solution space, reducing
 *   logic and edge-case failures. Expected improvement: +5-15pp on pass@1,
 *   concentrated in logic_assertion and edge_case failure classes.
 *
 * If ICG improves pass@1 beyond Wilson CI overlap, this is evidence that
 * pre-generation invariant injection moves outcomes — a genuine efficacy
 * mechanism for the OS layer.
 *
 * Usage:
 *   node run-r6-icg.mjs [--k=5] [--problems=8] [--skip-control]
 */

import { evalProblem } from './eval.js';
import { computeSelfCorrectionMetrics } from './self-correction-logger.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = [
  'binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii',
  'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree',
];

const MODES = {
  control: { label: 'control', icgEnabled: false },
  icg: { label: 'icg', icgEnabled: true },
};

// Parse CLI args
const args = process.argv.slice(2);
let K = 5;
let SKIP_CONTROL = false;
const CUSTOM_PROBLEMS = [];
for (const arg of args) {
  if (arg.startsWith('--k=')) K = parseInt(arg.slice(4), 10);
  if (arg === '--skip-control') SKIP_CONTROL = true;
  if (arg.startsWith('--problems=')) {
    // Could extend to support problem subsets
  }
}

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `r6-icg-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log(`\n${'='.repeat(70)}`);
console.log('=== R6 INVARIANT-CONSTRAINED GENERATION (ICG) EFFICACY TEST ===');
console.log(`=== N=${PROBLEMS.length}, k=${K}, modes=${SKIP_CONTROL ? 1 : 2} ===`);
console.log('=== Primary DV: pass@1 delta (ICG vs control) ===');
console.log(`${'='.repeat(70)}\n`);

const results = {};
const modeKeys = SKIP_CONTROL ? ['icg'] : ['control', 'icg'];

for (const modeKey of modeKeys) {
  const mode = MODES[modeKey];
  results[mode.label] = {};

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Running mode: ${mode.label} (icgEnabled=${mode.icgEnabled})`);
  console.log(`${'─'.repeat(50)}`);

  for (const problem of PROBLEMS) {
    console.log(`  ${problem}...`);
    const problemTraceDir = join(TRACE_DIR, mode.label, problem);
    if (!existsSync(problemTraceDir)) mkdirSync(problemTraceDir, { recursive: true });

    let passCount = 0;
    const trialResults = [];

    for (let trial = 0; trial < K; trial++) {
      console.log(`    Trial ${trial + 1}/${K}...`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);

        const attemptResults = await evalProblem(problem, 'reasoning_os_v0', null, {
          signal: controller.signal,
          traceDir: join(problemTraceDir, `trial-${trial}`),
          icgEnabled: mode.icgEnabled,
        });
        clearTimeout(timeout);

        // Extract attempt-level metrics
        const firstAttempt = attemptResults[0];
        const passAt1 = firstAttempt?.pass ?? false;
        if (passAt1) passCount++;

        // Collect ICG trace data
        let icgTraceData = null;
        let primaryPassRate = null;
        let cohAtrRisk = null;
        let failureKind = null;
        let failureSubKind = null;
        let failureCode = null;
        let autorepairCycles = 0;
        let informedRepairMode = null;

        for (const [, v] of Object.entries(attemptResults)) {
          if (v?.icg) icgTraceData = v.icg;
          if (v?.primaryPassRate !== undefined) primaryPassRate = v.primaryPassRate;
          if (v?.cohAtrRisk !== undefined && v.cohAtrRisk !== null) cohAtrRisk = v.cohAtrRisk;
          if (v?.failureKind) failureKind = v.failureKind;
          if (v?.failureSubKind) failureSubKind = v.failureSubKind;
          if (v?.failureCode) failureCode = v.failureCode;
          if (v?.autorepairCycles) autorepairCycles = v.autorepairCycles;
          if (v?.informedRepairMode) informedRepairMode = v.informedRepairMode;
        }

        const eventualPass = attemptResults.some(a => a?.pass);

        trialResults.push({
          trial: trial + 1,
          passAt1,
          eventualPass,
          primaryPassRate,
          cohAtrRisk,
          failureKind,
          failureSubKind,
          failureCode,
          autorepairCycles,
          informedRepairMode,
          icgEnabled: mode.icgEnabled,
          icgTrace: icgTraceData,
          error: undefined,
        });
      } catch (err) {
        console.log(`    Trial ${trial + 1} ERROR: ${err.message?.slice(0, 80)}`);
        trialResults.push({
          trial: trial + 1,
          passAt1: false,
          eventualPass: false,
          primaryPassRate: null,
          cohAtrRisk: null,
          failureKind: 'model_error',
          failureSubKind: null,
          failureCode: null,
          autorepairCycles: 0,
          informedRepairMode: null,
          icgEnabled: mode.icgEnabled,
          icgTrace: null,
          error: err.message,
        });
      }
    }

    const passAt1Rate = passCount / K;
    const eventualPassRate = trialResults.filter(r => r.eventualPass).length / K;
    const avgICGInvariantCount = trialResults
      .filter(r => r.icgTrace?.invariantCount)
      .map(r => r.icgTrace.invariantCount)
      .reduce((a, b, i, arr) => arr.length > 0 ? a + b / arr.length : 0, 0) || null;

    results[mode.label][problem] = {
      passAt1: passAt1Rate,
      passAt1Count: passCount,
      passAt1Total: K,
      eventualPassRate,
      trialResults,
      avgICGInvariantCount,
    };

    console.log(`  ${problem}: pass@1=${passCount}/${K} (${(passAt1Rate * 100).toFixed(0)}%), eventual=${(eventualPassRate * 100).toFixed(0)}%` +
      (avgICGInvariantCount !== null ? `, avg invariants=${avgICGInvariantCount.toFixed(1)}` : ''));
  }
}

// ── Aggregate results ──────────────────────────────────────────────────────

console.log(`\n${'='.repeat(70)}`);
console.log('=== R6 ICG RESULTS ===');
console.log(`${'='.repeat(70)}\n`);

for (const modeKey of modeKeys) {
  const mode = MODES[modeKey];
  const label = mode.label;
  const totalPassAt1 = Object.values(results[label]).reduce((sum, r) => sum + r.passAt1Count, 0);
  const totalTrials = Object.values(results[label]).reduce((sum, r) => sum + r.passAt1Total, 0);
  const rate = (totalPassAt1 / totalTrials * 100).toFixed(1);

  console.log(`\n${label.toUpperCase()} (icgEnabled=${mode.icgEnabled}):`);
  console.log(`  pass@1: ${totalPassAt1}/${totalTrials} (${rate}%)`);
  for (const [problem, data] of Object.entries(results[label])) {
    console.log(`  ${problem}: ${data.passAt1Count}/${data.passAt1Total} (${(data.passAt1Rate * 100).toFixed(0)}%)`);
  }
}

// ── A/B comparison ────────────────────────────────────────────────────────

if (!SKIP_CONTROL && results.control && results.icg) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log('A/B Comparison:');
  console.log(`${'─'.repeat(50)}`);

  const controlTotal = Object.values(results.control).reduce((sum, r) => sum + r.passAt1Count, 0);
  const icgTotal = Object.values(results.icg).reduce((sum, r) => sum + r.passAt1Count, 0);
  const controlD = Object.values(results.control).reduce((sum, r) => sum + r.passAt1Total, 0);
  const icgD = Object.values(results.icg).reduce((sum, r) => sum + r.passAt1Total, 0);

  const controlRate = (controlTotal / controlD * 100).toFixed(1);
  const icgRate = (icgTotal / icgD * 100).toFixed(1);
  const delta = ((icgTotal / icgD) - (controlTotal / controlD)) * 100;

  console.log(`  Control: ${controlTotal}/${controlD} (${controlRate}%)`);
  console.log(`  ICG:     ${icgTotal}/${icgD} (${icgRate}%)`);
  console.log(`  Delta:   ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp`);
  console.log();

  // Per-problem breakdown
  for (const problem of PROBLEMS) {
    const c = results.control[problem];
    const i = results.icg[problem];
    if (c && i) {
      const cRate = (c.passAt1 * 100).toFixed(0);
      const iRate = (i.passAt1 * 100).toFixed(0);
      const pDelta = ((i.passAt1 - c.passAt1) * 100).toFixed(0);
      const invCount = i.avgICGInvariantCount !== null ? `inv=${i.avgICGInvariantCount.toFixed(1)}` : '';
      console.log(`  ${problem}: control=${cRate}% ICG=${iRate}% delta=${pDelta >= 0 ? '+' : ''}${pDelta}pp ${invCount}`);
    }
  }
}

// ── Save results ───────────────────────────────────────────────────────────

const summary = {
  timestamp: TIMESTAMP,
  design: 'R6 ICG efficacy: control vs icgEnabled A/B',
  primaryDV: 'pass@1 delta (ICG vs control)',
  problems: PROBLEMS,
  k: K,
  modes: modeKeys.map(k => ({ key: k, icgEnabled: MODES[k].icgEnabled })),
  results,
};

const summaryPath = join(RUN_DIR, 'summary.json');
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`\nResults saved to: ${summaryPath}`);