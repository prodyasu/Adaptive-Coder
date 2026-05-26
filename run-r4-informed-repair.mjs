#!/usr/bin/env node
/**
 * run-r4-informed-repair.mjs — R4 Efficacy Arm: Does informed repair convert failures?
 *
 * Tests three autorepair feedback modes:
 * 1. VERIFIER (control) — current behavior: verifier suggestions only
 * 2. TEST_FAILURE — concrete test case failure feedback
 * 3. SPEC_AND_TEST — spec guidance + concrete test failure (Delta 4)
 *
 * Design:
 * - N=8 problems, k=5 trials per problem per mode
 * - All three modes use reasoning_os_v0 baseline (same model, same pipeline)
 * - Only difference is autorepair feedback content
 *
 * PRIMARY DEPENDENT VARIABLE (changed from pass@1):
 *   Repair conversion rate = P(pass after repair | first attempt failed AND repair triggered)
 *   This is the correct causal metric: it measures whether the repair mechanism
 *   itself works, not whether the overall pipeline is good (which is confounded
 *   by first-attempt pass rate). pass@1 conflates "never needed repair" with
 *   "repair succeeded" — only the latter is what R4 tests.
 *
 * SECONDARY DVs:
 *   - Final success rate (pass@N / best-of-k): overall pass including all attempts
 *   - Attempts-to-pass: mean number of coder calls to reach pass (conditional on passing)
 *   - Held-out pass after repair: held-out test rate among repair-converted trials
 *   - Conditional by failure class: repair conversion broken down by failure type
 *     (logic, timeout, signature, import) to detect which errors repair helps most
 *   - Self-correction rate (from self-correction-logger)
 *   - Autorepair cycles consumed
 *
 * Hypothesis (from PERM_GRAD):
 *   TEST_FAILURE and SPEC_AND_TEST should show higher repair conversion than
 *   VERIFIER because they provide concrete failure signal (acts at generation
 *   time, satisfies PERM_GRAD) rather than vague verifier suggestions
 *   (annotates post-hoc). pass@1 may not differ because it's dominated by
 *   first-attempt successes which repair never touches.
 *
 * This is the bridge from measurement → genuine RCR. If informed repair
 * converts failures at a higher rate, the OS layer has a real efficacy
 * mechanism — not just annotation, but actionable feedback that rewrites
 * the artifact.
 */
import { evalProblem } from './eval.js';
import { INFORMED_REPAIR_MODES } from './informed-repair.js';
import { computeSelfCorrectionMetrics } from './self-correction-logger.js';
import { computeModeMetrics, classifyTrial } from './r4-metrics.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = [
  'binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii',
  'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree',
];

const MODES = [
  INFORMED_REPAIR_MODES.VERIFIER,      // Control: existing vague verifier feedback
  INFORMED_REPAIR_MODES.TEST_FAILURE,   // Delta 4a: concrete test failure info
  INFORMED_REPAIR_MODES.SPEC_AND_TEST,  // Delta 4b: spec + test failure
];

const MODE_LABELS = {
  [INFORMED_REPAIR_MODES.VERIFIER]: 'verifier_only',
  [INFORMED_REPAIR_MODES.TEST_FAILURE]: 'test_failure',
  [INFORMED_REPAIR_MODES.SPEC_AND_TEST]: 'spec_and_test',
};

