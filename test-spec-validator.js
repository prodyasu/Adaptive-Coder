/**
 * test-spec-validator.js — Smoke tests for spec validation gate
 */

import { extractPythonSignature, compareSignatures, validateSpec } from './spec-validator.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Test 1: extractPythonSignature — basic function
const code1 = `def change(amount: int, coins: List[int]) -> int:
  dp = [0] * (amount + 1)
  return dp[amount]`;
const sig1 = extractPythonSignature(code1);
assert(sig1.name === 'change', 'extract name');
assert(sig1.params.length === 2, 'extract arity');
assert(sig1.params[0] === 'amount' && sig1.params[1] === 'coins', 'extract params');
console.log('✅ Test 1: extract basic function');

// Test 2: extractPythonSignature — class
const code2 = `class MinStack:
  def __init__(self):
    pass
  def push(self, val: int) -> None:
    pass`;
const sig2 = extractPythonSignature(code2);
assert(sig2.kind === 'class', 'extract class');
assert(sig2.name === 'MinStack', 'class name');
console.log('✅ Test 2: extract class');

// Test 3: compareSignatures — exact match
const gen = { name: 'change', params: ['amount', 'coins'], kind: 'function' };
const exp = { name: 'change', params: ['amount', 'coins'], kind: 'function' };
const cmp = compareSignatures(gen, exp);
assert(cmp.match === true, 'exact match');
console.log('✅ Test 3: exact match');

// Test 4: compareSignatures — param order mismatch
const gen4 = { name: 'change', params: ['coins', 'amount'], kind: 'function' };
const cmp4 = compareSignatures(gen4, exp);
assert(cmp4.match === false, 'param order mismatch detected');
assert(cmp4.mismatches.includes('param_order'), 'mismatch type');
assert(cmp4.guidance.includes('parameter order'), 'guidance mentions order');
console.log('✅ Test 4: param order mismatch');

// Test 5: compareSignatures — name mismatch
const gen5 = { name: 'coinChange', params: ['amount', 'coins'], kind: 'function' };
const cmp5 = compareSignatures(gen5, exp);
assert(cmp5.match === false, 'name mismatch detected');
assert(cmp5.mismatches.includes('name'), 'name mismatch type');
console.log('✅ Test 5: name mismatch');

// Test 6: compareSignatures — arity mismatch
const gen6 = { name: 'change', params: ['amount'], kind: 'function' };
const cmp6 = compareSignatures(gen6, exp);
assert(cmp6.match === false, 'arity mismatch detected');
assert(cmp6.mismatches.includes('arity'), 'arity mismatch type');
console.log('✅ Test 6: arity mismatch');

// Test 7: empty expected → pass through
const cmp7 = compareSignatures(gen, null);
assert(cmp7.match === true, 'no expected → skip validation');
console.log('✅ Test 7: no expected → skip');

// Test 8: validateSpec coin-change-ii
const fixture = validateSpec('coin-change-ii', code1);
assert(fixture.match === true, 'fixture passes');
console.log('✅ Test 8: coin-change-ii fixture');

// Test 9: coin-change-ii with wrong order
const code9 = `def change(coins: List[int], amount: int) -> int:
  dp = [0] * (amount + 1)
  return dp[amount]`;
const fixture9 = validateSpec('coin-change-ii', code9);
assert(fixture9.match === false, 'wrong order detected');
assert(fixture9.mismatches.includes('param_order'), 'param_order flagged');
console.log('✅ Test 9: wrong order rejected');

console.log('\n🎉 All 9 spec-validator tests passed.');
