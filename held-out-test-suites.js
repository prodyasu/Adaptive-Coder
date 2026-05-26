/**
 * held-out-test-suites.js — Held-out discriminativity test suites
 *
 * Additional test cases per problem NOT used in primary evaluation.
 * They detect COH_ATR contamination: code that passes scaffold tests
 * but fails held-out tests may be coherent under scaffold but not generalizable.
 *
 * DESIGN PRINCIPLES (from Claude brainstorm):
 * - Difficulty-calibrated: held-out tests ≈ same difficulty as primary tests
 * - Reference baseline: establish that reference solutions pass held-out at
 *   ~same rate as primary before trusting cohAtrRisk
 * - Primary DV: held-out pass-rate delta (continuous, not binary)
 *   cohAtrRisk = max(0, 1 - heldOutPassRate / primaryPassRate)
 *
 * Test code uses literal "${fnName}" placeholder — replaced at runtime
 * by runHeldOutTests() before execution.
 */

export const heldOutTestSuites = {
  'binary-search': [
    { code: 'from binary_search import ${fnName} as f; assert f([5], 5) == 0', desc: 'single-element-found' },
    { code: 'from binary_search import ${fnName} as f; assert f([5], 3) == -1', desc: 'single-element-not-found' },
    { code: 'from binary_search import ${fnName} as f; assert f([1,2,3,4,5], 5) == 4', desc: 'target-at-end' },
    { code: 'from binary_search import ${fnName} as f; assert f([1,2,3,4,5], 1) == 0', desc: 'target-at-beginning' },
    { code: 'from binary_search import ${fnName} as f; assert f([1,3,5,7,9], 4) == -1', desc: 'not-present-between' },
    { code: 'from binary_search import ${fnName} as f; assert f([10,20,30], 5) == -1', desc: 'not-present-below' },
  ],

  'climbing-stairs': [
    { code: 'from climbing_stairs import ${fnName} as f; assert f(1) == 1', desc: 'n=1' },
    { code: 'from climbing_stairs import ${fnName} as f; assert f(2) == 2', desc: 'n=2' },
    { code: 'from climbing_stairs import ${fnName} as f; assert f(6) == 13', desc: 'n=6' },
    { code: 'from climbing_stairs import ${fnName} as f; assert f(7) == 21', desc: 'n=7' },
    { code: 'from climbing_stairs import ${fnName} as f; assert f(20) == 10946', desc: 'n=20' },
  ],

  'container-with-most-water': [
    { code: 'from container_with_most_water import ${fnName} as f; assert f([1,2]) == 1', desc: 'two-elements' },
    { code: 'from container_with_most_water import ${fnName} as f; assert f([5,5,5,5]) == 15', desc: 'all-same-height' },
    { code: 'from container_with_most_water import ${fnName} as f; assert f([1,2,3,4,5]) == 6', desc: 'ascending' },
    { code: 'from container_with_most_water import ${fnName} as f; assert f([5,4,3,2,1]) == 6', desc: 'descending' },
    { code: 'from container_with_most_water import ${fnName} as f; assert f([8,1,1,1,8]) == 32', desc: 'v-shape' },
  ],

  'coin-change-ii': [
    { code: 'from coin_change_ii import ${fnName} as f; assert f(0, [1,2,5]) == 1', desc: 'amount-zero' },
    { code: 'from coin_change_ii import ${fnName} as f; assert f(5, [1]) == 1', desc: 'single-coin-type' },
    { code: 'from coin_change_ii import ${fnName} as f; assert f(3, [2]) == 0', desc: 'impossible-combination' },
    { code: 'from coin_change_ii import ${fnName} as f; assert f(10, [1,2,5]) == 10', desc: 'amount-10-coins-1-2-5' },
    { code: 'from coin_change_ii import ${fnName} as f; assert f(5, [2,3]) == 1', desc: 'two-ways-exact-match' },
  ],

  'two-sum': [
    { code: 'from two_sum import ${fnName} as f; r = f([-1,-2,-3,-4,-5], -8); assert set(r) == {2, 4}', desc: 'negative-numbers' },
    { code: 'from two_sum import ${fnName} as f; r = f(list(range(1,101)), 199); assert set(r) == {98, 99}', desc: 'large-array' },
    { code: 'from two_sum import ${fnName} as f; r = f([3,5,7,9], 8); assert set(r) == {0, 1}', desc: 'first-two-elements' },
  ],

  'valid-palindrome': [
    { code: 'from valid_palindrome import ${fnName} as f; assert f("") == True', desc: 'empty-string' },
    { code: 'from valid_palindrome import ${fnName} as f; assert f("a") == True', desc: 'single-char' },
    { code: 'from valid_palindrome import ${fnName} as f; assert f("0P") == False', desc: 'numbers-included' },
    { code: 'from valid_palindrome import ${fnName} as f; assert f("A man, a plan, a canal: Panama") == True', desc: 'mixed-special-chars' },
    { code: 'from valid_palindrome import ${fnName} as f; assert f("racecar") == True', desc: 'simple-palindrome' },
  ],

  'number-of-islands': [
    { code: 'from number_of_islands import ${fnName} as f; assert f([["1"],["1"],["1"]]) == 1', desc: 'single-column' },
    { code: 'from number_of_islands import ${fnName} as f; assert f([["1","0"],["0","1"]]) == 2', desc: 'diagonal-separate' },
    { code: 'from number_of_islands import ${fnName} as f; assert f([["1","1"],["0","1"]]) == 1', desc: 'l-shaped' },
    { code: 'from number_of_islands import ${fnName} as f; assert f([["0","0"],["0","0"]]) == 0', desc: 'all-water' },
  ],

  'invert-binary-tree': [
    { code: 'from invert_binary_tree import ${fnName} as f, TreeNode; r = f(TreeNode(1)); assert r.val == 1 and r.left is None and r.right is None', desc: 'single-node' },
    { code: 'from invert_binary_tree import ${fnName} as f, TreeNode; r = f(TreeNode(2, TreeNode(1), TreeNode(3))); assert r.left.val == 3 and r.right.val == 1', desc: 'swap-two-children' },
    { code: 'from invert_binary_tree import ${fnName} as f, TreeNode; r = f(TreeNode(1, TreeNode(2, TreeNode(3), None), None)); assert r.right.val == 2 and r.right.right.val == 3', desc: 'left-heavy-becomes-right' },
  ],

  // --- Stress-suite MVP problems (P1, P3, P4, P7) ---
  // Design: held-out tests underdetermine the solution — a shallow/wrong algorithm
  // that passes primary tests should fail at least some held-out tests.
  'edit-distance': [
    { code: 'from edit_distance import ${fnName} as f; assert f("food", "money") == 4', desc: 'not-just-len-sum' },
    { code: 'from edit_distance import ${fnName} as f; assert f("aaa", "ab") == 2', desc: 'delete-and-substitute' },
    { code: 'from edit_distance import ${fnName} as f; assert f("pneumonia", "neumonia") == 1', desc: 'single-delete' },
    { code: 'from edit_distance import ${fnName} as f; assert f("abcdef", "azced") == 3', desc: 'substitution-pattern' },
    { code: 'from edit_distance import ${fnName} as f; assert f("a", "b") == 1', desc: 'single-char-replace' },
  ],
  'word-break': [
    { code: 'from word_break import ${fnName} as f; assert f("aaaaaaa", ["aaaa","aaa"]) == True', desc: 'multiple-segmentations' },
    { code: 'from word_break import ${fnName} as f; assert f("ab", ["a","b","c"]) == True', desc: 'two-letter-tiling' },
    { code: 'from word_break import ${fnName} as f; assert f("goals", ["go","al","als","goal","goals"]) == True', desc: 'multi-valid-segmentation' },
    { code: 'from word_break import ${fnName} as f; assert f("catsandog", ["cats","dog","sand","and","cat"]) == False', desc: 'greedy-fails' },
    { code: 'from word_break import ${fnName} as f; assert f("abcd", ["a","abc","bcd"]) == True', desc: 'prefix-ambiguity' },
  ],
  'detect-cycle': [
    { code: 'from detect_cycle import ListNode, ${fnName} as f; a=ListNode(1); b=ListNode(2); a.next=b; b.next=a; assert f(a) == True', desc: 'two-node-cycle' },
    { code: 'from detect_cycle import ListNode, ${fnName} as f; n4=ListNode(4); n3=ListNode(3); n2=ListNode(2,n3); n1=ListNode(1,n2); n3.next=n4; n4.next=n2; assert f(n1) == True', desc: 'tail-to-middle-cycle' },
    { code: 'from detect_cycle import ListNode, ${fnName} as f; n3=ListNode(3); n2=ListNode(2,n3); n1=ListNode(1,n2); assert f(n1) == False', desc: 'no-cycle-length-3' },
    { code: 'from detect_cycle import ListNode, ${fnName} as f; n1=ListNode(1); n1.next=n1; assert f(n1) == True', desc: 'self-loop' },
  ],
  'valid-sudoku': [
    { code: 'from valid_sudoku import ${fnName} as f; b=[["5","3",".",".","7",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]; assert f(b) == True', desc: 'valid-complete' },
    { code: 'from valid_sudoku import ${fnName} as f; b=[[".",".",".",".",".",".",".",".","."],[".",".","4",".",".",".","8",".","."],[".",".",".",".",".",".",".",".","."],[".",".","1",".",".",".",".","2","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".","6",".",".","."],[".",".",".","2",".",".",".",".","."],[".",".",".",".",".","1",".",".","."],[".",".",".",".",".",".",".",".","."]]; assert f(b) == True', desc: 'sparse-valid' },
    { code: 'from valid_sudoku import ${fnName} as f; b=[[".","1",".",".",".",".",".",".","."],["1",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."]]; assert f(b) == False', desc: 'column-duplicate' },
    { code: 'from valid_sudoku import ${fnName} as f; b=[[".",".","5",".",".",".",".",".","."],["5",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."],[".",".",".",".",".",".",".",".","."]]; assert f(b) == False', desc: 'box-duplicate' },
  ],
};

