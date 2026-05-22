import {
  summarizeBinaryRun,
  exactMcNemarTest,
  exactPermutationTest,
  passAtK,
} from './stats.js';

export const RESULT_SCHEMA_VERSION = 'eval-result/v1';
export const DEFAULT_PIPELINES = ['raw_base', 'gen0_seed', 'gen18_evolved'];
export const DEFAULT_METRICS = ['pass1', 'passN'];

function toBool(value, path) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new Error(`${path} must be boolean or 0/1`);
}

function requireArray(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  return value;
}

function summarizeMetric(metric, pipelines, options) {
  const runs = {};
  for (const pipeline of pipelines) {
    const values = metric[pipeline];
    const summary = summarizeBinaryRun(pipeline, values, options);
    runs[pipeline] = {
      label: summary.label,
      n: summary.n,
      successes: summary.successes,
      failures: summary.failures,
      rate: summary.rate,
      exactCI: summary.exactCI,
      bootstrapCI: summary.bootstrapCI,
      passAt2: passAtK({ n: summary.n, c: summary.successes, k: Math.min(2, summary.n) }),
    };
  }

  const comparisons = {};
  for (let i = 0; i < pipelines.length; i++) {
    for (let j = i + 1; j < pipelines.length; j++) {
      const a = pipelines[i];
      const b = pipelines[j];
      comparisons[`${a}→${b}`] = {
        paired: exactMcNemarTest(metric[a], metric[b], { alternative: 'greater' }),
        unpairedPermutation: exactPermutationTest(metric[a], metric[b], { alternative: 'greater' }),
      };
    }
  }

  return { runs, comparisons };
}

