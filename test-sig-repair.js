/**
 * test-sig-repair.js — Tests for sig-repair.js
 *
 * Covers:
 * 1. Simple rename: def climbStairs(n) → def climb(n) with recursive calls updated
 * 2. Already correct name: no change
 * 3. No top-level def: no change
 * 4. Multiple top-level defs (non-test): no change (ambiguous)
 * 5. Multiple defs where one is test helper: skip test helpers, rename main
 * 6. Class-only code: no crash, no change (class rename out of scope)
 * 7. Code with unrelated identifiers containing the old name as substring
 * 8. Empty code: no change
 * 9. Real climbing-stairs: def climbStairs(n: int) -> int: → def climb(n: int) -> int:
 * 10. Code where test_climb is only function with no params — skip (wrong arity)
 */

import { repairSignatureName, canRepairSignatureName } from './sig-repair.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// --- Helper to build multi-line strings cleanly ---
function multiline(...parts) {
  return parts.join('\n');
}

// --- Test 1: Simple rename with recursive calls updated ---
const code1 = multiline(
  "def climbStairs(n: int) -> int:",
  "    if n <= 1:",
  "        return 1",
  "    return climbStairs(n - 1) + climbStairs(n - 2)"
);

const result1 = repairSignatureName(code1, 'climb');
assert(result1.repairedName === 'climb', `expected repairedName 'climb', got ${result1.repairedName}`);
assert(result1.originalName === 'climbStairs', `expected originalName 'climbStairs', got ${result1.originalName}`);
assert(result1.repaired.includes('def climb(n: int)'), 'def line should be renamed to climb');
assert(result1.repaired.includes('climb(n - 1)'), 'recursive call should be renamed');
assert(result1.repaired.includes('climb(n - 2)'), 'second recursive call should be renamed');
assert(!result1.repaired.includes('climbStairs'), 'old name should not appear anywhere');
console.log("✅ Test 1: simple rename with recursive calls updated");

// --- Test 2: Already correct name — no change ---
const code2 = multiline(
  "def climb(n: int) -> int:",
  "    if n <= 1:",
  "        return 1",
  "    return climb(n - 1) + climb(n - 2)"
);

const result2 = repairSignatureName(code2, 'climb');
assert(result2.repairedName === null, `expected no repair, got repairedName=${result2.repairedName}`);
assert(result2.originalName === null, `expected originalName null, got ${result2.originalName}`);
assert(result2.repaired === code2, 'code should be unchanged');
console.log("✅ Test 2: already correct name — no change");

// --- Test 3: No top-level def — no change ---
const code3 = multiline(
  "x = 42",
  "y = climbStairs(5)"
);

const result3 = repairSignatureName(code3, 'climb');
assert(result3.repairedName === null, 'should not repair');
assert(result3.repaired === code3, 'code should be unchanged');
console.log("✅ Test 3: no top-level def — no change");

// --- Test 4: Multiple top-level defs (non-test) — no change (ambiguous) ---
const code4 = multiline(
  "def helper(x):",
  "    return x * 2",
  "",
  "def climbStairs(n: int) -> int:",
  "    if n <= 1:",
  "        return 1",
  "    return climbStairs(n - 1)"
);

const result4 = repairSignatureName(code4, 'climb');
assert(result4.repairedName === null, 'should not repair when multiple top-level funcs');
assert(result4.repaired === code4, 'code should be unchanged');
console.log("✅ Test 4: multiple top-level defs (non-test) — no change");

// --- Test 5: Multiple defs where one is test helper — skip test helpers, rename main ---
const code5 = multiline(
  "def test_climb():",
  "    assert climb(5) == 8",
  "",
  "def climbStairs(n: int) -> int:",
  "    if n <= 1:",
  "        return 1",
  "    return climbStairs(n - 1) + climbStairs(n - 2)"
);

const result5 = repairSignatureName(code5, 'climb');
assert(result5.repairedName === 'climb', `expected repaired name 'climb', got ${result5.repairedName}`);
assert(result5.originalName === 'climbStairs', `expected original 'climbStairs', got ${result5.originalName}`);
assert(result5.repaired.includes('def climb(n: int)'), 'main function should be renamed');
assert(result5.repaired.includes('test_climb'), 'test helper should be untouched');
console.log("✅ Test 5: multiple defs, one is test helper — main function renamed");

// --- Test 6: Class-only code — no crash, no change ---
const code6 = multiline(
  "class Counter:",
  "    def __init__(self):",
  "        self.count = 0",
  "",
  "    def increment(self):",
  "        self.count += 1"
);

const result6 = repairSignatureName(code6, 'Counter');
assert(result6.repairedName === null, 'should not repair class');
assert(result6.repaired === code6, 'code should be unchanged');
console.log("✅ Test 6: class-only code — no crash, no change");

// --- Test 7: Unrelated identifiers with old name as substring ---
const code7 = multiline(
  "def climbStairs(n: int) -> int:",
  "    if n <= 1:",
  "        return 1",
  "    # climbStairsHelper is a helper that should not be renamed",
  "    climbStairsHelper = climbStairs",
  "    return climbStairsHelper(n - 1) + climbStairsHelper(n - 2)"
);

