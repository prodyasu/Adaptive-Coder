#!/usr/bin/env node
/**
 * test-eval-timeout-config.js — ensure eval model-stage timeouts are configurable.
 *
 * Regression: gen18/PGG shaper/coder/verifier calls hardcoded timeoutMs: 25_000,
 * so EVAL_TIMEOUT_MS only affected raw_base. That made timeout calibration runs
 * silently invalid.
 */

import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

console.log('\n=== test-eval-timeout-config.js ===\n');

const evalSource = readFileSync('eval.js', 'utf8');

console.log('Test 1: eval.js defines EVAL_TIMEOUT_MS override');
assert(evalSource.includes('process.env.EVAL_TIMEOUT_MS'), 'eval.js should read EVAL_TIMEOUT_MS');
assert(evalSource.includes('const TIMEOUT_MS'), 'eval.js should define TIMEOUT_MS');

console.log('Test 2: no model call hardcodes timeoutMs: 25_000');
const hardcodedModelTimeouts = [...evalSource.matchAll(/callOllama\([\s\S]*?timeoutMs:\s*25_000[\s\S]*?\)/g)];
assert(hardcodedModelTimeouts.length === 0, `callOllama should not use hardcoded timeoutMs: 25_000 (found ${hardcodedModelTimeouts.length})`);

console.log('Test 3: shaper/coder/verifier model calls use TIMEOUT_MS');
const timeoutMsUses = [...evalSource.matchAll(/timeoutMs:\s*TIMEOUT_MS/g)].length;
assert(timeoutMsUses >= 4, `expected at least 4 timeoutMs: TIMEOUT_MS uses (raw_base, shaper, coder, verifier); found ${timeoutMsUses}`);

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}\n`);

if (failed > 0) {
  console.error('FAILED');
  process.exit(1);
}

console.log('PASSED');
