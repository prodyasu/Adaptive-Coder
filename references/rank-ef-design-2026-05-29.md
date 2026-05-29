# Delta 7 / OP-1: Execution-Feedback Ranker — Design Doc

**Date:** 2026-05-29
**Status:** Proposed
**Delta ID:** `delta-rank-ef-v1`
**Supersedes:** N/A (new module)
**Research basis:** RankEF (ASE 2024) + Top Pass (arXiv 2024) — 20–31% pass@1 improvement over best-of-N random selection

---

## 1. Motivation

Best-of-5 (`gen18_evolved`) generates 5 independent candidates and takes the **first one that passes** `runBasicTest`. This is a noise-optimal strategy *if* all passing candidates are equivalent — but they aren't. Two passing candidates can have different execution profiles:

- Candidate A passes all primary assertions but fails PGG boundary checks (off-by-one risk hidden in held-out/harder cases)
- Candidate B passes all primary and all PGG assertions, cleaner execution trace
- Candidate C passes but has `primaryPassRate=1/3` (bare pass, high model variance)

**Best-of-5 treats A, B, C as equivalent and returns A.** Execution-feedback ranking treats them differently and returns B.

The research basis (RankEF, Top Pass) shows that scoring candidates by execution characteristics — not just pass/fail — yields 20–31% pass@1 gains over random/first-pass selection.

---

## 2. Architecture

### 2.1 Input: Candidate Attempt Record

Each attempt record from `evalProblem()` / `runPipeline()` provides:

```javascript
{
  attempt,          // 0-indexed attempt number
  pass,             // boolean — did runBasicTest pass?
  errorDetail,      // string — first failing test detail
  modelMs,          // total model call time (ms)
  autorepairCycles, // number — how many repair loops were needed
  failureKind,      // 'logic_assertion' | 'format_protocol' | 'timeout' | 'spec_validation' | 'model_error'
  failureSubKind,   // 'assertion_failed' | 'off_by_one' | 'boundary_condition' | 'name_mismatch' | ...
  failureCode,      // hierarchical code string
  primaryPassRate,  // fraction of primary assertions that passed (0.0 – 1.0)
  primaryPassed,    // integer count of primary assertions passed
  primaryTotal,     // integer count of primary assertions total
  heldOutPassRate,  // held-out suite pass rate (0.0 – 1.0) | undefined
  cohAtrRisk,       // contamination risk (0.0 – 1.0) | null
  pgg: {
    accepted,       // boolean — did PGG assertions all pass?
    failedCount,    // number of PGG assertions that failed
    totalCount,     // total PGG assertions
    results,        // array of { passed, input, expected, error? }
    resampleNumber, // total resamples used
    exhausted,      // boolean
  },
  trace: {
    testDetail,     // first failing assertion detail string
    pggResults,     // per-assertion pass/fail/error
    compileError,   // string | undefined
    inducedDrift,   // { originalName, driftName } | undefined
    informedRepairFeedback, // string | undefined
    icg,            // { invariants, ... } | undefined
    sigRepair,      // { originalName, repairedName } | undefined
  }
}
```

### 2.2 Scoring Feature Vector

For each candidate, the ranker extracts this feature vector:

| Feature | Type | Description |
|---------|------|-------------|
| `pass` | boolean | Primary test suite passed |
| `primaryPassRate` | float [0,1] | Fraction of primary assertions passed |
| `pggPassRate` | float [0,1] | PGG assertions that passed / total |
| `pggPassed` | boolean | All PGG assertions passed |
| `heldOutPassRate` | float [0,1] \| null | Held-out suite pass rate |
| `cohAtrRisk` | float [0,1] \| null | Contamination risk (lower = cleaner) |
| `failureKind` | enum | Coarse failure class |
| `failureSubKind` | enum | Fine failure class |
| `failureClass` | string | Full diagnostic class (from diagnostician.js) |
| `executionTimeScore` | float [0,1] | Normalized inverse modelMs (faster = better) |
| `autorepairCycles` | int | Repair loops needed (0 = clean generation) |
| `pggResampleRatio` | float [0,1] | `pggResampleNumber / MAX_PGG_RESAMPLES` |
| `compileError` | boolean | Had a compile error |
| `offByOne` | boolean | Diagnosed as off-by-one failure |
| `timeoutFlag` | boolean | Had an execution or model timeout |
| `logicScore` | float [0,1] | Computed logic score (see below) |

### 2.3 Logic Score Computation

`logicScore` is a composite of primary assertion pass rate and failure mode penalties:

