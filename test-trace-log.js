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

assert(first === second, 'same sanitized file path expected');
assert(!first.includes('..') && !first.includes('/gen18'), 'path must be sanitized');

const lines = readFileSync(first, 'utf8').trim().split('\n').map(JSON.parse);
assert(lines.length === 2, 'append should create two jsonl rows');
assert(lines[0].trace.shaperRaw.rawLength === 250, 'rawLength preserved');
assert(lines[0].trace.shaperRaw.snippet.length <= 43, 'snippet truncated with ellipsis');
assert(lines[0].trace.shaperRaw.truncated === true, 'truncated flag set');
assert(lines[0].trace.code.snippet.includes('def change'), 'code snippet recorded');
assert(lines[0].failureKind === 'format_protocol', 'failureKind is recorded');
assert(lines[0].failureSubKind === 'missing_json', 'failureSubKind is recorded');
assert(lines[0].failureCode === 'format_protocol.missing_json', 'failureCode is recorded');
assert(lines[1].pass === true, 'second line preserves pass=true');

console.log('🎉 trace-log tests passed.');
