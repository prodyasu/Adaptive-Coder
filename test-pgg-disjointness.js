/**
 * test-pgg-disjointness.js — Verify PGG assertions are disjoint from test data
 *
 * This guards against K5 contamination: if PGG assertions are subsets of
 * the primary test suite or held-out test suite, they trivially boost
 * pass@1 by leaking test data into the prompt.
 *
 * The disjointness check uses string containment: an assertion is
 * considered "contaminating" if its input/expected pair appears as a
 * substring in any primary or held-out test.
 *
 * Run: node test-pgg-disjointness.js
 */

import { PGG_ASSERTIONS } from './problem-assertions.js';
import { heldOutTestSuites } from './held-out-test-suites.js';

// ---------------------------------------------------------------------------
// Primary test suite (from eval.js runBasicTest)
// ---------------------------------------------------------------------------

// Reconstructed from eval.js runBasicTest — all test cases per problem
const PRIMARY_TEST_SUITES = {
  'climbing-stairs': [
    `f(1) == 1`,
    `f(2) == 2`,
    `f(3) == 3`,
    `f(4) == 5`,
    `f(5) == 8`,
  ],
  'binary-search': [
    `f([1,3,5,7], 5) == 2`,
    `f([1,3,5,7], 4) == -1`,
    `f([1], 1) == 0`,
  ],
  'container-with-most-water': [
    `f([1,8,6,2,5,4,8,3,7]) == 49`,
  ],
  'coin-change-ii': [
    `f(5, [1,2,5]) == 4`,
    `f(3, [2]) == 0`,
    `f(0, [1,2,5]) == 1`,
  ],
  'two-sum': [
    `f([2,7,11,15], 9) == {0, 1}`,
    `f([3,2,4], 6) == {1, 2}`,
    `f([3,3], 6) == {0, 1}`,
  ],
  'valid-palindrome': [
    `f("A man, a plan, a canal: Panama") == True`,
    `f("race a car") == False`,
    `f(" ") == True`,
    `f("ab") == False`,
  ],
  'number-of-islands': [
    `f([["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]) == 1`,
    `f([["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]) == 3`,
    `f([["1"]]) == 1`,
    `f([["0","0"],["0","0"]]) == 0`,
  ],
  'invert-binary-tree': [
    `f(TreeNode(4, TreeNode(2, TreeNode(1), TreeNode(3)), TreeNode(7, TreeNode(6), TreeNode(9))))`,
  ],
  'edit-distance': [
    `f("horse", "ros") == 3`,
    `f("intention", "execution") == 5`,
    `f("", "abc") == 3`,
    `f("abc", "") == 3`,
  ],
  'word-break': [
    `f("leetcode", ["leet","code"]) == True`,
    `f("applepenapple", ["apple","pen"]) == True`,
    `f("catsandog", ["cats","dog","sand","and","cat"]) == False`,
  ],
  'detect-cycle': [
    `f(n1) == True`,  // 3-node cycle
    `f(None) == False`,
    `f(ListNode(1)) == False`,
  ],
  'valid-sudoku': [
    `f(b) == True`,   // full valid board
    `f(b) == False`,  // row duplicate
    `f(b) == False`,  // col/box duplicate
    `f(b) == True`,   // empty board
  ],
};

// ---------------------------------------------------------------------------
// Disjointness checker
// ---------------------------------------------------------------------------

/**
 * Check if an assertion is a substring of any primary test.
 * Returns { contaminates: boolean, matchedTest: string | null }
 */
function checkPrimaryContamination(problemName, assertion) {
  const primaryTests = PRIMARY_TEST_SUITES[problemName] || [];
  const assertionStr = `${assertion.input}|${assertion.expected}`.toLowerCase();

  for (const test of primaryTests) {
    const testStr = test.toLowerCase();
    // Check if assertion input+expected appears as substring in test
    if (testStr.includes(assertionStr) || assertionStr.includes(testStr)) {
      return { contaminates: true, matchedTest: test };
    }

    // Also check just the expected value
    if (test.includes(assertion.expected)) {
      // Check if input pattern matches too
      const inputNorm = normalizeInput(assertion.input);
      const testNorm = normalizeInput(test);
      if (inputNorm && testNorm.includes(inputNorm)) {
        return { contaminates: true, matchedTest: test };
      }
    }
  }

  return { contaminates: false, matchedTest: null };
}

/**
 * Check if an assertion is a substring of any held-out test.
 */
function checkHeldOutContamination(problemName, assertion) {
  const heldOutSuite = heldOutTestSuites[problemName] || [];
  const assertionStr = `${assertion.input}|${assertion.expected}`.toLowerCase();

  for (const testEntry of heldOutSuite) {
    const testCode = testEntry.code.toLowerCase();
    const testDesc = (testEntry.desc || '').toLowerCase();

    // Check if assertion input+expected appears in test code or description
    if (testCode.includes(assertionStr) || assertionStr.includes(testCode)) {
      return { contaminates: true, matchedTest: testEntry.desc };
    }

    // Check just expected value in test code
    if (testCode.includes(assertion.expected.toLowerCase())) {
      // Heuristic: if expected value appears with a similar input pattern, flag it
      const inputNorm = normalizeInput(assertion.input);
      if (inputNorm && testCode.includes(inputNorm)) {
        return { contaminates: true, matchedTest: testEntry.desc };
      }
    }
  }

  return { contaminates: false, matchedTest: null };
}

/**
 * Normalize an input string for comparison.
 * Removes spaces, brackets, quotes for easier matching.
 */
function normalizeInput(input) {
  if (!input) return '';
  return input.toLowerCase().replace(/\s+/g, '').replace(/['"]/g, '');
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

let contaminationFound = false;

console.log('\n=== test-pgg-disjointness.js ===\n');
console.log('Checking PGG assertions against primary and held-out test suites...\n');

for (const [problemName, assertions] of Object.entries(PGG_ASSERTIONS)) {
  console.log(`Problem: ${problemName}`);
  let problemContaminated = false;

  for (const assertion of assertions) {
    const primaryCheck = checkPrimaryContamination(problemName, assertion);
    const heldOutCheck = checkHeldOutContamination(problemName, assertion);

    if (primaryCheck.contaminates) {
      console.log(`  ✗ PRIMARY CONTAMINATION: input=${assertion.input}, expected=${assertion.expected}`);
      console.log(`    Matched test: ${primaryCheck.matchedTest}`);
      problemContaminated = true;
      contaminationFound = true;
    }

    if (heldOutCheck.contaminates) {
      console.log(`  ✗ HELD-OUT CONTAMINATION: input=${assertion.input}, expected=${assertion.expected}`);
      console.log(`    Matched test desc: ${heldOutCheck.matchedTest}`);
      problemContaminated = true;
      contaminationFound = true;
    }
  }

  if (!problemContaminated) {
    console.log(`  ✓ No contamination detected (${assertions.length} assertions)`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

if (contaminationFound) {
  console.log('!!! CONTAMINATION DETECTED — PGG assertions overlap with test data !!!');
  console.log('This is a K5 kill criterion. Fix the assertions before running PGG experiments.\n');
  process.exit(1);
} else {
  console.log('✓ All PGG assertions are disjoint from primary and held-out test suites.');
  console.log('✓ K5 contamination check PASSED.\n');
  process.exit(0);
}