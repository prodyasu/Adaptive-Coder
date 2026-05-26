/**
 * problem-assertions.js — Curated PGG assertion table for all 12 problems
 *
 * K=3 assertions per problem (Phase 1 spec), DISJOINT from:
 *   - Primary test suite (runBasicTest in eval.js)
 *   - Held-out test suite (held-out-test-suites.js)
 *
 * These are hand-authored I/O pairs that:
 *   (1) Are NOT in the primary or held-out test data
 *   (2) Provide discriminative signal without trivial leak
 *   (3) Cover the core algorithmic property of each problem
 *
 * The extractAssertions() function uses the curated table as Layer 1,
 * and falls back to Layer 2 (Shaper spec parsing) for unknown problems.
 *
 * CRITICAL: K5 kill criterion — assertions must NOT be subsets of test data.
 * test-pgg-disjointness.js guards this.
 */

// ---------------------------------------------------------------------------
// Layer 1: Curated assertions (frozen, source of truth)
// ---------------------------------------------------------------------------
// Format: { input: string, expected: string, expr: Python assert expression }
//
// Disjointness notes:
// - climbing-stairs: PGG assertions use n=6,7,20 — different from primary (1,2,3,4,5) and held-out (6,7,20 overlap!)
//   → FIX: use n=8,9,10 which are all distinct from primary and held-out
// - binary-search: PGG assertions use different target positions than primary (0,1,2,4) and held-out (0,4,end,begin,between)
//   → Use targets that test different search space boundaries
// - edit-distance: Use inputs not in primary ("abc","") or held-out ("food","aaa","pneumonia","abcdef","a","")
//   → "cat"→"dog", ""→"x", "xyz"→""
// - word-break: Use different word lists than primary (["leet","code"],["apple","pen"],["cats","dog","sand","and","cat"])
//   → "dogs" with ["dog"], "abcde" with ["ab","c","de","abc"]
// - detect-cycle: Use different list structures than primary (3-node chain with cycle at node[3]) and held-out (2-node, tail-to-middle, self-loop)
//   → Test 4-node cycle at different position, empty list, single node
// - valid-sudoku: Use different boards than primary (full valid, invalid by row/col, empty) and held-out (valid-complete, sparse-valid, column-duplicate, box-duplicate)
//   → Partially-filled valid board, board invalid by row duplicate, board invalid by box duplicate
//
// For problems with small test spaces (e.g., valid-sudoku), we use board configurations
// that exercise different constraint combinations rather than just different literals.