const result7 = repairSignatureName(code7, 'climb');
assert(result7.repairedName === 'climb', `expected repair`);
assert(result7.repaired.includes('def climb(n: int)'), 'def renamed');
// Should rename climbStairs(n-1) and climbStairs(n-2) but NOT climbStairsHelper
assert(result7.repaired.includes('climbStairsHelper'), 'climbStairsHelper should remain');
assert(!result7.repaired.includes('climbStairs('), 'no old function name calls remain');
console.log("✅ Test 7: unrelated identifiers with old name substring — only exact calls renamed");

// --- Test 8: Empty code — no change ---
const result8a = repairSignatureName('', 'climb');
assert(result8a.repairedName === null, 'empty string should not repair');
assert(result8a.repaired === '', 'code should be empty');

const result8b = repairSignatureName(null, 'climb');
assert(result8b.repairedName === null, 'null should not repair');
console.log("✅ Test 8: empty code — no change");

// --- Test 9: Real climbing-stairs with type annotations preserved ---
const code9 = multiline(
  "from typing import int",
  "",
  "def climbStairs(n: int) -> int:",
  "    \"\"\"Return number of ways to climb n stairs.\"\"\"",
  "    if n == 1:",
  "        return 1",
  "    if n == 2:",
  "        return 2",
  "    return climbStairs(n - 1) + climbStairs(n - 2)"
);

const result9 = repairSignatureName(code9, 'climb');
assert(result9.repairedName === 'climb', `expected repair`);
assert(result9.originalName === 'climbStairs');
assert(result9.repaired.includes('def climb(n: int) -> int:'), 'def line should be renamed with type annotations');
assert(result9.repaired.includes('climb(n - 1)'), 'first recursive call renamed');
assert(result9.repaired.includes('climb(n - 2)'), 'second recursive call renamed');
assert(!result9.repaired.includes('climbStairs('), 'old name calls gone');
console.log("✅ Test 9: real climbing-stairs with type annotations preserved");

// --- Test 10: test_climb only function with no params — skip (wrong arity) ---
const code10 = multiline(
  "def test_climb():",
  "    pass"
);

const result10 = repairSignatureName(code10, 'climb');
assert(result10.repairedName === null, 'should not repair test-only function');
assert(result10.repaired === code10, 'code should be unchanged');
console.log("✅ Test 10: test_climb only function with no params — skipped");

// --- Test 11: canRepairSignatureName helper ---
const code11a = multiline(
  "def climbStairs(n):",
  "    return n"
);
const check11a = canRepairSignatureName(code11a, 'climb');
assert(check11a.canRepair === true, 'should be repairable');
assert(check11a.originalName === 'climbStairs');
assert(check11a.reason.includes('climbStairs → climb'), 'reason should mention both names');

const code11b = multiline(
  "def helper():",
  "    pass",
  "def climbStairs(n):",
  "    return n"
);
const check11b = canRepairSignatureName(code11b, 'climb');
assert(check11b.canRepair === false, 'should not be repairable due to ambiguity');
assert(check11b.reason.includes('multiple'), 'reason should mention multiple');

const code11c = multiline(
  "def climb(n):",
  "    return n"
);
const check11c = canRepairSignatureName(code11c, 'climb');
assert(check11c.canRepair === false, 'should not repair when already correct');

console.log("✅ Test 11: canRepairSignatureName helper works correctly");

// --- Test 12: Multi-line def (parentheses spanning multiple lines) ---
const code12 = multiline(
  "def climbStairs(",
  "    n: int",
  ") -> int:",
  "    if n <= 1:",
  "        return 1",
  "    return climbStairs(n - 1) + climbStairs(n - 2)"
);

const result12 = repairSignatureName(code12, 'climb');
assert(result12.repairedName === 'climb', `expected repair`);
assert(result12.originalName === 'climbStairs');
assert(result12.repaired.includes('def climb('), 'def line should be renamed');
assert(result12.repaired.includes('climb(n - 1)'), 'recursive calls should be renamed');
console.log("✅ Test 12: multi-line def works correctly");

// --- Test 13: No expected name given ---
const code13 = multiline(
  "def climbStairs(n):",
  "    return n"
);
const result13a = repairSignatureName(code13, '');
assert(result13a.repairedName === null, 'empty expected name should not repair');
const result13b = repairSignatureName(code13, null);
assert(result13b.repairedName === null, 'null expected name should not repair');
console.log("✅ Test 13: empty/null expected name — no repair");

// --- Test 14: Function with self/cls parameter should still work ---
const code14 = multiline(
  "class Solution:",
  "    def climbStairs(self, n: int) -> int:",
  "        if n <= 1:",
  "            return 1",
  "        return self.climbStairs(n - 1) + self.climbStairs(n - 2)"
);

const result14 = repairSignatureName(code14, 'climb');
assert(result14.repairedName === null, 'class methods should not be renamed (not top-level)');
console.log("✅ Test 14: class methods — not renamed (not top-level)");

// --- Test 15: Main function with default params and body reference ---
const code15 = multiline(
  "def climbStairs(n: int, steps=2) -> int:",
  "    if n <= 1:",
  "        return 1",
  "    total = 0",
  "    for i in range(steps):",
  "        total += climbStairs(n - i - 1)",
  "    return total"
);

const result15 = repairSignatureName(code15, 'climb');
assert(result15.repairedName === 'climb', 'should repair');
assert(result15.repaired.includes('def climb(n: int'), 'def renamed');
assert(result15.repaired.includes('climb(n - i - 1)'), 'recursive call in loop renamed');
console.log("✅ Test 15: function with default params and body reference");

console.log("\n🎉 All sig-repair tests passed.");