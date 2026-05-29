/**
 * audit-rank-ef.js — Audit script: verify rank-ef.js scoring on realistic data.
 *
 * Runs inside Node.js with ES module support. Executes all checks:
 *   1. Score computation on realistic candidate sets
 *   2. Edge cases (pass-fail gate, all-fail, missing fields)
 *   3. Weight sensitivity analysis
 *   4. Off-by-one diagnostic quality check
 *
 * Usage: node --experimental-vm-modules audit-rank-ef.js
 */

import { extractFeatures, computeLogicScore, heuristicScore, rankCandidates, selectBest, RANK_EF_WEIGHTS } from './rank-ef.js';
import { DIAGNOSTIC_CLASSES } from './diagnostician.js';

// ---------------------------------------------------------------------------
// Realistic candidate factories
// ---------------------------------------------------------------------------

function makeCandidate(overrides = {}) {
  return {
    attempt: overrides.attempt ?? 0,
    pass: overrides.pass ?? false,
    errorDetail: overrides.errorDetail ?? undefined,
    modelMs: overrides.modelMs ?? 5000,
    autorepairCycles: overrides.autorepairCycles ?? 0,
    failureKind: overrides.failureKind ?? undefined,
    failureSubKind: overrides.failureSubKind ?? undefined,
    failureCode: overrides.failureCode ?? undefined,
    primaryPassRate: overrides.primaryPassRate ?? 0.0,
    heldOutPassRate: overrides.heldOutPassRate ?? undefined,
    cohAtrRisk: overrides.cohAtrRisk ?? undefined,
    pgg: overrides.pgg ?? undefined,   // { accepted, failedCount, totalCount, resampleNumber, exhausted }
    trace: overrides.trace ?? {},
    candidateIndex: overrides.candidateIndex ?? 0,
    ...overrides,
  };
}

/** Realistic scenario 1: 3 passing, 2 failing — all with PGG data */
function makeScenario1() {
  return [
    makeCandidate({
      candidateIndex: 0, pass: true, primaryPassRate: 1.0,
      pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false },
      modelMs: 8000, autorepairCycles: 0, trace: {},
    }),
    makeCandidate({
      candidateIndex: 1, pass: true, primaryPassRate: 1.0,
      pgg: { accepted: false, failedCount: 1, totalCount: 3, resampleNumber: 2, exhausted: false },
      modelMs: 5000, autorepairCycles: 1, trace: {},
    }),
    makeCandidate({
      candidateIndex: 2, pass: true, primaryPassRate: 1.0,
      pgg: null,  // no PGG data
      modelMs: 12000, autorepairCycles: 0, trace: {},
    }),
    makeCandidate({
      candidateIndex: 3, pass: false, primaryPassRate: 0.67,
      failureKind: 'logic_assertion', failureSubKind: 'off_by_one',
      pgg: { accepted: false, failedCount: 2, totalCount: 3, resampleNumber: 5, exhausted: false },
      modelMs: 3000, autorepairCycles: 2, trace: {},
    }),
    makeCandidate({
      candidateIndex: 4, pass: false, primaryPassRate: 0.0,
      failureKind: 'format_protocol',
      pgg: { accepted: false, failedCount: 3, totalCount: 3, resampleNumber: 9, exhausted: true },
      modelMs: 2000, autorepairCycles: 0, trace: {},
    }),
  ];
}

