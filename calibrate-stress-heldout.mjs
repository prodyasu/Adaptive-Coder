#!/usr/bin/env node
/**
 * calibrate-stress-heldout.mjs — no-model reference calibration for stress-suite MVP.
 *
 * This runner only validates checked-in reference.py solutions against primary +
 * held-out tests. Keep it separate from model-call runners so calibration does
 * not inherit model/provider variance or warm module state from eval runs.
 */
import {
  STRESS_PROBLEMS,
  calibrateReferences,
  ensureRunDir,
  frac,
  pct,
  writeCompactReport,
} from './stress-runner-utils.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const RUN_DIR = ensureRunDir('stress-reference-calibration');

console.log('\n=== Stress-suite reference calibration (NO MODEL CALLS) ===');
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Problems: ${STRESS_PROBLEMS.join(', ')}\n`);

const calibration = calibrateReferences({ problems: STRESS_PROBLEMS });
const rawResults = {};

for (const [problem, r] of Object.entries(calibration.results)) {
  console.log(`--- ${problem} ---`);
  console.log(`  primary: ${frac(r.primaryPassed, r.primaryTotal)}`);
  console.log(`  held-out: ${frac(r.heldOutPassed, r.heldOutTotal)}`);
  console.log(`  cohAtrRisk: ${pct(r.cohAtrRisk)}`);
  console.log(`  clean: ${r.clean ? 'yes' : 'NO'}`);
  if (!r.clean && r.heldOutDetails) {
    for (const d of r.heldOutDetails.filter(d => !d.pass)) {
      console.log(`    FAIL ${d.desc}: ${d.error || 'assertion failed'}`);
    }
  }

  rawResults[problem] = {
    passAt1Count: r.primaryPass ? 1 : 0,
    passAt1Rate: r.primaryPass ? 1 : 0,
    trials: [{
      trial: 1,
      passAt1: r.primaryPass,
      eventualPass: r.primaryPass && r.heldOutPassRate === 1,
      repairEligible: false,
      repairConverted: false,
      heldOutPassRate: r.heldOutPassRate,
      primaryPassRate: r.primaryPassRate,
      cohAtrRisk: r.cohAtrRisk,
      failureClass: r.clean ? null : 'reference_calibration_failure',
    }],
  };
}

const summary = {
  runType: 'stress-reference-calibration',
  baseline: 'reference.py/no-model',
  k: 1,
  problems: STRESS_PROBLEMS,
  totalTrials: STRESS_PROBLEMS.length,
  passAt1: {
    count: Object.values(calibration.results).filter(r => r.primaryPassRate === 1).length,
    total: STRESS_PROBLEMS.length,
    rate: Object.values(calibration.results).filter(r => r.primaryPassRate === 1).length / STRESS_PROBLEMS.length,
  },
  passAtN: {
    count: Object.values(calibration.results).filter(r => r.primaryPassRate === 1 && r.heldOutPassRate === 1).length,
    total: STRESS_PROBLEMS.length,
    rate: Object.values(calibration.results).filter(r => r.primaryPassRate === 1 && r.heldOutPassRate === 1).length / STRESS_PROBLEMS.length,
  },
  repairEligibleCount: 0,
  repairConvertedCount: 0,
  repairConversionRate: null,
  heldOutRate: {
    count: Object.values(calibration.results).reduce((s, r) => s + (r.heldOutPassRate ?? 0), 0),
    total: STRESS_PROBLEMS.length,
    rate: Object.values(calibration.results).reduce((s, r) => s + (r.heldOutPassRate ?? 0), 0) / STRESS_PROBLEMS.length,
  },
  avgCohAtrRisk: Object.values(calibration.results).reduce((s, r) => s + (r.cohAtrRisk ?? 0), 0) / STRESS_PROBLEMS.length,
  failureClassBreakdown: calibration.allClean ? {} : { reference_calibration_failure: Object.values(calibration.results).filter(r => !r.clean).length },
  byProblem: Object.fromEntries(Object.entries(calibration.results).map(([problem, r]) => [problem, {
    trials: 1,
    passAt1: r.primaryPassRate === 1 ? 1 : 0,
    passAtN: r.primaryPassRate === 1 && r.heldOutPassRate === 1 ? 1 : 0,
    repairEligible: 0,
    repairConverted: 0,
    heldOutRate: r.heldOutPassRate,
    avgCohAtrRisk: r.cohAtrRisk,
  }])),
  allClean: calibration.allClean,
};

writeFileSync(join(RUN_DIR, 'reference-calibration.json'), JSON.stringify(calibration, null, 2));
const report = writeCompactReport({ summary, rawResults, runDir: RUN_DIR });
console.log('\n' + report);
console.log(`\nOverall: ${calibration.allClean ? 'PASS — primary + held-out reference calibration is 100%' : 'FAIL — reference calibration confounded'}`);
console.log(`Run dir: ${RUN_DIR}`);
process.exit(calibration.allClean ? 0 : 1);
