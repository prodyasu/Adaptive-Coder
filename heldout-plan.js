import { createHash } from 'crypto';

export const HELDOUT_PLAN_SCHEMA_VERSION = 'heldout-plan/v1';

export const EXISTING_TESTCASE_PROBLEM_IDS = [
  'binary-search',
  'climbing-stairs',
  'coin-change-ii',
  'container-with-most-water',
  'invert-binary-tree',
  'lru-cache',
  'median-of-two-sorted',
  'meeting-rooms-ii',
  'merge-intervals',
  'min-stack',
  'rotting-oranges',
  'substring-with-concatenation',
  'trapping-rain-water',
  'two-sum',
  'valid-parentheses',
  'valid-sudoku',
  'word-break-ii',
];

export const INCOMPLETE_DISK_PROBLEM_IDS = [
  'coin-change',
  'regular-expression-matching',
  'serialize-binary-tree',
];

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter(key => key !== 'planHash')
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computePlanHash(plan) {
  return `sha256:${createHash('sha256').update(stableJson(plan)).digest('hex')}`;
}

function problemStructureCategories() {
  return [
    {
      id: 'array_hash_intervals',
      label: 'Array / Hash / Intervals',
      targetCount: 6,
      rationale: 'Single-pass, hash-map, sorting, and interval merge patterns; catches basic translation and boundary handling.',
      examplesExcludedFromExistingCorpus: ['two-sum', 'merge-intervals'],
    },
    {
      id: 'dp_recursion',
      label: 'Dynamic Programming / Recursion',
      targetCount: 6,
      rationale: 'Tests subproblem framing, recurrence extraction, base cases, and memo/table discipline.',
      examplesExcludedFromExistingCorpus: ['climbing-stairs', 'coin-change-ii', 'word-break-ii'],
    },
    {
      id: 'two_pointer_sliding_window',
      label: 'Two-pointer / Sliding Window',
      targetCount: 5,
      rationale: 'Pointer movement, window invariants, and off-by-one failures.',
      examplesExcludedFromExistingCorpus: ['container-with-most-water', 'substring-with-concatenation'],
    },
    {
      id: 'graph_tree_bfs_dfs',
      label: 'Graph / Tree / BFS / DFS',
      targetCount: 6,
      rationale: 'Traversal state, queue/stack correctness, tree mutation, visited tracking.',
      examplesExcludedFromExistingCorpus: ['invert-binary-tree', 'rotting-oranges'],
    },
    {
      id: 'stack_queue_data_structure',
      label: 'Stack / Queue / Data Structure',
      targetCount: 6,
      rationale: 'Stateful APIs and operation-sequence correctness, where scaffold signatures matter.',
      examplesExcludedFromExistingCorpus: ['min-stack', 'lru-cache', 'valid-parentheses'],
    },
    {
      id: 'strings_grids_constraints',
      label: 'Strings / Grids / Constraint Checking',
      targetCount: 7,
      rationale: 'Parsing, indexing, grid invariants, and constraint validation.',
      examplesExcludedFromExistingCorpus: ['valid-sudoku', 'trapping-rain-water'],
    },
  ];
}

function difficultyBuckets() {
  return [
    {
      id: 'easy',
      targetCount: 8,
      calibration: 'Published easy label or expected reference solution under ~25 LOC with one dominant invariant.',
    },
    {
      id: 'medium',
      targetCount: 18,
      calibration: 'Published medium label or expected reference solution ~25-60 LOC with multiple branches/invariants.',
    },
    {
      id: 'hard',
      targetCount: 10,
      calibration: 'Published hard label or expected reference solution >60 LOC, multi-phase DP/search, or stateful API edge cases.',
    },
  ];
}

function balanceMatrix() {
  return [
    { category: 'array_hash_intervals', difficulty: 'easy', count: 2 },
    { category: 'array_hash_intervals', difficulty: 'medium', count: 3 },
    { category: 'array_hash_intervals', difficulty: 'hard', count: 1 },
    { category: 'dp_recursion', difficulty: 'easy', count: 1 },
    { category: 'dp_recursion', difficulty: 'medium', count: 3 },
    { category: 'dp_recursion', difficulty: 'hard', count: 2 },
    { category: 'two_pointer_sliding_window', difficulty: 'easy', count: 1 },
    { category: 'two_pointer_sliding_window', difficulty: 'medium', count: 3 },
    { category: 'two_pointer_sliding_window', difficulty: 'hard', count: 1 },
    { category: 'graph_tree_bfs_dfs', difficulty: 'easy', count: 1 },
    { category: 'graph_tree_bfs_dfs', difficulty: 'medium', count: 3 },
    { category: 'graph_tree_bfs_dfs', difficulty: 'hard', count: 2 },
    { category: 'stack_queue_data_structure', difficulty: 'easy', count: 1 },
    { category: 'stack_queue_data_structure', difficulty: 'medium', count: 3 },
    { category: 'stack_queue_data_structure', difficulty: 'hard', count: 2 },
    { category: 'strings_grids_constraints', difficulty: 'easy', count: 2 },
    { category: 'strings_grids_constraints', difficulty: 'medium', count: 3 },
    { category: 'strings_grids_constraints', difficulty: 'hard', count: 2 },
  ];
}