const K = 5;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `r4-informed-repair-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log(`\n${'='.repeat(70)}`);
console.log('=== R4 INFORMED REPAIR EFFICACY ARM ===');
console.log(`=== N=${PROBLEMS.length}, k=${K}, modes=3 ===`);
console.log(`=== Primary DV: REPAIR CONVERSION RATE (not pass@1) ===`);
console.log(`${'='.repeat(70)}\n`);

const results = {};

for (const mode of MODES) {
  const modeLabel = MODE_LABELS[mode];
  results[modeLabel] = {};
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Running mode: ${modeLabel}`);
  console.log(`${'─'.repeat(50)}`);

  for (const problem of PROBLEMS) {
    console.log(`  ${problem}...`);
    const problemTraceDir = join(TRACE_DIR, modeLabel, problem);
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
          autorepairFeedbackMode: mode,  // KEY: thread the mode through
        });
        clearTimeout(timeout);

        const entries = Object.entries(attemptResults)
          .filter(([k]) => !isNaN(k))
          .sort(([a],[b]) => Number(a) - Number(b));

        // ── Classify trial outcomes for repair conversion ──
        const classified = classifyTrial(entries);
        const firstAttemptPassed = classified.passAt1;
        if (firstAttemptPassed) passCount++;

        // Extract additional per-trial metrics not in classifyTrial
        let primaryPassRate = null;
        let cohAtrRisk = null;
        let selfCorrection = null;
        let informedRepairMode = null;
        let autorepairCycles = 0;

        for (const [, v] of entries) {
          if (v?.primaryPassRate !== undefined) primaryPassRate = v.primaryPassRate;
          if (v?.cohAtrRisk !== undefined && v.cohAtrRisk !== null) cohAtrRisk = v.cohAtrRisk;
          if (v?.selfCorrection) selfCorrection = v.selfCorrection;
          if (v?.informedRepairMode) informedRepairMode = v.informedRepairMode;
          if (v?.autorepairCycles) autorepairCycles = v.autorepairCycles;
          if (primaryPassRate !== null) break;
        }

        trialResults.push({
          trial: trial + 1,
          // Primary DV fields (from classifyTrial)
          passAt1: classified.passAt1,
          repairEligible: classified.repairEligible,
          repairConverted: classified.repairConverted,
          // Secondary outcomes
          eventualPass: classified.eventualPass,
          attemptsToPass: classified.attemptsToPass,
          heldOutAfterRepairRate: classified.heldOutAfterRepairRate,
          failureClass: classified.failureClass,
          failureClasses: classified.failureClasses,
          // Additional metrics
          primaryPassRate,
          cohAtrRisk,
          selfCorrection,
          autorepairCycles,
          informedRepairMode,
          informedRepairTriggered: classified.repairEligible || (entries.some(([,v]) => v?.informedRepairFeedback)),
          error: undefined,
        });
      } catch (err) {
        console.log(`    Trial ${trial + 1} ERROR: ${err.message?.slice(0, 80)}`);
        trialResults.push({
          trial: trial + 1,
          passAt1: false,
          repairEligible: false,
          repairConverted: false,
          eventualPass: false,
          attemptsToPass: null,
          heldOutAfterRepairRate: null,
          failureClass: null,
          failureClasses: [],
          primaryPassRate: null,
          cohAtrRisk: null,
          selfCorrection: null,
          autorepairCycles: 0,
          informedRepairMode: null,
          informedRepairTriggered: false,
          error: err.message,
        });
      }
    }

    results[modeLabel][problem] = {
      passAt1Count: passCount,
      passAt1Rate: passCount / K,
      trials: trialResults,
    };
    console.log(`  ${problem}: pass@1 = ${passCount}/${K} (${(passCount/K*100).toFixed(0)}%)`);
  }
}

// ── Compute metrics (via r4-metrics.js) ──
const verifierMetrics = computeModeMetrics(results['verifier_only']);
const testFailureMetrics = computeModeMetrics(results['test_failure']);
const specAndTestMetrics = computeModeMetrics(results['spec_and_test']);

// ── Report ──
console.log(`\n${'='.repeat(70)}`);
console.log('R4 INFORMED REPAIR RESULTS');
console.log('=== PRIMARY DV: REPAIR CONVERSION RATE ===');
console.log(`${'='.repeat(70)}`);

function fmtRate(num) {
  return num !== null && num !== undefined ? (num * 100).toFixed(1) + '%' : 'N/A';
}

function fmtPct(num, denom) {
  return denom > 0 ? `${num}/${denom} (${(num/denom*100).toFixed(1)}%)` : 'N/A (0 eligible)';
}

for (const [label, metrics] of [
  ['VERIFIER (control)', verifierMetrics],
  ['TEST_FAILURE (Delta 4a)', testFailureMetrics],
  ['SPEC_AND_TEST (Delta 4b)', specAndTestMetrics],
]) {
  console.log(`\n--- ${label} ---`);
  console.log(`  PRIMARY — Repair conversion:  ${fmtPct(metrics.repairConverted, metrics.repairEligible)}`);
  console.log(`  Repair conversion rate:        ${fmtRate(metrics.repairConversionRate)}`);
  console.log(`  Context — pass@1:             ${fmtPct(metrics.passedAt1Trials, metrics.totalTrials)}`);
  console.log(`  Final success (pass@N):       ${fmtPct(metrics.finalSuccessTrials, metrics.totalTrials)}`);
  console.log(`  Avg attempts-to-pass:         ${metrics.avgAttemptsToPass !== null ? metrics.avgAttemptsToPass.toFixed(2) : 'N/A'} (n=${metrics.attemptsToPassN})`);
  console.log(`  Held-out after repair:        ${fmtRate(metrics.heldOutAfterRepairRate)} (n=${metrics.heldOutAfterRepairN})`);
  console.log(`  Avg cohAtrRisk:               ${fmtRate(metrics.avgCohAtrRisk)}`);

  // Failure class breakdown
  if (Object.keys(metrics.byFailureClass).length > 0) {
    console.log(`  Repair conversion by failure class:`);
    for (const [fc, data] of Object.entries(metrics.byFailureClass)) {
      console.log(`    ${fc}: ${fmtPct(data.converted, data.eligible)}`);
    }
  }

  for (const [p, s] of Object.entries(metrics.byProblem)) {
    const repairStr = s.repairConversion !== null ? `${(s.repairConversion * 100).toFixed(0)}% (${s.repairConverted}/${s.repairEligible})` : 'N/A';
    const finalStr = `${(s.finalSuccessRate * 100).toFixed(0)}%`;
    console.log(`    ${p}: repair=${repairStr} pass@1=${(s.passAt1Rate * 100).toFixed(0)}% final=${finalStr}`);
  }
}

