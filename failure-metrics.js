/**
 * failure-metrics.js — classify eval attempts into coarse and hierarchical failure causes.
 *
 * Goal: avoid treating pass@1 misses as a single bucket. Protocol/format noise,
 * timeouts, model errors, spec validation misses, and real assertion failures
 * imply different next actions. Phase 2A keeps the stable five parent kinds while
 * adding sub-kind codes such as `format_protocol.missing_json` for diagnostics.
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

export const FAILURE_SUBKIND_LABELS = {
  pass: 'pass',
  'logic_assertion.assertion_failed': 'logic assertion failed',
  'logic_assertion.wrong_answer': 'wrong answer',
  'logic_assertion.boundary_condition': 'boundary condition',
  'logic_assertion.autorepair_exhausted': 'autorepair exhausted',
  'format_protocol.missing_json': 'missing JSON',
  'format_protocol.invalid_json': 'invalid JSON',
  'format_protocol.missing_code': 'missing code',
  'format_protocol.syntax_error': 'syntax error',
  'format_protocol.missing_function': 'missing function/class',
  'format_protocol.missing_test_suite': 'missing test suite',
  'format_protocol.unparsable': 'unparsable output',
  'timeout.execution_timeout': 'execution timeout',
  'timeout.rate_limit': 'rate limit',
  'spec_validation.signature_mismatch': 'signature mismatch',
  'spec_validation.parameter_order': 'parameter order',
  'spec_validation.arity_mismatch': 'arity mismatch',
  'spec_validation.name_mismatch': 'name mismatch',
  'model_error.provider_error': 'provider/model error',
  'model_error.http_error': 'HTTP error',
  'model_error.network_error': 'network error',
};

function normalizedText(attempt = {}) {
  return [
    attempt.error,
    attempt.stageFailed,
    attempt.errorDetail,
    attempt.detail,
    attempt.failureKind,
    attempt.failureSubKind,
    attempt.failureCode,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isKnownParentKind(kind) {
  return kind === 'pass' || FAILURE_KIND_ORDER.includes(kind);
}

function parentKindFrom(value) {
  if (!value || value === 'unknown') return null;
  const parent = String(value).split('.')[0];
  return isKnownParentKind(parent) ? parent : null;
}

function subKindFromCode(code, parentKind) {
  if (!code || code === 'unknown') return null;
  const text = String(code);
  if (text.includes('.')) {
    const [parent, subKind] = text.split('.', 2);
    if (parent === parentKind && subKind) return subKind;
  }
  return text;
}

export function classifyFailureKind(attempt = {}) {
  const explicitParent = parentKindFrom(attempt.failureKind) || parentKindFrom(attempt.failureCode);
  if (explicitParent && explicitParent !== 'pass') return explicitParent;
  if (attempt.pass || explicitParent === 'pass') return 'pass';

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

function inferFailureSubKind(attempt, parentKind) {
  const explicit = subKindFromCode(attempt.failureCode, parentKind)
    || subKindFromCode(attempt.failureKind, parentKind)
    || subKindFromCode(attempt.failureSubKind, parentKind);
  if (explicit && explicit !== 'unknown' && explicit !== parentKind) return explicit;

  const text = normalizedText(attempt);
  const stage = String(attempt.stageFailed || '').toLowerCase();
  const error = String(attempt.error || '').toLowerCase();

  if (parentKind === 'pass') return 'pass';

  if (parentKind === 'timeout') {
    if (error === 'rate_limit' || stage === 'rate_limit' || /rate.?limit/.test(text)) return 'rate_limit';
    return 'execution_timeout';
  }

  if (parentKind === 'model_error') {
    if (/http \d{3}|\b[45]\d\d\b/.test(text)) return 'http_error';
    if (/network error|fetch failed|connection|econnreset|enotfound|timeout while connecting/.test(text)) return 'network_error';
    return 'provider_error';
  }

  if (parentKind === 'spec_validation') {
    if (/param order|parameter order|argument order/.test(text)) return 'parameter_order';
    if (/arity mismatch|wrong arity|argument count|parameter count/.test(text)) return 'arity_mismatch';
    if (/name mismatch|wrong name|function name|class name/.test(text)) return 'name_mismatch';
    return 'signature_mismatch';
  }

  if (parentKind === 'format_protocol') {
    if (/no json|missing json|produced no json/.test(text)) return 'missing_json';
    if (/invalid json|json parse|parse failed|bad json/.test(text)) return 'invalid_json';
    if (/syntaxerror|syntax error|compile error/.test(text)) return 'syntax_error';
    if (/no code|missing code|empty response/.test(text)) return 'missing_code';
    if (/no function|missing function|no class|missing class/.test(text)) return 'missing_function';
    if (/no test suite|missing test suite/.test(text)) return 'missing_test_suite';
    return 'unparsable';
  }

  if (parentKind === 'logic_assertion') {
    if (stage === 'autorepair_exhausted' || /autorepair exhausted/.test(text)) return 'autorepair_exhausted';
    if (/boundary|edge case|empty input|zero|off.?by.?one/.test(text)) return 'boundary_condition';
    if (/wrong answer|expected|actual|test failed|basic test/.test(text)) return 'wrong_answer';
    return 'assertion_failed';
  }

  return 'unknown';
}

export function classifyFailureDetail(attempt = {}) {
  const kind = classifyFailureKind(attempt);
  if (kind === 'pass') {
    return {
      kind: 'pass',
      subKind: 'pass',
      code: 'pass',
      label: FAILURE_KIND_LABELS.pass,
      subKindLabel: FAILURE_SUBKIND_LABELS.pass,
    };
  }

  const subKind = inferFailureSubKind(attempt, kind);
  const code = `${kind}.${subKind}`;
  return {
    kind,
    subKind,
    code,
    label: FAILURE_KIND_LABELS[kind] || kind,
    subKindLabel: FAILURE_SUBKIND_LABELS[code] || subKind,
  };
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

export function summarizeFailureTaxonomy(attempts = []) {
  const summary = {
    totalAttempts: 0,
    pass: 0,
    kinds: emptyFailureSummary(),
    subKinds: {},
  };
  delete summary.kinds.totalAttempts;

  for (const attempt of attempts) {
    summary.totalAttempts += 1;
    const detail = classifyFailureDetail(attempt);
    if (detail.kind === 'pass') {
      summary.pass += 1;
      summary.kinds.pass += 1;
      continue;
    }
    if (Object.hasOwn(summary.kinds, detail.kind)) {
      summary.kinds[detail.kind] += 1;
    } else {
      summary.kinds.format_protocol += 1;
    }
    summary.subKinds[detail.code] = (summary.subKinds[detail.code] || 0) + 1;
  }

  return summary;
}

export function collectAttemptsFromProblems(problems = {}) {
  return Object.values(problems).flatMap(problem => Array.isArray(problem?.attempts) ? problem.attempts : []);
}

export function summarizeStateFailureKinds(state = {}) {
  return summarizeFailureKinds(collectAttemptsFromProblems(state.problems || {}));
}

export function summarizeStateFailureTaxonomy(state = {}) {
  return summarizeFailureTaxonomy(collectAttemptsFromProblems(state.problems || {}));
}

export function formatFailureKindSummary(summary = emptyFailureSummary()) {
  const parts = FAILURE_KIND_ORDER.map(kind => `${FAILURE_KIND_LABELS[kind]}=${summary[kind] || 0}`);
  if (summary.pass) parts.unshift(`${FAILURE_KIND_LABELS.pass}=${summary.pass}`);
  return parts.join(', ');
}

export function formatFailureTaxonomySummary(summary = summarizeFailureTaxonomy()) {
  const kindSummary = {
    pass: summary.pass || summary.kinds?.pass || 0,
    ...summary.kinds,
  };
  const parentParts = FAILURE_KIND_ORDER
    .filter(kind => kindSummary[kind])
    .map(kind => `${FAILURE_KIND_LABELS[kind]}=${kindSummary[kind] || 0}`);
  if (kindSummary.pass) parentParts.unshift(`${FAILURE_KIND_LABELS.pass}=${kindSummary.pass}`);

  const subKindParts = Object.entries(summary.subKinds || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, count]) => `${code}=${count}`);

  if (subKindParts.length === 0) return parentParts.join(', ');
  return `${parentParts.join(', ')} (${subKindParts.join(', ')})`;
}
