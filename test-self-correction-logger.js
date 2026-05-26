/**
 * test-self-correction-logger.js — Tests for self-correction rate passive logger
 */
import { computeSelfCorrectionMetrics, attachSelfCorrectionToTrace } from './self-correction-logger.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1: computeSelfCorrectionMetrics — empty input
// ---------------------------------------------------------------------------
const empty = computeSelfCorrectionMetrics([]);
assert(empty.total === 0, 'Empty input: total=0');
assert(empty.totalWithAutorepair === 0, 'Empty input: totalWithAutorepair=0');
assert(empty.selfCorrectionRate === null, 'Empty input: selfCorrectionRate=null');

// ---------------------------------------------------------------------------
// Test 2: All trivial passes (no autorepair)
// ---------------------------------------------------------------------------
const trivialPasses = [
  { problemName: 'binary-search', pass: true, autorepairCycles: 0, stageFailed: null },
  { problemName: 'climbing-stairs', pass: true, autorepairCycles: 0, stageFailed: null },
  { problemName: 'two-sum', pass: true, autorepairCycles: 0, stageFailed: null },
];
const trivial = computeSelfCorrectionMetrics(trivialPasses);
assert(trivial.total === 3, 'Trivial passes: total=3');
assert(trivial.trivialPasses === 3, 'Trivial passes: trivialPasses=3');
assert(trivial.totalWithAutorepair === 0, 'Trivial passes: totalWithAutorepair=0');
assert(trivial.selfCorrectionRate === null, 'Trivial passes: selfCorrectionRate=null (no autorepair)');

// ---------------------------------------------------------------------------
// Test 3: Self-correction — some pass after autorepair
// ---------------------------------------------------------------------------
const mixed = [
  { problemName: 'binary-search', pass: true, autorepairCycles: 0, stageFailed: null },
  { problemName: 'climbing-stairs', pass: true, autorepairCycles: 1, stageFailed: null },  // self-corrected
  { problemName: 'coin-change-ii', pass: false, autorepairCycles: 2, stageFailed: 'autorepair_exhausted' },
  { problemName: 'two-sum', pass: true, autorepairCycles: 1, stageFailed: null },  // self-corrected
  { problemName: 'valid-palindrome', pass: false, autorepairCycles: 0, stageFailed: 'coder_error' },
];
const result = computeSelfCorrectionMetrics(mixed);
assert(result.total === 5, 'Mixed: total=5');
assert(result.totalWithAutorepair === 3, 'Mixed: totalWithAutorepair=3');
assert(result.selfCorrected === 2, 'Mixed: selfCorrected=2');
assert(result.autorepairExhausted === 1, 'Mixed: autorepairExhausted=1');
assert(result.trivialPasses === 1, 'Mixed: trivialPasses=1');
assert(result.trivialFails === 1, 'Mixed: trivialFails=1');
assert(Math.abs(result.selfCorrectionRate - 2/3) < 0.001, 'Mixed: selfCorrectionRate=2/3');

// ---------------------------------------------------------------------------
// Test 4: Per-problem breakdown
// ---------------------------------------------------------------------------
assert(result.byProblem['climbing-stairs'].selfCorrected === 1, 'By problem: climbing-stairs self-corrected=1');
assert(result.byProblem['coin-change-ii'].exhausted === 1, 'By problem: coin-change-ii exhausted=1');
assert(result.byProblem['binary-search'].trivialPass === 1, 'By problem: binary-search trivialPass=1');

// ---------------------------------------------------------------------------
// Test 5: attachSelfCorrectionToTrace — autorepair pass
// ---------------------------------------------------------------------------
const trace1 = {};
const attemptResult1 = { pass: true, autorepairCycles: 1, stageFailed: null };
attachSelfCorrectionToTrace(trace1, attemptResult1);
assert(trace1.selfCorrection.enteredAutorepair === true, 'Trace: enteredAutorepair=true for cycle=1');
assert(trace1.selfCorrection.selfCorrected === true, 'Trace: selfCorrected=true when pass after autorepair');
assert(trace1.selfCorrection.autorepairCycles === 1, 'Trace: autorepairCycles=1');

// ---------------------------------------------------------------------------
// Test 6: attachSelfCorrectionToTrace — autorepair exhausted
// ---------------------------------------------------------------------------
const trace2 = {};
const attemptResult2 = { pass: false, autorepairCycles: 2, stageFailed: 'autorepair_exhausted' };
attachSelfCorrectionToTrace(trace2, attemptResult2);
assert(trace2.selfCorrection.enteredAutorepair === true, 'Trace: enteredAutorepair=true for exhausted');
assert(trace2.selfCorrection.selfCorrected === false, 'Trace: selfCorrected=false for exhausted');
assert(trace2.selfCorrection.autorepairCycles === 2, 'Trace: autorepairCycles=2');
assert(trace2.selfCorrection.stageFailed === 'autorepair_exhausted', 'Trace: stageFailed=autorepair_exhausted');

// ---------------------------------------------------------------------------
// Test 7: attachSelfCorrectionToTrace — trivial pass (no autorepair)
// ---------------------------------------------------------------------------
const trace3 = {};
const attemptResult3 = { pass: true, autorepairCycles: 0, stageFailed: null };
attachSelfCorrectionToTrace(trace3, attemptResult3);
assert(trace3.selfCorrection.enteredAutorepair === false, 'Trace: enteredAutorepair=false for trivial pass');
assert(trace3.selfCorrection.selfCorrected === false, 'Trace: selfCorrected=false (never entered autorepair)');
assert(trace3.selfCorrection.autorepairCycles === 0, 'Trace: autorepairCycles=0');

// ---------------------------------------------------------------------------
// Test 8: attachSelfCorrectionToTrace — trivial fail
// ---------------------------------------------------------------------------
const trace4 = {};
const attemptResult4 = { pass: false, autorepairCycles: 0, stageFailed: 'coder_error', errorDetail: 'timeout' };
attachSelfCorrectionToTrace(trace4, attemptResult4);
assert(trace4.selfCorrection.enteredAutorepair === false, 'Trace: enteredAutorepair=false for trivial fail');
assert(trace4.selfCorrection.selfCorrected === false, 'Trace: selfCorrected=false for trivial fail');
assert(trace4.selfCorrection.stageFailed === 'coder_error', 'Trace: stageFailed=coder_error');

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);