export function buildRecommendedHeldOutPlan({ frozenBy = 'moss', frozenAt = new Date().toISOString() } = {}) {
  const plan = {
    schemaVersion: HELDOUT_PLAN_SCHEMA_VERSION,
    datasetName: 'shaper-coder-heldout-v1',
    datasetVersion: '1.0.0-plan',
    status: 'planned_not_frozen',
    frozenAt,
    frozenBy,
    noModelEvalRequired: true,
    targetN: 36,
    minimumN: 24,
    existingN4ProblemIds: ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii'],
    excludedExistingProblemIds: EXISTING_TESTCASE_PROBLEM_IDS,
    incompleteDiskProblemIds: INCOMPLETE_DISK_PROBLEM_IDS,
    categories: problemStructureCategories(),
    difficultyBuckets: difficultyBuckets(),
    balanceMatrix: balanceMatrix(),
    sourcingRules: [
      'Do not source expanded held-out problems from the existing testcases/ corpus or any co-listed training pool.',
      'Each selected problem must be committed with task text, reference TypeScript signature/solution, deterministic tests, and source provenance before model eval.',
      'Incomplete disk directories may only become held-out candidates after completion and contamination checks; until then they are tracked as incomplete, not selected.',
      'Freeze the manifest and hashes before running raw_base, gen0_seed, or gen18_evolved.',
    ],
    contaminationControls: {
      requiredChecks: ['exact_content_hash', 'ngram_overlap', 'solution_code_overlap', 'source_date_before_freeze', 'reviewer_not_freezer'],
      trainingSourcesExcluded: ['current-shaper-training-set', 'existing-testcases-corpus', 'N4-heldout-results'],
      ngramSize: 5,
      maxAllowedNgramOverlapRatio: 0.08,
      exactHashAlgorithm: 'sha256',
      requiredProblemFields: ['problemId', 'category', 'difficulty', 'taskHash', 'referenceHash', 'testHash', 'source', 'contaminationCheck'],
    },
    freezeRules: [
      { id: 'hash_of_problem_list', rule: 'Compute sha256 over sorted per-problem hashes and store it in the final held-out manifest.' },
      { id: 'immutable_after_freeze', rule: 'Any task/reference/test edit after freeze creates a new datasetVersion; no silent mutation.' },
      { id: 'git_tag', rule: 'Tag the freeze commit as heldout-v1-YYYYMMDD before any model eval.' },
      { id: 'pipeline_alignment', rule: 'Every result artifact must reference this dataset and use exactly raw_base, gen0_seed, gen18_evolved unless separately preregistered.' },
    ],
    preregisteredPredictions: [
      { id: 'P1', claim: 'gen18_evolved pass@1 exceeds raw_base on the frozen held-out set.', successCriterion: 'Positive paired difference with exact McNemar p < 0.05; report Bonferroni-adjusted interpretation across preregistered claims.' },
      { id: 'P2', claim: 'gen18_evolved pass@1 exceeds gen0_seed, but by less than the N=4 50-point apparent gap.', successCriterion: '0 < gen18_minus_gen0 < 0.50 on pass@1.' },
      { id: 'P3', claim: 'gen18 advantage is larger on medium+hard buckets than easy bucket.', successCriterion: '(medium_hard gap) > (easy gap) for gen18_evolved minus raw_base.' },
      { id: 'P4', claim: 'gen0_seed improves pass@N recovery more than pass@1.', successCriterion: 'gen0_seed pass@N - raw_base pass@N > gen0_seed pass@1 - raw_base pass@1.' },
      { id: 'P5', claim: 'Dominant failures cluster in logic_assertion and spec_validation sub-kinds, not model_error.', successCriterion: 'At least 80% of failed attempts have failureKind in {logic_assertion, spec_validation, format_protocol}; model_error remains below 10%.' },
    ],
    statisticalPlan: {
      primaryMetric: 'pass@1',
      secondaryMetrics: ['pass@N', 'failureCode distribution', 'bucketed pass@1 by difficulty and category'],
      primaryTest: 'exact_mcnemar',
      confidenceIntervals: 'clopper_pearson_for_rates; bootstrap_for_bucketed_differences',
      multipleComparisonNote: 'Preregistered predictions are interpreted with both raw p-values and Bonferroni-adjusted p<0.01 sensitivity notes.',
      doNotCombineWithN4: true,
    },
    approvalGate: {
      requiredBeforeModelEval: true,
      reason: 'Expanded held-out evaluation can consume paid/remote model calls and changes evidential status; freeze and approval precede runs.',
    },
  };
  return { ...plan, planHash: computePlanHash(plan) };
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

export function validateHeldOutPlan(plan = {}) {
  const errors = [];
  if (plan.schemaVersion !== HELDOUT_PLAN_SCHEMA_VERSION) {
    addError(errors, 'schemaVersion', `expected ${HELDOUT_PLAN_SCHEMA_VERSION}`);
  }
  if (!plan.datasetName) addError(errors, 'datasetName', 'datasetName is required');
  if (!Number.isInteger(plan.targetN) || plan.targetN < 1) addError(errors, 'targetN', 'targetN must be a positive integer');
  if (!Number.isInteger(plan.minimumN) || plan.minimumN < 1 || plan.minimumN > plan.targetN) addError(errors, 'minimumN', 'minimumN must be a positive integer <= targetN');
  if (plan.noModelEvalRequired !== true) addError(errors, 'noModelEvalRequired', 'planning/freezing must not require model evals');

  const categories = Array.isArray(plan.categories) ? plan.categories : [];
  const buckets = Array.isArray(plan.difficultyBuckets) ? plan.difficultyBuckets : [];
  const matrix = Array.isArray(plan.balanceMatrix) ? plan.balanceMatrix : [];
  if (categories.length < 4) addError(errors, 'categories', 'at least four categories required');
  if (buckets.length !== 3) addError(errors, 'difficultyBuckets', 'exactly easy/medium/hard buckets required');

  const categoryIds = new Set(categories.map(category => category.id));
  const bucketIds = new Set(buckets.map(bucket => bucket.id));
  for (const row of matrix) {
    if (!categoryIds.has(row.category)) addError(errors, 'balanceMatrix', `unknown category ${row.category}`);
    if (!bucketIds.has(row.difficulty)) addError(errors, 'balanceMatrix', `unknown difficulty ${row.difficulty}`);
    if (!Number.isInteger(row.count) || row.count < 0) addError(errors, 'balanceMatrix', 'row count must be non-negative integer');
  }
  const matrixTotal = matrix.reduce((sum, row) => sum + (Number.isInteger(row.count) ? row.count : 0), 0);
  if (matrixTotal !== plan.targetN) addError(errors, 'balanceMatrix', `balanceMatrix sums to ${matrixTotal}, expected targetN ${plan.targetN}`);
  const bucketTotal = buckets.reduce((sum, bucket) => sum + (Number.isInteger(bucket.targetCount) ? bucket.targetCount : 0), 0);
  if (bucketTotal !== plan.targetN) addError(errors, 'difficultyBuckets', `difficultyBuckets sum to ${bucketTotal}, expected targetN ${plan.targetN}`);
  const categoryTotal = categories.reduce((sum, category) => sum + (Number.isInteger(category.targetCount) ? category.targetCount : 0), 0);
  if (categoryTotal !== plan.targetN) addError(errors, 'categories', `categories sum to ${categoryTotal}, expected targetN ${plan.targetN}`);

  for (const n4Problem of ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii']) {
    if (!plan.excludedExistingProblemIds?.includes(n4Problem)) {
      addError(errors, 'excludedExistingProblemIds', `must exclude existing/N4 problem ${n4Problem}`);
    }
  }

  const controls = plan.contaminationControls || {};
  for (const check of ['exact_content_hash', 'ngram_overlap', 'solution_code_overlap', 'source_date_before_freeze', 'reviewer_not_freezer']) {
    if (!controls.requiredChecks?.includes(check)) addError(errors, 'contaminationControls.requiredChecks', `missing required check ${check}`);
  }
  if (!Array.isArray(controls.trainingSourcesExcluded) || controls.trainingSourcesExcluded.length === 0) {
    addError(errors, 'contaminationControls.trainingSourcesExcluded', 'trainingSourcesExcluded must list at least one excluded source');
  }

  if (!Array.isArray(plan.freezeRules) || !plan.freezeRules.some(rule => rule.id === 'hash_of_problem_list')) {
    addError(errors, 'freezeRules', 'hash_of_problem_list freeze rule required');
  }
  if (!Array.isArray(plan.preregisteredPredictions) || plan.preregisteredPredictions.length < 5) {
    addError(errors, 'preregisteredPredictions', 'at least five preregistered predictions required');
  }
  if (plan.statisticalPlan?.primaryTest !== 'exact_mcnemar') {
    addError(errors, 'statisticalPlan.primaryTest', 'primary paired test must be exact_mcnemar');
  }
  if (plan.statisticalPlan?.doNotCombineWithN4 !== true) {
    addError(errors, 'statisticalPlan.doNotCombineWithN4', 'expanded results must not be combined with N4 claims');
  }

  const expectedHash = computePlanHash(plan);
  if (plan.planHash !== expectedHash) {
    addError(errors, 'planHash', `planHash mismatch: expected ${expectedHash}`);
  }

  return { valid: errors.length === 0, errors };
}

export function formatHeldOutPlanErrors(errors = []) {
  if (!errors.length) return 'no validation errors';
  return errors.map(error => `${error.path}: ${error.message}`).join('\n');
}