export const PGG_ASSERTIONS = {
  // --- Standard N=8 (from problems.js loadHeldOutProblems) ---

  'climbing-stairs': [
    { input: '8',  expected: '34',  expr: 'from climbing_stairs import f; assert f(8) == 34' },
    { input: '9',  expected: '55',  expr: 'from climbing_stairs import f; assert f(9) == 55' },
    { input: '10', expected: '89',  expr: 'from climbing_stairs import f; assert f(10) == 89' },
  ],

  'binary-search': [
    { input: '[1,3,5,7,9], 1',  expected: '0',  expr: 'from binary_search import f; assert f([1,3,5,7,9], 1) == 0' },
    { input: '[1,3,5,7,9], 9',  expected: '4',  expr: 'from binary_search import f; assert f([1,3,5,7,9], 9) == 4' },
    { input: '[2,4,6,8], 5',    expected: '-1', expr: 'from binary_search import f; assert f([2,4,6,8], 5) == -1' },
  ],

  'container-with-most-water': [
    { input: '[1,1]',           expected: '1',  expr: 'from container_with_most_water import f; assert f([1,1]) == 1' },
    { input: '[1,2,3,4,5,6]',  expected: '9',  expr: 'from container_with_most_water import f; assert f([1,2,3,4,5,6]) == 9' },
    { input: '[3,9,1,2]',      expected: '9',  expr: 'from container_with_most_water import f; assert f([3,9,1,2]) == 9' },
  ],

  'coin-change-ii': [
    { input: '1, [1]',         expected: '1',  expr: 'from coin_change_ii import f; assert f(1, [1]) == 1' },
    { input: '2, [1,2]',       expected: '2',  expr: 'from coin_change_ii import f; assert f(2, [1,2]) == 2' },
    { input: '4, [1,2,3]',     expected: '4',  expr: 'from coin_change_ii import f; assert f(4, [1,2,3]) == 4' },
  ],

  'two-sum': [
    { input: '[1,2,3], 5',     expected: 'set([0,2])', expr: 'from two_sum import f; assert set(f([1,2,3], 5)) == {0,2}' },
    { input: '[0,4,3,0], 0',  expected: 'set([0,3])', expr: 'from two_sum import f; assert set(f([0,4,3,0], 0)) == {0,3}' },
    { input: '[5,25], 30',     expected: 'set([0,1])', expr: 'from two_sum import f; assert set(f([5,25], 30)) == {0,1}' },
  ],

  'valid-palindrome': [
    { input: '"Was it a car or a cat I saw?"', expected: 'True',  expr: 'from valid_palindrome import f; assert f("Was it a car or a cat I saw?") == True' },
    { input: '"No lemon, no melon"',          expected: 'True',  expr: 'from valid_palindrome import f; assert f("No lemon, no melon") == True' },
    { input: '"$1-a b#3$"',                   expected: 'True',  expr: 'from valid_palindrome import f; assert f("$1-a b#3$") == True' },
  ],

  'number-of-islands': [
    { input: '[["1","1","0"],["1","1","0"],["0","0","1"]]', expected: '2', expr: 'from number_of_islands import f; assert f([["1","1","0"],["1","1","0"],["0","0","1"]]) == 2' },
    { input: '[["1","0","1"],["0","0","0"],["1","0","1"]]', expected: '3', expr: 'from number_of_islands import f; assert f([["1","0","1"],["0","0","0"],["1","0","1"]]) == 3' },
    { input: '[["1","1","1"],["1","0","1"],["1","1","1"]]', expected: '1', expr: 'from number_of_islands import f; assert f([["1","1","1"],["1","0","1"],["1","1","1"]]) == 1' },
  ],

  'invert-binary-tree': [
    { input: 'TreeNode(2, TreeNode(1), TreeNode(3))',  expected: 'val=2,left=3,right=1', expr: 'from invert_binary_tree import f, TreeNode; r=f(TreeNode(2, TreeNode(1), TreeNode(3))); assert r.val==2 and r.left.val==3 and r.right.val==1' },
    { input: 'TreeNode(5, TreeNode(3, TreeNode(1), TreeNode(4)), TreeNode(7, TreeNode(6), TreeNode(9)))', expected: 'val=5,left=9,right=3', expr: 'from invert_binary_tree import f, TreeNode; r=f(TreeNode(5, TreeNode(3, TreeNode(1), TreeNode(4)), TreeNode(7, TreeNode(6), TreeNode(9)))); assert r.val==5 and r.left.val==9 and r.right.val==3' },
    { input: 'TreeNode(1, TreeNode(2, TreeNode(3), None), None)', expected: 'val=1,left=None,right=2', expr: 'from invert_binary_tree import f, TreeNode; r=f(TreeNode(1, TreeNode(2, TreeNode(3), None), None)); assert r.val==1 and r.right.val==2 and r.right.left.val==3' },
  ],

  // --- Stress-suite MVP (P1, P3, P4, P7) — failure-rich problems ---

  'edit-distance': [
    { input: '"cat", "dog"', expected: '3',  expr: 'from edit_distance import f; assert f("cat", "dog") == 3' },
    { input: '"", "x"',      expected: '1',  expr: 'from edit_distance import f; assert f("", "x") == 1' },
    { input: '"xyz", ""',    expected: '3',  expr: 'from edit_distance import f; assert f("xyz", "") == 3' },
  ],

  'word-break': [
    { input: '"abcde", ["ab","c","de"]', expected: 'True',  expr: 'from word_break import f; assert f("abcde", ["ab","c","de"]) == True' },
    { input: '"abab", ["ab","aba"]',     expected: 'True',  expr: 'from word_break import f; assert f("abab", ["ab","aba"]) == True' },
    { input: '"abc", ["ab","bc"]',       expected: 'False', expr: 'from word_break import f; assert f("abc", ["ab","bc"]) == False' },
  ],

  'detect-cycle': [
    // 4-node cycle from node 4 back to node 2 (different from primary's 3-node cycle at n3→n0→n2→n3)
    { input: 'ListNode(1, ListNode(2, ListNode(3, ListNode(4)))) — node4.next=node2', expected: 'True',  expr: 'from detect_cycle import ListNode, f; n1=ListNode(1); n2=ListNode(2); n3=ListNode(3); n4=ListNode(4); n1.next=n2; n2.next=n3; n3.next=n4; n4.next=n2; assert f(n1) == True' },
    // Self-loop (different from primary's no-cycle single node)
    { input: 'ListNode(42).next=ListNode(42) — self-loop', expected: 'True',  expr: 'from detect_cycle import ListNode, f; n=ListNode(42); n.next=n; assert f(n) == True' },
    // Two-node chain with no cycle (different from primary's single node)
    { input: 'ListNode(1).next=ListNode(2) — two nodes, no cycle', expected: 'False', expr: 'from detect_cycle import ListNode, f; n1=ListNode(1); n2=ListNode(2); n1.next=n2; assert f(n1) == False' },
  ],

  'valid-sudoku': [
    // Partially-filled valid board (different from primary full valid + invalid)
    { input: 'board with rows: ["5","3",".",".",".",".",".",".","."], ["6",".",".","1","9","5",".",".","."], [".","9","8",".",".",".",".","6","."], ["8",".",".",".","6",".",".",".","3"], ["4",".",".","8",".","3",".",".","1"], ["7",".",".",".","2",".",".",".","6"], [".","6",".",".",".",".","2","8","."], [".",".",".","4","1","9",".",".","5"], [".",".",".",".","8",".",".","7","9"] — valid partial', expected: 'True', expr: 'from valid_sudoku import f; b=[["5","3",".",".",".",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]; assert f(b) == True' },
    // Row duplicate invalid board
    { input: 'board with duplicate "5" in row 0', expected: 'False', expr: 'from valid_sudoku import f; b=[["5","5","3",".",".",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]; assert f(b) == False' },
    // Box duplicate invalid board
    { input: 'board with duplicate "1" in 3x3 box top-left', expected: 'False', expr: 'from valid_sudoku import f; b=[["1","1","3",".",".",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]; assert f(b) == False' },
  ],
};

