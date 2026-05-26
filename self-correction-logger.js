/**
 * self-correction-logger.js — Passive read-only logger for self-correction rate
 *
 * Per Claude's recommendation: "Passive, read-only on the trace, zero downside,
 * and adding it now captures data in-run instead of forcing a re-run."
 *
 * Self-correction = the autorepair loop successfully fixed a failure
 * on a subsequent cycle. Higher self-correction rate implies stronger
 * internal verification; lower rate implies either no failures to
 * correct (trivial problems) or inability to self-correct (fragile solutions).
 *
 * This module does NOT modify the pipeline. It reads attempt results after
 * the fact and computes summary metrics.
 */

/**
 * Analyze a batch of attempt results and compute self-correction metrics.
 *
 * @param {Array} attempts - Array of attempt result objects from eval.js
 * @returns {Object} Self-correction summary
 */
export function computeSelfCorrectionMetrics(attempts) {
  // Each attempt has: pass, autorepairCycles, stageFailed, trace?, errorDetail
  // Self-correction = attempt that eventually passed after ≥1 autorepair cycle
  // Self-correction rate = self-corrected / (self-corrected + autorepair-exhausted)

  let totalWithAutorepair = 0;   // attempts that entered autorepair at all
  let selfCorrected = 0;         // attempts that passed after autorepair
  let autorepairExhausted = 0;   // attempts that exhausted autorepair without passing
  let trivialPasses = 0;         // attempts that passed without any autorepair needed
  let trivialFails = 0;          // attempts that failed without autorepair (e.g. coder error)

  // Per-problem breakdown
  const byProblem = {};

  for (const attempt of attempts) {
    const problem = attempt.problemName || 'unknown';
    if (!byProblem[problem]) {
      byProblem[problem] = { total: 0, selfCorrected: 0, exhausted: 0, trivialPass: 0, trivialFail: 0 };
    }
    byProblem[problem].total++;

    if (attempt.autorepairCycles > 0 || attempt.stageFailed === 'autorepair_exhausted') {
      // Attempt entered autorepair
      totalWithAutorepair++;
      if (attempt.pass) {
        selfCorrected++;
        byProblem[problem].selfCorrected++;
      } else {
        autorepairExhausted++;
        byProblem[problem].exhausted++;
      }
    } else if (attempt.pass) {
      trivialPasses++;
      byProblem[problem].trivialPass++;
    } else {
      trivialFails++;
      byProblem[problem].trivialFail++;
    }
  }

  const total = attempts.length;
  const selfCorrectionRate = totalWithAutorepair > 0
    ? selfCorrected / totalWithAutorepair
    : null; // null = no autorepair events at all

  return {
    total,
    totalWithAutorepair,
    selfCorrected,
    autorepairExhausted,
    trivialPasses,
    trivialFails,
    selfCorrectionRate,
    byProblem,
  };
}

/**
 * Log self-correction metrics to the trace for a single attempt.
 * This is called per-attempt during pipeline execution and attached to the trace.
 *
 * @param {Object} trace - The trace object for the current attempt
 * @param {Object} attemptResult - The attempt result { pass, autorepairCycles, stageFailed, errorDetail }
 * @returns {Object} Updated trace with selfCorrection field
 */
export function attachSelfCorrectionToTrace(trace, attemptResult) {
  const enteredAutorepair = attemptResult.autorepairCycles > 0 || attemptResult.stageFailed === 'autorepair_exhausted';
  const selfCorrected = enteredAutorepair && attemptResult.pass;

  trace.selfCorrection = {
    enteredAutorepair,
    selfCorrected,
    autorepairCycles: attemptResult.autorepairCycles || 0,
    stageFailed: attemptResult.stageFailed || null,
  };

  return trace;
}