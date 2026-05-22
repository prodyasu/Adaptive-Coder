/**
 * test-heldout-plan.js — validation tests for expanded held-out dataset plan.
 *
 * This phase plans/freeze-controls the dataset only. It must not run model evals.
 */

import {
  HELDOUT_PLAN_SCHEMA_VERSION,
  buildRecommendedHeldOutPlan,
  computePlanHash,
  validateHeldOutPlan,
  formatHeldOutPlanErrors,
} from './heldout-plan.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const plan = buildRecommendedHeldOutPlan({ frozenBy: 'moss', frozenAt: '2026-05-21T00:00:00.000Z' });

assert(plan.schemaVersion === HELDOUT_PLAN_SCHEMA_VERSION, 'plan uses stable schema version');
assert(plan.datasetName === 'shaper-coder-heldout-v1', 'plan names the held-out dataset');
assert(plan.targetN === 36, 'recommended target N is 36');
assert(plan.minimumN === 24, 'minimum N is 24');
assert(plan.noModelEvalRequired === true, 'plan explicitly requires no model eval to create/freeze');

assert(plan.categories.length === 6, 'six problem-structure categories are preregistered');
assert(plan.difficultyBuckets.length === 3, 'three difficulty buckets are preregistered');
assert(plan.balanceMatrix.reduce((sum, row) => sum + row.count, 0) === plan.targetN, 'balance matrix sums to targetN');
assert(plan.difficultyBuckets.reduce((sum, bucket) => sum + bucket.targetCount, 0) === plan.targetN, 'difficulty buckets sum to targetN');
assert(plan.categories.every(category => category.targetCount >= 4), 'each category has meaningful representation');
assert(plan.difficultyBuckets.find(bucket => bucket.id === 'hard')?.targetCount >= 8, 'hard bucket has enough examples for bucketed analysis');

assert(plan.excludedExistingProblemIds.includes('binary-search'), 'N4 problems excluded from new held-out construction');
assert(plan.excludedExistingProblemIds.includes('coin-change-ii'), 'existing testcases are excluded to avoid co-listed training leakage');
assert(plan.incompleteDiskProblemIds.includes('regular-expression-matching'), 'incomplete disk dirs tracked separately, not silently included');

assert(plan.contaminationControls.requiredChecks.includes('exact_content_hash'), 'exact hash contamination check required');
assert(plan.contaminationControls.requiredChecks.includes('ngram_overlap'), 'n-gram contamination check required');
assert(plan.contaminationControls.requiredChecks.includes('solution_code_overlap'), 'solution overlap contamination check required');
assert(plan.freezeRules.some(rule => rule.id === 'hash_of_problem_list'), 'freeze rules require problem-list hash');
assert(plan.preregisteredPredictions.length >= 5, 'at least five preregistered predictions recorded');
assert(plan.statisticalPlan.primaryTest === 'exact_mcnemar', 'primary paired test is exact McNemar');

const hash = computePlanHash(plan);
assert(/^sha256:[a-f0-9]{64}$/.test(hash), `plan hash is stable sha256, got ${hash}`);

const valid = validateHeldOutPlan({ ...plan, planHash: hash });
assert(valid.valid, `recommended plan validates: ${formatHeldOutPlanErrors(valid.errors)}`);

const bad = validateHeldOutPlan({
  ...plan,
  targetN: 36,
  balanceMatrix: plan.balanceMatrix.slice(1),
  planHash: 'sha256:' + '0'.repeat(64),
});
assert(!bad.valid, 'validator rejects broken balance/hash plan');
assert(bad.errors.some(error => error.path === 'balanceMatrix'), 'validator points at balance matrix mismatch');
assert(bad.errors.some(error => error.path === 'planHash'), 'validator points at stale hash');

const contaminated = validateHeldOutPlan({
  ...plan,
  planHash: computePlanHash(plan),
  contaminationControls: {
    ...plan.contaminationControls,
    trainingSourcesExcluded: [],
  },
});
assert(!contaminated.valid, 'validator rejects empty excluded training source list');
assert(formatHeldOutPlanErrors(contaminated.errors).includes('trainingSourcesExcluded'), 'formatted errors preserve exact failing field');

const missingChecksPlan = {
  ...plan,
  contaminationControls: {
    ...plan.contaminationControls,
    requiredChecks: ['exact_content_hash', 'ngram_overlap', 'solution_code_overlap'],
  },
};
const missingChecks = validateHeldOutPlan({ ...missingChecksPlan, planHash: computePlanHash(missingChecksPlan) });
assert(!missingChecks.valid, 'validator rejects missing source-date and reviewer contamination checks');
assert(missingChecks.errors.some(error => error.message.includes('source_date_before_freeze')), 'validator enforces source_date_before_freeze');
assert(missingChecks.errors.some(error => error.message.includes('reviewer_not_freezer')), 'validator enforces reviewer_not_freezer');

const impossibleMinimum = { ...plan, minimumN: 0 };
const badMinimum = validateHeldOutPlan({ ...impossibleMinimum, planHash: computePlanHash(impossibleMinimum) });
assert(!badMinimum.valid, 'validator rejects minimumN=0');
assert(badMinimum.errors.some(error => error.path === 'minimumN'), 'validator points at minimumN');

console.log('🎉 heldout-plan tests passed.');
