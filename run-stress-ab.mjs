#!/usr/bin/env node
/**
 * run-stress-ab.mjs — Full stress-suite A/B experiment runner.
 *
 * Runs three arms sequentially:
 *   1. Baseline (gen18_evolved, k=5)
 *   2. R4 informed-repair (reasoning_os_v0, 3 modes, k=5)
 *   3. ICG (reasoning_os_v0 + ICG, k=5)
 *
 * Preregistered primary metrics:
 *   - ICG: pass@1 (pre-generation intervention)
 *   - R4: repair conversion (post-failure intervention)
 *   - Baseline: pass@1, pass@N (control)
 *
 * Secondary metrics: held-out rate, cohAtrRisk, failure class breakdown
 *
 * Usage:
 *   node run-stress-ab.mjs [--k=5] [--timeout-ms=120000] [--problems=edit-distance,word-break,detect-cycle,valid-sudoku]
 */

import { STRESS_PROBLEMS, DEFAULT_K, DEFAULT_BASELINE, DEFAULT_R4_BASELINE, R4_MODES, R4_MODE_LABELS } from './stress-runner-utils.js';
import { runProblemTrials, summarizeRun, writeCompactReport, computeR4ModeMetrics, frac, pct } from './stress-runner-utils.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const k = Number(argValue('k', String(DEFAULT_K)));
const timeoutMs = Number(argValue('timeout-ms', '120000'));
const problems = argValue('problems', STRESS_PROBLEMS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const RUN_BASE = `validation-runs/stress-ab-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(RUN_BASE, { recursive: true });

console.log('\n=== STRESS-SUITE A/B EXPERIMENT ===');
console.log(`Run base: ${RUN_BASE}`);
console.log(`Problems: ${problems.join(', ')}`);
console.log(`k: ${k}`);
console.log(`Timeout: ${timeoutMs}ms`);
console.log(`Timestamp: ${new Date().toISOString()}\n`);

// ─── ARM 1: Baseline (gen18_evolved) ───────────────────────────────
const baselineDir = join(RUN_BASE, 'arm1-baseline');
mkdirSync(join(baselineDir, 'traces'), { recursive: true });

console.log('\n=== ARM 1: Baseline (gen18_evolved) ===');
const baselineResults = {};
for (const problem of problems) {
  console.log(`--- ${problem} ---`);
  baselineResults[problem] = await runProblemTrials({
    problem,
    baseline: DEFAULT_BASELINE,
    k,
    traceDir: join(baselineDir, 'traces', problem),
    timeoutMs,
  });
  const r = baselineResults[problem];
  const passAtN = r.trials.filter(t => t.eventualPass).length;
  console.log(`  pass@1: ${frac(r.passAt1Count, r.trials.length)}`);
  console.log(`  pass@N: ${frac(passAtN, r.trials.length)}`);
  console.log(`  repair-eligible: ${r.trials.filter(t => t.repairEligible).length}`);
}

const baselineSummary = summarizeRun({ runType: 'stress-baseline', baseline: DEFAULT_BASELINE, k, problems, rawResults: baselineResults });
writeFileSync(join(baselineDir, 'raw-results.json'), JSON.stringify(baselineResults, null, 2));
writeCompactReport({ summary: baselineSummary, rawResults: baselineResults, runDir: baselineDir });
console.log('\n' + writeCompactReport({ summary: baselineSummary, rawResults: baselineResults, runDir: false }));

// ─── ARM 2: R4 informed-repair (reasoning_os_v0, 3 modes) ─────────
const r4Dir = join(RUN_BASE, 'arm2-r4');
mkdirSync(join(r4Dir, 'traces'), { recursive: true });

console.log('\n=== ARM 2: R4 informed-repair (reasoning_os_v0) ===');
const rawByMode = {};
for (const mode of R4_MODES) {
  const label = R4_MODE_LABELS[mode];
  rawByMode[label] = {};
  console.log(`\n  === mode: ${label} ===`);

  for (const problem of problems) {
    console.log(`  --- ${problem} ---`);
    rawByMode[label][problem] = await runProblemTrials({
      problem,
      baseline: DEFAULT_R4_BASELINE,
      k,
      traceDir: join(r4Dir, 'traces', label, problem),
      timeoutMs,
      extraEvalOpts: { autorepairFeedbackMode: mode },
    });
    const r = rawByMode[label][problem];
    const passAtN = r.trials.filter(t => t.eventualPass).length;
    console.log(`    pass@1: ${frac(r.passAt1Count, r.trials.length)}`);
    console.log(`    pass@N: ${frac(passAtN, r.trials.length)}`);
    console.log(`    repair-eligible: ${r.trials.filter(t => t.repairEligible).length}`);
  }
}

const modeMetrics = computeR4ModeMetrics(rawByMode);
const r4Flattened = Object.fromEntries(Object.entries(rawByMode).flatMap(([label, byProblem]) =>
  Object.entries(byProblem).map(([problem, data]) => [`${label}/${problem}`, data])
));
const r4Summary = summarizeRun({ runType: 'stress-r4-informed-repair', baseline: DEFAULT_R4_BASELINE, k, problems: Object.keys(r4Flattened), rawResults: r4Flattened, modeMetrics });
writeFileSync(join(r4Dir, 'raw-results-by-mode.json'), JSON.stringify(rawByMode, null, 2));
writeFileSync(join(r4Dir, 'mode-metrics.json'), JSON.stringify(modeMetrics, null, 2));
writeCompactReport({ summary: r4Summary, rawResults: rawByMode, runDir: r4Dir });
console.log('\n' + writeCompactReport({ summary: r4Summary, rawResults: rawByMode, runDir: false }));

// ─── ARM 3: ICG (reasoning_os_v0 + ICG) ───────────────────────────
const icgDir = join(RUN_BASE, 'arm3-icg');
mkdirSync(join(icgDir, 'traces'), { recursive: true });

console.log('\n=== ARM 3: ICG (reasoning_os_v0 + ICG) ===');
const icgResults = {};
for (const problem of problems) {
  console.log(`--- ${problem} ---`);
  icgResults[problem] = await runProblemTrials({
    problem,
    baseline: DEFAULT_R4_BASELINE,
    k,
    traceDir: join(icgDir, 'traces', problem),
    timeoutMs,
    extraEvalOpts: { icgEnabled: true },
  });
  const r = icgResults[problem];
  const passAtN = r.trials.filter(t => t.eventualPass).length;
  console.log(`  pass@1: ${frac(r.passAt1Count, r.trials.length)}`);
  console.log(`  pass@N: ${frac(passAtN, r.trials.length)}`);
  console.log(`  repair-eligible: ${r.trials.filter(t => t.repairEligible).length}`);

  const trialsWithICG = r.trials.filter(t => t.attempts?.some?.(a => a.icg));
  if (trialsWithICG.length > 0) {
    const avgInvariantCount = trialsWithICG
      .map(t => t.attempts?.find?.(a => a.icg)?.icg?.trace?.invariantCount ?? 0)
      .filter(v => v > 0);
    if (avgInvariantCount.length > 0) {
      const sum = avgInvariantCount.reduce((a, b) => a + b, 0);
      console.log(`  avg invariants: ${(sum / avgInvariantCount.length).toFixed(1)}`);
    }
  }
}

const icgSummary = summarizeRun({ runType: 'stress-icg', baseline: DEFAULT_R4_BASELINE, k, problems, rawResults: icgResults });
writeFileSync(join(icgDir, 'raw-results.json'), JSON.stringify(icgResults, null, 2));
writeCompactReport({ summary: icgSummary, rawResults: icgResults, runDir: icgDir });
console.log('\n' + writeCompactReport({ summary: icgSummary, rawResults: icgResults, runDir: false }));

// ─── COMPARISON REPORT ─────────────────────────────────────────────
const comparison = {
  experiment: 'stress-suite-ab',
  timestamp: new Date().toISOString(),
  k,
  problems,
  arms: {
    baseline: {
      runType: baselineSummary.runType,
      baseline: baselineSummary.baseline,
      passAt1: baselineSummary.passAt1,
      passAtN: baselineSummary.passAtN,
      repairEligibleCount: baselineSummary.repairEligibleCount,
      repairConvertedCount: baselineSummary.repairConvertedCount,
      repairConversionRate: baselineSummary.repairConversionRate,
      heldOutRate: baselineSummary.heldOutRate,
      avgCohAtrRisk: baselineSummary.avgCohAtrRisk,
      failureClassBreakdown: baselineSummary.failureClassBreakdown,
      byProblem: baselineSummary.byProblem,
    },
    r4_modes: Object.fromEntries(Object.entries(modeMetrics).map(([label, m]) => [label, {
      passAt1: { count: m.passedAt1Trials, total: m.totalTrials, rate: m.passedAt1Trials / m.totalTrials },
      passAtN: { count: m.finalSuccessTrials, total: m.totalTrials },
      repairEligible: m.repairEligible,
      repairConverted: m.repairConverted,
      repairConversionRate: m.repairConversionRate,
      heldOutAfterRepairRate: m.heldOutAfterRepairRate,
      avgCohAtrRisk: m.avgCohAtrRisk,
      byFailureClass: Object.fromEntries(Object.entries(m.byFailureClass).map(([k, v]) => [k, v.eligible])),
    }])),
    icg: {
      runType: icgSummary.runType,
      baseline: icgSummary.baseline,
      passAt1: icgSummary.passAt1,
      passAtN: icgSummary.passAtN,
      repairEligibleCount: icgSummary.repairEligibleCount,
      repairConvertedCount: icgSummary.repairConvertedCount,
      repairConversionRate: icgSummary.repairConversionRate,
      heldOutRate: icgSummary.heldOutRate,
      avgCohAtrRisk: icgSummary.avgCohAtrRisk,
      failureClassBreakdown: icgSummary.failureClassBreakdown,
      byProblem: icgSummary.byProblem,
    },
  },
};

writeFileSync(join(RUN_BASE, 'comparison.json'), JSON.stringify(comparison, null, 2));

// ─── DECISION SUMMARY ─────────────────────────────────────────────
const lines = [
  '# STRESS-SUITE A/B DECISION SUMMARY',
  '',
  `Date: ${new Date().toISOString()}`,
  `k: ${k}`,
  `Problems: ${problems.join(', ')}`,
  '',
  '## PREREGISTERED PRIMARY METRICS',
  '',
  '### ICG (pre-generation): pass@1 vs baseline',
  `- Baseline pass@1: ${frac(baselineSummary.passAt1.count, baselineSummary.passAt1.total)}`,
  `- ICG pass@1: ${frac(icgSummary.passAt1.count, icgSummary.passAt1.total)}`,
  `- Delta: ${pct((icgSummary.passAt1.rate - baselineSummary.passAt1.rate))}`,
  '',
  '### R4 (post-failure): repair conversion',
];

for (const [label, metrics] of Object.entries(modeMetrics)) {
  lines.push(`- ${label}: ${metrics.repairConverted}/${metrics.repairEligible} (${pct(metrics.repairConversionRate)})`);
}
lines.push(`- Baseline repair conversion: ${baselineSummary.repairConversionRate !== null ? pct(baselineSummary.repairConversionRate) : 'N/A (no repair)'}`);

lines.push('');
lines.push('## HELD-OUT RATES');
lines.push(`- Baseline: ${baselineSummary.heldOutRate.total > 0 ? pct(baselineSummary.heldOutRate.rate) : 'N/A'}`);
lines.push(`- ICG: ${icgSummary.heldOutRate.total > 0 ? pct(icgSummary.heldOutRate.rate) : 'N/A'}`);
for (const [label, metrics] of Object.entries(modeMetrics)) {
  lines.push(`- R4/${label}: held-out-after-repair=${pct(metrics.heldOutAfterRepairRate)}`);
}

lines.push('');
lines.push('## COHESION-ATTRITION RISK');
lines.push(`- Baseline: ${pct(baselineSummary.avgCohAtrRisk)}`);
lines.push(`- ICG: ${pct(icgSummary.avgCohAtrRisk)}`);

lines.push('');
lines.push('## FAILURE CLASS BREAKDOWN');
lines.push(`- Baseline: ${JSON.stringify(baselineSummary.failureClassBreakdown)}`);
lines.push(`- ICG: ${JSON.stringify(icgSummary.failureClassBreakdown)}`);
for (const [label, metrics] of Object.entries(modeMetrics)) {
  lines.push(`- R4/${label}: ${JSON.stringify(Object.fromEntries(Object.entries(metrics.byFailureClass).map(([k, v]) => [k, v.eligible])))}`);
}

lines.push('');
lines.push('## PER-PROBLEM BREAKDOWN');
for (const problem of problems) {
  const b = baselineSummary.byProblem[problem] || {};
  const i = icgSummary.byProblem[problem] || {};
  lines.push(`### ${problem}`);
  lines.push(`  Baseline: pass@1=${frac(b.passAt1, b.trials)} held-out=${pct(b.heldOutRate)} cohAtrRisk=${pct(b.avgCohAtrRisk)}`);
  lines.push(`  ICG:      pass@1=${frac(i.passAt1, i.trials)} held-out=${pct(i.heldOutRate)} cohAtrRisk=${pct(i.avgCohAtrRisk)}`);
  for (const [label, byProblem] of Object.entries(rawByMode)) {
    const r4 = byProblem[problem];
    if (r4) {
      const r4p = r4Summary.byProblem[`${label}/${problem}`] || {};
      lines.push(`  R4/${label}: pass@1=${frac(r4p.passAt1, r4p.trials)} repair=${r4p.repairConverted}/${r4p.repairEligible}`);
    }
  }
}

lines.push('');
lines.push('---');
lines.push(`Results saved to: ${RUN_BASE}`);

const reportText = lines.join('\n');
writeFileSync(join(RUN_BASE, 'DECISION-REPORT.md'), reportText);
console.log('\n' + reportText);
console.log(`\nAll results saved to ${RUN_BASE}`);