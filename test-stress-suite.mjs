#!/usr/bin/env node
/**
 * test-stress-suite.mjs — Verify stress-suite MVP wiring without model calls
 *
 * Tests:
 * 1. All 4 stress-suite problems have task.txt in testcases-expansion/
 * 2. All 4 problems have primary tests in eval.js testSuites
 * 3. All 4 problems have held-out tests in held-out-test-suites.js
 * 4. Reference solutions pass primary tests at 100%
 * 5. Reference solutions pass held-out tests at 100%
 * 6. Shallow solutions pass some primary tests but fail some held-out (underdetermination)
 */

import { runBasicTest } from './eval.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPANSION_DIR = join(__dirname, 'testcases-expansion');

const STRESS_PROBLEMS = ['edit-distance', 'word-break', 'detect-cycle', 'valid-sudoku'];

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

console.log('\n=== Stress-Suite MVP Wiring Test ===\n');

// 1. Task files exist
console.log('1. Task files exist in testcases-expansion/');
for (const p of STRESS_PROBLEMS) {
  const taskPath = join(EXPANSION_DIR, p, 'task.txt');
  assert(existsSync(taskPath), `${p}/task.txt exists`);
}

// 2. Reference files exist
console.log('\n2. Reference files exist');
for (const p of STRESS_PROBLEMS) {
  const refPy = join(EXPANSION_DIR, p, 'reference.py');
  const refTs = join(EXPANSION_DIR, p, 'reference.ts') || join(EXPANSION_DIR, p, 'reference-ts.txt');
  assert(existsSync(refPy), `${p}/reference.py exists`);
  assert(existsSync(join(EXPANSION_DIR, p, 'reference.ts')) || existsSync(join(EXPANSION_DIR, p, 'reference-ts.txt')),
    `${p}/reference.ts or reference-ts.txt exists`);
}

// 3. Reference solutions pass primary + held-out at 100%
console.log('\n3. Reference calibration (primary + held-out)');
const REFERENCE_SOLUTIONS = {
  'edit-distance': `def minDistance(word1, word2):
    m, n = len(word1), len(word2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if word1[i - 1] == word2[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]`,

  'word-break': `from typing import List
def wordBreak(s, wordDict):
    word_set = set(wordDict)
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(1, n + 1):
        for j in range(i):
            if dp[j] and s[j:i] in word_set:
                dp[i] = True
                break
    return dp[n]`,

  'detect-cycle': `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def hasCycle(head):
    if not head or not head.next:
        return False
    slow = head
    fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if slow is fast:
            return True
    return False`,

  'valid-sudoku': `from typing import List
def isValidSudoku(board):
    for i in range(9):
        row = set()
        col = set()
        box = set()
        for j in range(9):
            if board[i][j] != '.':
                if board[i][j] in row:
                    return False
                row.add(board[i][j])
            if board[j][i] != '.':
                if board[j][i] in col:
                    return False
                col.add(board[j][i])
            box_row = (i // 3) * 3 + j // 3
            box_col = (i % 3) * 3 + j % 3
            if board[box_row][box_col] != '.':
                if board[box_row][box_col] in box:
                    return False
                box.add(board[box_row][box_col])
    return True`,
};

for (const [problem, code] of Object.entries(REFERENCE_SOLUTIONS)) {
  const result = runBasicTest(problem, code);
  const primaryPct = result.primaryPassRate !== undefined
    ? `${(result.primaryPassRate * 100).toFixed(0)}%`
    : (result.pass ? '100%' : 'FAIL');
  const heldOutPct = result.heldOutPassRate !== undefined
    ? `${(result.heldOutPassRate * 100).toFixed(0)}%`
    : 'N/A';
  const cohRisk = result.cohAtrRisk !== null && result.cohAtrRisk !== undefined
    ? `${(result.cohAtrRisk * 100).toFixed(0)}%`
    : 'N/A';

  assert(result.pass, `${problem}: primary PASS (${primaryPct})`);
  assert(result.primaryPassRate === 1, `${problem}: primary 100%`);
  assert(result.heldOutPassRate === 1, `${problem}: held-out 100% (${result.heldOutPassed}/${result.heldOutTotal})`);
  assert(result.cohAtrRisk === 0, `${problem}: cohAtrRisk = 0%`);
}

// 4. Shallow solutions underdetermination check
console.log('\n4. Underdetermination: shallow solutions fail some held-out tests');
const SHALLOW_SOLUTIONS = {
  'edit-distance': `def minDistance(word1, word2):
    return len(word1) + len(word2)`,

  'valid-sudoku': `def isValidSudoku(board):
    for row in board:
        digits = [c for c in row if c != '.']
        if len(digits) != len(set(digits)):
            return False
    return True`,
};

for (const [problem, code] of Object.entries(SHALLOW_SOLUTIONS)) {
  const result = runBasicTest(problem, code);
  const primaryPct = result.primaryPassRate !== undefined
    ? `${(result.primaryPassRate * 100).toFixed(0)}%`
    : 'N/A';
  const heldOutPct = result.heldOutPassRate !== undefined
    ? `${(result.heldOutPassRate * 100).toFixed(0)}%`
    : 'N/A';

  // Shallow solution should pass SOME primary but fail SOME held-out
  const primaryButNotAll = result.primaryPassRate > 0 && result.primaryPassRate < 1;
  const heldOutLessThanPrimary = result.heldOutPassRate < result.primaryPassRate;
  const anyPrimaryPass = result.primaryPassRate > 0;
  const anyHeldOutFail = result.heldOutPassRate < 1;

  console.log(`  ${problem}: primary=${primaryPct} held-out=${heldOutPct}`);
  assert(anyPrimaryPass, `${problem}: shallow passes some primary tests`);
  assert(anyHeldOutFail, `${problem}: shallow fails at least some held-out tests (underdetermination confirmed)`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);