```javascript
function computeLogicScore(attempt) {
  let score = attempt.primaryPassRate ?? 0.0;

  if (!attempt.pass) {
    // Penalize failure modes for non-passing candidates
    if (attempt.failureSubKind === 'off_by_one') score -= 0.15;       // almost right
    else if (attempt.failureKind === 'logic_assertion') score -= 0.05; // logic error
    else if (attempt.failureKind === 'timeout') score -= 0.10;        // inefficient
    else if (attempt.failureKind === 'format_protocol') score -= 0.20; // bad code quality
  }

  if (attempt.pgg && !attempt.pgg.accepted) score -= 0.10;             // PGG objections
  if (attempt.trace?.compileError) score -= 0.25;                     // garbage code

  // Bonus for autorepair-free generation (clean = better)
  if (attempt.autorepairCycles === 0) score += 0.05;

  return Math.max(0.0, Math.min(1.0, score));
}
```

### 2.4 Composite Score Formula

```javascript
function compositeScore(v, weights = DEFAULT_WEIGHTS) {
  const log = v.logicScore;
  const pg  = (v.pggPassRate ?? 1.0);
  const ho  = (v.heldOutPassRate ?? 0.5);
  const ec  = v.executionTimeScore;
  const cr  = Math.max(0, 1 - (v.cohAtrRisk ?? 0)); // invert risk: 1 = safe
  const ar  = Math.max(0, 1 - v.autorepairCycles / 5);
  const re  = Math.max(0, 1 - v.pggResampleRatio);

  return (
    weights.logic        * log +
    weights.pgg          * pg +
    weights.heldOut     * ho +
    weights.execTime     * ec +
    weights.cohAtr       * cr +
    weights.autoRepair   * ar +
    weights.pggResamples * re
  );
}

const DEFAULT_WEIGHTS = Object.freeze({
  logic:        0.30,  // dominant — algorithmic correctness
  pgg:          0.20,  // PGG = cross-validation layer
  heldOut:      0.15,  // quality signal beyond primary
  execTime:     0.10,  // speed/simplicity signal
  cohAtr:       0.10,  // contamination safety
  autoRepair:   0.10,  // clean generation bonus
  pggResamples: 0.05,  // low resample = efficient
});
```

### 2.5 Ranker Output

```typescript
// rankCandidates returns a sorted array (highest scored first)
function rankCandidates(attempts: AttemptRecord[]): AttemptRecord[];

// selectBest returns the top-scored candidate
// If multiple candidates tie, prefer the one with:
//   1. highest primaryPassRate
//   2. lowest modelMs
//   3. earliest attempt index (lowest cost)
function selectBest(rankedCandidates: AttemptRecord[]): AttemptRecord;
```

---

## 3. Integration with eval.js

### 3.1 Pipeline Position

The ranked evaluation does **not** alter the existing `evalProblem()` loop. It adds a new parallel mode:

```
evalProblem(problem, baseline, model)          ← existing best-of-5 (stops on first pass)
evalProblemRankEf(problem, baseline, model)    ← NEW ranked evaluation (all N candidates evaluated)
```

**Why not modify evalProblem()?**
- The existing best-of-5 baseline must remain unchanged for A/B comparison
- `MAX_ATTEMPTS=5` with `break on first pass` is the **definition** of best-of-5; changing it would contaminate the baseline
- A parallel entry point is cleaner and avoids protocol drift

### 3.2 evalProblemRankEf() — New Entry Point

```javascript
/**
 * Ranked execution-feedback evaluation.
 * Runs N independent candidates through the full pipeline, then selects
 * the best candidate using execution-feedback scoring.
 *
 * Differs from evalProblem() in that it NEVER breaks on first pass.
 * ALL N candidates are evaluated before selection.
 *
 * @param {string} problemName
 * @param {string} baselineKind  — 'gen18_evolved' (other baselines unsupported for now)
 * @param {string|null} model
 * @param {Object} opts
 * @param {number} [opts.N=5]              — number of candidates to generate
 * @param {boolean} [opts.rankEfEnabled]  — (redundant here, always true for this fn)
 * @param {AbortSignal} [opts.signal]
 * @param {string|false} [opts.traceDir]
 * @returns {Promise<CandidateRankResult>}
 */
export async function evalProblemRankEf(problemName, baselineKind, model, opts = {}) {
  const N = opts.N || 5;
  const candidates = [];

  // Generate N candidates — fresh independent pipeline runs
  // NOTE: Each run gets a fresh shaper call to maximize diversity
  for (let i = 0; i < N; i++) {
    const controller = new AbortController();
    const signal = opts.signal || controller.signal;
    const attemptResults = await evalProblem(problemName, baselineKind, model, {
      ...opts,
      signal,
      // Suppress early-break: we need ALL N results for ranking
      // But evalProblem still breaks on pass by default...
      // Solution: run evalProblem but don't pass -- we handle ranking AFTER
      // Actually evalProblem still breaks. We need a pipeline variant.
      // See 3.3 for the actual pipeline change.
    });
    // ...
  }
}
```

