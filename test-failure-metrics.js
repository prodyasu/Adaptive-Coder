/**
 * test-failure-metrics.js — failure-kind classifier and summary tests.
 *
 * Keeps pass@1 interpretation honest by separating protocol/model noise from
 * actual solution assertion failures.
 */

import {
  classifyFailureKind,
  summarizeFailureKinds,
  formatFailureKindSummary,
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

console.log('\n🎉 failure-metrics tests passed.');