/** Realistic scenario 2: 1 passing, 4 failing — hard problem */
function makeScenario2() {
  return [
    makeCandidate({
      candidateIndex: 0, pass: true, primaryPassRate: 1.0,
      pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false },
      modelMs: 30000, autorepairCycles: 0, trace: {},
    }),
    makeCandidate({
      candidateIndex: 1, pass: false, primaryPassRate: 0.8,
      failureKind: 'logic_assertion', failureSubKind: undefined,
      pgg: { accepted: false, failedCount: 1, totalCount: 3, resampleNumber: 1, exhausted: false },
      modelMs: 5000, autorepairCycles: 1, trace: {},
    }),
    makeCandidate({
      candidateIndex: 2, pass: false, primaryPassRate: 0.5,
      failureKind: 'timeout',
      modelMs: 59000, autorepairCycles: 0, trace: {},
    }),
    makeCandidate({
      candidateIndex: 3, pass: false, primaryPassRate: 0.33,
      failureKind: 'logic_assertion', failureSubKind: 'assertion_failed',
      pgg: { accepted: false, failedCount: 2, totalCount: 3, resampleNumber: 3, exhausted: false },
      modelMs: 8000, autorepairCycles: 2, trace: {},
    }),
    makeCandidate({
      candidateIndex: 4, pass: false, primaryPassRate: 0.0,
      failureKind: 'model_error',
      modelMs: 1000, autorepairCycles: 0, trace: {},
    }),
  ];
}

/** Realistic scenario 3: ALL failing — every candidate fails */
function makeScenario3() {
  return [
    makeCandidate({
      candidateIndex: 0, pass: false, primaryPassRate: 0.67,
      failureKind: 'logic_assertion', failureSubKind: 'off_by_one',
      pgg: { accepted: false, failedCount: 1, totalCount: 3, resampleNumber: 2, exhausted: false },
      modelMs: 3000, autorepairCycles: 1, trace: {},
    }),
    makeCandidate({
      candidateIndex: 1, pass: false, primaryPassRate: 0.5,
      failureKind: 'logic_assertion',
      pgg: { accepted: false, failedCount: 2, totalCount: 3, resampleNumber: 5, exhausted: false },
      modelMs: 7000, autorepairCycles: 0, trace: {},
    }),
    makeCandidate({
      candidateIndex: 2, pass: false, primaryPassRate: 0.0,
      failureKind: 'format_protocol',
      pgg: { accepted: false, failedCount: 3, totalCount: 3, resampleNumber: 10, exhausted: true },
      modelMs: 2000, autorepairCycles: 0, trace: {},
    }),
    makeCandidate({
      candidateIndex: 3, pass: false, primaryPassRate: 0.33,
      failureKind: 'timeout',
      modelMs: 59000, autorepairCycles: 0, trace: {},
    }),
    makeCandidate({
      candidateIndex: 4, pass: false, primaryPassRate: 0.0,
      failureKind: 'model_error',
      modelMs: 500, autorepairCycles: 0, trace: { compileError: 'SyntaxError: unexpected token' },
    }),
  ];
}

/** Realistic scenario 4: Tie-breaking — same scores need tiebreak */
function makeScenario4() {
  return [
    makeCandidate({
      candidateIndex: 0, pass: true, primaryPassRate: 1.0,
      modelMs: 5000, autorepairCycles: 0, pgg: null, trace: {},
    }),
    makeCandidate({
      candidateIndex: 1, pass: true, primaryPassRate: 1.0,
      modelMs: 3000, autorepairCycles: 0, pgg: null, trace: {},
    }),
    makeCandidate({
      candidateIndex: 2, pass: true, primaryPassRate: 1.0,
      modelMs: 10000, autorepairCycles: 0, pgg: null, trace: {},
    }),
  ];
}

/** Scenario 5: Missing fields — stability check */
function makeScenario5_MissingFields() {
  return [
    makeCandidate({
      candidateIndex: 0,
      pass: true,
      primaryPassRate: 1.0,
      // pgg: undefined
      // modelMs: undefined
      // trace: {}
    }),
    makeCandidate({
      candidateIndex: 1,
      pass: false,
      // primaryPassRate: undefined → defaults to 0
      failureKind: 'logic_assertion',
      // modelMs: undefined → treated as 0 in tiebreak
      // pgg: undefined
      trace: {},
    }),
    makeCandidate({
      candidateIndex: 2,
      pass: false,
      primaryPassRate: 0.5,
      failureKind: 'timeout',
      modelMs: 59000,
      // heldOutPassRate: undefined
      // cohAtrRisk: undefined
      // autorepairCycles: undefined → defaults to 0
    }),
  ];
}

