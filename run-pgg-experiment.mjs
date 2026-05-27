#!/usr/bin/env node
/**
 * run-pgg-experiment.mjs — PGG Phase 1 experiment runner.
 *
 * 4 arms:
 *   A: single-shot (gen18, k=1)
 *   B: best-of-5   (gen18, k=5)
 *   C: PGG-5        (pgg_v0, k=5) — PGG rejection sampling + k=5
 *   D: PGG-1        (pgg_v0, k=1) — PGG rejection sampling, single trial
 *
 * Problem set: stress-suite (4) + no new constraints yet (Phase 1 validates mechanism).
 * Primary kill criterion: K3 (PGG-5 pass@1 > best-of-5 pass@1 + 25pp for Phase 1).
 *
 * Usage:
 *   node run-pgg-experiment.mjs                     # all 4 arms
 *   node run-pgg-experiment.mjs --arms=a,d           # only arms A and D
 *   node run-pgg-experiment.mjs --k=1                # override k (for single-arm)
 *   node run-pgg-experiment.mjs --problems=edit-distance,word-break
 *   node run-pgg-experiment.mjs --dry-run            # print config, don't run
 *
 * Output: validation-runs/pgg-phase1-<timestamp>/
 */

import {
  STRESS_PROBLEMS,
  DEFAULT_BASELINE,
  DEFAULT_K,
  ensureRunDir,
  runProblemTrials,
  summarizeRun,
  buildMultiArmComparison,
  buildMultiArmSummary,
  writeMultiArmReport,
  frac,
} from './stress-runner-utils.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function argFlag(name) {
  return process.argv.includes(`--${name}`);
}

const ARMS_FILTER = argValue('arms', 'a,b,c,d'); // default: all arms
const K_OVERRIDE = argValue('k', null);           // null = use arm default
const PROBLEMS_FILTER = argValue('problems', STRESS_PROBLEMS.join(','));
const DRY_RUN = argFlag('dry-run');
const TIMEOUT_MS = Number(argValue('timeout-ms', '120000'));
const MODEL = argValue('model', 'minimax-m2.7:cloud');

const problems = PROBLEMS_FILTER.split(',').map(s => s.trim()).filter(Boolean);
const armsToRun = ARMS_FILTER.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------------------
// Arm definitions
// ---------------------------------------------------------------------------

const ARMS = {
  a: { label: 'single-shot', baseline: 'gen18_evolved', k: 1, pggEnabled: false, extraOpts: {} },
  b: { label: 'best-of-5',   baseline: 'gen18_evolved', k: 5, pggEnabled: false, extraOpts: {} },
  c: { label: 'PGG-5',       baseline: 'pgg_v0',        k: 5, pggEnabled: true,  extraOpts: {} },
  d: { label: 'PGG-1',       baseline: 'pgg_v0',        k: 1, pggEnabled: true,  extraOpts: {} },
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RUN_DIR = ensureRunDir(`pgg-phase1-${timestamp}`);
const TRACE_DIR = join(RUN_DIR, 'traces');
mkdirSync(TRACE_DIR, { recursive: true });

const allResults = {};

console.log('\n=== PGG Phase 1 Experiment ===');
console.log(`Run dir: ${RUN_DIR}`);
console.log(`Model: ${MODEL}`);
console.log(`Problems: ${problems.join(', ')}`);
console.log(`Arms: ${armsToRun.join(', ').toUpperCase()}`);
console.log('');

for (const armKey of armsToRun) {
  const arm = ARMS[armKey];
  if (!arm) {
    console.error(`Unknown arm: ${armKey}. Valid arms: a, b, c, d`);
    process.exit(1);
  }

  const k = K_OVERRIDE ? Number(K_OVERRIDE) : arm.k;
  const armLabel = `${armKey.toUpperCase()}: ${arm.label} (k=${k})`;
  const armTraceDir = join(TRACE_DIR, armKey);
  mkdirSync(armTraceDir, { recursive: true });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ARM ${armLabel}`);
  console.log(`  baseline=${arm.baseline}, pggEnabled=${arm.pggEnabled}`);
  console.log(`${'='.repeat(60)}\n`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would run ${problems.length} problems × k=${k}`);
    continue;
  }

  const armResults = {};
  for (const problem of problems) {
    console.log(`  --- ${problem} (${arm.label}) ---`);
    const result = await runProblemTrials({
      problem,
      baseline: arm.baseline,
      k,
      traceDir: armTraceDir,
      timeoutMs: TIMEOUT_MS,
      extraEvalOpts: {
        pggEnabled: arm.pggEnabled,
        // Force model to configured model
        ...arm.extraOpts,
      },
    });

    armResults[problem] = result;

    const passAt1 = result.passAt1Count;
    const totalTrials = result.trials.length;
    const passAtN = result.trials.filter(t => t.eventualPass).length;
    const repairEligible = result.trials.filter(t => t.repairEligible).length;
    const pggResamplesTotal = result.trials.reduce((s, t) => s + (t.pggResamples || 0), 0);

    console.log(`    pass@1: ${frac(passAt1, totalTrials)}`);
    console.log(`    pass@N: ${frac(passAtN, totalTrials)}`);
    console.log(`    repair-eligible: ${repairEligible}`);
    if (arm.pggEnabled) {
      console.log(`    PGG resamples: ${pggResamplesTotal}`);
    }
  }

  allResults[armKey] = armResults;

  // Per-arm summary
  const armSummary = summarizeRun({
    runType: `pgg-phase1-arm-${armKey}`,
    baseline: arm.baseline,
    k,
    problems,
    rawResults: armResults,
  });

  writeFileSync(
    join(RUN_DIR, `arm-${armKey}-results.json`),
    JSON.stringify(armResults, null, 2)
  );
  writeFileSync(
    join(RUN_DIR, `arm-${armKey}-summary.json`),
    JSON.stringify(armSummary, null, 2)
  );
}

