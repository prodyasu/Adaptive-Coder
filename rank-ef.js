/**
 * rank-ef.js — Execution-Feedback Ranker (Delta 7 / OP-1)
 *
 * Ranks candidate code solutions by execution feedback (traces, failure class,
 * assertion results, PGG outcomes) rather than taking the first passing candidate.
 *
 * Research basis: RankEF (ASE 2024) + Top Pass (arXiv 2024) — 20-31% pass@1
 * improvement over best-of-N random selection using execution feedback.
 *
 * Key insight: best-of-5 treats all passing candidates as equivalent.
 * RankEF distinguishes them by execution characteristics and selects the
 * highest-quality passing candidate, or the best failing candidate if none pass.
 *
 * Module exports:
 *   - extractFeatures(attempt) → feature vector
 *   - computeLogicScore(attempt) → float [0,1]
 *   - heuristicScore(attempt, weights?) → float [0,1]
 *   - rankCandidates(attempts, weights?) → sorted attempts (best first)
 *   - selectBest(attempts, weights?) → best attempt
 *   - RANK_EF_VERSION, RANK_EF_WEIGHTS
 */

import { classifyFailure, DIAGNOSTIC_CLASSES } from './diagnostician.js';

// ---------------------------------------------------------------------------
// Version and weights
// ---------------------------------------------------------------------------

export const RANK_EF_VERSION = 'v1';

export const RANK_EF_WEIGHTS = Object.freeze({
  logic:        0.30,   // dominant — algorithmic correctness
  pgg:          0.20,   // PGG = cross-validation layer
  heldOut:      0.15,   // quality signal beyond primary
  execTime:     0.10,   // speed/simplicity signal
  cohAtr:       0.10,   // contamination safety (inverted)
  autoRepair:   0.10,   // clean generation bonus
  pggResamples: 0.05,   // low resample = efficient
});

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

export function extractFeatures(attempt) {
  const t = attempt.trace || {};
  const pgg = attempt.pgg || null;

  // Normalize modelMs to [0,1] execTimeScore (higher = faster)
  // 60s is worst; <1s is best
  const executionTimeScore = attempt.modelMs > 0
    ? Math.max(0, 1 - attempt.modelMs / 60_000)
    : 0.5;  // unknown time → neutral

  // PGG pass rate: fraction of PGG assertions that passed
  const pggPassRate = (pgg && pgg.totalCount > 0)
    ? (pgg.totalCount - pgg.failedCount) / pgg.totalCount
    : 1.0;  // no PGG → neutral (don't penalize)

  // Diagnostic classification
  const diagnostic = (attempt.trace && typeof attempt.trace === 'object' && Object.keys(attempt.trace).length > 0)
    ? classifyFailure(attempt.trace)
    : { class: DIAGNOSTIC_CLASSES.UNKNOWN };

  // Also check failureSubKind directly for off_by_one detection
  // (classifyFailure needs full trace; failureSubKind is already parsed by failure-metrics)
  const offByOneFromSubKind = attempt.failureSubKind === 'off_by_one';

  return {
    pass:                Boolean(attempt.pass),
    primaryPassRate:     attempt.primaryPassRate ?? 0.0,
    pggPassRate,
    pggPassed:           pgg ? Boolean(pgg.accepted) : true,
    heldOutPassRate:     attempt.heldOutPassRate ?? null,
    cohAtrRisk:          attempt.cohAtrRisk ?? null,
    failureKind:         attempt.failureKind ?? 'unknown',
    failureSubKind:      attempt.failureSubKind ?? 'unknown',
    diagnosticClass:     diagnostic.class ?? DIAGNOSTIC_CLASSES.UNKNOWN,
    executionTimeScore,
    autorepairCycles:    attempt.autorepairCycles ?? 0,
    pggResampleRatio:    pgg
      ? (pgg.resampleNumber || 0) / 10   // MAX_PGG_RESAMPLES=10
      : 0,
    compileError:        Boolean(t.compileError),
    offByOne:            (diagnostic?.class === DIAGNOSTIC_CLASSES.OFF_BY_ONE) || offByOneFromSubKind,
    timeoutFlag:         Boolean(
      attempt.failureKind === 'timeout' ||
      (typeof t.verifierError === 'string' && t.verifierError.includes('timeout')) ||
      (typeof t.coderError === 'string' && t.coderError.includes('timeout'))
    ),
  };
}