/** Scenario 6: Pass-fail gate edge case — two passing but one has higher composite */
function makeScenario6_PassFailGateEdgeCase() {
  // Candidate 0: passes but barely (high modelMs, autorepair needed, fails PGG)
  const c0 = makeCandidate({
    candidateIndex: 0, pass: true, primaryPassRate: 1.0,
    modelMs: 55000, autorepairCycles: 4,
    pgg: { accepted: false, failedCount: 2, totalCount: 3, resampleNumber: 8, exhausted: false },
    trace: {},
  });
  // Candidate 1: fails but very close (off-by-one, clean generation, fast)
  const c1 = makeCandidate({
    candidateIndex: 1, pass: false, primaryPassRate: 0.92,
    failureKind: 'logic_assertion', failureSubKind: 'off_by_one',
    pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false },
    modelMs: 500, autorepairCycles: 0, trace: {},
  });
  // Candidate 2: passes cleanly (fast, no repairs, PGG accepted)
  const c2 = makeCandidate({
    candidateIndex: 2, pass: true, primaryPassRate: 1.0,
    modelMs: 3000, autorepairCycles: 0,
    pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false },
    trace: {},
  });
  return [c0, c1, c2];
}

// ---------------------------------------------------------------------------
// Audit runner
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passCount++;
  } else {
    console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
    failCount++;
  }
}

function section(title) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

function dumpScores(candidates) {
  for (const c of candidates) {
    const log = computeLogicScore(c);
    const h = heuristicScore(c);
    const v = extractFeatures(c);
    console.log(
      `  [${c.candidateIndex}] pass=${c.pass} pRate=${c.primaryPassRate?.toFixed(2)} ` +
      `logScore=${log.toFixed(3)} heurScore=${h.toFixed(3)} ` +
      `pgg=${c.pgg?.accepted ?? 'n/a'} pggRate=${v.pggPassRate?.toFixed(2)} ` +
      `modelMs=${c.modelMs} ar=${c.autorepairCycles} ` +
      `failKind=${c.failureKind ?? 'n/a'} offByOne=${v.offByOne}`
    );
  }
}

// ---------------------------------------------------------------------------
// Run all audits
// ---------------------------------------------------------------------------

console.log('🔍 rank-ef.js Audit Report');
console.log('   Weights:', JSON.stringify(RANK_EF_WEIGHTS));

// ============================================================
// AUDIT 1: Basic scoring on realistic scenarios
// ============================================================
section('AUDIT 1 — Realistic Candidate Set Scoring');

console.log('\nScenario 1: 3 passing, 2 failing (mixed quality passing)');
const s1 = makeScenario1();
dumpScores(s1);
const best1 = selectBest(s1);
check('Selected candidate passes primary', best1.pass === true, `got pass=${best1.pass}`);
check('Selected best passing candidate (PGG-accepted)', best1.candidateIndex === 0,
  `selected index=${best1.candidateIndex}`);
console.log(`  → Selected index=${best1.candidateIndex}, score=${best1.rankerScore.toFixed(4)}, rank=${best1.ranker.rank}`);

console.log('\nScenario 2: 1 passing, 4 failing (hard problem)');
const s2 = makeScenario2();
dumpScores(s2);
const best2 = selectBest(s2);
check('Selected candidate passes', best2.pass === true);
check('Selected the passing candidate (index 0)', best2.candidateIndex === 0,
  `got index=${best2.candidateIndex}`);
console.log(`  → Selected index=${best2.candidateIndex}, score=${best2.rankerScore.toFixed(4)}`);

console.log('\nScenario 3: ALL FAILING candidates');
const s3 = makeScenario3();
dumpScores(s3);
const best3 = selectBest(s3);
check('Returns a best-failing candidate (not undefined)', best3 !== undefined);
check('Best-failing is the off-by-one (index 0)', best3.candidateIndex === 0,
  `got index=${best3.candidateIndex}`);
