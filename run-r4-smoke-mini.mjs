// run-r4-smoke-mini.mjs — Ultra-minimal smoke: 1 problem × 1 trial × 3 modes = 3 calls
import { evalProblem } from './eval.js';
import { INFORMED_REPAIR_MODES } from './informed-repair.js';
import { classifyTrial } from './r4-metrics.js';
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const PROBLEMS = ['binary-search'];
const MODES = [
  INFORMED_REPAIR_MODES.VERIFIER,
  INFORMED_REPAIR_MODES.TEST_FAILURE,
  INFORMED_REPAIR_MODES.SPEC_AND_TEST,
];
const K = 1;
const TRACE_DIR = '/tmp/r4-smoke-mini';
mkdirSync(TRACE_DIR, { recursive: true });

const summary = {};
const allEntries = {};

for (const mode of MODES) {
  console.log(`\n=== Mode: ${mode} ===`);
  summary[mode] = {};
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

        // Check each attempt for informedRepairFeedback
        for (const [idx, v] of entries) {
          const hasFeedback = !!v?.informedRepairFeedback;
          const hasMode = !!v?.informedRepairMode;
          const hasAutorepairCycles = v?.autorepairCycles !== undefined;
          console.log(
            `    attempt ${idx}: informedRepairFeedback=${hasFeedback} ` +
            `informedRepairMode=${hasMode || 'unset'} autorepairCycles=${v?.autorepairCycles}`
          );
        }

        summary[mode][problem] = {
          passAt1: classified.passAt1,
          repairEligible: classified.repairEligible,
          repairConverted: classified.repairConverted,
          eventualPass: classified.eventualPass,
          attemptsToPass: classified.attemptsToPass,
        };
      } catch (err) {
        console.log(`  ERROR: ${err.message?.slice(0, 120)}`);
        summary[mode][problem] = { error: err.message };
      }
    }
  }
}

console.log('\n=== TRACE WIRING CHECK ===');
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

const traceFiles = walkDir(TRACE_DIR);
console.log(`Trace files found: ${traceFiles.length}`);
let foundInformedRepair = false;
let foundInformedMode = false;
let sampleFeedback = null;

for (const f of traceFiles) {
  const raw = readFileSync(f, { encoding: 'utf8', flag: 'r' });
  if (raw.includes('informedRepairFeedback')) {
    foundInformedRepair = true;
    // Extract a sample
    const match = raw.match(/"informedRepairFeedback"\s*:\s*"([^"]{0,300})/);
    if (match && !sampleFeedback) sampleFeedback = match[1].slice(0, 200);
  }
  if (raw.includes('informedRepairMode')) foundInformedMode = true;
}

console.log(`Has informedRepairFeedback in traces: ${foundInformedRepair}`);
console.log(`Has informedRepairMode in traces: ${foundInformedMode}`);
if (sampleFeedback) console.log(`Sample feedback excerpt: ${sampleFeedback}`);

// Per-mode trace check
for (const mode of MODES) {
  const modeDir = join(TRACE_DIR, mode);
  const files = walkDir(modeDir);
  console.log(`  ${mode}: ${files.length} trace files`);
  for (const f of files) {
    const raw = readFileSync(f, { encoding: 'utf8', flag: 'r' });
    const hasFB = raw.includes('informedRepairFeedback');
    const hasMode = raw.includes('informedRepairMode');
    console.log(`    ${f.split('/').pop()}: informedRepairFeedback=${hasFB} informedRepairMode=${hasMode}`);
  }
}

console.log('\n=== WIRING VERDICT ===');
// Check that non-VERIFIER modes have informedRepairFeedback recorded
const testFailureEntries = allEntries[INFORMED_REPAIR_MODES.TEST_FAILURE];
const specAndTestEntries = allEntries[INFORMED_REPAIR_MODES.SPEC_AND_TEST];
const verifierEntries = allEntries[INFORMED_REPAIR_MODES.VERIFIER];

const checkMode = (modeName, entries) => {
  if (!entries) return 'no_entries';
  let hasFeedback = false;
  let hasMode = false;
  for (const [, v] of entries.entries) {
    if (v?.informedRepairFeedback) hasFeedback = true;
    if (v?.informedRepairMode) hasMode = true;
  }
  return { hasFeedback, hasMode };
};

const tf = checkMode('TEST_FAILURE', testFailureEntries);
const st = checkMode('SPEC_AND_TEST', specAndTestEntries);
const v = checkMode('VERIFIER', verifierEntries);

console.log(`VERIFIER:      hasFeedback=${v.hasFeedback} hasMode=${v.hasMode}`);
console.log(`TEST_FAILURE:  hasFeedback=${tf.hasFeedback} hasMode=${tf.hasMode}`);
console.log(`SPEC_AND_TEST: hasFeedback=${st.hasFeedback} hasMode=${st.hasMode}`);

console.log('\n=== SMOKE COMPLETE ===');
