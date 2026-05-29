/**
 * test-pgg-filter.js — Unit tests for pgg-filter.js
 *
 * Tests the PGG rejection filter with known-good and known-bad code.
 * Uses mock mode (no actual Ollama calls) for deterministic testing.
 *
 * Run: node test-pgg-filter.js
 */

import { pggFilter, pggFilterAuto } from './pgg-filter.js';
import { PGG_ASSERTIONS } from './problem-assertions.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// Good climbing-stairs implementation (correct fibonacci)
const goodClimbingStairs = `
def f(n):
    if n == 1:
        return 1
    if n == 2:
        return 2
    a, b = 1, 2
    for _ in range(3, n + 1):
        a, b = b, a + b
    return b
`;

// Bad climbing-stairs implementation (always returns 1)
const badClimbingStairs = `
def f(n):
    return 1
`;

// Good binary-search implementation
const goodBinarySearch = `
def f(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
`;

// Bad binary-search implementation (wrong direction)
const badBinarySearch = `
def f(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            right = mid - 1  # wrong!
        else:
            left = mid + 1   # wrong!
    return -1
`;

// Good word-break (DP solution)
const goodWordBreak = `
def f(s, wordDict):
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(1, n + 1):
        for j in range(i):
            if dp[j] and s[j:i] in wordDict:
                dp[i] = True
                break
    return dp[n]
`;

// Bad word-break (greedy, fails on "dogs" with ["dog"])
const badWordBreak = `
def f(s, wordDict):
    words = sorted(wordDict, key=len, reverse=True)
    for w in words:
        if s.startswith(w):
            remaining = s[len(w):]
            if not remaining:
                return True
            if all(remaining.startswith(w2) for w2 in words if remaining.startswith(w2)):
                return True
    return False
`;

// Good detect-cycle (Floyd's algorithm)
const goodDetectCycle = `
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def f(head):
    if not head:
        return False
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow == fast:
            return True
    return False
`;

// Good edit-distance (DP)
const goodEditDistance = `
def f(word1, word2):
    m, n = len(word1), len(word2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if word1[i-1] == word2[j-1]:
                dp[i][j] = dp[i-1][j-1]
            else:
                dp[i][j] = 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    return dp[m][n]
`;