import { execFileSync } from 'child_process';

/**
 * Run held-out tests for a problem against extracted code.
 * Returns { passRate, passed, total, details } where details is
 * an array of { desc, pass, error? }.
 *
 * @param {string} problemName - The problem identifier
 * @param {string} fnName - The expected function name (after sig-repair)
 * @param {string} tmpDir - Directory where code files live
 * @returns {{ passRate: number, passed: number, total: number, details: Array }}
 */
export function runHeldOutTests(problemName, fnName, tmpDir) {
  const suite = heldOutTestSuites[problemName];

  if (!suite || suite.length === 0) {
    return { passRate: NaN, passed: 0, total: 0, details: [], skipReason: 'no held-out suite' };
  }

  // Substitute ${fnName} in test code
  const tests = suite.map(t => ({
    ...t,
    resolvedCode: t.code.replace(/\$\{fnName\}/g, fnName),
  }));

  const details = [];
  let passed = 0;

  for (const test of tests) {
    try {
      execFileSync('python3', ['-c', test.resolvedCode], {
        cwd: tmpDir,
        timeout: 3000,
        stdio: 'pipe',
        env: { ...process.env, PYTHONPATH: tmpDir },
      });
      passed++;
      details.push({ desc: test.desc, pass: true });
    } catch (err) {
      details.push({
        desc: test.desc,
        pass: false,
        error: (err.stderr || Buffer.alloc(0)).toString().slice(0, 200) || (err.message || 'unknown error').slice(0, 200),
      });
    }
  }

  return {
    passRate: passed / suite.length,
    passed,
    total: suite.length,
    details,
  };
}

/**
 * Calculate COH_ATR risk metric.
 * cohAtrRisk = max(0, 1 - heldOutPassRate / primaryPassRate)
 * If primary tests pass > 0 and held-out pass rate drops, risk > 0.
 * If held-out pass rate matches or exceeds primary, risk = 0.
 * If both are 0 (nothing passes), risk = NaN (undefined).
 *
 * @param {number} primaryPassRate - Pass rate on primary test suite (0-1)
 * @param {number} heldOutPassRate - Pass rate on held-out test suite (0-1)
 * @returns {number} cohAtrRisk (0-1, or NaN if undefined)
 */
export function calculateCohAtrRisk(primaryPassRate, heldOutPassRate) {
  // Guard: primaryPassRate = 0 → division by zero. Mark undefined.
  if (primaryPassRate === 0) return NaN;
  // Guard: low primary pass rate → noisy ratio. Mark undefined below 0.6 threshold.
  // Claude's code flag: only treat cohAtrRisk as defined when primaryPassRate ≥ ~0.6;
  // else mark undefined rather than reporting a noisy ratio that poisons aggregate stats.
  if (primaryPassRate < 0.6) return NaN;
  return Math.max(0, 1 - heldOutPassRate / primaryPassRate);
}