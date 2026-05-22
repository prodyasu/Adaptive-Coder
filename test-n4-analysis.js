/**
 * test-n4-analysis.js — reproducible N=4 result extraction + stats analysis.
 */

import {
  extractResultMatrix,
  analyzeN4Results,
  formatAnalysisMarkdown,
} from './n4-analysis.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function approx(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`FAIL: ${msg}: expected ${expected}, got ${actual}`);
  }
}

const fixture = `
# Results

### Pass@1 (first-attempt pass rate)

| Problem | raw_base | gen0_seed | gen18_evolved |
|----------|----------|-----------|---------------|
| binary-search | ✓ | ✓ | ✓ |
| climbing-stairs | ✓ | ✓ | ✓ |
| container-with-most-water | ✗ | ✗ | ✓ |
| coin-change-ii | ✗ | ✗ | ✓ |
| **pass@1** | **2/4** | **2/4** | **4/4** |

### Pass@N (any-attempt pass rate)

| Problem | raw_base | gen0_seed | gen18_evolved |
|----------|----------|-----------|---------------|
| binary-search | ✓ | ✓ | ✓ |
| climbing-stairs | ✓ | ✓ | ✓ |
| container-with-most-water | ✗ | ✓ | ✓ |
| coin-change-ii | ✗ | ✓ | ✓ |
| **pass@N** | **2/4** | **4/4** | **4/4** |
`;

const matrix = extractResultMatrix(fixture);
assert(matrix.pass1.raw_base.length === 4, 'extracts four pass@1 raw_base entries');
assert(matrix.pass1.raw_base.join(',') === '1,1,0,0', 'extracts raw_base pass@1 vector');
assert(matrix.pass1.gen18_evolved.join(',') === '1,1,1,1', 'extracts gen18 pass@1 vector');
assert(matrix.passN.gen0_seed.join(',') === '1,1,1,1', 'extracts gen0 pass@N vector');
assert(matrix.problems.join(',') === 'binary-search,climbing-stairs,container-with-most-water,coin-change-ii', 'preserves problem names');

const analysis = analyzeN4Results(fixture, { bootstrapIterations: 500, seed: 99 });
assert(analysis.metrics.pass1.runs.raw_base.successes === 2, 'analysis counts raw_base pass@1');
assert(analysis.metrics.pass1.runs.gen18_evolved.successes === 4, 'analysis counts gen18 pass@1');
approx(analysis.metrics.pass1.comparisons['gen0_seed→gen18_evolved'].paired.pValue, 0.25, 1e-12, 'paired p-value for pass@1 lift');
approx(analysis.metrics.passN.comparisons['gen0_seed→gen18_evolved'].paired.pValue, 1, 1e-12, 'paired p-value for no pass@N lift');

const markdown = formatAnalysisMarkdown(analysis);
assert(markdown.includes('raw_base: 2/4'), 'formatted markdown includes raw_base count');
assert(markdown.includes('gen18_evolved: 4/4'), 'formatted markdown includes gen18 count');
assert(markdown.includes('p = 0.2500'), 'formatted markdown includes exact p-value');

console.log('🎉 n4-analysis tests passed.');
