/**
 * failure-metrics.js — classify eval attempts into coarse failure causes.
 *
 * Goal: avoid treating pass@1 misses as a single bucket. Protocol/format noise,
 * timeouts, model errors, spec validation misses, and real assertion failures
 * imply different next actions.
 */

export const FAILURE_KIND_ORDER = [
  'logic_assertion',
  'format_protocol',
  'timeout',
  'spec_validation',
  'model_error',
];

export const FAILURE_KIND_LABELS = {
  pass: 'pass',
  logic_assertion: 'logic/assertion',
  format_protocol: 'format/protocol',
  timeout: 'timeout',
  spec_validation: 'spec_validation',
  model_error: 'model_error',
};

function normalizedText(attempt = {}) {
  return [
    attempt.error,
    attempt.stageFailed,
    attempt.errorDetail,
    attempt.detail,
    attempt.failureKind,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function classifyFailureKind(attempt = {}) {
  if (attempt.failureKind && attempt.failureKind !== 'unknown') return attempt.failureKind;
  if (attempt.pass) return 'pass';

  const text = normalizedText(attempt);
  const stage = String(attempt.stageFailed || '').toLowerCase();
  const error = String(attempt.error || '').toLowerCase();

  if (
    error === 'timeout' ||
    error === 'rate_limit' ||
    stage === 'timeout' ||
    stage === 'rate_limit' ||
    /\btimeout\b|\btimed out\b|\brate.?limit\b|\b\d{4,}ms limit\b/.test(text)
  ) {
    return 'timeout';
  }

  if (
    error === 'model_error' ||
    stage === 'model_error' ||
    /model_error|ollama.*error|network error|http \d{3}|fetch failed|connection/.test(text)
  ) {
    return 'model_error';
  }

  if (stage === 'spec_validation' || /spec validation|signature|param order|arity mismatch|name mismatch/.test(text)) {
    return 'spec_validation';
  }

  if (
    /assertion failed|assertionerror|wrong answer|expected|test failed|basic test/.test(text) ||
    stage === 'autorepair_exhausted'
  ) {
    return 'logic_assertion';
  }

  if (
    ['shaper_error', 'coder_error', 'verifier_error'].includes(stage) ||
    /no json|json parse|parse failed|no code|empty response|compile error|syntaxerror|no function|no class|no test suite|unparsable|invalid json/.test(text)
  ) {
    return 'format_protocol';
  }

  return 'logic_assertion';
}

export function emptyFailureSummary() {
  return {
    totalAttempts: 0,
    pass: 0,
    logic_assertion: 0,
    format_protocol: 0,
    timeout: 0,
    spec_validation: 0,
    model_error: 0,
  };
}

export function summarizeFailureKinds(attempts = []) {
  const summary = emptyFailureSummary();
  for (const attempt of attempts) {
    summary.totalAttempts += 1;
    const kind = classifyFailureKind(attempt);
    if (Object.hasOwn(summary, kind)) {
      summary[kind] += 1;
    } else {
      summary.format_protocol += 1;
    }
  }
  return summary;
}

export function collectAttemptsFromProblems(problems = {}) {
  return Object.values(problems).flatMap(problem => Array.isArray(problem?.attempts) ? problem.attempts : []);
}

export function summarizeStateFailureKinds(state = {}) {
  return summarizeFailureKinds(collectAttemptsFromProblems(state.problems || {}));
}

export function formatFailureKindSummary(summary = emptyFailureSummary()) {
  const parts = FAILURE_KIND_ORDER.map(kind => `${FAILURE_KIND_LABELS[kind]}=${summary[kind] || 0}`);
  if (summary.pass) parts.unshift(`${FAILURE_KIND_LABELS.pass}=${summary.pass}`);
  return parts.join(', ');
}