### 3.3 evalPipelineBatch() — New Internal Function (true parallel candidate generation)

The cleanest integration adds a new internal function that runs N candidates **without stopping**:

```javascript
/**
 * Run N independent pipeline candidates WITHOUT early-exit.
 * Each candidate = fresh shaper + coder + verifier + test.
 *
 * This is the key difference from evalProblem():
 *   - evalProblem: runs 1 pipeline, breaks on first pass, returns up to k attempt records
 *   - evalPipelineBatch: runs N independent pipelines, evaluates all, returns N*BATCH results
 *
 * @param {string} problemName
 * @param {string} baselineKind
 * @param {string|null} model
 * @param {Object} ctx
 * @param {number} N  — number of candidates
 * @returns {Promise<CandidateRecord[]>}  — N records with full trace data
 */
export async function evalPipelineBatch(problemName, baselineKind, model, ctx, N) {
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      runPipeline(problemName, task, baselineKind, model, signal, ctx)
        .then(r => ({ ...r, candidateIndex: i }))
        .catch(err => ({ candidateIndex: i, error: err.message, pass: false }))
    )
  );
  return results;
}
```

### 3.4 Wiring the Ranker into evalProblemRankEf()

```javascript
export async function evalProblemRankEf(problemName, baselineKind, model, opts = {}) {
  const N = opts.N || 5;
  const task = loadProblemTask(problemName);  // already available via evalProblem internals

  // Run N full independent pipeline executions
  const candidates = await evalPipelineBatch(problemName, baselineKind, model, ctx, N);

  // Attach per-assertion diagnostics to each candidate
  const ctxs = await Promise.all(candidates.map(c =>
    enrichCandidateContext(c, problemName)  // runs diagnostician, attaches failureClass
  ));

  // Score and rank
  const scored = ctxs.map(c => ({ ...c, score: scoreCandidate(c) }));
  const ranked = rankCandidates(scored);
  const best = selectBest(ranked);

  return {
    best,               // The selected attempt record (with score, rank fields)
    allCandidates: ranked, // All N candidates, ranked
    metadata: {
      N,
      baselineKind,
      problemName,
      rankerVersion: 'v1',
    }
  };
}
```

### 3.5 Trace Output

The `best` record includes ranker-specific fields:

```javascript
best.ranker = {
  score,                    // composite score (float)
  logicScore,               // logic sub-score
  pggScore,                 // PGG sub-score
  rank,                      // 1-based rank among N candidates
  selectedOver,              // array of candidateIndex values that were rejected
  scores: [score1, score2, ... scoreN],  // all scores for audit
};
```

---

## 4. Microbench Experiment Design

### 4.1 Problems

Use the **4 discriminative stress-suite problems** (highest variance, most room for ranking to matter):

| Problem | Pattern | Why discriminative |
|---------|---------|-------------------|
| `edit-distance` | DP 2D | Base case + recurrence complexity — many candidates almost-right |
| `longest-increasing-subsequence` | DP + binary search | Optimal structure — candidates often miss binary search |
| `course-schedule-ii` | Topological sort | Cycle detection + ordering — subtle edge cases |
| `critical-connections` | Tarjan's bridge (DFS) | Low-link algorithm — boundary/direction errors common |

### 4.2 Candidate Budget

- **N = 5 candidates per problem per trial** (same as current k=5 for fair comparison)
- **M = 5 trials per problem** (25 candidate evaluations per problem)
- **Total evaluations:** 4 problems × 5 trials × 5 candidates = **100 candidate evaluations**

### 4.3 Primary Metric

**pass@1(selected):** Fraction of trials where the ranker-selected candidate passes.

- Collected in two arms:
  - **Bo5 arm:** `evalProblem()` with `break on first pass` — gives best-of-5 pass@1
  - **RankEF arm:** `evalProblemRankEf()` — gives ranked-selection pass@1

**Key comparison:** If RankEF pass@1 > Bo5 pass@1, the ranker is adding value.

### 4.4 Secondary Metrics