// ── Deltas ──
// Primary delta: repair conversion rate difference
const rcV = verifierMetrics.repairConversionRate;
const rcTF = testFailureMetrics.repairConversionRate;
const rcST = specAndTestMetrics.repairConversionRate;

console.log(`\n--- DELTAS vs CONTROL (VERIFIER) ---`);
console.log(`  PRIMARY — Repair conversion:`);
console.log(`    TEST_FAILURE vs VERIFIER:   ${rcV !== null && rcTF !== null ? ((rcTF - rcV) * 100).toFixed(1) + 'pp' : 'N/A (insufficient repair-eligible trials)'}`);
console.log(`    SPEC_AND_TEST vs VERIFIER:  ${rcV !== null && rcST !== null ? ((rcST - rcV) * 100).toFixed(1) + 'pp' : 'N/A (insufficient repair-eligible trials)'}`);
console.log(`    TEST_FAILURE vs SPEC:       ${rcTF !== null && rcST !== null ? ((rcTF - rcST) * 100).toFixed(1) + 'pp' : 'N/A'}`);

// Legacy pass@1 deltas (for context)
const deltaTF = testFailureMetrics.passAt1Rate - verifierMetrics.passAt1Rate;
const deltaST = specAndTestMetrics.passAt1Rate - verifierMetrics.passAt1Rate;
console.log(`\n  Context — pass@1 deltas (NOT primary DV):`);
console.log(`    TEST_FAILURE:   ${(deltaTF * 100).toFixed(1)}pp`);
console.log(`    SPEC_AND_TEST:  ${(deltaST * 100).toFixed(1)}pp`);

// Final success deltas
const fsTF = testFailureMetrics.finalSuccessRate - verifierMetrics.finalSuccessRate;
const fsST = specAndTestMetrics.finalSuccessRate - verifierMetrics.finalSuccessRate;
console.log(`  Final success deltas:`);
console.log(`    TEST_FAILURE:   ${(fsTF * 100).toFixed(1)}pp`);
console.log(`    SPEC_AND_TEST:  ${(fsST * 100).toFixed(1)}pp`);

const report = {
  type: 'r4-informed-repair',
  timestamp: TIMESTAMP,
  problems: PROBLEMS,
  k: K,
  modes: MODES,
  primaryDV: 'repairConversionRate',
  primaryDVDefinition: 'P(pass after repair | first attempt failed AND repair triggered)',
  secondaryDVs: [
    'finalSuccessRate', 'avgAttemptsToPass', 'heldOutAfterRepairRate',
    'repairConversionByFailureClass', 'passAt1Rate (context only)',
  ],
  hypothesis: 'Informed repair (TEST_FAILURE, SPEC_AND_TEST) should show higher repair conversion than VERIFIER-only feedback per PERM_GRAD. pass@1 may not differ (dominated by first-attempt successes).',
  note: 'Primary DV changed from pass@1 to repair conversion rate because pass@1 conflates "never needed repair" with "repair succeeded" — only the latter is what R4 tests causally.',
  reference_r3_efficacy: 'OS v0 82.5% vs gen18 87.5% (NS)',
  verifier: verifierMetrics,
  test_failure: testFailureMetrics,
  spec_and_test: specAndTestMetrics,
  deltas: {
    primary: {
      repairConversion: {
        testFailure_vs_verifier: rcV !== null && rcTF !== null ? `${((rcTF - rcV) * 100).toFixed(1)}pp` : 'N/A',
        specAndTest_vs_verifier: rcV !== null && rcST !== null ? `${((rcST - rcV) * 100).toFixed(1)}pp` : 'N/A',
      },
    },
    context: {
      passAt1: {
        testFailure_vs_verifier: `${(deltaTF * 100).toFixed(1)}pp`,
        specAndTest_vs_verifier: `${(deltaST * 100).toFixed(1)}pp`,
      },
      finalSuccess: {
        testFailure_vs_verifier: `${(fsTF * 100).toFixed(1)}pp`,
        specAndTest_vs_verifier: `${(fsST * 100).toFixed(1)}pp`,
      },
    },
  },
  raw: results,
};
writeFileSync(join(RUN_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nResults saved to ${RUN_DIR}`);
console.log(`${'='.repeat(70)}`);