// ---------------------------------------------------------------------------
// Layer 2: Parse from Shaper spec (fallback for unknown problems)
// ---------------------------------------------------------------------------

/**
 * Parse acceptance criteria from a Shaper spec for I/O pairs.
 * Looks for patterns like:
 *   - "f(1) returns 2"
 *   - "input X should produce Y"
 *   - "assert f(X) == Y"
 *
 * @param {Array<string>} criteria - acceptance_criteria array from Shaper spec
 * @returns {Array<{input: string, expected: string, expr: string}>}
 */
function parseAcceptanceCriteria(criteria) {
  if (!Array.isArray(criteria)) return [];

  const assertions = [];
  for (const c of criteria) {
    // Pattern: "f(1) returns 2" or "f([1,2], 3) returns 4"
    const returnsMatch = c.match(/f\(([^)]+)\)\s+returns?\s+(\S+)/i);
    if (returnsMatch) {
      const input = returnsMatch[1].trim();
      const expected = returnsMatch[2].trim().replace(/[.,]$/, '');
      assertions.push({
        input,
        expected,
        expr: `from module import f; assert f(${input}) == ${expected}`,
      });
    }

    // Pattern: "assert f(X) == Y"
    const assertMatch = c.match(/assert\s+f\(([^)]+)\)\s*==\s*(\S+)/i);
    if (assertMatch) {
      const input = assertMatch[1].trim();
      const expected = assertMatch[2].trim().replace(/[.,]$/, '');
      assertions.push({
        input,
        expected,
        expr: `from module import f; assert f(${input}) == ${expected}`,
      });
    }

    // Pattern: "input X should produce Y"
    const produceMatch = c.match(/input\s+([^(]+?)\s+should\s+produce\s+(\S+)/i);
    if (produceMatch) {
      const input = produceMatch[1].trim();
      const expected = produceMatch[2].trim().replace(/[.,]$/, '');
      assertions.push({
        input,
        expected,
        expr: `from module import f; assert f(${input}) == ${expected}`,
      });
    }
  }

  return assertions;
}

// ---------------------------------------------------------------------------
// Main export: extractAssertions
// ---------------------------------------------------------------------------

/**
 * Extract PGG assertions for a problem.
 *
 * Layer 1: Curated table (PGG_ASSERTIONS) — preferred, frozen
 * Layer 2: Parse from Shaper spec acceptance_criteria — fallback
 *
 * @param {string} problemName - Problem identifier
 * @param {Object} spec - Optional Shaper spec object (may have acceptance_criteria)
 * @returns {Array<{input: string, expected: string, expr: string}>}
 */
export function extractAssertions(problemName, spec = null) {
  // Layer 1: curated
  if (PGG_ASSERTIONS[problemName]) {
    return PGG_ASSERTIONS[problemName];
  }

  // Layer 2: parse from spec
  if (spec && Array.isArray(spec.acceptance_criteria) && spec.acceptance_criteria.length > 0) {
    return parseAcceptanceCriteria(spec.acceptance_criteria);
  }

  // No assertions available
  return [];
}

/**
 * Get all problem names that have curated PGG assertions.
 * @returns {string[]}
 */
export function getProblemNames() {
  return Object.keys(PGG_ASSERTIONS);
}