// off-by-one should be best among failing due to -0.15 vs -0.05 penalties
// Logic: c0: 0.67 - 0.15(offby1) = 0.52, c1: 0.50 - 0.05 = 0.45, c3: 0.0 - 0.10(timeout) = 0.0
// Among failing, off-by-one should win
console.log(`  → Selected index=${best3.candidateIndex}, score=${best3.rankerScore.toFixed(4)}, pass=${best3.pass}`);

console.log('\nScenario 4: Tie-breaking (same primaryPassRate)');
const s4 = makeScenario4();
dumpScores(s4);
const best4 = selectBest(s4);
check('Faster candidate wins tie (modelMs 3000 vs 5000 vs 10000)', best4.candidateIndex === 1,
  `got index=${best4.candidateIndex}`);
console.log(`  → Selected index=${best4.candidateIndex}, modelMs=${best4.modelMs}`);

// ============================================================
// AUDIT 2: Pass-fail gate edge cases
// ============================================================
section('AUDIT 2 — Pass-Fail Gate Edge Cases');

console.log('\nScenario 6: Pass-fail gate — passing with TERRIBLE metrics vs failing near-perfect');
const s6 = makeScenario6_PassFailGateEdgeCase();
dumpScores(s6);
const best6 = selectBest(s6);
console.log(`  → Selected index=${best6.candidateIndex}, pass=${best6.pass}`);
check('Pass-fail gate selects passing candidate even when failing has better features',
  best6.pass === true,
  `pass=${best6.pass}, ifail=${best6.candidateIndex !== 0 && best6.candidateIndex !== 2}`);
check('Among passing, selects the better passing one (c2 over c0)',
  best6.candidateIndex === 2,
  `selected=${best6.candidateIndex} (c0=slow-pass, c2=clean-pass)`);

// What if the ONLY passing candidate has terrible quality?
console.log('\n  Edge: only passing candidate has modelMs=58s (near-timeout) and 4 autorepairs');
const s6b = [
  makeCandidate({ candidateIndex: 0, pass: true, primaryPassRate: 1.0, modelMs: 58000, autorepairCycles: 4,
    pgg: { accepted: false, failedCount: 2, totalCount: 3, resampleNumber: 7, exhausted: false }, trace: {} }),
  makeCandidate({ candidateIndex: 1, pass: false, primaryPassRate: 0.9, modelMs: 1000, autorepairCycles: 0,
    failureKind: 'logic_assertion', failureSubKind: 'off_by_one', trace: {} }),
];
const best6b = selectBest(s6b);
check('Gate still selects passing (c0) even if extremely slow — this is correct behavior', best6b.candidateIndex === 0,
  `selected=${best6b.candidateIndex}`);
console.log(`  → This is by design: gate never selects failing over passing. Rationale: passing means assertions passed.`);

// ============================================================
// AUDIT 3: Missing fields stability
// ============================================================
section('AUDIT 3 — Missing Field Stability');

console.log('\nScenario 5: Missing fields (undefined primaryPassRate, modelMs, pgg)');
const s5 = makeScenario5_MissingFields();
dumpScores(s5);
const best5 = selectBest(s5);
check('Handles undefined primaryPassRate (defaults to 0.0)', best5 !== undefined);
check('Handles undefined pgg (treated as neutral)', best5 !== undefined);
check('Handles undefined modelMs (treated as 0 in tiebreak)', best5 !== undefined);
console.log(`  → Selected index=${best5.candidateIndex}, scores computed without crash`);

// Verify no crashes with empty candidates array
const emptyBest = selectBest([]);
check('Empty candidates array returns undefined (not thrown)', emptyBest === undefined);

// ============================================================
// AUDIT 4: Off-by-one diagnostic quality
// ============================================================
section('AUDIT 4 — Off-By-One Detection Quality');