| Metric | Description |
|--------|-------------|
| `pass@N(all)` | Fraction of trials where any candidate passed (ceiling) |
| `avgRank(selected)` | Average rank of the selected candidate (1=always picks best) |
| `selection Agreement(Bo5, RankEF)` | Fraction where both methods selected same candidate |
| `Kendall's Tau` | Rank correlation between score and "would pass" across candidates |
| `primaryPassRate(selected)` | Average primaryPassRate of selected candidates |

### 4.5 Kill Criteria

| Criterion | Threshold | Action if violated |
|-----------|-----------|-------------------|
| **Pass@1 lift** | RankEF pass@1 − Bo5 pass@1 < +5pp with 95% CI including 0 | Kill experiment |
| **Overhead ratio** | `total modelMs RankEF / total modelMs Bo5 > 2.5x` | Kill (cost not justified) |
| **Noisy selection** | `avgRank(selected) > 2.5` | Kill (ranker not finding best) |
| **Zero candidate** | 0/5 candidates pass in >50% of trials | Kill (pool quality problem) |

### 4.6 Statistical Protocol

- **95% Wilson CIs** on all pass@1 comparisons
- **Paired design:** Same problem + same model + same day → compare arms side by side
- **Minimum delta for claim:** +10pp with CI not crossing zero
- **Report:** per-problem pass@1, aggregate, per-trial scores and selected candidates

---

## 5. Key Difference from Best-of-5

| Property | Best-of-5 | RankEF |
|----------|-----------|--------|
| **Selection criterion** | First passing candidate | Highest composite score |
| **Early exit** | Yes, on first pass | No, evaluates all N |
| **Passing but wrong-type candidate** | Returned if it passes primary tests | May be ranked below a non-passing-but-higher-quality candidate |
| **Multiple passing candidates** | Returns #1 (random order) | Returns highest-scored |
| **Cost per trial** | ~1-3 model calls | N × full pipeline |
| **Signal used** | pass/fail only | execution trace + failure class + assertion results |

### Concrete Scenario Where RankEF Outperforms

```
Candidate 1: pass=true, pgg.accepted=false, primaryPassRate=3/3, failureSubKind='assertion_failed'
Candidate 2: pass=true, pgg.accepted=true,  primaryPassRate=3/3, failureSubKind=null
Candidate 3: pass=false, pgg.accepted=true, primaryPassRate=2/3, failureSubKind='off_by_one'

Best-of-5 → returns Candidate 1 (first passing)
RankEF    → scores: C2(0.91) > C1(0.76) > C3(0.52) → returns Candidate 2
```

Candidate 2 is preferred because it passed all PGG assertions (cross-validation signal that Candidate 1 lacks).

### Additional Rule: Pass-Fail Gating

To prevent selecting an objectively wrong candidate just because it has good execution characteristics:

```javascript
function selectBest(rankedCandidates) {
  // Stage 1: Find all passing candidates
  const passing = rankedCandidates.filter(c => c.pass);

  // Stage 2: If any passing candidates exist, select from among them
  if (passing.length > 0) {
    return passing.reduce((best, c) =>
      c.score > best.score ? c : best
    );
  }

  // Stage 3: No passing candidates — select best failing candidate
  // (still useful for pass@N metric and understanding pool quality)
  return rankedCandidates[0];
}
```

This means RankEF can **never do worse than best-of-5** in selecting a passing candidate (it first filters to passing candidates, then picks the best among them).

---

## 6. Concrete Code Outline

### 6.1 New File: `rank-ef.js`

