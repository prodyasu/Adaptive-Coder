/**
 * test-trace-log.js — regression tests for structured eval trace logging.
 */

import { mkdirSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeTraceLog } from './trace-log.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const dir = mkdtempSync(join(tmpdir(), 'trace-log-test-'));
mkdirSync(dir, { recursive: true });

const first = writeTraceLog({
  dir,
  problemName: '../coin/change ii',
  baselineKind: 'gen18/evolved',
  attempt: 0,
  pass: false,
  stageFailed: 'shaper_error',
  errorDetail: 'shaper produced no JSON',
  failureKind: 'format_protocol',
  failureSubKind: 'missing_json',
  failureCode: 'format_protocol.missing_json',
  trace: {
    shaperRaw: 'x'.repeat(250),
    code: 'def change(amount, coins):\n    return 0',
  },
  maxChars: 40,
});

const second = writeTraceLog({
  dir,
  problemName: '../coin/change ii',
  baselineKind: 'gen18/evolved',
  attempt: 1,
  pass: true,
  trace: { verifierRaw: '{"pass": true}' },
  maxChars: 40,
});

// Test reasoningOs metadata preservation (Task 6)
// Uses same problem/baseline to share the same file path with prior rows
const third = writeTraceLog({
  dir,
  problemName: '../coin/change ii',
  baselineKind: 'gen18/evolved',
  attempt: 2,
  pass: false,
  failureKind: 'format_protocol',
  reasoningOs: {
    route: { mode: 'code_generation', reasoningStyle: 'spec_first' },
    criteriaVector: { correctness: 1, interfaceContract: 0, failureCriterion: 'interfaceContract' },
    updateTarget: { criterion: 'interfaceContract', component: 'signature_contract', actionable: true },
    deltaId: 'delta-test',
  },
  maxChars: 40,
});

// Test reasoningOs.trace raw output is also bounded when present
// Uses same problem/baseline to share the same file path
const fourth = writeTraceLog({
  dir,
  problemName: '../coin/change ii',
  baselineKind: 'gen18/evolved',
  attempt: 3,
  pass: false,
  failureKind: 'format_protocol',
  reasoningOs: {
    route: { mode: 'code_generation', reasoningStyle: 'spec_first' },
    criteriaVector: { correctness: 1, interfaceContract: 0, failureCriterion: 'interfaceContract' },
    // This trace sub-field contains raw model output that must be bounded
    trace: {
      modelRaw: 'x'.repeat(200),
      verifierRaw: 'y'.repeat(100),
    },
  },
  maxChars: 50,
});

assert(first === second, 'same sanitized file path expected');
assert(!first.includes('..') && !first.includes('/gen18'), 'path must be sanitized');

// All 4 rows appended to the same file (same problem+baseline)
const lines = readFileSync(first, 'utf8').trim().split('\n').map(JSON.parse);
assert(lines.length === 4, 'four rows appended to same file');
assert(lines[0].trace.shaperRaw.rawLength === 250, 'rawLength preserved');
assert(lines[0].trace.shaperRaw.snippet.length <= 43, 'snippet truncated with ellipsis');
assert(lines[0].trace.shaperRaw.truncated === true, 'truncated flag set');
assert(lines[0].trace.code.snippet.includes('def change'), 'code snippet recorded');
assert(lines[0].failureKind === 'format_protocol', 'failureKind is recorded');
assert(lines[0].failureSubKind === 'missing_json', 'failureSubKind is recorded');
assert(lines[0].failureCode === 'format_protocol.missing_json', 'failureCode is recorded');
assert(lines[1].pass === true, 'second line preserves pass=true');
assert(lines[2].reasoningOs, 'third line has reasoningOs');
assert(lines[2].reasoningOs.route.mode === 'code_generation', 'reasoningOs.route.mode preserved');
assert(lines[2].reasoningOs.criteriaVector.failureCriterion === 'interfaceContract', 'reasoningOs.criteriaVector preserved');
assert(lines[2].reasoningOs.updateTarget.component === 'signature_contract', 'reasoningOs.updateTarget preserved');
assert(lines[2].reasoningOs.deltaId === 'delta-test', 'reasoningOs.deltaId preserved');
// Fourth line: reasoningOs.trace sub-field also bounded
assert(lines[3].reasoningOs.trace.modelRaw.truncated === true, 'reasoningOs.trace.modelRaw bounded');
assert(lines[3].reasoningOs.trace.modelRaw.rawLength === 200, 'reasoningOs.trace.modelRaw rawLength preserved');
assert(lines[3].reasoningOs.trace.modelRaw.snippet.length <= 53, 'reasoningOs.trace.modelRaw snippet truncated');
assert(lines[3].reasoningOs.trace.verifierRaw.truncated === true, 'reasoningOs.trace.verifierRaw bounded');
// Non-trace reasoningOs fields still intact alongside bounded trace
assert(lines[3].reasoningOs.route.reasoningStyle === 'spec_first', 'reasoningOs.route preserved alongside bounded trace');

console.log('🎉 trace-log tests passed.');