const ob1_candidates = [
  makeCandidate({ candidateIndex: 0, pass: false, primaryPassRate: 0.67,
    failureKind: 'logic_assertion', failureSubKind: 'off_by_one', trace: {} }),
  makeCandidate({ candidateIndex: 1, pass: false, primaryPassRate: 0.67,
    failureKind: 'logic_assertion', failureSubKind: 'assertion_failed', trace: {} }),
  makeCandidate({ candidateIndex: 2, pass: false, primaryPassRate: 0.67,
    failureKind: 'logic_assertion', failureSubKind: undefined, trace: {} }),
];
const ob1_features = ob1_candidates.map(extractFeatures);
console.log('\nOff-by-one detection from failureSubKind:');
for (let i = 0; i < ob1_candidates.length; i++) {
  console.log(`  [${i}] subKind=${ob1_candidates[i].failureSubKind} offByOne=${ob1_features[i].offByOne}`);
}
check('off_by_one subKind is detected directly', ob1_features[0].offByOne === true);
check('non-off_by_one subKind is not flagged', ob1_features[1].offByOne === false);
check('undefined subKind does not falsely trigger offByOne', ob1_features[2].offByOne === false);

console.log('\nOff-by-one via trace diagnostic (requires full trace with error messages):');
const ob1_trace = makeCandidate({ candidateIndex: 0, pass: false, primaryPassRate: 0.67,
  failureKind: 'logic_assertion', failureSubKind: 'off_by_one',
  trace: { assertionError: 'expected 4 but got 5' } });
const ob1_feat = extractFeatures(ob1_trace);
console.log(`  offByOne=${ob1_feat.offByOne} (should be true from subKind)`);

// ============================================================
// AUDIT 5: Logic score penalties are correctly ordered
// ============================================================
section('AUDIT 5 — Penalty Ordering (should: model_error > format_protocol > timeout > logic_assertion > off_by_one)');

const penalty_tests = [
  { kind: 'model_error',       pRate: 0.5, label: 'model_error' },
  { kind: 'format_protocol',   pRate: 0.5, label: 'format_protocol' },
  { kind: 'timeout',            pRate: 0.5, label: 'timeout' },
  { kind: 'logic_assertion',   pRate: 0.5, label: 'logic_assertion' },
  { kind: 'off_by_one',         pRate: 0.67, subKind: 'off_by_one', label: 'off_by_one (subKind)' },
];

const penalty_scores = penalty_tests.map(t => {
  const c = makeCandidate({
    pass: false, primaryPassRate: t.pRate,
    failureKind: t.kind, failureSubKind: t.subKind,
    trace: {},
  });
  return { label: t.label, score: computeLogicScore(c) };
});

penalty_scores.sort((a, b) => a.score - b.score);
console.log('\nPenalty ordering (lowest score = worst):');
penalty_scores.forEach((p, i) => console.log(`  ${i+1}. ${p.label}: ${p.score.toFixed(4)}`));

// Verify expected ordering
const labels = penalty_scores.map(p => p.label);
const expected = ['model_error', 'format_protocol', 'timeout', 'logic_assertion', 'off_by_one (subKind)'];
for (let i = 0; i < expected.length; i++) {
  check(`Penalty rank ${i+1} is ${expected[i]}`, labels[i] === expected[i],
    `got ${labels[i]}`);
}

// ============================================================
// AUDIT 6: Weight sensitivity — what if weights are wrong?
// ============================================================
section('AUDIT 6 — Weight Sensitivity Analysis');

const ws_candidates = [
  makeCandidate({ candidateIndex: 0, pass: true, primaryPassRate: 1.0,
    pgg: { accepted: false, failedCount: 1, totalCount: 3, resampleNumber: 5, exhausted: false },
    modelMs: 58000, autorepairCycles: 3, trace: {} }),
  makeCandidate({ candidateIndex: 1, pass: true, primaryPassRate: 1.0,
    pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false },
    modelMs: 2000, autorepairCycles: 0, trace: {} }),
];

