/**
 * test-failure-metrics.js — failure-kind classifier and summary tests.
 *
 * Keeps pass@1 interpretation honest by separating protocol/model noise from
 * actual solution assertion failures.
 */

import {
  classifyFailureKind,
  classifyFailureDetail,
  summarizeFailureKinds,
  summarizeFailureTaxonomy,
  formatFailureKindSummary,
  formatFailureTaxonomySummary,
} from './failure-metrics.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const cases = [
  [{ pass: true }, 'pass'],
  [{ pass: false, error: 'timeout' }, 'timeout'],
  [{ pass: false, stageFailed: 'rate_limit' }, 'timeout'],
  [{ pass: false, error: 'model_error', errorDetail: 'HTTP 500' }, 'model_error'],
  [{ pass: false, stageFailed: 'spec_validation', errorDetail: 'param order mismatch' }, 'spec_validation'],
  [{ pass: false, stageFailed: 'shaper_error', errorDetail: 'shaper produced no JSON' }, 'format_protocol'],
  [{ pass: false, stageFailed: 'coder_error', errorDetail: 'coder produced no code' }, 'format_protocol'],
  [{ pass: false, stageFailed: 'verifier_error', errorDetail: 'verifier failed: bad JSON' }, 'format_protocol'],
  [{ pass: false, errorDetail: 'assertion failed' }, 'logic_assertion'],
  [{ pass: false, stageFailed: 'autorepair_exhausted', errorDetail: 'autorepair exhausted' }, 'logic_assertion'],
];

for (const [attempt, expected] of cases) {
  const actual = classifyFailureKind(attempt);
  assert(actual === expected, `${JSON.stringify(attempt)} classified as ${actual}, expected ${expected}`);
}
console.log('✅ classifyFailureKind covers pass/timeout/model/spec/protocol/logic cases');

const detailCases = [
  [
    { pass: false, stageFailed: 'shaper_error', errorDetail: 'shaper produced no JSON object' },
    { kind: 'format_protocol', subKind: 'missing_json', code: 'format_protocol.missing_json' },
  ],
  [
    { pass: false, stageFailed: 'coder_error', errorDetail: 'SyntaxError: invalid syntax on line 3' },
    { kind: 'format_protocol', subKind: 'syntax_error', code: 'format_protocol.syntax_error' },
  ],
  [
    { pass: false, stageFailed: 'spec_validation', errorDetail: 'param order mismatch: expected (amount, coins)' },
    { kind: 'spec_validation', subKind: 'parameter_order', code: 'spec_validation.parameter_order' },
  ],
  [
    { pass: false, errorDetail: 'AssertionError: expected 0 for empty input boundary case' },
    { kind: 'logic_assertion', subKind: 'boundary_condition', code: 'logic_assertion.boundary_condition' },
  ],
  [
    { pass: false, stageFailed: 'rate_limit', errorDetail: 'provider returned rate limit' },
    { kind: 'timeout', subKind: 'rate_limit', code: 'timeout.rate_limit' },
  ],
  [
    { pass: false, error: 'model_error', errorDetail: 'HTTP 500 from Ollama provider' },
    { kind: 'model_error', subKind: 'http_error', code: 'model_error.http_error' },
  ],
];

for (const [attempt, expected] of detailCases) {
  const actual = classifyFailureDetail(attempt);
  assert(actual.kind === expected.kind, `${expected.code} kind: got ${actual.kind}`);
  assert(actual.subKind === expected.subKind, `${expected.code} subKind: got ${actual.subKind}`);
  assert(actual.code === expected.code, `${JSON.stringify(attempt)} code ${actual.code}, expected ${expected.code}`);
}
console.log('✅ classifyFailureDetail assigns hierarchical failure sub-kinds');

const summary = summarizeFailureKinds([
  { pass: false, errorDetail: 'assertion failed' },
  { pass: false, stageFailed: 'shaper_error', errorDetail: 'shaper produced no JSON' },
  { pass: false, error: 'timeout' },
  { pass: false, stageFailed: 'spec_validation' },
  { pass: false, error: 'model_error' },
  { pass: true },
]);

assert(summary.totalAttempts === 6, 'summary counts total attempts');
assert(summary.pass === 1, 'summary counts pass attempts');
assert(summary.logic_assertion === 1, 'summary counts logic/assertion failures');
assert(summary.format_protocol === 1, 'summary counts format/protocol failures');
assert(summary.timeout === 1, 'summary counts timeout failures');
assert(summary.spec_validation === 1, 'summary counts spec validation failures');
assert(summary.model_error === 1, 'summary counts model errors');
console.log('✅ summarizeFailureKinds counts failures without dropping passes');

const rendered = formatFailureKindSummary(summary);
assert(rendered.includes('logic/assertion=1'), 'render includes logic/assertion label');
assert(rendered.includes('format/protocol=1'), 'render includes format/protocol label');
assert(rendered.includes('timeout=1'), 'render includes timeout label');
assert(rendered.includes('spec_validation=1'), 'render includes spec_validation label');
assert(rendered.includes('model_error=1'), 'render includes model_error label');
console.log('✅ formatFailureKindSummary renders stable labels');

const taxonomySummary = summarizeFailureTaxonomy(detailCases.map(([attempt]) => attempt));
assert(taxonomySummary.totalAttempts === detailCases.length, 'taxonomy summary counts total attempts');
assert(taxonomySummary.kinds.format_protocol === 2, 'taxonomy summary counts parent kind totals');
assert(taxonomySummary.subKinds['format_protocol.missing_json'] === 1, 'taxonomy summary counts missing_json sub-kind');
assert(taxonomySummary.subKinds['format_protocol.syntax_error'] === 1, 'taxonomy summary counts syntax_error sub-kind');
assert(taxonomySummary.subKinds['logic_assertion.boundary_condition'] === 1, 'taxonomy summary counts boundary_condition sub-kind');
const taxonomyRendered = formatFailureTaxonomySummary(taxonomySummary);
assert(taxonomyRendered.includes('format/protocol=2'), 'taxonomy render includes parent kind total');
assert(taxonomyRendered.includes('format_protocol.missing_json=1'), 'taxonomy render includes sub-kind code');
assert(taxonomyRendered.includes('logic_assertion.boundary_condition=1'), 'taxonomy render includes logic sub-kind code');
console.log('✅ summarizeFailureTaxonomy preserves parent totals and sub-kind detail');

console.log('\n🎉 failure-metrics tests passed.');
