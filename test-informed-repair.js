/**
 * test-informed-repair.js — Tests for Delta 4: Feedback-aware autorepair
 *
 * Tests for extractTestFailure() and buildInformedRepairFeedback()
 * which parse concrete test failures and build targeted coder retry prompts.
 */

import { extractTestFailure, buildInformedRepairFeedback, INFORMED_REPAIR_MODES } from './informed-repair.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${message} — expected "${expected}", got "${actual}"`);
  }
}

function assertIncludes(haystack, needle, message) {
  if (haystack.includes(needle)) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${message} — expected to include "${needle}" in "${haystack.slice(0, 200)}"`);
  }
}

function assertNotIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${message} — expected NOT to include "${needle}"`);
  }
}

// ── extractTestFailure ──
console.log('\n=== extractTestFailure ===\n');

// 1. AssertionError
const assertOutput = `from binary_search import search as f
Traceback (most recent call last):
  File "<string>", line 1, in <module>
AssertionError
>>> assert f([1,3,5,7], 5) == 2`;

const assertResult = extractTestFailure(assertOutput, 'binary-search');
assert(assertResult !== null, 'assertOutput should parse');
assertEqual(assertResult.errorType, 'AssertionError', 'assertOutput errorType');
assert(assertResult.testLine.includes('assert') || assertResult.testLine.includes('from'), 'assertOutput should find test line');

// 2. TypeError
const typeOutput = `TypeError: 'NoneType' object is not subscriptable
Traceback (most recent call last):
  File "<string>", line 1
    from two_sum import twoSum as f; r = f([2,7,11,15], 9)`;

const typeResult = extractTestFailure(typeOutput, 'two-sum');
assert(typeResult !== null, 'typeOutput should parse');
assertEqual(typeResult.errorType, 'TypeError', 'typeOutput errorType');
assertIncludes(typeResult.errorMsg, 'NoneType', 'typeOutput errorMsg');

// 3. Timeout
const timeoutOutput = `TimeoutError: solution timed out after 5000ms`;
const timeoutResult = extractTestFailure(timeoutOutput, 'climbing-stairs');
assert(timeoutResult !== null, 'timeoutOutput should parse');
assertEqual(timeoutResult.errorType, 'TimeoutError', 'timeoutOutput errorType');
assertIncludes(timeoutResult.errorMsg, 'timed out', 'timeoutOutput errorMsg');

// 4. ImportError
const importOutput = `ImportError: cannot import name 'climbStairs' from 'climbing_stairs'`;
const importResult = extractTestFailure(importOutput, 'climbing-stairs');
assert(importResult !== null, 'importOutput should parse');
assertEqual(importResult.errorType, 'ImportError', 'importOutput errorType');

// 5. Null/empty input
assertEqual(extractTestFailure(null, 'test'), null, 'null should return null');
assertEqual(extractTestFailure('', 'test'), null, 'empty string should return null');
assertEqual(extractTestFailure(123, 'test'), null, 'non-string should return null');

// 6. Unrecognized error (no known pattern)
const unknownOutput = `Something went wrong but not a Python error`;
const unknownResult = extractTestFailure(unknownOutput, 'test');
assertEqual(unknownResult, null, 'unknown error returns null');

// ── buildInformedRepairFeedback ──
console.log('\n=== buildInformedRepairFeedback ===\n');

// 7. VERIFIER mode (backward compat)
const verifierFeedback = buildInformedRepairFeedback(
  'binary-search', 'def search(): pass',
  'error output', INFORMED_REPAIR_MODES.VERIFIER,
  { verifierFeedback: 'The solution does not handle edge cases properly.' }
);
assertIncludes(verifierFeedback, 'does not handle edge cases', 'VERIFIER mode should pass through verifier feedback');
assertNotIncludes(verifierFeedback, 'previous attempt failed a test', 'VERIFIER mode should NOT add test failure info');

// 8. TEST_FAILURE mode with AssertionError
const testFailureOutput = `AssertionError
>>> assert f([1,3,5,7], 5) == 2
Traceback: ...`;

const tfFeedback = buildInformedRepairFeedback(
  'binary-search', 'def search(): pass',
  testFailureOutput, INFORMED_REPAIR_MODES.TEST_FAILURE,
  { verifierFeedback: 'vague suggestion' }
);
assertIncludes(tfFeedback, 'Previous attempt failed a test case', 'TEST_FAILURE should mention test case failure');
assertIncludes(tfFeedback, 'AssertionError', 'TEST_FAILURE should include error type');

