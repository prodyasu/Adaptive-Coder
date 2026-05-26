/**
 * stress-runner-utils.js — Shared helpers for stress-suite calibration runners.
 *
 * Pure/reporting helpers are kept here so tests can validate runner behavior
 * without making model calls. The CLI scripts remain fresh Node process entrypoints.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runBasicTest, evalProblem } from './eval.js';
import { classifyTrial, computeModeMetrics } from './r4-metrics.js';
import { INFORMED_REPAIR_MODES } from './informed-repair.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const STRESS_PROBLEMS = ['edit-distance', 'word-break', 'detect-cycle', 'valid-sudoku'];
export const DEFAULT_K = 5;
export const DEFAULT_BASELINE = 'gen18_evolved';
export const DEFAULT_R4_BASELINE = 'reasoning_os_v0';
export const R4_MODES = [
  INFORMED_REPAIR_MODES.VERIFIER,
  INFORMED_REPAIR_MODES.TEST_FAILURE,
  INFORMED_REPAIR_MODES.SPEC_AND_TEST,
];
export const R4_MODE_LABELS = {
  [INFORMED_REPAIR_MODES.VERIFIER]: 'verifier_only',
  [INFORMED_REPAIR_MODES.TEST_FAILURE]: 'test_failure',
  [INFORMED_REPAIR_MODES.SPEC_AND_TEST]: 'spec_and_test',
};

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function pct(rate) {
  return rate === null || rate === undefined || Number.isNaN(rate) ? 'N/A' : `${(rate * 100).toFixed(1)}%`;
}

export function frac(count, total) {
  return total > 0 ? `${count}/${total} (${pct(count / total)})` : '0/0 (N/A)';
}

export function loadStressReferenceSolutions({ problems = STRESS_PROBLEMS } = {}) {
  const refs = {};
  for (const problem of problems) {
    const refPath = join(__dirname, 'testcases-expansion', problem, 'reference.py');
    refs[problem] = readFileSync(refPath, 'utf8').trim();
  }
  return refs;
}

export function ensureRunDir(prefix) {
  const runDir = join('validation-runs', `${prefix}-${timestamp()}`);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

export function calibrateReferences({ problems = STRESS_PROBLEMS, referenceSolutions = loadStressReferenceSolutions({ problems }) } = {}) {
  const results = {};
  let allClean = true;

  for (const problem of problems) {
    const result = runBasicTest(problem, referenceSolutions[problem]);
    const clean = result.primaryPassRate === 1 && result.heldOutPassRate === 1 && result.cohAtrRisk === 0;
    if (!clean) allClean = false;
    results[problem] = {
      primaryPass: result.pass,
      primaryPassRate: result.primaryPassRate,
      primaryPassed: result.primaryPassed,
      primaryTotal: result.primaryTotal,
      heldOutPassRate: result.heldOutPassRate,
      heldOutPassed: result.heldOutPassed,
      heldOutTotal: result.heldOutTotal,
      cohAtrRisk: result.cohAtrRisk,
      clean,
      heldOutDetails: result.heldOutDetails,
      detail: result.detail,
    };
  }

  return { allClean, results };
}

export function entriesFromAttemptResults(attemptResults) {
  return Object.entries(attemptResults)
    .filter(([k]) => !Number.isNaN(Number(k)))
    .sort(([a], [b]) => Number(a) - Number(b));
}

export function summarizeTrial({ trial, entries, error }) {
  if (error) {
    return {
      trial,
      passAt1: false,
      repairEligible: false,
      repairConverted: false,
      eventualPass: false,
      attemptsToPass: null,
      heldOutAfterRepairRate: null,
      heldOutPassRate: null,
      failureClass: 'runner_error',
      failureClasses: ['runner_error'],
      primaryPassRate: null,
      cohAtrRisk: null,
      autorepairCycles: 0,
      pggResamples: 0,
      pggExhausted: false,
      error: error.message || String(error),
    };
  }

  const classified = classifyTrial(entries);
  const first = entries[0]?.[1] || {};
  const last = entries[entries.length - 1]?.[1] || {};
  const firstFailure = entries.find(([, v]) => !v?.pass)?.[1];
  const repairAttempt = entries.find(([idx, v]) => Number(idx) > 0 && (v?.informedRepairFeedback || v?.autorepairCycles > 0))?.[1];

  return {
    trial,
    passAt1: classified.passAt1,
    repairEligible: classified.repairEligible,
    repairConverted: classified.repairConverted,
    eventualPass: classified.eventualPass,
    attemptsToPass: classified.attemptsToPass,
    heldOutAfterRepairRate: classified.heldOutAfterRepairRate,
    heldOutPassRate: first.heldOutPassRate ?? last.heldOutPassRate ?? null,
    failureClass: classified.failureClass || firstFailure?.failureKind || null,
    failureClasses: classified.failureClasses,
    primaryPassRate: first.primaryPassRate ?? last.primaryPassRate ?? null,
    cohAtrRisk: first.cohAtrRisk ?? last.cohAtrRisk ?? null,
    autorepairCycles: entries.reduce((sum, [, v]) => sum + (v?.autorepairCycles || 0), 0),
    pggResamples: entries.reduce((sum, [, v]) => sum + (v?.pgg?.resampleNumber || 0), 0),
    pggExhausted: entries.some(([, v]) => v?.pgg?.exhausted),
    informedRepairMode: repairAttempt?.informedRepairMode ?? last.informedRepairMode ?? null,
    attempts: entries.map(([idx, v]) => ({
      attempt: Number(idx) + 1,
      pass: Boolean(v?.pass),
      stageFailed: v?.stageFailed,
      failureKind: v?.failureKind,
      primaryPassRate: v?.primaryPassRate,
      heldOutPassRate: v?.heldOutPassRate,
      cohAtrRisk: v?.cohAtrRisk,
      icg: v?.icg ?? null,
    })),
    error: undefined,
  };
}

export async function runProblemTrials({ problem, baseline = DEFAULT_BASELINE, k = DEFAULT_K, traceDir, timeoutMs = 120_000, extraEvalOpts = {} }) {
  let passAt1Count = 0;
  const trials = [];

  for (let trial = 1; trial <= k; trial++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const attemptResults = await evalProblem(problem, baseline, null, {
        signal: controller.signal,
        traceDir: traceDir ? join(traceDir, problem, `trial-${trial}`) : undefined,
        ...extraEvalOpts,
      });
      clearTimeout(timeout);
      const trialSummary = summarizeTrial({ trial, entries: entriesFromAttemptResults(attemptResults) });
      if (trialSummary.passAt1) passAt1Count++;
      trials.push(trialSummary);
    } catch (error) {
      trials.push(summarizeTrial({ trial, entries: [], error }));
    }
  }

  return { passAt1Count, passAt1Rate: k > 0 ? passAt1Count / k : 0, trials };
}

export function summarizeRun({ runType, baseline, k, problems, rawResults, modeMetrics = null }) {
  let total = 0;
  let passAt1Count = 0;
  let passAtNCount = 0;
  let repairEligibleCount = 0;
  let repairConvertedCount = 0;
  let heldOutSum = 0;
  let heldOutN = 0;
  const cohValues = [];
  const failureClassBreakdown = {};
  const byProblem = {};

  for (const [problem, data] of Object.entries(rawResults)) {
    const trials = data.trials || [];
    const problemPassAt1 = trials.filter(t => t.passAt1).length;
    const problemPassAtN = trials.filter(t => t.eventualPass || t.passAtN).length;
    const problemRepairEligible = trials.filter(t => t.repairEligible).length;
    const problemRepairConverted = trials.filter(t => t.repairConverted).length;
    const problemHeldOut = trials.map(t => t.heldOutPassRate ?? t.heldOutAfterRepairRate).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    const problemCoh = trials.map(t => t.cohAtrRisk).filter(v => v !== null && v !== undefined && !Number.isNaN(v));

    total += trials.length;
    passAt1Count += problemPassAt1;
    passAtNCount += problemPassAtN;
    repairEligibleCount += problemRepairEligible;
    repairConvertedCount += problemRepairConverted;
    heldOutSum += problemHeldOut.reduce((a, b) => a + b, 0);
    heldOutN += problemHeldOut.length;
    cohValues.push(...problemCoh);

    for (const t of trials) {
      const cls = t.failureClass || (t.error ? 'runner_error' : null);
      if (cls) failureClassBreakdown[cls] = (failureClassBreakdown[cls] || 0) + 1;
    }

    byProblem[problem] = {
      trials: trials.length,
      passAt1: problemPassAt1,
      passAtN: problemPassAtN,
      repairEligible: problemRepairEligible,
      repairConverted: problemRepairConverted,
      heldOutRate: problemHeldOut.length ? problemHeldOut.reduce((a, b) => a + b, 0) / problemHeldOut.length : null,
      avgCohAtrRisk: problemCoh.length ? problemCoh.reduce((a, b) => a + b, 0) / problemCoh.length : null,
    };
  }

  return {
    runType,
    baseline,
    k,
    problems,
    totalTrials: total,
    passAt1: { count: passAt1Count, total, rate: total ? passAt1Count / total : 0 },
    passAtN: { count: passAtNCount, total, rate: total ? passAtNCount / total : 0 },
    repairEligibleCount,
    repairConvertedCount,
    repairConversionRate: repairEligibleCount ? repairConvertedCount / repairEligibleCount : null,
    heldOutRate: { count: heldOutSum, total: heldOutN, rate: heldOutN ? heldOutSum / heldOutN : null },
    avgCohAtrRisk: cohValues.length ? cohValues.reduce((a, b) => a + b, 0) / cohValues.length : null,
    failureClassBreakdown,
    byProblem,
    modeMetrics,
  };
}

export function formatFailureBreakdown(breakdown) {
  const entries = Object.entries(breakdown || {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : 'none';
}

export function compactReportText({ summary }) {
  const lines = [];
  lines.push(`# ${summary.runType} compact report`);
  lines.push('');
  lines.push(`baseline: ${summary.baseline}`);
  lines.push(`problems: ${summary.problems.join(', ')}`);
  lines.push(`k: ${summary.k}`);
  lines.push(`pass@1: ${frac(summary.passAt1.count, summary.passAt1.total)}`);
  lines.push(`pass@N: ${frac(summary.passAtN.count, summary.passAtN.total)}`);
  lines.push(`repair-eligible: ${summary.repairEligibleCount}`);
  lines.push(`repair-converted: ${summary.repairConvertedCount} (${pct(summary.repairConversionRate)})`);
  lines.push(`held-out rate: ${summary.heldOutRate.total > 0 ? `${summary.heldOutRate.count.toFixed(2)}/${summary.heldOutRate.total} (${pct(summary.heldOutRate.rate)})` : 'N/A'}`);
  lines.push(`cohAtrRisk: ${pct(summary.avgCohAtrRisk)}`);
  lines.push(`failure classes: ${formatFailureBreakdown(summary.failureClassBreakdown)}`);
  lines.push('');
  lines.push('per-problem:');
  for (const [problem, p] of Object.entries(summary.byProblem)) {
    lines.push(`- ${problem}: pass@1=${frac(p.passAt1, p.trials)} pass@N=${frac(p.passAtN, p.trials)} repair=${p.repairConverted}/${p.repairEligible} held-out=${pct(p.heldOutRate)} cohAtrRisk=${pct(p.avgCohAtrRisk)}`);
  }
  if (summary.modeMetrics) {
    lines.push('');
    lines.push('mode metrics:');
    for (const [mode, metrics] of Object.entries(summary.modeMetrics)) {
      lines.push(`- ${mode}: pass@1=${frac(metrics.passedAt1Trials, metrics.totalTrials)} pass@N=${frac(metrics.finalSuccessTrials, metrics.totalTrials)} repair=${metrics.repairConverted}/${metrics.repairEligible} (${pct(metrics.repairConversionRate)}) held-out-after-repair=${pct(metrics.heldOutAfterRepairRate)} cohAtrRisk=${pct(metrics.avgCohAtrRisk)} failureClasses=${formatFailureBreakdown(Object.fromEntries(Object.entries(metrics.byFailureClass).map(([k, v]) => [k, v.eligible])))}`);
    }
  }
  return lines.join('\n');
}

export function writeCompactReport({ summary, rawResults, runDir }) {
  const report = compactReportText({ summary });
  if (runDir) {
    writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ summary, rawResults }, null, 2));
    writeFileSync(join(runDir, 'compact-report.md'), report + '\n');
  }
  return report;
}

export function computeR4ModeMetrics(resultsByMode) {
  return Object.fromEntries(
    Object.entries(resultsByMode).map(([label, modeResults]) => [label, computeModeMetrics(modeResults)])
  );
}