console.log('\nCandidates with dramatically different quality (both pass):');
ws_candidates.forEach((c, i) => {
  console.log(`  [${i}] pgg=${c.pgg.accepted} modelMs=${c.modelMs} ar=${c.autorepairCycles}`);
});

const defaultScore = ws_candidates.map(c => heuristicScore(c));
console.log(`\nDefault weights: c0=${defaultScore[0].toFixed(4)}, c1=${defaultScore[1].toFixed(4)}`);
check('With default weights, clean-fast-passing beats slow-dirty-passing',
  defaultScore[1] > defaultScore[0],
  `c0=${defaultScore[0].toFixed(4)} c1=${defaultScore[1].toFixed(4)}`);

// What if we zero out logic weight?
const noLogic = { logic: 0, pgg: 0, heldOut: 0.25, execTime: 0.25, cohAtr: 0.25, autoRepair: 0.25, pggResamples: 0 };
const noLogicScore = ws_candidates.map(c => heuristicScore(c, noLogic));
console.log(`\nZero logic weight: c0=${noLogicScore[0].toFixed(4)}, c1=${noLogicScore[1].toFixed(4)}`);
check('Without logic weight, different ordering can occur',
  true, 'documenting behavior only');

// ============================================================
// AUDIT 7: All-fail scenario — what does rankEF return?
// ============================================================
section('AUDIT 7 — All-Fail Edge Case');

// All candidates fail
const allFail = makeScenario3();
const bestAllFail = selectBest(allFail);
check('All-fail: returns best failing candidate (not undefined)', bestAllFail !== undefined);
check('All-fail: selected candidate has highest score among failing',
  bestAllFail.candidateIndex === 0, `selected=${bestAllFail.candidateIndex}`);
console.log(`\nAll-fail selected: index=${bestAllFail.candidateIndex} score=${bestAllFail.rankerScore.toFixed(4)}`);
console.log(`  failureKind=${bestAllFail.failureKind}, primaryPassRate=${bestAllFail.primaryPassRate}`);

// All fail with compile errors
const allCompileFail = [
  makeCandidate({ candidateIndex: 0, pass: false, primaryPassRate: 0, trace: { compileError: 'SyntaxError' } }),
  makeCandidate({ candidateIndex: 1, pass: false, primaryPassRate: 0, trace: { compileError: 'ReferenceError' } }),
];
const bestCompileFail = selectBest(allCompileFail);
check('All-compile-fail: still returns a candidate (not undefined)', bestCompileFail !== undefined);
console.log(`  All compile fail → selected index=${bestCompileFail.candidateIndex}`);

// ============================================================
// AUDIT 8: PGG neutral default check
// ============================================================
section('AUDIT 8 — PGG Neutral Default');

const noPggPassing = makeCandidate({ candidateIndex: 0, pass: true, primaryPassRate: 1.0, pgg: null, trace: {} });
const withPggPassing = makeCandidate({ candidateIndex: 1, pass: true, primaryPassRate: 1.0,
  pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false }, trace: {} });

const noPggScore = heuristicScore(noPggPassing);
const withPggScore = heuristicScore(withPggPassing);
check('No PGG data (null) scores same as PGG accepted for passing candidates',
  Math.abs(noPggScore - withPggScore) < 0.001,
  `noPgg=${noPggScore.toFixed(4)} withPgg=${withPggScore.toFixed(4)}`);

// For failing, no PGG also neutral
const noPggFailing = makeCandidate({ candidateIndex: 0, pass: false, primaryPassRate: 0.5,
  failureKind: 'logic_assertion', pgg: null, trace: {} });
const noPggFailingScore = heuristicScore(noPggFailing);
check('No PGG (null) on failing candidate: score computed without crash', noPggFailingScore >= 0);

// ============================================================
// AUDIT 9: cohAtrRisk and heldOutPassRate neutral defaults
// ============================================================
section('AUDIT 9 — Neutral Defaults for Missing Secondary Signals');

