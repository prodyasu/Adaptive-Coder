#!/usr/bin/env node
/**
 * run-r3-efficacy.mjs — R3 Efficacy Arm
 *
 * OS v0 (no drift) vs gen18_evolved, both with held-out metrics.
 * Continuous DVs: primaryPassRate, heldOutPassRate, cohAtrRisk, selfCorrectionRate.
 * pass@k is secondary confirmatory only.
 *
 * Reference calibration: ALL 8 held-out suites are CLEAN (100% pass rate).
 * cohAtrRisk guard: undefined (NaN) when primaryPassRate < 0.6.
 *
 * Claude's recommendation: report as efficacy A/B comparison, NOT mixed with drift.
 */
import { evalProblem } from './eval.js';
import { computeSelfCorrectionMetrics } from './self-correction-logger.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = [
  'binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii',
  'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree',
];

const BASELINES = ['reasoning_os_v0', 'gen18_evolved'];
const K = 5;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `r3-efficacy-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log(`\n${'='.repeat(70)}`);
console.log('=== R3 EFFICACY ARM ===');
console.log(`=== OS v0 (no drift) vs gen18_evolved, N=${PROBLEMS.length}, k=${K} ===`);
console.log(`${'='.repeat(70)}\n`);

const results = {};

for (const baseline of BASELINES) {
  results[baseline] = {};
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Running baseline: ${baseline}`);
  console.log(`${'─'.repeat(50)}`);

  for (const problem of PROBLEMS) {
    console.log(`  ${problem}...`);
    const problemTraceDir = join(TRACE_DIR, baseline, problem);
    if (!existsSync(problemTraceDir)) mkdirSync(problemTraceDir, { recursive: true });

    let passCount = 0;
    const trialResults = [];

    for (let trial = 0; trial < K; trial++) {
      console.log(`    Trial ${trial + 1}/${K}...`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120_000);

        const attemptResults = await evalProblem(problem, baseline, null, {
          signal: controller.signal,
          traceDir: join(problemTraceDir, `trial-${trial}`),
        });
        clearTimeout(timeout);

        const entries = Object.entries(attemptResults)
          .filter(([k]) => !isNaN(k))
          .sort(([a],[b]) => Number(a) - Number(b));

        const firstAttempt = entries[0]?.[1];
        const passAt1 = firstAttempt?.pass || false;
        const passAtN = entries.some(([,v]) => v.pass);
        if (passAt1) passCount++;

        // Collect held-out + self-correction metrics from first attempt that has them
        let primaryPassRate = null, heldOutPassRate = null, cohAtrRisk = null;
        let selfCorrection = null;
        for (const [,v] of entries) {
          if (v?.primaryPassRate !== undefined) {
            primaryPassRate = v.primaryPassRate;
            heldOutPassRate = v.heldOutPassRate ?? null;
            cohAtrRisk = v.cohAtrRisk ?? null;
          }
          if (v?.selfCorrection) {
            selfCorrection = v.selfCorrection;
          }
          if (primaryPassRate !== null) break;
        }

        trialResults.push({
          trial: trial + 1,
          passAt1,
          passAtN,
          primaryPassRate,
          heldOutPassRate,
          cohAtrRisk,
          selfCorrection,
          autorepairCycles: firstAttempt?.autorepairCycles ?? 0,
        });
      } catch (err) {
        console.log(`    Trial ${trial + 1} ERROR: ${err.message?.slice(0, 80)}`);
        trialResults.push({ trial: trial + 1, passAt1: false, passAtN: false, error: err.message });
      }
    }

    results[baseline][problem] = {
      passAt1Count: passCount,
      passAt1Rate: passCount / K,
      trials: trialResults,
    };
    console.log(`  ${problem}: pass@1 = ${passCount}/${K} (${(passCount/K*100).toFixed(0)}%)`);
  }
}

