#!/usr/bin/env node
/**
 * run-stress-r4.mjs — R4 informed-repair calibration on stress-suite MVP.
 *
 * Runs verifier_only, test_failure, and spec_and_test modes separately on the
 * stress-suite. This is a model-call runner; keep it separate from no-model
 * reference calibration and run via a fresh Node process.
 */
import {
  STRESS_PROBLEMS,
  DEFAULT_K,
  DEFAULT_R4_BASELINE,
  R4_MODES,
  R4_MODE_LABELS,
  ensureRunDir,
  runProblemTrials,
  summarizeRun,
  writeCompactReport,
  computeR4ModeMetrics,
  frac,
} from './stress-runner-utils.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const baseline = argValue('baseline', DEFAULT_R4_BASELINE);
const k = Number(argValue('k', String(DEFAULT_K)));
const timeoutMs = Number(argValue('timeout-ms', '120000'));
const problems = argValue('problems', STRESS_PROBLEMS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const selectedModeArg = argValue('modes', R4_MODES.join(','));
const selectedModes = selectedModeArg.split(',').map(s => s.trim()).filter(Boolean);
const RUN_DIR = ensureRunDir(`stress-r4-${baseline}-k${k}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

console.log('\n=== Stress-suite R4 informed-repair calibration (MODEL CALLS) ===');
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Baseline: ${baseline}`);
console.log(`Model stages: minimax-m2.7:cloud via eval.js`);
console.log(`Modes: ${selectedModes.map(m => R4_MODE_LABELS[m] || m).join(', ')}`);
console.log(`Problems: ${problems.join(', ')}`);
console.log(`k: ${k}\n`);

const rawByMode = {};
for (const mode of selectedModes) {
  const label = R4_MODE_LABELS[mode] || mode;
  rawByMode[label] = {};
  console.log(`=== mode: ${label} ===`);

  for (const problem of problems) {
    console.log(`--- ${problem} ---`);
    rawByMode[label][problem] = await runProblemTrials({
      problem,
      baseline,
      k,
      traceDir: join(TRACE_DIR, label),
      timeoutMs,
      extraEvalOpts: { autorepairFeedbackMode: mode },
    });
    const r = rawByMode[label][problem];
    const passAtN = r.trials.filter(t => t.eventualPass).length;
    console.log(`  pass@1: ${frac(r.passAt1Count, r.trials.length)}`);
    console.log(`  pass@N: ${frac(passAtN, r.trials.length)}`);
    console.log(`  repair-eligible: ${r.trials.filter(t => t.repairEligible).length}`);
  }
}

const modeMetrics = computeR4ModeMetrics(rawByMode);
const flattened = Object.fromEntries(Object.entries(rawByMode).flatMap(([label, byProblem]) =>
  Object.entries(byProblem).map(([problem, data]) => [`${label}/${problem}`, data])
));
const summary = summarizeRun({ runType: 'stress-r4-informed-repair', baseline, k, problems: Object.keys(flattened), rawResults: flattened, modeMetrics });

writeFileSync(join(RUN_DIR, 'raw-results-by-mode.json'), JSON.stringify(rawByMode, null, 2));
writeFileSync(join(RUN_DIR, 'mode-metrics.json'), JSON.stringify(modeMetrics, null, 2));
const report = writeCompactReport({ summary, rawResults: rawByMode, runDir: RUN_DIR });

console.log('\n' + report);
console.log(`\nResults saved to ${RUN_DIR}`);