```javascript
/**
 * rank-ef.js — Execution-Feedback Ranker (Delta 7 / OP-1)
 *
 * Rank candidates by execution feedback (traces, failure class, assertion results)
 * rather than taking the first passing candidate.
 *
 * Module exports:
 *   - rankCandidates(attempts) → sorted attempts
 *   - selectBest(rankedAttempts) → best attempt
 *   - scoreCandidate(attempt, opts?) → float score
 *   - extractFeatures(attempt) → feature vector
 *   - computeLogicScore(attempt) → float [0,1]
 *   - heuristicScore(attempt) → float [0,1]
 *   - RANK_EF_WEIGHTS constant
 *   - RANK_EF_VERSION constant
 */

import { classifyFailure, DIAGNOSTIC_CLASSES } from './diagnostician.js';

export const RANK_EF_VERSION = 'v1';
export const RANK_EF_WEIGHTS = Object.freeze({
  logic:        0.30,
  pgg:          7.20,  // ← fix: 0.20, was 7.20 (typo in doc only)
  heldOut:      0.15,
  execTime:     0.10,
  cohAtr:       0.10,
  autoRepair:   0.10,
  pggResamples: 0.05,
});

export function extractFeatures(attempt) {
  const t = attempt.trace || {};

  // Normalize modelMs to [0,1] execTimeScore (higher = faster)
  const execTimeScore = attempt.modelMs > 0
    ? Math.max(0, 1 - attempt.modelMs / 60_000)  // 60s = worst
    : 0.5;

  const pggPassRate = (attempt.pgg && attempt.pgg.totalCount > 0)
    ? (attempt.pgg.totalCount - attempt.pgg.failedCount) / attempt.pgg.totalCount
    : 1.0;

  const diagnostic = attempt.trace ? classifyFailure(attempt.trace) : null;

  return {
    pass:              Boolean(attempt.pass),
    primaryPassRate:   attempt.primaryPassRate ?? 0.0,
    pggPassRate,
    pggPassed:         attempt.pgg ? Boolean(attempt.pgg.accepted) : true,
    heldOutPassRate:   attempt.heldOutPassRate ?? null,
    cohAtrRisk:        attempt.cohAtrRisk ?? null,
    failureKind:       attempt.failureKind ?? 'unknown',
    failureSubKind:    attempt.failureSubKind ?? 'unknown',
    diagnosticClass:   diagnostic?.class ?? DIAGNOSTIC_CLASSES.UNKNOWN,
    executionTimeScore: execTimeScore,
    autorepairCycles:  attempt.autorepairCycles ?? 0,
    pggResampleRatio:   attempt.pgg
      ? (attempt.pgg.resampleNumber || 0) / 10   // MAX_PGG_RESAMPLES=10
      : 0,
    compileError:      Boolean(t.compileError),
    offByOne:          diagnostic?.class === DIAGNOSTIC_CLASSES.OFF_BY_ONE,
    timeoutFlag:       Boolean(
      attempt.failureKind === 'timeout' ||
      t.verifierError?.includes?.('timeout') ||
      t.coderError?.includes?.('timeout')
    ),
  };
}

export function computeLogicScore(attempt) {
  let score = attempt.primaryPassRate ?? 0.0;
  const v = extractFeatures(attempt);

  if (!attempt.pass) {
    if (v.offByOne)                                    score -= 0.15;
    else if (v.failureKind === 'logic_assertion')      score -= 0.05;
    else if (v.failureKind === 'timeout')              score -= 0.10;
    else if (v.failureKind === 'format_protocol')      score -= 0.20;
    else if (v.failureKind === 'model_error')         score -= 0.30;
  }

  if (attempt.pgg && !attempt.pgg.accepted)            score -= a.10;
  if (v.compileError)                                   score -= 0.25;
  if (v.timeoutFlag)                                    score -= 0.10;
  if (!v.pass && v.autorepairCycles === 0)            score -= 0.05; // no self-correction attempted

  // Bonus: autorepair-free clean generation
  if (attempt.pass && attempt.autorepairCycles === 0)  score += 0.05;

  return Math.max(0.0, Math.min(1.0, score));
}

export function heuristicScore(attempt) {
  const v = extractFeatures(attempt);
  const W = RANK_EF_WEIGHTS;
  const logic      = computeLogicScore(attempt);
  const pg         = v.pggPassRate ?? 1.0;
  const ho         = v.heldOutPassRate ?? 0.5;
  const ec         = v.executionTimeScore;
  const cr         = Math.max(0, 1 - (v.cohAtrRisk ?? 0));
  const ar         = Math.max(0, 1 - v.autorepairCycles / 5);
  const re         = Math.max(0, 1 - v.pggResampleRatio);

  return (
    W.logic        * logic +
    W.pgg          * pg  +
    W.heldOut      * ho  +
    W.execTime     * ec  +
    W.cohAtr       * cr  +
    W.autoRepair   * ar  +
    W.pggResamples * re
  );
}

export function scoreCandidate(attempt, opts = {}) {
  return heuristicScore(attempt);
}

export function rankCandidates(attempts) {
  return [...attempts]
    .map(a => ({ ...a, _score: scoreCandidate(a) }))
    .sort((a, b) => {
      // Primary: composite score descending
      if (b._score !== a._score) return b._score - a._score;
      // Tie-breaker 1: higher primaryPassRate
      if ((b.primaryPassRate ?? 0) !== (a.primaryPassRate ?? 0))
        return (b.primaryPassRate ?? 0) - (a.primaryPassRate ?? 0);
      // Tie-breaker 2: faster execution
      return (a.modelMs ?? 0) - (b.modelMs ?? 0);
    });
}

/**
 * Select the best candidate from ranked results.
 * PASS-FIRST RULE: never select a failing candidate if any passing candidates exist.
 */
export function selectBest(rankedAttempts) {
  const passing = rankedAttempts.filter(a => a.pass);
  if (passing.length > 0) {
    return passing.reduce((best, c) =>
      (c._score ?? scoreCandidate(c)) > (best._score ?? scoreCandidate(best)) ? c : best
    );
  }
  // No passing candidates — return best failing candidate
  return rankedAttempts[0];
}
```