// ── Compute metrics ──
function computeArmMetrics(armResults) {
  let totalPrimaryPass = 0, totalTrials = 0;
  let heldOutSum = 0, heldOutCount = 0;
  let cohAtrRiskValues = [];
  let selfCorrTotal = 0, selfCorrSelf = 0;
  const byProblem = {};

  for (const [problem, data] of Object.entries(armResults)) {
    totalPrimaryPass += data.passAt1Count;
    totalTrials += data.trials.length;

    let pHeldOut = 0, pHeldOutN = 0, pCohAtrValues = [];
    let pSelfCorrTotal = 0, pSelfCorrSelf = 0;

    for (const t of data.trials) {
      if (t.heldOutPassRate !== null && t.heldOutPassRate !== undefined) {
        heldOutSum += t.heldOutPassRate;
        heldOutCount++;
        pHeldOut += t.heldOutPassRate;
        pHeldOutN++;
      }
      if (t.cohAtrRisk !== null && t.cohAtrRisk !== undefined && !isNaN(t.cohAtrRisk)) {
        cohAtrRiskValues.push(t.cohAtrRisk);
        pCohAtrValues.push(t.cohAtrRisk);
      }
      if (t.selfCorrection) {
        pSelfCorrTotal++;
        if (t.selfCorrection.selfCorrected) pSelfCorrSelf++;
      }
    }

    byProblem[problem] = {
      passAt1Rate: data.passAt1Rate,
      avgHeldOut: pHeldOutN > 0 ? pHeldOut / pHeldOutN : null,
      avgCohAtrRisk: pCohAtrValues.length > 0 ? pCohAtrValues.reduce((a,b) => a+b, 0) / pCohAtrValues.length : null,
    };
    selfCorrTotal += pSelfCorrTotal;
    selfCorrSelf += pSelfCorrSelf;
  }

  return {
    totalTrials,
    primaryPassRate: totalTrials > 0 ? totalPrimaryPass / totalTrials : 0,
    passedTrials: totalPrimaryPass,
    heldOutPassRate: heldOutCount > 0 ? heldOutSum / heldOutCount : null,
    avgCohAtrRisk: cohAtrRiskValues.length > 0 ? cohAtrRiskValues.reduce((a,b) => a+b, 0) / cohAtrRiskValues.length : null,
    selfCorrectionRate: selfCorrTotal > 0 ? selfCorrSelf / selfCorrTotal : null,
    selfCorrSelf,
    selfCorrTotal,
    byProblem,
  };
}

const osMetrics = computeArmMetrics(results['reasoning_os_v0']);
const genMetrics = computeArmMetrics(results['gen18_evolved']);

// ── Report ──
console.log(`\n${'='.repeat(70)}`);
console.log('R3 EFFICACY ARM RESULTS');
console.log(`${'='.repeat(70)}`);

for (const [name, metrics] of [['OS v0', osMetrics], ['gen18', genMetrics]]) {
  console.log(`\n--- ${name} ---`);
  console.log(`  Primary pass@1:  ${metrics.passedTrials}/${metrics.totalTrials} (${(metrics.primaryPassRate * 100).toFixed(1)}%)`);
  console.log(`  Held-out rate:    ${metrics.heldOutPassRate !== null ? (metrics.heldOutPassRate * 100).toFixed(1) + '%' : 'N/A'}`);
  console.log(`  Avg cohAtrRisk:   ${metrics.avgCohAtrRisk !== null ? (metrics.avgCohAtrRisk * 100).toFixed(1) + '%' : 'N/A (undefined)'}`);
  console.log(`  Self-correction:  ${metrics.selfCorrectionRate !== null ? (metrics.selfCorrectionRate * 100).toFixed(0) + '%' : 'N/A'} (${metrics.selfCorrSelf}/${metrics.selfCorrTotal})`);
  for (const [p, s] of Object.entries(metrics.byProblem)) {
    const hoStr = s.avgHeldOut !== null ? `${(s.avgHeldOut * 100).toFixed(0)}%` : 'N/A';
    const cohStr = s.avgCohAtrRisk !== null ? `${(s.avgCohAtrRisk * 100).toFixed(0)}%` : 'undef';
    console.log(`    ${p}: pass@1=${(s.passAt1Rate * 100).toFixed(0)}% held-out=${hoStr} cohAtr=${cohStr}`);
  }
}

const deltaPrimary = osMetrics.primaryPassRate - genMetrics.primaryPassRate;
const deltaHeldOut = (osMetrics.heldOutPassRate ?? 0) - (genMetrics.heldOutPassRate ?? 0);
console.log(`\n--- DELTA (OS v0 - gen18) ---`);
console.log(`  Primary pass@1 delta:  ${(deltaPrimary * 100).toFixed(1)}pp`);
console.log(`  Held-out rate delta:  ${(deltaHeldOut * 100).toFixed(1)}pp`);
console.log(`  cohAtrRisk delta:      ${osMetrics.avgCohAtrRisk !== null && genMetrics.avgCohAtrRisk !== null ? ((osMetrics.avgCohAtrRisk - genMetrics.avgCohAtrRisk) * 100).toFixed(1) + 'pp' : 'N/A'}`);

const report = {
  type: 'r3-efficacy',
  timestamp: TIMESTAMP,
  problems: PROBLEMS,
  k: K,
  referenceCalibration: 'CLEAN (all 8 held-out suites pass at 100%)',
  cohAtrRiskGuard: 'undefined when primaryPassRate < 0.6',
  os_v0: osMetrics,
  gen18: genMetrics,
  raw: results,
};
writeFileSync(join(RUN_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nResults saved to ${RUN_DIR}`);
console.log(`${'='.repeat(70)}`);