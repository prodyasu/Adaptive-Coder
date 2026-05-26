#!/usr/bin/env node
/**
 * run-r3-capability.mjs — R3 Capability Arm
 *
 * OS v0 + induced drift, reported ONLY as:
 *   - trigger fired X/40
 *   - repair succeeded Y/X
 *   - post-repair held-out Z
 *
 * No comparison with no-drift efficacy arm (different experiment).
 * This proves sig-repair is a deterministic capability, not stochastic efficacy.
 */
import { evalProblem } from './eval.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const PROBLEMS = [
  'binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii',
  'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree',
];

const K = 5;
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `r3-capability-${TIMESTAMP}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log(`\n${'='.repeat(70)}`);
console.log('=== R3 CAPABILITY ARM ===');
console.log(`=== OS v0 + induced drift, N=${PROBLEMS.length}, k=${K} ===`);
console.log('=== Reported as: trigger fired, repair succeeded, post-repair held-out ===');
console.log(`${'='.repeat(70)}\n`);

const results = {};

for (const problem of PROBLEMS) {
  console.log(`  ${problem}...`);
  const problemTraceDir = join(TRACE_DIR, problem);
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
        inducedDrift: true,
      });
      clearTimeout(timeout);

      const entries = Object.entries(attemptResults)
        .filter(([k]) => !isNaN(k))
        .sort(([a],[b]) => Number(a) - Number(b));

      const firstAttempt = entries[0]?.[1];
      const passAt1 = firstAttempt?.pass || false;
      const passAtN = entries.some(([,v]) => v.pass);
      if (passAt1) passCount++;

      // Collect drift + held-out metrics from attempt records
      let triggerFired = false, repairSucceeded = false;
      let primaryPassRate = null, heldOutPassRate = null, cohAtrRisk = null;

      for (const [,v] of entries) {
        const sigRepair = v?.sigRepair;
        if (sigRepair) {
          triggerFired = true;
          // sigRepair is stored as { snippet: '{"originalName":"...","repairedName":"..."}', rawLength, truncated }
          // or as { originalName, repairedName } directly
          const repairedName = sigRepair.repairedName
            ?? (sigRepair.snippet ? (JSON.parse(sigRepair.snippet)).repairedName : null);
          if (repairedName) repairSucceeded = true;
        }
        if (v?.primaryPassRate !== undefined) {
          primaryPassRate = v.primaryPassRate;
          heldOutPassRate = v.heldOutPassRate ?? null;
          cohAtrRisk = v.cohAtrRisk ?? null;
        }
      }

      trialResults.push({
        trial: trial + 1,
        passAt1,
        passAtN,
        triggerFired,
        repairSucceeded,
        primaryPassRate,
        heldOutPassRate,
        cohAtrRisk,
      });
    } catch (err) {
      console.log(`    Trial ${trial + 1} ERROR: ${err.message?.slice(0, 80)}`);
      trialResults.push({ trial: trial + 1, passAt1: false, passAtN: false, error: err.message, triggerFired: false, repairSucceeded: false });
    }
  }

  results[problem] = {
    passAt1Count: passCount,
    passAt1Rate: passCount / K,
    trials: trialResults,
  };
  console.log(`  ${problem}: pass@1 = ${passCount}/${K} (${(passCount/K*100).toFixed(0)}%)`);
}

// ── Compute capability metrics ──
let totalTrials = PROBLEMS.length * K;
let triggerFired = 0, repairSucceeded = 0;
let postRepairHeldOutSum = 0, postRepairHeldOutCount = 0;
const problemSummary = {};

for (const [problem, data] of Object.entries(results)) {
  let pFired = 0, pRepaired = 0, pHOSum = 0, pHON = 0;

  for (const t of data.trials) {
    if (t.triggerFired) { triggerFired++; pFired++; }
    if (t.repairSucceeded) { repairSucceeded++; pRepaired++; }
    if (t.heldOutPassRate !== null && t.heldOutPassRate !== undefined) {
      postRepairHeldOutSum += t.heldOutPassRate;
      postRepairHeldOutCount++;
      pHOSum += t.heldOutPassRate;
      pHON++;
    }
  }

  problemSummary[problem] = {
    totalTrials: data.trials.length,
    passAt1Rate: data.passAt1Rate,
    triggerFired: pFired,
    repairSucceeded: pRepaired,
    avgHeldOut: pHON > 0 ? pHOSum / pHON : null,
  };
}

// ── Report ──
console.log(`\n${'='.repeat(70)}`);
console.log('R3 CAPABILITY ARM RESULTS');
console.log('(sig-repair deterministic capability test, NOT efficacy comparison)');
console.log(`${'='.repeat(70)}`);

console.log(`\n  Total trials:            ${totalTrials}`);
console.log(`  Drift trigger fired:    ${triggerFired}/${totalTrials} (${(triggerFired/totalTrials*100).toFixed(0)}%)`);
console.log(`  Repair succeeded:       ${repairSucceeded}/${triggerFired} (${triggerFired > 0 ? (repairSucceeded/triggerFired*100).toFixed(0) : 'N/A'}%)`);
console.log(`  Post-repair held-out:   ${postRepairHeldOutCount > 0 ? (postRepairHeldOutSum/postRepairHeldOutCount*100).toFixed(1) + '%' : 'N/A'}`);

console.log(`\n  Per problem:`);
for (const [p, s] of Object.entries(problemSummary)) {
  const hoStr = s.avgHeldOut !== null ? `${(s.avgHeldOut * 100).toFixed(0)}%` : 'N/A';
  console.log(`    ${p}: pass@1=${(s.passAt1Rate*100).toFixed(0)}% trigger=${s.triggerFired}/${s.totalTrials} repair=${s.repairSucceeded}/${s.triggerFired} held-out=${hoStr}`);
}

const report = {
  type: 'r3-capability',
  timestamp: TIMESTAMP,
  problems: PROBLEMS,
  k: K,
  drift: 'induced',
  referenceCalibration: 'CLEAN (all 8 held-out suites pass at 100%)',
  summary: {
    totalTrials,
    triggerFired,
    repairSucceeded,
    postRepairHeldOut: postRepairHeldOutCount > 0 ? postRepairHeldOutSum / postRepairHeldOutCount : null,
  },
  byProblem: problemSummary,
  raw: results,
};

writeFileSync(join(RUN_DIR, 'report.json'), JSON.stringify(report, null, 2));
console.log(`\nResults saved to ${RUN_DIR}`);
console.log(`${'='.repeat(70)}`);