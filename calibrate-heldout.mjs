#!/usr/bin/env node
/**
 * calibrate-heldout.mjs — Run reference solutions against held-out test suites
 * to establish the difficulty-calibration floor.
 *
 * If reference scores held-out 6/6 → suite clean, model drops are real COH_ATR.
 * If reference drops to 4/6 → confounded, need to fix/subtract floor.
 *
 * One solution per problem, no k=5 sampling. Cheap pass.
 */
import { runBasicTest } from './eval.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

// Correct Python reference solutions for all 8 N=8 problems
const REFERENCE_SOLUTIONS = {
  'binary-search': `from typing import List
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
    return -1`,

  'climbing-stairs': `def climb(n: int) -> int:
    if n <= 2:
        return n
    a, b = 1, 2
    for _ in range(3, n + 1):
        a, b = b, a + b
    return b`,

  'container-with-most-water': `from typing import List
def maxArea(height: List[int]) -> int:
    left, right = 0, len(height) - 1
    max_area = 0
    while left < right:
        area = (right - left) * min(height[left], height[right])
        max_area = max(max_area, area)
        if height[left] < height[right]:
            left += 1
        else:
            right -= 1
    return max_area`,

  'coin-change-ii': `from typing import List
def change(amount: int, coins: List[int]) -> int:
    dp = [0] * (amount + 1)
    dp[0] = 1
    for coin in coins:
        for i in range(coin, amount + 1):
            dp[i] += dp[i - coin]
    return dp[amount]`,

  'two-sum': `from typing import List
def twoSum(nums: List[int], target: int) -> List[int]:
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []`,

  'valid-palindrome': `def isPalindrome(s: str) -> bool:
    cleaned = ''.join(c.lower() for c in s if c.isalnum())
    return cleaned == cleaned[::-1]`,

  'number-of-islands': `from typing import List
def numIslands(grid: List[List[str]]) -> int:
    if not grid:
        return 0
    rows, cols = len(grid), len(grid[0])
    count = 0

    def dfs(r, c):
        if r < 0 or r >= rows or c < 0 or c >= cols or grid[r][c] != '1':
            return
        grid[r][c] = '0'
        dfs(r + 1, c)
        dfs(r - 1, c)
        dfs(r, c + 1)
        dfs(r, c - 1)

    for r in range(rows):
        for c in range(cols):
            if grid[r][c] == '1':
                count += 1
                dfs(r, c)
    return count`,

  'invert-binary-tree': `from typing import Optional
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def invertTree(root: Optional[TreeNode]) -> Optional[TreeNode]:
    if not root:
        return None
    root.left, root.right = root.right, root.left
    invertTree(root.left)
    invertTree(root.right)
    return root`,

  // --- Stress-suite MVP (P1, P3, P4, P7) ---
  'edit-distance': `def minDistance(word1: str, word2: str) -> int:
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
def wordBreak(s: str, wordDict: List[str]) -> bool:
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
def isValidSudoku(board: List[List[str]]) -> bool:
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

const PROBLEMS = Object.keys(REFERENCE_SOLUTIONS);
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = join('validation-runs', `reference-calibration-${TIMESTAMP}`);
const { mkdirSync } = await import('fs');
mkdirSync(RUN_DIR, { recursive: true });

console.log(`\n${'='.repeat(60)}`);
console.log('=== Reference Solution Held-Out Calibration ===');
console.log(`${'='.repeat(60)}\n`);

const results = {};

for (const problem of PROBLEMS) {
  const code = REFERENCE_SOLUTIONS[problem];
  console.log(`--- ${problem} ---`);

  const result = runBasicTest(problem, code);
  const primaryPass = result.pass ? 'PASS' : 'FAIL';
  const primaryRate = result.primaryPassRate !== undefined
    ? `${result.primaryPassed}/${result.primaryTotal} (${(result.primaryPassRate * 100).toFixed(0)}%)`
    : primaryPass;
  const heldOutRate = result.heldOutPassRate !== undefined
    ? `${result.heldOutPassed}/${result.heldOutTotal} (${(result.heldOutPassRate * 100).toFixed(0)}%)`
    : 'N/A';
  const cohRisk = result.cohAtrRisk !== undefined && result.cohAtrRisk !== null
    ? `${(result.cohAtrRisk * 100).toFixed(0)}%`
    : 'N/A';

  console.log(`  Primary: ${primaryRate}`);
  console.log(`  Held-out: ${heldOutRate}`);
  console.log(`  cohAtrRisk: ${cohRisk}`);

  if (result.heldOutDetails) {
    for (const d of result.heldOutDetails) {
      if (!d.pass) {
        console.log(`  FAIL: ${d.desc}: ${d.error?.slice(0, 80) || 'assertion failed'}`);
      }
    }
  }

  results[problem] = {
    primaryPass: result.pass,
    primaryPassRate: result.primaryPassRate,
    primaryPassed: result.primaryPassed,
    primaryTotal: result.primaryTotal,
    heldOutPassRate: result.heldOutPassRate,
    heldOutPassed: result.heldOutPassed,
    heldOutTotal: result.heldOutTotal,
    cohAtrRisk: result.cohAtrRisk,
    heldOutDetails: result.heldOutDetails,
  };
}

const summary = {
  calibration: 'reference-solutions',
  timestamp: TIMESTAMP,
  results,
};

writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(`\n${'='.repeat(60)}`);
console.log('CALIBRATION SUMMARY');
console.log(`${'='.repeat(60)}`);

let allClean = true;
for (const [p, r] of Object.entries(results)) {
  const hoStr = r.heldOutPassRate !== undefined ? `${(r.heldOutPassRate * 100).toFixed(0)}%` : 'N/A';
  const cohStr = r.cohAtrRisk !== undefined && r.cohAtrRisk !== null ? `${(r.cohAtrRisk * 100).toFixed(0)}%` : 'N/A';
  const clean = r.heldOutPassRate === 1;
  const marker = clean ? '✓' : '✗ CONFOUNDED';
  if (!clean) allClean = false;
  console.log(`  ${p}: primary=${(r.primaryPassRate * 100).toFixed(0)}% held-out=${hoStr} cohAtrRisk=${cohStr} ${marker}`);
}

console.log(`\nOverall: ${allClean ? 'All held-out suites are CLEAN (reference passes 100%)' : 'Some held-out suites are CONFOUNDED (reference drops) — fix or flag before R3'}`);
console.log(`Run dir: ${RUN_DIR}`);
console.log(`${'='.repeat(60)}`);