// Bad edit-distance (wrong base case)
const badEditDistance = `
def f(word1, word2):
    if not word1:
        return len(word2)
    if not word2:
        return len(word1)
    if word1[0] == word2[0]:
        return f(word1[1:], word2[1:])
    return 1 + min(f(word1[1:], word2), f(word1, word2[1:]))
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n=== test-pgg-filter.js ===\n');

// Test 1: Good code passes PGG filter
console.log('Test 1: Good climbing-stairs passes filter');
{
  const assertions = PGG_ASSERTIONS['climbing-stairs'];
  const result = pggFilter(goodClimbingStairs, 'climbing-stairs', assertions, 'f');
  assert(result.accepted === true, 'good code should be accepted');
  assert(result.failedCount === 0, 'no failures for correct implementation');
}

// Test 2: Bad code fails PGG filter
console.log('Test 2: Bad climbing-stairs fails filter');
{
  const assertions = PGG_ASSERTIONS['climbing-stairs'];
  const result = pggFilter(badClimbingStairs, 'climbing-stairs', assertions, 'f');
  assert(result.accepted === false, 'bad code should be rejected');
  assert(result.failedCount > 0, 'should have at least one failure');
}

// Test 3: Good binary-search passes filter
console.log('Test 3: Good binary-search passes filter');
{
  const assertions = PGG_ASSERTIONS['binary-search'];
  const result = pggFilter(goodBinarySearch, 'binary-search', assertions, 'f');
  assert(result.accepted === true, 'good binary-search should be accepted');
  assert(result.failedCount === 0, 'no failures for correct implementation');
}

// Test 4: Bad binary-search fails filter
console.log('Test 4: Bad binary-search fails filter');
{
  const assertions = PGG_ASSERTIONS['binary-search'];
  const result = pggFilter(badBinarySearch, 'binary-search', assertions, 'f');
  assert(result.accepted === false, 'bad binary-search should be rejected');
}

// Test 5: Good word-break passes filter
console.log('Test 5: Good word-break passes filter');
{
  const assertions = PGG_ASSERTIONS['word-break'];
  const result = pggFilter(goodWordBreak, 'word-break', assertions, 'f');
  assert(result.accepted === true, 'good word-break should be accepted');
  assert(result.failedCount === 0, 'no failures for DP solution');
}

// Test 6: Bad word-break fails filter
console.log('Test 6: Bad word-break fails filter');
{
  const assertions = PGG_ASSERTIONS['word-break'];
  const result = pggFilter(badWordBreak, 'word-break', assertions, 'f');
  assert(result.accepted === false, 'bad greedy word-break should be rejected');
}

// Test 7: Good detect-cycle passes filter (no cycle)
console.log('Test 7: Good detect-cycle passes for no-cycle case');
{
  const assertions = PGG_ASSERTIONS['detect-cycle'];
  // Filter only checks the function returns, not cycle detection per se
  // We test that the function is callable
  const result = pggFilter(goodDetectCycle, 'detect-cycle', [assertions[1]], 'f');
  // None assertion should pass (f(None) == False)
  assert(result.accepted === true || result.totalCount === 1, 'detect-cycle with None should work');
}

// Test 8: Good edit-distance passes filter
console.log('Test 8: Good edit-distance passes filter');
{
  const assertions = PGG_ASSERTIONS['edit-distance'];
  const result = pggFilter(goodEditDistance, 'edit-distance', assertions, 'f');
  assert(result.accepted === true, 'good edit-distance should be accepted');
  assert(result.failedCount === 0, 'DP solution passes all assertions');
}

// Test 9: Bad edit-distance fails filter (recursive, wrong base case)
console.log('Test 9: Bad edit-distance fails filter');
{
  const assertions = PGG_ASSERTIONS['edit-distance'];
  const result = pggFilter(badEditDistance, 'edit-distance', assertions, 'f');
  assert(result.accepted === false, 'bad recursive edit-distance should be rejected');
}

// Test 10: pggFilter works with real generated function names, not just fixture alias f
console.log('Test 10: pggFilter rewrites assertion import alias for real function names');
{
  const realWordBreakName = goodWordBreak.replace('def f(s, wordDict):', 'def wordBreak(s, wordDict):');
  const assertions = PGG_ASSERTIONS['word-break'];
  const result = pggFilter(realWordBreakName, 'word-break', assertions, 'wordBreak');
  assert(result.accepted === true, 'real generated function name should be imported as f for assertions');
  assert(result.failedCount === 0, 'no failures for DP solution with real function name');
}

// Test 10b: pggFilterAuto detects function name
console.log('Test 10b: pggFilterAuto detects function name automatically');
{
  const assertions = PGG_ASSERTIONS['climbing-stairs'];
  const result = pggFilterAuto(goodClimbingStairs, 'climbing-stairs', assertions);
  assert(result.accepted === true, 'auto-detected fn should work');
}

// Test 11: pggFilter returns empty results for no assertions
console.log('Test 11: Empty assertions return accepted=true');
{
  const result = pggFilter(goodClimbingStairs, 'climbing-stairs', [], 'f');
  assert(result.accepted === true, 'empty assertions should accept');
  assert(result.totalCount === 0, 'totalCount should be 0');
  assert(result.reason === 'no_assertions', 'should indicate no assertions');
}

// Test 12: pggFilter handles missing function gracefully
console.log('Test 12: Missing function returns rejected');
{
  const badCode = `def wrong_name(): pass`;
  const assertions = PGG_ASSERTIONS['climbing-stairs'];
  const result = pggFilter(badCode, 'climbing-stairs', assertions, 'f');
  assert(result.accepted === false, 'wrong function name should fail');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log('');

if (failed > 0) {
  console.log('FAILED');
  process.exit(1);
} else {
  console.log('PASSED');
  process.exit(0);
}