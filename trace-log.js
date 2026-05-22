import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

function sanitizeName(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/\.{2,}/g, '.') || 'unknown';
}

function compactText(value, maxChars) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const limit = Math.max(0, Number(maxChars) || 4000);
  const truncated = text.length > limit;
  return {
    snippet: truncated ? text.slice(0, limit) + '...' : text,
    rawLength: text.length,
    truncated,
  };
}

function compactTrace(trace = {}, maxChars) {
  const out = {};
  for (const [key, value] of Object.entries(trace)) {
    if (value === undefined) continue;
    out[key] = compactText(value, maxChars);
  }
  return out;
}

/**
 * Compact reasoningOs.trace sub-field only (raw model output), preserving
 * all other reasoningOs fields intact.
 */
function compactReasoningOsTrace(reasoningOs = {}, maxChars) {
  if (!reasoningOs.trace) return reasoningOs;
  return {
    ...reasoningOs,
    trace: compactTrace(reasoningOs.trace, maxChars),
  };
}

export function traceLogPath({ dir = 'run-logs', problemName, baselineKind }) {
  const problem = sanitizeName(problemName);
  const baseline = sanitizeName(baselineKind);
  return join(dir, `${problem}-${baseline}.jsonl`);
}

export function writeTraceLog({
  dir = 'run-logs',
  problemName,
  baselineKind,
  attempt,
  pass,
  stageFailed,
  errorDetail,
  failureKind,
  failureSubKind,
  failureCode,
  trace = {},
  reasoningOs,
  maxChars = 4000,
}) {
  mkdirSync(dir, { recursive: true });
  const path = traceLogPath({ dir, problemName, baselineKind });
  const row = {
    timestamp: new Date().toISOString(),
    problem: problemName,
    baseline: baselineKind,
    attempt,
    pass: Boolean(pass),
    stageFailed,
    errorDetail,
    failureKind,
    failureSubKind,
    failureCode,
    trace: compactTrace(trace, maxChars),
    reasoningOs: reasoningOs ? compactReasoningOsTrace(reasoningOs, maxChars) : undefined,
  };
  appendFileSync(path, JSON.stringify(row) + '\n');
  return path;
}
