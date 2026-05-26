// run-r4-smoke-tiny.mjs — Tiny smoke: 1 problem × 1 trial × 3 modes = 3 calls
// Uses a problem more likely to need repair (number-of-islands)
import { evalProblem } from './eval.js';
import { INFORMED_REPAIR_MODES } from './informed-repair.js';
import { classifyTrial } from './r4-metrics.js';
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROBLEMS = ['number-of-islands'];  // more complex, less likely to pass first shot
const MODES = [
  INFORMED_REPAIR_MODES.VERIFIER,
  INFORMED_REPAIR_MODES.TEST_FAILURE,
  INFORMED_REPAIR_MODES.SPEC_AND_TEST,
];
const K = 1;
const TRACE_DIR = '/tmp/r4-smoke-tiny';
mkdirSync(TRACE_DIR, { recursive: true });

const allResults = {};
const allEntries = {};

for (const mode of MODES) {
  console.log(`\n=== Mode: ${mode} ===`);
  allResults[mode] = {};
  for (const problem of PROBLEMS) {
    for (let trial = 0; trial < K; trial++) {
      const trialTraceDir = join(TRACE_DIR, mode, problem, `trial-${trial}`);
      mkdirSync(trialTraceDir, { recursive: true });
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        const result = await evalProblem(problem, 'reasoning_os_v0', null, {
          signal: controller.signal,
          traceDir: trialTraceDir,
          autorepairFeedbackMode: mode,
          traceMaxChars: 4000,
        });
        clearTimeout(timeoutId);

        const entries = Object.entries(result)
          .filter(([k]) => !isNaN(k))
          .sort(([a], [b]) => Number(a) - Number(b));
        allEntries[mode] = { entries, result };

        const classified = classifyTrial(entries);
        console.log(
          `  ${problem} trial ${trial}: passAt1=${classified.passAt1} ` +
          `repairEligible=${classified.repairEligible} repairConverted=${classified.repairConverted} ` +
          `eventualPass=${classified.eventualPass} attemptsToPass=${classified.attemptsToPass}`
        );

        for (const [idx, v] of entries) {
          console.log(
            `    attempt ${idx}: pass=${v?.pass} autorepairCycles=${v?.autorepairCycles} ` +
            `informedRepairFeedback=${!!v?.informedRepairFeedback} ` +
            `informedRepairMode=${v?.informedRepairMode || 'unset'}`
          );
        }

        allResults[mode][problem] = { classified, entries };
      } catch (err) {
        console.log(`  ERROR: ${err.message?.slice(0, 120)}`);
        allResults[mode][problem] = { error: err.message };
      }
    }
  }
}

// === Parse JSONL traces and check for informedRepairFeedback ===
console.log('\n=== TRACE FILE CHECK ===');
function walkDir(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...walkDir(p));
    else if (e.isFile()) files.push(p);
  }
  return files;
}

for (const mode of MODES) {
  const files = walkDir(join(TRACE_DIR, mode));
  console.log(`\n  ${mode}:`);
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    let hasInformedRepairFeedback = false;
    let hasInformedRepairMode = false;
    let feedbackSample = null;
    let modeValue = null;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const trace = obj.trace || obj;
        if (trace.informedRepairFeedback) {
          hasInformedRepairFeedback = true;
          if (!feedbackSample) feedbackSample = String(trace.informedRepairFeedback).slice(0, 200);
        }
        if (trace.informedRepairMode) {
          hasInformedRepairMode = true;
          modeValue = trace.informedRepairMode;
        }
      } catch (_) {}
    }
    console.log(`    ${f.split('/').pop()}: informedRepairFeedback=${hasInformedRepairFeedback} informedRepairMode=${hasInformedRepairMode} (mode=${modeValue || 'n/a'})`);
    if (feedbackSample) console.log(`      feedback sample: ${feedbackSample}`);
  }
}

// === Wiring verdict ===
console.log('\n=== WIRING VERDICT ===');
// VERIFIER should never have informedRepairFeedback (it uses the old code path)
// Non-VERIFIER modes with autorepairCycles>0 should have it
for (const mode of MODES) {
  const data = allEntries[mode];
  if (!data) { console.log(`  ${mode}: no data`); continue; }
  const { entries } = data;
  let hasFeedback = false;
  let hasMode = false;
  let cycles = 0;
  let nonZeroCycles = false;
  for (const [, v] of entries) {
    if (v?.informedRepairFeedback) hasFeedback = true;
    if (v?.informedRepairMode) hasMode = true;
    if (v?.autorepairCycles !== undefined) {
      cycles = v.autorepairCycles;
      if (cycles > 0) nonZeroCycles = true;
    }
  }
  const verdict = mode === INFORMED_REPAIR_MODES.VERIFIER
    ? `(control — should NOT have informedRepairFeedback: ${!hasFeedback ? 'PASS' : 'FAIL'})`
    : `(${nonZeroCycles ? (hasFeedback ? 'PASS — feedback present' : 'FAIL — missing feedback') : 'SKIP — autorepair not triggered'})`;
  console.log(`  ${mode}: feedback=${hasFeedback} mode=${hasMode} autorepairCycles=${cycles} ${verdict}`);
}

console.log('\n=== SMOKE COMPLETE ===');
