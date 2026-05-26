/**
 * r4-metrics.js — R4 metrics computation (extracted for testability)
 *
 * Primary DV: repair conversion rate = P(pass after repair | first attempt failed AND repair triggered)
 * Secondary: final success rate, attempts-to-pass, held-out after repair, by failure class
 */

/**
 * Compute aggregate metrics from mode-level trial data.
 *
 * @param {Object} modeResults - { problemName: { passAt1Count, passAt1Rate, trials: [...] } }
 * @returns {Object} Aggregate metrics including repair conversion rate
 */
export function computeModeMetrics(modeResults) {
  let totalTrials = 0;
  let totalPassAt1 = 0;
  let totalEventualPass = 0;

  // Repair conversion denominator & numerator
  let repairEligible = 0;
  let repairConverted = 0;

  // Attempts-to-pass (conditional on passing)
  let attemptsSum = 0;
  let attemptsCount = 0;

  // Held-out after repair
  let heldOutAfterRepairSum = 0;
  let heldOutAfterRepairCount = 0;

  // CohAtr risk
  let cohAtrRiskValues = [];

  // By failure class
  const byFailureClass = {};

  // Per-problem summary
  const byProblem = {};

  for (const [problem, data] of Object.entries(modeResults)) {
    totalTrials += data.trials.length;
    totalPassAt1 += data.passAt1Count;

    let pRepairEligible = 0, pRepairConverted = 0;
    let pEventualPass = 0;
    let pHeldOutSum = 0, pHeldOutN = 0;
    let pCohAtrValues = [];
    let pAttemptsSum = 0, pAttemptsN = 0;

    for (const t of data.trials) {
      if (t.eventualPass) pEventualPass++;

      // Repair conversion
      if (t.repairEligible) {
        repairEligible++;
        pRepairEligible++;
        if (t.repairConverted) {
          repairConverted++;
          pRepairConverted++;
        }
      }

      // Attempts-to-pass
      if (t.attemptsToPass !== null && t.attemptsToPass !== undefined) {
        attemptsSum += t.attemptsToPass;
        attemptsCount++;
        pAttemptsSum += t.attemptsToPass;
        pAttemptsN++;
      }

      // Held-out after repair
      if (t.heldOutAfterRepairRate !== null && t.heldOutAfterRepairRate !== undefined) {
        heldOutAfterRepairSum += t.heldOutAfterRepairRate;
        heldOutAfterRepairCount++;
        pHeldOutSum += t.heldOutAfterRepairRate;
        pHeldOutN++;
      }

      // CohAtr risk
      if (t.cohAtrRisk !== null && t.cohAtrRisk !== undefined && !isNaN(t.cohAtrRisk)) {
        cohAtrRiskValues.push(t.cohAtrRisk);
        pCohAtrValues.push(t.cohAtrRisk);
      }

      // Failure class breakdown for repair conversion
      if (t.repairEligible && t.failureClass) {
        if (!byFailureClass[t.failureClass]) {
          byFailureClass[t.failureClass] = { eligible: 0, converted: 0 };
        }
        byFailureClass[t.failureClass].eligible++;
        if (t.repairConverted) byFailureClass[t.failureClass].converted++;
      }
    }

    totalEventualPass += pEventualPass;

    byProblem[problem] = {
      passAt1Rate: data.passAt1Rate,
      finalSuccessRate: data.trials.length > 0 ? pEventualPass / data.trials.length : 0,
      repairConversion: pRepairEligible > 0 ? pRepairConverted / pRepairEligible : null,
      repairEligible: pRepairEligible,
      repairConverted: pRepairConverted,
      avgAttemptsToPass: pAttemptsN > 0 ? pAttemptsSum / pAttemptsN : null,
      avgHeldOutAfterRepair: pHeldOutN > 0 ? pHeldOutSum / pHeldOutN : null,
      avgCohAtrRisk: pCohAtrValues.length > 0 ? pCohAtrValues.reduce((a,b) => a+b, 0) / pCohAtrValues.length : null,
    };
  }

  return {
    totalTrials,
    // Primary DV: repair conversion rate
    repairConversionRate: repairEligible > 0 ? repairConverted / repairEligible : null,
    repairEligible,
    repairConverted,
    // Legacy pass@1 (still reported for context, not primary)
    passAt1Rate: totalTrials > 0 ? totalPassAt1 / totalTrials : 0,
    passedAt1Trials: totalPassAt1,
    // Final success rate (pass@N / best-of-k)
    finalSuccessRate: totalTrials > 0 ? totalEventualPass / totalTrials : 0,
    finalSuccessTrials: totalEventualPass,
    // Attempts-to-pass (conditional on passing)
    avgAttemptsToPass: attemptsCount > 0 ? attemptsSum / attemptsCount : null,
    attemptsToPassN: attemptsCount,
    // Held-out after repair
    heldOutAfterRepairRate: heldOutAfterRepairCount > 0 ? heldOutAfterRepairSum / heldOutAfterRepairCount : null,
    heldOutAfterRepairN: heldOutAfterRepairCount,
    // CohAtr risk
    avgCohAtrRisk: cohAtrRiskValues.length > 0 ? cohAtrRiskValues.reduce((a,b) => a+b, 0) / cohAtrRiskValues.length : null,
    // Failure class breakdown
    byFailureClass,
    byProblem,
  };
}

/**
 * Classify a trial's repair eligibility and conversion from raw attempt data.
 *
 * @param {Array} entries - Sorted [attemptIdx, resultObj] pairs from evalProblem
 * @returns {Object} Trial classification for metrics
 */
export function classifyTrial(entries) {
  const firstAttempt = entries[0]?.[1];
  const firstAttemptPassed = firstAttempt?.pass || false;

  let repairTriggered = false;
  let passedAfterRepair = false;
  let eventualPass = false;
  let attemptsToPass = null;
  let heldOutAfterRepairRate = null;
  const failureClasses = [];

  for (const [attemptIdx, v] of entries) {
    const attemptNum = Number(attemptIdx);

    // Track eventual pass and attempts-to-pass
    if (v?.pass && attemptsToPass === null) {
      eventualPass = true;
      attemptsToPass = attemptNum + 1;  // 1-indexed
    }

    // Detect repair trigger: attempt > 0 with informed repair feedback or autorepair cycles
    if (attemptNum > 0 && (v?.informedRepairFeedback || v?.autorepairCycles > 0)) {
      repairTriggered = true;
      if (v?.pass) {
        passedAfterRepair = true;
      }
      // Capture held-out from post-repair attempt
      if (v?.heldOutPassRate !== undefined && v?.heldOutPassRate !== null) {
        heldOutAfterRepairRate = v.heldOutPassRate;
      }
    }

    // Collect failure classes
    if (!v?.pass && v?.failureKind) {
      failureClasses.push(v.failureKind);
    }
  }

  const repairEligible = !firstAttemptPassed && repairTriggered;
  const repairConverted = repairEligible && passedAfterRepair;

  return {
    passAt1: firstAttemptPassed,
    repairEligible,
    repairConverted,
    eventualPass,
    attemptsToPass,
    heldOutAfterRepairRate,
    failureClass: failureClasses.length > 0 ? failureClasses[0] : null,
    failureClasses,
  };
}