// ---------------------------------------------------------------------------
// Logic score computation
// ---------------------------------------------------------------------------

export function computeLogicScore(attempt) {
  let score = attempt.primaryPassRate ?? 0.0;
  const v = extractFeatures(attempt);

  // Penalize failure modes for non-passing candidates
  if (!attempt.pass) {
    if (v.offByOne)                                         score -= 0.15;  // almost right
    else if (v.failureKind === 'logic_assertion')            score -= 0.05;  // logic error
    else if (v.failureKind === 'timeout')                   score -= 0.10;  // inefficient
    else if (v.failureKind === 'format_protocol')           score -= 0.20;  // bad code quality
    else if (v.failureKind === 'model_error')               score -= 0.30;  // infra/infra failure
  }

  // PGG objections: deductions for failing assertion checks
  if (attempt.pgg && !attempt.pgg.accepted)                  score -= 0.10;

  // Compile errors: significant quality penalty
  if (v.compileError)                                         score -= 0.25;

  // Timeout flag: mild penalty (efficiency concern)
  if (v.timeoutFlag)                                          score -= 0.10;

  // No self-correction attempted for a failing candidate → mild penalty
  if (!v.pass && (v.autorepairCycles ?? 0) === 0)                   score -= 0.05;

  // Bonus: autorepair-free clean generation
  if (attempt.pass && (attempt.autorepairCycles ?? 0) === 0)         score += 0.05;

  return Math.max(0.0, Math.min(1.0, score));
}

// ---------------------------------------------------------------------------
// Heuristic composite score
// ---------------------------------------------------------------------------

export function heuristicScore(attempt, weights = RANK_EF_WEIGHTS) {
  const v = extractFeatures(attempt);

  const log = computeLogicScore(attempt);
  const pg  = v.pggPassRate;
  const ho  = v.heldOutPassRate ?? 0.5;    // unknown held-out → neutral
  const ec  = v.executionTimeScore;
  const cr  = Math.max(0, 1 - (v.cohAtrRisk ?? 0));  // invert risk: 1 = safe
  const ar  = Math.max(0, 1 - v.autorepairCycles / 5); // 0 repairs = 1.0
  const re  = Math.max(0, 1 - v.pggResampleRatio);

  return (
    weights.logic        * log +
    weights.pgg          * pg +
    weights.heldOut      * ho +
    weights.execTime     * ec +
    weights.cohAtr       * cr +
    weights.autoRepair   * ar +
    weights.pggResamples * re
  );
}

// ---------------------------------------------------------------------------
// Ranking and selection
// ---------------------------------------------------------------------------

/**
 * Rank candidates by execution-feedback score (best first).
 * @param {Array} attempts — array of attempt records from evalPipelineBatch
 * @param {Object} weights — optional weight overrides
 * @returns {Array} — sorted copy (highest score first), each with .rankerScore attached
 */
export function rankCandidates(attempts, weights = RANK_EF_WEIGHTS) {
  const scored = attempts.map(a => {
    const score = heuristicScore(a, weights);
    return { ...a, rankerScore: score };
  });

  // Sort by score descending; break ties by primaryPassRate descending, then modelMs ascending
  scored.sort((a, b) => {
    if (b.rankerScore !== a.rankerScore) return b.rankerScore - a.rankerScore;
    const aRate = a.primaryPassRate ?? 0;
    const bRate = b.primaryPassRate ?? 0;
    if (bRate !== aRate) return bRate - aRate;
    // modelMs undefined → Infinity (treated as slowest, not fastest)
    return (a.modelMs ?? Infinity) - (b.modelMs ?? Infinity);
  });

  return scored;
}

/**
 * Select the best candidate, with a pass-fail gate:
 *   1. If any candidate passes primary tests, select the highest-scored passing candidate
 *   2. If no candidate passes, select the highest-scored failing candidate
 *
 * This ensures RankEF NEVER does worse than best-of-5 in finding a passing candidate.
 *
 * @param {Array} attempts — array of attempt records (will be ranked internally)
 * @param {Object} weights — optional weight overrides
 * @returns {Object} — the best attempt record, with .ranker metadata attached
 */
