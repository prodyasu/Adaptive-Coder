/**
 * test-result-schema.js — Phase 2B machine-readable result JSON schema tests.
 */

import {
  RESULT_SCHEMA_VERSION,
  buildResultArtifactFromMatrix,
  validateResultArtifact,
  formatValidationErrors,
} from './result-schema.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const matrix = {
  problems: ['binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii'],
  pass1: {
    raw_base: [1, 1, 0, 0],
    gen0_seed: [1, 1, 0, 0],
    gen18_evolved: [1, 1, 1, 1],
  },
  passN: {
    raw_base: [1, 1, 0, 0],
    gen0_seed: [1, 1, 1, 1],
    gen18_evolved: [1, 1, 1, 1],
  },
};

const artifact = buildResultArtifactFromMatrix(matrix, {
  runId: 'n4-heldout-2026-04-24',
  harnessVersion: '0.2.0',
  source: { type: 'markdown', path: 'N4-RESULTS.md' },
  generatedAt: '2026-05-21T00:00:00.000Z',
  notes: ['No new model evals; reconstructed from existing N4-RESULTS.md tables.'],
});

assert(RESULT_SCHEMA_VERSION === 'eval-result/v1', 'schema version is stable');
assert(artifact.schemaVersion === RESULT_SCHEMA_VERSION, 'artifact includes schema version');
assert(artifact.run.runId === 'n4-heldout-2026-04-24', 'run id preserved');
assert(artifact.problems.length === 4, 'artifact has one row per problem');
assert(artifact.pipelines.length === 3, 'artifact declares three pipelines');
assert(artifact.problems[2].results.gen18_evolved.passAt1 === true, 'problem-level gen18 pass@1 is boolean');
assert(artifact.problems[2].results.gen0_seed.passAtN === true, 'problem-level gen0 pass@N is boolean');
assert(artifact.metrics.pass1.runs.raw_base.successes === 2, 'aggregate pass@1 raw_base count');
assert(artifact.metrics.passN.runs.gen0_seed.successes === 4, 'aggregate pass@N gen0 count');
assert(artifact.metrics.pass1.comparisons['gen0_seed→gen18_evolved'].paired.pValue === 0.25, 'paired p-value included');
assert(artifact.methodology.statistics.includes('clopper-pearson'), 'methodology documents exact CI method');

const validation = validateResultArtifact(artifact);
assert(validation.valid === true, `valid artifact passes validation: ${formatValidationErrors(validation.errors)}`);

const invalid = structuredClone(artifact);
delete invalid.problems[0].results.raw_base.passAt1;
const invalidValidation = validateResultArtifact(invalid);
assert(invalidValidation.valid === false, 'missing required problem metric fails validation');
assert(formatValidationErrors(invalidValidation.errors).includes('passAt1'), 'validation errors identify missing passAt1');

console.log('🎉 result-schema tests passed.');
