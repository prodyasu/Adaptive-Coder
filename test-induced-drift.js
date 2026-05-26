/**
 * test-induced-drift.js — Tests for deterministic sig-repair capability testing
 *
 * Verifies that:
 * 1. Drift names are defined for all N=8 problems
 * 2. applyDrift correctly remaps function names
 * 3. Drift names are non-idiomatic (different from reference names)
 * 4. isDriftEnabled checks opts correctly
 * 5. Drift + sig-repair produces deterministic capability test results
 */
import { DRIFT_NAME_MAP, getDriftName, applyDrift, isDriftEnabled } from './induced-drift.js';
import { repairSignatureName } from './sig-repair.js';

const PROBLEMS = [
  'binary-search', 'climbing-stairs', 'container-with-most-water', 'coin-change-ii',
  'two-sum', 'valid-palindrome', 'number-of-islands', 'invert-binary-tree',
];

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

// Test 1: Drift names for all N=8 problems
console.log('Test 1: All N=8 problems have drift names...');
for (const problem of PROBLEMS) {
  assert(getDriftName(problem) !== null, `${problem} should have a drift name`);
  assert(typeof getDriftName(problem) === 'string', `${problem} drift name should be a string`);
}

// Test 2: Drift names differ from expected reference names
console.log('Test 2: Drift names differ from reference names...');
const REFERENCE_NAMES = {
  'binary-search': 'search',
  'climbing-stairs': 'climb',
  'container-with-most-water': 'maxArea',
  'coin-change-ii': 'change',
  'two-sum': 'twoSum',
  'valid-palindrome': 'isPalindrome',
  'number-of-islands': 'numIslands',
  'invert-binary-tree': 'invertTree',
};
for (const problem of PROBLEMS) {
  const drift = getDriftName(problem);
  const ref = REFERENCE_NAMES[problem];
  assert(drift !== ref, `${problem}: drift "${drift}" should differ from reference "${ref}"`);
}

// Test 3: applyDrift remaps function name
console.log('Test 3: applyDrift remaps function name...');
const sig = { name: 'search', params: ['nums', 'target'], returnType: 'number' };
const drifted = applyDrift(sig, 'binary-search');
assert(drifted.name === 'compute_result', `drift name should be compute_result, got ${drifted.name}`);
assert(drifted.originalName === 'search', `originalName should be search, got ${drifted.originalName}`);
assert(drifted.driftApplied === true, `driftApplied should be true`);
assert(drifted.params.length === 2, `params should be preserved`);
assert(drifted.returnType === 'number', `returnType should be preserved`);

// Test 4: applyDrift returns null signature unchanged
console.log('Test 4: applyDrift handles null gracefully...');
assert(applyDrift(null, 'binary-search') === null, 'null signature should return null');

// Test 5: applyDrft for unknown problem returns original
console.log('Test 5: applyDrift returns original for unknown problem...');
const unknownSig = { name: 'foo', params: [], returnType: 'void' };
const unknownDrifted = applyDrift(unknownSig, 'unknown-problem');
assert(unknownDrifted.name === 'foo', `unknown problem should keep original name`);
assert(unknownDrifted.driftApplied === undefined, `unknown problem should not have driftApplied`);

// Test 6: isDriftEnabled
console.log('Test 6: isDriftEnabled checks...');
assert(isDriftEnabled({ inducedDrift: true }) === true, 'opts.inducedDrift=true → true');
assert(isDriftEnabled({ inducedDrift: false }) === false, 'opts.inducedDrift=false → false');
assert(isDriftEnabled({}) === false, 'no opts.inducedDrift → false');
assert(isDriftEnabled() === false, 'no opts → false');

// Test 7: End-to-end drift + sig-repair
// Model generates "search" but expected name is "compute_result"
// Sig-repair should rename search → compute_result
console.log('Test 7: End-to-end drift + sig-repair...');
const modelCode = `def search(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = (left + right) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1`;

const driftedSig = applyDrift({ name: 'search', params: ['nums', 'target'], returnType: 'number' }, 'binary-search');
assert(driftedSig.name === 'compute_result', 'drift should rename to compute_result');

const repairResult = repairSignatureName(modelCode, driftedSig.name);
assert(repairResult.repairedName === 'compute_result', `sig-repair should rename to compute_result, got ${repairResult.repairedName}`);
assert(repairResult.originalName === 'search', `original should be search, got ${repairResult.originalName}`);
assert(repairResult.repaired.includes('def compute_result'), `repaired code should have def compute_result`);
assert(!repairResult.repaired.includes('def search('), `repaired code should not have def search(`);

// Test 8: Drift name uniqueness
console.log('Test 8: Drift names are unique...');
const driftNames = new Set(Object.values(DRIFT_NAME_MAP));
assert(driftNames.size === Object.keys(DRIFT_NAME_MAP).length, 'all drift names should be unique');

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}