export function selectBest(attempts, weights = RANK_EF_WEIGHTS) {
  const ranked = rankCandidates(attempts, weights);

  // Pass-fail gate: prefer passing candidates over failing ones
  const passing = ranked.filter(c => c.pass);
  const allCandidatesFailed = passing.length === 0 && ranked.length > 0;
  if (passing.length > 0) {
    // Among passing candidates, the highest-scored one wins
    // (rankCandidates already sorted by score, so passing[0] is best passing)
    return attachRankerMeta(passing[0], ranked, { allCandidatesFailed: false });
  }

  // No passing candidates: return the best failing candidate
  if (ranked.length === 0) return undefined;
  return attachRankerMeta(ranked[0], ranked, { allCandidatesFailed: true });
}

/**
 * Attach ranker metadata to the selected candidate for trace auditing.
 */
function attachRankerMeta(selected, allRanked, flags = {}) {
  return {
    ...selected,
    ranker: {
      score: selected.rankerScore,
      rank: allRanked.findIndex(c => c.candidateIndex === selected.candidateIndex) + 1,
      selectedOver: allRanked
        .filter(c => c.candidateIndex !== selected.candidateIndex)
        .map(c => c.candidateIndex),
      numCandidates: allRanked.length,
      allCandidatesFailed: flags.allCandidatesFailed ?? false,
      version: RANK_EF_VERSION,
      allScores: allRanked.map(c => ({
        candidateIndex: c.candidateIndex,
        score: c.rankerScore,
        pass: c.pass,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Adaptive early stop
// ---------------------------------------------------------------------------

/**
 * Decide whether to stop generating candidates early.
 *
 * Strategy: if a candidate has a high heuristic score AND passes primary tests,
 * we've found a strong solution and can skip remaining candidates.
 *
 * @param {Object} attempt — candidate attempt record (with rankerScore attached)
 * @param {Object} opts — options: { confidenceThreshold: 0.85, requirePass: true }
 * @returns {boolean} — true if we should stop early
 */
export function shouldEarlyStop(attempt, opts = {}) {
  const {
    confidenceThreshold = 0.85,
    requirePass = true,
  } = opts;

  if (!attempt) return false;

  // Must pass primary tests to consider early stop
  if (requirePass && !attempt.pass) return false;

  // Score must exceed confidence threshold
  const score = attempt.rankerScore ?? heuristicScore(attempt);
  return score >= confidenceThreshold;
}

// ---------------------------------------------------------------------------
// Batch evaluation entry point (for runner scripts)
// ---------------------------------------------------------------------------

/**
 * Build a result summary from a set of ranked candidates.
 * Used by experiment runners to compute aggregate statistics.
 *
 * @param {Array} allRankResults — array of { best, allCandidates, metadata } per trial
 * @returns {Object} aggregate summary
 */
export function buildRankEfSummary(allRankResults) {
  const N = allRankResults.length;
  if (N === 0) return { version: RANK_EF_VERSION, N: 0 };

  let passAt1Selected = 0;
  let passAtN = 0;              // any candidate passes
  let totalCandidates = 0;
  let totalModelMs = 0;
  let rankSum = 0;

  for (const result of allRankResults) {
    const { best, allCandidates, metadata } = result;
    totalCandidates += allCandidates.length;
    totalModelMs += (best.modelMs || 0);
    rankSum += (best.ranker?.rank || 0);

    if (best.pass) passAt1Selected++;
    if (allCandidates.some(c => c.pass)) passAtN++;
  }

  return {
    version: RANK_EF_VERSION,
    N,
    totalCandidates,
    avgCandidatesPerTrial: (totalCandidates / N).toFixed(1),
    passAt1Selected: `${passAt1Selected}/${N}`,
    passAt1SelectedRate: passAt1Selected / N,
    passAtN: `${passAtN}/${N}`,
    passAtNRate: passAtN / N,
    avgRank: (rankSum / N).toFixed(2),
    totalModelMs,
    avgModelMs: Math.round(totalModelMs / N),
  };
}