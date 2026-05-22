/**
 * test-basic-runner.js — local tests for eval.js runBasicTest.
 *
 * Guards against silent passes for unsupported problems and checks a couple of
 * representative function/class suites without making model calls.
 */

import { runBasicTest } from './eval.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const coinGood = `
def change(amount: int, coins: list[int]) -> int:
    dp = [0] * (amount + 1)
    dp[0] = 1
    for c in coins:
        for a in range(c, amount + 1):
            dp[a] += dp[a - c]
    return dp[amount]
`;

const coinBad = `
def change(amount: int, coins: list[int]) -> int:
    return 0
`;

const minStackGood = `
class MinStack:
    def __init__(self):
        self.stack = []
        self.mins = []
    def push(self, val: int) -> None:
        self.stack.append(val)
        self.mins.append(val if not self.mins else min(val, self.mins[-1]))
    def pop(self) -> None:
        self.stack.pop()
        self.mins.pop()
    def top(self) -> int:
        return self.stack[-1]
    def getMin(self) -> int:
        return self.mins[-1]
`;

const minStackBad = `
class MinStack:
    def __init__(self): self.stack = []
    def push(self, val: int) -> None: self.stack.append(val)
    def pop(self) -> None: self.stack.pop()
    def top(self) -> int: return self.stack[-1]
    def getMin(self) -> int: return self.stack[-1]
`;

let res = runBasicTest('coin-change-ii', coinGood);
assert(res.pass, `coin-change-ii good should pass: ${res.detail || ''}`);
console.log('✅ coin-change-ii good passes');

res = runBasicTest('coin-change-ii', coinBad);
assert(!res.pass, 'coin-change-ii bad should fail');
console.log('✅ coin-change-ii bad fails');

res = runBasicTest('min-stack', minStackGood);
assert(res.pass, `min-stack good should pass: ${res.detail || ''}`);
console.log('✅ min-stack good passes');

res = runBasicTest('min-stack', minStackBad);
assert(!res.pass, 'min-stack bad should fail');
console.log('✅ min-stack bad fails');

res = runBasicTest('not-covered', 'def solution():\n    return 1');
assert(!res.pass && res.detail?.includes('no test suite'), 'unknown problem must not silently pass');
console.log('✅ unsupported problem fails closed');

console.log('\n🎉 runBasicTest tests passed.');