// ---------------------------------------------------------------------------
// Comparative analysis
// ---------------------------------------------------------------------------

if (!DRY_RUN && Object.keys(allResults).length > 0) {
  console.log('\n' + '='.repeat(60));
  console.log('  COMPARATIVE ANALYSIS');
  console.log('='.repeat(60));

  const comparison = buildMultiArmComparison(allResults, { armMeta: ARMS });

  // Kill criteria evaluation
  console.log('\n--- Kill Criteria ---');
  if (comparison.a && comparison.b && comparison.c) {
    const bRate = comparison.b.passAt1.rate * 100;
    const cRate = comparison.c.passAt1.rate * 100;
    const diff = cRate - bRate;
    const k3Status = diff > 25 ? '✅ SURVIVED' : diff > 10 ? '⚠️  MARGINAL' : '❌ KILLED';
    console.log(`K3 (pass@1 dominance): PGG-5=${cRate.toFixed(1)}% vs best-of-5=${bRate.toFixed(1)}% → diff=${diff.toFixed(1)}pp → ${k3Status}`);
  }

  if (comparison.a && comparison.d) {
    const aRate = comparison.a.passAt1.rate * 100;
    const dRate = comparison.d.passAt1.rate * 100;
    const diff = dRate - aRate;
    const k4Status = diff > 0 ? '✅ REJECTION HAS SIGNAL' : '❌ NO SIGNAL';
    console.log(`K4 (rejection signal): PGG-1=${dRate.toFixed(1)}% vs single-shot=${aRate.toFixed(1)}% → diff=${diff.toFixed(1)}pp → ${k4Status}`);
  }

  if (comparison.c) {
    const totalPggResamples = comparison.c.pggResamples;
    console.log(`PGG resamples total: ${totalPggResamples}`);
  }

  console.log('\n--- Per-Arm Summary ---');
  for (const [armKey, data] of Object.entries(comparison)) {
    console.log(`  ${armKey.toUpperCase()} (${data.label}): pass@1=${frac(data.passAt1.count, data.passAt1.total)} | pass@N=${frac(data.passAtN.count, data.passAtN.total)}`);
  }

  writeFileSync(
    join(RUN_DIR, 'comparison.json'),
    JSON.stringify(comparison, null, 2)
  );

  const summary = buildMultiArmSummary({
    runType: 'pgg-phase1-comparison',
    baseline: 'multi-arm',
    k: 'varies',
    problems,
    rawResults: allResults,
    armMeta: ARMS,
  });
  writeMultiArmReport({
    summary,
    rawResults: allResults,
    runDir: RUN_DIR,
  });
  console.log(`\nFull report: ${join(RUN_DIR, 'report.md')}`);
}

if (DRY_RUN) {
  console.log('\n[DRY RUN — no model calls made]');
}

console.log(`\nDone. Results in ${RUN_DIR}`);