// 9. TEST_FAILURE mode with timeout
const timeoutFeedback = buildInformedRepairFeedback(
  'climbing-stairs', 'def climb(): ...',
  'TimeoutError: timed out', INFORMED_REPAIR_MODES.TEST_FAILURE,
  {}
);
assertIncludes(timeoutFeedback, 'timed out', 'TEST_FAILURE timeout should mention timeout');
assertIncludes(timeoutFeedback, 'Optimize', 'TEST_FAILURE timeout should suggest optimization');

// 10. SPEC_AND_TEST mode with both signals
const specTestFeedback = buildInformedRepairFeedback(
  'two-sum', 'def two_sum(): pass',
  'TypeError: NoneType object is not subscriptable',
  INFORMED_REPAIR_MODES.SPEC_AND_TEST,
  { verifierFeedback: 'vague', specGuidance: 'Expected signature: def twoSum(nums: List[int], target: int)' }
);
assertIncludes(specTestFeedback, 'Signature mismatch', 'SPEC_AND_TEST should include spec guidance');
assertIncludes(specTestFeedback, 'TypeError', 'SPEC_AND_TEST should include error type');
assertIncludes(specTestFeedback, 'Fix the error', 'SPEC_AND_TEST should prompt to fix');

// 11. SPEC_AND_TEST without spec guidance (only test failure)
const noSpecFeedback = buildInformedRepairFeedback(
  'valid-palindrome', 'def isPalindrome(): pass',
  'AssertionError: False != True',
  INFORMED_REPAIR_MODES.SPEC_AND_TEST,
  { verifierFeedback: 'vague', specGuidance: null }
);
assertNotIncludes(noSpecFeedback, 'Signature mismatch', 'no spec guidance should skip signature mismatch');
assertIncludes(noSpecFeedback, 'Previous attempt failed', 'should still include test failure');

// 12. TEST_FAILURE with unparseable output falls back to raw
const fallbackFeedback = buildInformedRepairFeedback(
  'test-problem', 'def test(): pass',
  'Some random output without a Python error', INFORMED_REPAIR_MODES.TEST_FAILURE,
  {}
);
assertIncludes(fallbackFeedback, 'Previous attempt failed', 'should have fallback message');
assertIncludes(fallbackFeedback, 'Some random output', 'should include raw output');

// 13. VERIFIER mode with no verifier feedback
const noVFeedback = buildInformedRepairFeedback(
  'test', 'code', 'output', INFORMED_REPAIR_MODES.VERIFIER, {}
);
assertIncludes(noVFeedback, 'Try again', 'VERIFIER mode with no feedback should have fallback');

// ── INFORMED_REPAIR_MODES constants ──
console.log('\n=== INFORMED_REPAIR_MODES constants ===\n');

assertEqual(INFORMED_REPAIR_MODES.VERIFIER, 'verifier', 'VERIFIER constant');
assertEqual(INFORMED_REPAIR_MODES.TEST_FAILURE, 'test_failure', 'TEST_FAILURE constant');
assertEqual(INFORMED_REPAIR_MODES.SPEC_AND_TEST, 'spec_and_test', 'SPEC_AND_TEST constant');

// ── Integration: feedback flows into coder prompt format ──
console.log('\n=== Integration test: feedback in prompt ===\n');

// 14. Verify feedback is suitable for coder prompt injection
const integrationFeedback = buildInformedRepairFeedback(
  'coin-change-ii', 'def change(amount, coins): pass',
  `AssertionError: 4 != 3
  from coin_change_ii import change as f; assert f(5, [1,2,5]) == 4`,
  INFORMED_REPAIR_MODES.SPEC_AND_TEST,
  { specGuidance: 'Expected signature: def change(amount: int, coins: List[int]) -> int' }
);
assert(integrationFeedback.length > 20, 'integration feedback should be substantive');
assert(integrationFeedback.length < 800, 'integration feedback should be concise (<800 chars)');
assertIncludes(integrationFeedback, 'Signature mismatch', 'integration includes spec');
assertIncludes(integrationFeedback, 'Previous attempt', 'integration includes test failure');

// ── Summary ──
console.log(`\n${'='.repeat(50)}`);
console.log(`Informed-repair tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}