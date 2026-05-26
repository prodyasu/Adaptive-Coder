/**
 * test-held-out-eval-integration.js — Test that eval.js runBasicTest
 * returns held-out discriminativity metrics when includeHeldOut=true
 * and omits them when includeHeldOut=false.
 */
import { runBasicTest } from './eval.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

const goodBinarySearch = `
from typing import List

def search(nums: List[int], target: int) -> int:
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = (left + right) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
`;

const brittleBinarySearch = `
from typing import List

def search(nums: List[int], target: int) -> int:
    if nums == [1,3,5,7] and target == 5: return 2
    if nums == [1,3,5,7] and target == 4: return -1
    if nums == [1] and target == 1: return 0
    return -1
`;

// Test 1: Good solution — all pass, cohAtrRisk = 0
console.log('Test 1: Good solution — zero COH_ATR risk...');
const good = runBasicTest('binary-search', goodBinarySearch);
assert(good.pass === true, 'good solution should pass');
assert(good.primaryPassRate === 1, `good primary pass rate should be 1, got ${good.primaryPassRate}`);
assert(good.heldOutPassRate === 1, `good held-out pass rate should be 1, got ${good.heldOutPassRate}`);
assert(good.cohAtrRisk === 0, `good cohAtrRisk should be 0, got ${good.cohAtrRisk}`);

// Test 2: Brittle solution — primary passes, held-out partial, positive cohAtrRisk
console.log('Test 2: Brittle solution — detects COH_ATR contamination...');
const brittle = runBasicTest('binary-search', brittleBinarySearch);
assert(brittle.pass === true, 'brittle solution should pass primary');
assert(brittle.primaryPassRate === 1, `brittle primary pass rate should be 1, got ${brittle.primaryPassRate}`);
assert(brittle.heldOutPassRate < 1, `brittle held-out pass rate should be < 1, got ${brittle.heldOutPassRate}`);
assert(brittle.cohAtrRisk > 0, `brittle cohAtrRisk should be > 0, got ${brittle.cohAtrRisk}`);
assert(Math.abs(brittle.cohAtrRisk - 0.5) < 0.01, `brittle cohAtrRisk should be ~0.5, got ${brittle.cohAtrRisk}`);

// Test 3: includeHeldOut=false — no held-out metrics
console.log('Test 3: includeHeldOut=false — no held-out metrics...');
const noHeldOut = runBasicTest('binary-search', goodBinarySearch, { includeHeldOut: false });
assert(noHeldOut.pass === true, 'should pass primary');
assert(noHeldOut.heldOutPassRate === undefined, 'heldOutPassRate should be undefined');
assert(noHeldOut.cohAtrRisk === undefined, 'cohAtrRisk should be undefined');

// Test 4: Wrong solution — both fail, cohAtrRisk = null (NaN)
console.log('Test 4: Wrong solution — both fail, cohAtrRisk = null...');
const wrong = runBasicTest('binary-search', 'def search(nums, target): return 42');
assert(wrong.pass === false, 'wrong solution should fail primary');
assert(wrong.primaryPassRate === 0, `wrong primary pass rate should be 0, got ${wrong.primaryPassRate}`);
assert(wrong.heldOutPassRate === 0, `wrong held-out pass rate should be 0, got ${wrong.heldOutPassRate}`);
assert(Number.isNaN(wrong.cohAtrRisk) || wrong.cohAtrRisk === null, `wrong cohAtrRisk should be NaN/null (both 0/0), got ${wrong.cohAtrRisk}`);

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}