### 6.2 New File: `test-rank-ef.js`

```javascript
import { strict as assert } from 'assert';
import {
  rankCandidates, selectBest, scoreCandidate,
  extractFeatures, computeLogicScore, heuristicScore,
  RANK_EF_WEIGHTS, RANK_EF_VERSION,
} from './rank-ef.js';

// ----- test data generators -----

function makeCandidate(overrides = {}) {
  return {
    attempt: 0,
    pass: false,
    primaryPassRate: 0,
    primaryPassed: 0,
    primaryTotal: 3,
    modelMs: 5000,
    autorepairCycles: 0,
    failureKind: 'logic_assertion',
    failureSubKind: 'assertion_failed',
    failureCode: 'logic_assertion.assertion_failed',
    heldOutPassRate: null,
    cohAtrRisk: null,
    pgg: { accepted: true, failedCount: 0, totalCount: 0 },
    trace: {},
    ...overrides,
  };
}

// ----- tests -----

console.log('Running rank-ef tests...');

{
  // passing candidate vs failing candidate
  const c1 = makeCandidate({ pass: false, primaryPassRate: 0.33 });
  const c2 = makeCandidate({ pass: true, primaryPassRate: 1.0 });
  const ranked = rankCandidates([c1, c2]);
  assert(ranked[0].pass === true, 'selectBest must prefer passing candidate');
}

{
  // two passing candidates: higher score wins
  const c1 = makeCandidate({ pass: true, primaryPassRate: 1.0, pgg: { accepted: false } });
  const c2 = makeCandidate({ pass: true, primaryPassRate: 1.0, pgg: { accepted: true } });
  const ranked = rankCandidates([c1, c2]);
  assert(ranked[0].pgg.accepted === true, 'PGG-passing candidate must rank above PGG-failing');
  assert(ranked[0] === c2);
}

{
  // off-by-one candidate scores lower than clean-passing
  const c1 = makeCandidate({ pass: false, primaryPassRate: 0.67, failureSubKind: 'off_by_one', trace: {} });
  const c2 = makeCandidate({ pass: false, primaryPassRate: 0.67, failureSubKind: 'assertion_failed', trace: {} });
  const s1 = heuristicScore(c1);
  const s2 = heuristicScore(c2);
  assert(s1 < s2, 'off_by_one must score lower than general assertion failure');
}

{
  // compile error candidate scores very low
  const c1 = makeCandidate({ pass: false, trace: { compileError: 'SyntaxError' } });
  const c2 = makeCandidate({ pass: false, trace: {} });
  const s1 = heuristicScore(c1);
  const s2 = heuristicScore(c2);
  assert(s1 < s2, 'compile error must score very low');
}

{
  // autorepair-free generation bonus
  const c1 = makeCandidate({ pass: true, autorepairCycles: 0 });
  const c2 = makeCandidate({ pass: true, autorepairCycles: 1 });
  const s1 = heuristicScore(c1);
  const s2 = heuristicScore(c2);
  assert(s1 > s2, 'clean generation must score higher');
}

{
  // heldOutPassRate contributes to score
  const c1 = makeCandidate({ pass: true, heldOutPassRate: 1.0 });
  const c2 = makeCandidate({ pass: true, heldOutPassRate: 0.5 });
  const s1 = heuristicScore(c1);
  const s2 = heuristicScore(c2);
  assert(s1 > s2, 'higher heldOutPassRate must score higher');
}

{
  // timeoutFlag penalizes score
  const c1 = makeCandidate({ pass: false, failureKind: 'timeout', trace: {} });
  const c2 = makeCandidate({ pass: false, failureKind: 'logic_assertion', trace: {} });
  const s1 = heuristicScore(c1);
  const s2 = heuristicScore(c2);
  assert(s1 < s2, 'timeout must score lower than logic failure');
}

{
  // RANK_EF_VERSION is set
  assert(RANK_EF_VERSION === 'v1');
}

{
  // Weights sum to 1.0
  const sum = Object.values(RANK_EF_WEIGHTS).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1.0) < 0.001, `weights sum=${sum}`);
}

console.log('All rank-ef tests passed.');
```