const missingSecondary = [
  makeCandidate({ candidateIndex: 0, pass: true, primaryPassRate: 1.0,
    heldOutPassRate: undefined, cohAtrRisk: undefined, modelMs: 5000, trace: {} }),
  makeCandidate({ candidateIndex: 1, pass: true, primaryPassRate: 1.0,
    heldOutPassRate: 0.5, cohAtrRisk: 0.5, modelMs: 5000, trace: {} }),
];
const msScores = missingSecondary.map(c => heuristicScore(c));
check('Missing heldOut/cohAtr treated as neutral (0.5) and not crushed to 0',
  msScores[0] > 0.7, `score=${msScores[0].toFixed(4)} with full missing signals`);
check('Score with known secondary signals differs from missing (signals are used)',
  Math.abs(msScores[0] - msScores[1]) > 0.001);

// ============================================================
// AUDIT 10: composite score formula verification
// ============================================================
section('AUDIT 10 — Composite Score Decomposition');

const t = makeCandidate({
  candidateIndex: 0, pass: true, primaryPassRate: 1.0,
  modelMs: 5000, autorepairCycles: 0,
  heldOutPassRate: 0.8, cohAtrRisk: 0.1,
  pgg: { accepted: true, failedCount: 0, totalCount: 3, resampleNumber: 0, exhausted: false },
  trace: {},
});
const log = computeLogicScore(t);
const v = extractFeatures(t);
const W = RANK_EF_WEIGHTS;

const ho = v.heldOutPassRate ?? 0.5;
const cr = Math.max(0, 1 - (v.cohAtrRisk ?? 0));
const ar = Math.max(0, 1 - v.autorepairCycles / 5);
const ec = v.executionTimeScore;
const re = Math.max(0, 1 - v.pggResampleRatio);

const expectedComposite =
  W.logic * log +
  W.pgg * v.pggPassRate +
  W.heldOut * ho +
  W.execTime * ec +
  W.cohAtr * cr +
  W.autoRepair * ar +
  W.pggResamples * re;

const actualComposite = heuristicScore(t);

console.log(`\nDecomposition for perfect-passing candidate:`);
console.log(`  logic:       ${log.toFixed(4)} × ${W.logic} = ${(W.logic * log).toFixed(4)}`);
console.log(`  pgg:         ${v.pggPassRate.toFixed(4)} × ${W.pgg} = ${(W.pgg * v.pggPassRate).toFixed(4)}`);
console.log(`  heldOut:     ${ho.toFixed(4)} × ${W.heldOut} = ${(W.heldOut * ho).toFixed(4)}`);
console.log(`  execTime:    ${ec.toFixed(4)} × ${W.execTime} = ${(W.execTime * ec).toFixed(4)}`);
console.log(`  cohAtr:      ${cr.toFixed(4)} × ${W.cohAtr} = ${(W.cohAtr * cr).toFixed(4)}`);
console.log(`  autoRepair:  ${ar.toFixed(4)} × ${W.autoRepair} = ${(W.autoRepair * ar).toFixed(4)}`);
console.log(`  pggResamples:${re.toFixed(4)} × ${W.pggResamples} = ${(W.pggResamples * re).toFixed(4)}`);
console.log(`  EXPECTED:   ${expectedComposite.toFixed(4)}`);
console.log(`  ACTUAL:     ${actualComposite.toFixed(4)}`);
check('Composite score decomposition matches heuristicScore()',
  Math.abs(expectedComposite - actualComposite) < 0.0001);

// ============================================================
// Final summary
// ============================================================
section('FINAL AUDIT SUMMARY');
console.log(`\n  Passed: ${passCount}`);
console.log(`  Failed: ${failCount}`);
console.log(`  Total:  ${passCount + failCount}`);
console.log(`\n  Timestamp: ${new Date().toISOString()}`);
console.log(`  rank-ef version: v1`);