export function buildResultArtifactFromMatrix(matrix, options = {}) {
  const problems = requireArray(matrix.problems, 'matrix.problems');
  const pipelines = options.pipelines ?? DEFAULT_PIPELINES;
  for (const metricKey of DEFAULT_METRICS) {
    if (!matrix[metricKey]) throw new Error(`matrix.${metricKey} is required`);
    for (const pipeline of pipelines) {
      const values = requireArray(matrix[metricKey][pipeline], `matrix.${metricKey}.${pipeline}`);
      if (values.length !== problems.length) {
        throw new Error(`matrix.${metricKey}.${pipeline} length must match problems length`);
      }
    }
  }

  const problemRows = problems.map((problemId, index) => {
    const results = {};
    for (const pipeline of pipelines) {
      results[pipeline] = {
        passAt1: toBool(matrix.pass1[pipeline][index], `matrix.pass1.${pipeline}[${index}]`),
        passAtN: toBool(matrix.passN[pipeline][index], `matrix.passN.${pipeline}[${index}]`),
      };
    }
    return { problemId, results };
  });

  const statsOptions = {
    bootstrapIterations: options.bootstrapIterations ?? 10000,
    seed: options.seed ?? 20260521,
  };

  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: options.source ?? { type: 'unknown' },
    run: {
      runId: options.runId ?? 'unknown-run',
      harnessVersion: options.harnessVersion ?? 'unknown',
      model: options.model,
      notes: options.notes ?? [],
    },
    pipelines,
    problems: problemRows,
    metrics: {
      pass1: summarizeMetric(matrix.pass1, pipelines, statsOptions),
      passN: summarizeMetric(matrix.passN, pipelines, statsOptions),
    },
    methodology: {
      statistics: [
        'clopper-pearson',
        'clopper-pearson exact binomial confidence intervals',
        'seeded percentile bootstrap confidence intervals',
        'Codex-style pass@k estimator',
        'exact paired McNemar/binomial sign test for same-problem comparisons',
        'exact unpaired permutation test for secondary comparison',
      ],
      caveats: [
        'N=4 is too small for asymptotic tests or strong generalization claims.',
        'Machine-readable artifact may be reconstructed from markdown when source.type=markdown.',
      ],
    },
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushIf(errors, condition, path, message) {
  if (condition) errors.push({ path, message });
}

export function validateResultArtifact(artifact) {
  const errors = [];
  pushIf(errors, !isObject(artifact), '$', 'artifact must be an object');
  if (!isObject(artifact)) return { valid: false, errors };

  pushIf(errors, artifact.schemaVersion !== RESULT_SCHEMA_VERSION, 'schemaVersion', `must be ${RESULT_SCHEMA_VERSION}`);
  pushIf(errors, typeof artifact.generatedAt !== 'string', 'generatedAt', 'must be an ISO string');
  pushIf(errors, !isObject(artifact.source), 'source', 'must be an object');
  pushIf(errors, !isObject(artifact.run), 'run', 'must be an object');
  pushIf(errors, !Array.isArray(artifact.pipelines) || artifact.pipelines.length === 0, 'pipelines', 'must be a non-empty array');
  pushIf(errors, !Array.isArray(artifact.problems) || artifact.problems.length === 0, 'problems', 'must be a non-empty array');
  pushIf(errors, !isObject(artifact.metrics), 'metrics', 'must be an object');

  const pipelines = Array.isArray(artifact.pipelines) ? artifact.pipelines : [];
  if (isObject(artifact.run)) {
    pushIf(errors, typeof artifact.run.runId !== 'string', 'run.runId', 'must be a string');
    pushIf(errors, typeof artifact.run.harnessVersion !== 'string', 'run.harnessVersion', 'must be a string');
  }

  if (Array.isArray(artifact.problems)) {
    artifact.problems.forEach((problem, problemIndex) => {
      const basePath = `problems[${problemIndex}]`;
      pushIf(errors, !isObject(problem), basePath, 'must be an object');
      if (!isObject(problem)) return;
      pushIf(errors, typeof problem.problemId !== 'string', `${basePath}.problemId`, 'must be a string');
      pushIf(errors, !isObject(problem.results), `${basePath}.results`, 'must be an object');
      for (const pipeline of pipelines) {
        const result = problem.results?.[pipeline];
        const resultPath = `${basePath}.results.${pipeline}`;
        pushIf(errors, !isObject(result), resultPath, 'must be an object');
        if (!isObject(result)) continue;
        pushIf(errors, typeof result.passAt1 !== 'boolean', `${resultPath}.passAt1`, 'must be boolean');
        pushIf(errors, typeof result.passAtN !== 'boolean', `${resultPath}.passAtN`, 'must be boolean');
      }
    });
  }

  for (const metricKey of DEFAULT_METRICS) {
    const metric = artifact.metrics?.[metricKey];
    pushIf(errors, !isObject(metric), `metrics.${metricKey}`, 'must be an object');
    if (!isObject(metric)) continue;
    pushIf(errors, !isObject(metric.runs), `metrics.${metricKey}.runs`, 'must be an object');
    pushIf(errors, !isObject(metric.comparisons), `metrics.${metricKey}.comparisons`, 'must be an object');
    for (const pipeline of pipelines) {
      const run = metric.runs?.[pipeline];
      const runPath = `metrics.${metricKey}.runs.${pipeline}`;
      pushIf(errors, !isObject(run), runPath, 'must be an object');
      if (!isObject(run)) continue;
      pushIf(errors, typeof run.n !== 'number', `${runPath}.n`, 'must be number');
      pushIf(errors, typeof run.successes !== 'number', `${runPath}.successes`, 'must be number');
      pushIf(errors, typeof run.rate !== 'number', `${runPath}.rate`, 'must be number');
      pushIf(errors, !isObject(run.exactCI), `${runPath}.exactCI`, 'must be object');
      pushIf(errors, !isObject(run.bootstrapCI), `${runPath}.bootstrapCI`, 'must be object');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function formatValidationErrors(errors) {
  return (errors ?? []).map((e) => `${e.path}: ${e.message}`).join('; ');
}