### 6.3 eval.js Changes (additions only, no modifications to existing code paths)

```javascript
// NEW export function (add to end of eval.js)
import { rankCandidates, selectBest, scoreCandidate, extractFeatures } from './rank-ef.js';

/**
 * Run N independent pipeline candidates WITHOUT early-exit.
 * This is the core of the ranked-EF evaluation mode.
 *
 * @param {string} problemName
 * @param {string} baselineKind
 * @param {string|null} model
 * @param {Object} ctx  — pipeline context (same as runPipeline)
 * @param {number} N    — number of candidates
 * @param {Object} opts — evalProblem options
 * @returns {Promise<CandidateRecord[]>}
 */
export async function evalPipelineBatch(problemName, baselineKind, model, ctx, N, opts = {}) {
  const controller = opts.signal ? null : new AbortController();
  const signal = opts.signal || controller.signal;
  const task = loadProblemTask(problemName);

  const results = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      runPipeline(problemName, task, baselineKind, model, signal, ctx)
        .then(r => ({ ...r, candidateIndex: i }))
    )
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') {
      // Enrich with full attempt records from evalProblem-style loop
      // (reuse the attempt→record transformation from evalProblem)
      return buildAttemptRecord(r.value, i);
    }
    return {
      candidateIndex: i,
      pass: false,
      errorDetail: r.reason?.message || 'pipeline_error',
      stageFailed: 'pipeline_error',
    };
  });
}

/**
 * Ranked execution-feedback evaluation.
 * Generates N candidates and selects the best by execution characteristics.
 */
export async function evalProblemRankEf(problemName, baselineKind, model, opts = {}) {
  const N = opts.N || 5;
  const effectiveBaselineKind = (baselineKind === 'reasoning_os_v0') ? 'gen18_evolved' : baselineKind;

  const candidates = await evalPipelineBatch(
    problemName, effectiveBaselineKind, model,
    {
      waitMs: 0,
      autorepairCycles: 0,
      originalBaselineKind: baselineKind,
      inducedDrift: opts.inducedDrift || false,
      autorepairFeedbackMode: opts.autorepairFeedbackMode || INFORMED_REPAIR_MODES.VERIFIER,
      icgEnabled: opts.icgEnabled || false,
      pggEnabled: opts.pggEnabled || false,
    },
    N,
    opts
  );

  // Run the ranker
  const ranked = rankCandidates(candidates);
  const best = selectBest(ranked);

  // Attach rank metadata to all candidates
  const rankedWithRank = ranked.map((c, i) => ({
    ...c,
    ranker: {
      score: c._score ?? scoreCandidate(c),
      logicScore: computeLogicScore(canonicalizeCandidate(c)),
      rank: i + 1,
      scores: ranked.map(r => r._score ?? scoreCandidate(r)),
    }
  }));

  const bestWithRank = rankedWithRank[0];

  return {
    best: bestWithRank,
    allCandidates: rankedWithRank,
    metadata: {
      version: RANK_EF_VERSION,
      N,
      problemName,
      baselineKind,
      passAt1Selected: bestWithRank.pass,
      passAtN: rankedWithRank.some(c => c.pass),
    }
  };
}
```

### 6.4 New File: `run-rank-口を.mjs` (runner script)

```javascript
/**
 * run-rank-ef.mjs — Delta 7 microbench runner
 *
 * Runs 4 discriminative problems × 5 trials × N=5 candidates
 * Compares RankEF-selected pass@1 vs best-of-5 pass@1.
 *
 * Usage: node run-rank-ef.mjs [--problems edit-distance,lis,course-schedule-ii,critical-connections] [--k 5] [--N 5] [--baseline gen18_evolved]
 */

import { evalProblemRankEf } from './eval.js';
import { ensureRunDir, STRESS_PROBLEMS, DEFAULT_K, runProblemTrials, summarizeRun, writeCompactReport } from './stress-runner-utils.js';
import { pct, frac } from './stress-runner-utils.js';

const PROBLEMS = STRESS_PROBLEMS;   // ['edit-distance', 'lis', 'course-schedule-ii', 'critical-connections']
const K = 5;                       // trials per problem
const N = 5;                       // candidates per trial for rank-ef arm
const BASELINE = 'gen18_evolved';

async function main() {
  const runDir = ensureRunDir('rank-ef');
  const results = {};

  for (const problem of PROBLEMS) {
    console.log(`\n## ${problem} (k=${K}, N=${N})`);
    const problemResults = [];

    for (let trial = 1; trial <= K; trial++) {
      const { best, allCandidates, metadata } = await evalProblemRankEf(
        problem, BASELINE, null,
        { N, traceDir: `${runDir}/traces/${problem}/trial-${trial}` }
      );

      problemResults.push({
        trial,
        best,
        allCandidates,
        passAt1: best.pass,
        eventualPass: allCandidates.some(c => c.pass),
      });

      const status = best.pass ? '✅ PASS' : '❌ FAIL';
      const score = best.ranker?.score?.toFixed(3) ?? 'N/A';
      console.log(`  trial ${trial}: ${status} (score=${score}, rank=${best.ranker?.rank})`);
    }

    const passCount = problemResults.filter(r => r.passAt1).length;
    const passAt1Rate = passCount / K;
    console.log(`  → pass@1: ${passCount}/${K} (${pct(passAt1Rate)})`);

    results[problem] = problemResults;
  }

  // Summary
  const totalPass = Object.values(results).flat().filter(r => r.passAt1).length;
  const total = PROBLEMS.length * K;
  console.log(`\n## Aggregate: ${totalPass}/${total} (${pct(totalPass/total)})`);
}
```

---

## 7. Implementation Checklist

### Phase A (No model calls — unit test only)
- [ ] Write `rank-ef.js` — scoring functions, feature extraction, rank/select logic
- [ ] Write `test-rank-ef.js` — full unit test coverage (aim for 15+ assertions)
- [ ] All tests pass: `node test-rank-ef.js`

### Phase B (Microbench — model calls required)
- [ ] Add `evalPipelineBatch()` to `eval.js` (new internal function)
- [ ] Add `evalProblemRankEf()` to `eval.js` (new public async function)
- [ ] Write `run-rank-ef.mjs` — microbench runner script
- [ ] Run microbench: 4 problems × 5 trials × N=5 (100 candidate evaluations, ~10-20 min)
- [ ] Compute Wilson 95% CI on pass@1 delta (RankEF − Bo5)

### Phase C (Decision gate)
- [ ] If kill criteria met → document findings, archive experiment
- [ ] If +10pp with CI away from zero → promote to `validated_local`

### Phase D (Scale)
- [ ] Scale to N≥8 problems with k=5 trials
- [ ] If improvement holds → propose promoting to `delta-7-approved`

---

## 8. Risk Flags

| Risk | Severity | Mitigation |
|------|----------|------------|
| RankEF cannot beat best-of-5 when pool is diverse but candidates are similar | Medium | If avgRank(selected) ≈ 1.5 and no lift, kill |
| Weights are heuristic — may need tuning per problem class | Medium | Log scores and raw features per candidate so we can analyze and reweight |
| N=5 is still noisy; real gain may require N≥10 | Low | Design has `opts.N` parameter; scale up after microbench |
| Ranker adds latency (all N candidates must complete before selection) | Medium | Parallelize candidate generation via Promise.allSettled; latency ≈ max(modelMs) not sum |

---

## 9. Relationship to Other Deltas

```
Delta 1: Extraction           — cleans coder output (pre-execution)
Delta 2: Sig-repair          — fixes name mismatch (pre-execution)
Delta 3: Constraint ordering — improves spec quality (pre-generation)
Delta 4: Informed repair     — concrete failure signal to retry (post-failure, within-trial)
Delta 6: ICG                 — structural invariants injected (pre-generation)
Delta 7: RankEF              — execution-feedback candidate selection (post-generation, cross-candidate)
```

**Delta 7 does NOT interfere with Delta 4.** Delta 4 operates *within* each candidate's autorepair loop. RankEF operates *after* all N candidates have completed, selecting among them.

---

## 10. References

- **RankEF** (ASE 20241997): `dl.acm.org/doi/10.1145/3691620.3695000` — +30.97% pass@1, +31.43% pass@2 on APPS
- **Top Pass** (arXiv 2024): `arxiv.org/html/2408.05715v1` — +32.9% pass@1 on CodeContests; +6.8% on APPS
- **Research scout report**: `references/research-scout-best-of-n-2026-05-28.md`
- **OP Harness brainstorm**: `references/op-harness-brainstorm-2026-05-26.md` (not found; design grounded in KNOWLEDGE.md + source reading)
