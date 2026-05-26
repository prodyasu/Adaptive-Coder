/**
 * informed-repair.js — Delta 4: Feedback-aware autorepair
 *
 * PERM_GRAD explains why metadata-only OS layers don't improve outcomes:
 * interventions must ACT at generation time or REWRITE the artifact, not
 * annotate it post-hoc. Current autorepair feeds verifier suggestions which
 * are vague ("the solution doesn't handle edge cases"). The model already
 * generated the wrong code and gets the same vague spec back.
 *
 * Informed repair closes the loop: run the code, capture the ACTUAL failure
 * (test name, inputs, expected, got), and feed that concrete failure signal
 * back into the coder prompt. This is genuine RCR: the system detects a
 * failure via testing, generates targeted feedback, and retries with
 * information about what specifically went wrong.
 *
 * Three tiers of feedback (ordered by specificity):
 * 1. VERIFIER_FEEDBACK (existing): Verifier's suggestions — vague, model-generated
 * 2. TEST_FAILURE: Concrete test case that failed — inputs, expected, got
 * 3. SPEC_AND_TEST: Spec guidance + concrete test failure — dual signal
 *
 * The tier is selected by autorepairFeedbackMode in opts:
 *   'verifier' (default, backward compat) — same as current behavior
 *   'test_failure' — inject concrete test failure info
 *   'spec_and_test' — spec guidance + concrete test failure
 *
 * Module exports:
 *   - buildInformedRepairPrompt(problemName, code, testOutput, mode)
 *   - extractTestFailure(testOutput, problemName)
 *   - INFORMED_REPAIR_MODES (constant)
 */

export const INFORMED_REPAIR_MODES = {
  VERIFIER: 'verifier',       // Existing behavior: verifier suggestions only
  TEST_FAILURE: 'test_failure', // Concrete test case failure: "your code returned X, expected Y"
  SPEC_AND_TEST: 'spec_and_test', // Both: signature guidance + concrete test failure
};

/**
 * Parse test output to extract the first concrete test failure.
 *
 * @param {string} testOutput - Raw stderr/stdout from running the test
 * @param {string} problemName - Problem identifier for context
 * @returns {{testLine: string, errorType: string, errorMsg: string, rawOutput: string} | null}
 */
export function extractTestFailure(testOutput, problemName) {
  if (!testOutput || typeof testOutput !== 'string') return null;

  // Common Python traceback patterns
  const assertMatch = testOutput.match(/AssertionError:?(.*)/);
  const typeMatch = testOutput.match(/(TypeError|ValueError|IndexError|KeyError|AttributeError|NameError|RecursionError|OverflowError|ZeroDivisionError):\s*(.*)/);
  const timeoutMatch = testOutput.match(/TimeoutError|timed?\s*out/i);

  const lines = testOutput.split('\n').filter(l => l.trim());

  if (timeoutMatch) {
    return {
      testLine: lines.find(l => l.includes('import') || l.includes('assert')) || '',
      errorType: 'TimeoutError',
      errorMsg: 'Solution timed out — likely infinite loop or exponential complexity',
      rawOutput: testOutput.slice(0, 500),
    };
  }

  const errorType = assertMatch ? 'AssertionError' : (typeMatch ? typeMatch[1] : 'Unknown');
  const errorMsg = assertMatch ? assertMatch[1].trim() : (typeMatch ? typeMatch[2].trim() : '');

  // Try to find the specific test line that failed
  const testLine = lines.find(l => l.includes('assert') || l.includes('from ')) || '';

  if (!assertMatch && !typeMatch && !timeoutMatch) {
    // No recognizable error — maybe import error or syntax error
    const importMatch = testOutput.match(/(ImportError|ModuleNotFoundError):\s*(.*)/);
    if (importMatch) {
      return {
        testLine: '',
        errorType: importMatch[1],
        errorMsg: importMatch[2].trim(),
        rawOutput: testOutput.slice(0, 500),
      };
    }
    return null; // No parseable failure
  }

  return {
    testLine,
    errorType,
    errorMsg,
    rawOutput: testOutput.slice(0, 500),
  };
}

/**
 * Build the coder prompt with informed repair feedback.
 *
 * This is the core of Delta 4: instead of "verifier said try again",
 * the coder sees exactly what test case it failed and how.
 *
 * @param {string} problemName - Problem identifier
 * @param {string} code - Previous code attempt that failed
 * @param {string} testOutput - Raw test runner output
 * @param {string} mode - One of INFORMED_REPAIR_MODES
 * @param {Object} opts - Additional options
 * @param {string} [opts.specGuidance] - Spec validation guidance (for SPEC_AND_TEST mode)
 * @param {string} [opts.verifierFeedback] - Verifier suggestions (for VERIFIER mode fallback)
 * @returns {string} Feedback string to inject into coder prompt
 */
export function buildInformedRepairFeedback(problemName, code, testOutput, mode, opts = {}) {
  if (mode === INFORMED_REPAIR_MODES.VERIFIER) {
    // Backward compat: return verifier feedback as-is
    return opts.verifierFeedback || 'Previous attempt failed verification. Try again.';
  }

  const failure = extractTestFailure(testOutput, problemName);

  if (mode === INFORMED_REPAIR_MODES.TEST_FAILURE) {
    if (!failure) {
      // Fallback: couldn't parse failure, use raw output
      return `Previous attempt failed testing. Error output:\n${testOutput?.slice(0, 400) || 'No output'}\n\nFix the error and try again.`;
    }

    if (failure.errorType === 'TimeoutError') {
      return `Previous attempt timed out. Your solution likely has an infinite loop or exponential complexity.\nOptimize the algorithm (e.g., use memoization, reduce nesting, or switch to a more efficient approach).`;
    }

    let feedback = `Previous attempt failed a test case:\n`;
    if (failure.testLine) {
      feedback += `  Test: ${failure.testLine.trim()}\n`;
    }
    feedback += `  Error: ${failure.errorType}`;
    if (failure.errorMsg) {
      feedback += `: ${failure.errorMsg}`;
    }
    feedback += `\n\nFix the specific error and resubmit your solution.`;
    return feedback;
  }

  if (mode === INFORMED_REPAIR_MODES.SPEC_AND_TEST) {
    let feedback = '';

    // Spec guidance first (if available)
    if (opts.specGuidance) {
      feedback += `Signature mismatch: ${opts.specGuidance}\n\n`;
    }

    // Then concrete test failure
    if (failure) {
      if (failure.errorType === 'TimeoutError') {
        feedback += `Previous attempt timed out. Optimize your algorithm (memoization, reduce complexity).\n`;
      } else {
        feedback += `Previous attempt failed a test case:\n`;
        if (failure.testLine) {
          feedback += `  Test: ${failure.testLine.trim()}\n`;
        }
        feedback += `  Error: ${failure.errorType}`;
        if (failure.errorMsg) {
          feedback += `: ${failure.errorMsg}`;
        }
        feedback += `\n`;
      }
    } else if (testOutput) {
      feedback += `Previous attempt failed. Error:\n${testOutput.slice(0, 400)}\n`;
    }

    feedback += `\nFix the error and resubmit.`;
    return feedback;
  }

  // Unknown mode — fallback to verifier
  return opts.verifierFeedback || 'Previous attempt failed. Try again.';
}

/**
 * Run primary tests with detailed output capture.
 * Unlike runBasicTest which returns {pass, detail}, this returns
 * the full test output for failure analysis.
 *
 * @param {string} problemName - Problem identifier
 * @param {string} code - Code to test
 * @returns {{passed: boolean, testOutput: string, failCount: number, passCount: number}}
 */
export function runTestsWithOutput(problemName, code) {
  const moduleName = problemName.replace(/-/g, '_');
  const tmpDir = require('os').tmpdir();
  const modulePath = require('path').join(tmpDir, `${moduleName}.py`);
  require('fs').writeFileSync(modulePath, code);

  // Detect function name
  const fnMatch = code.match(/^def\s+(\w+)/m);
  const classMatch = code.match(/^class\s+(\w+)/m);
  if (!fnMatch && !classMatch) {
    return { passed: false, testOutput: 'no function or class definition found', failCount: 1, passCount: 0 };
  }
  const fnName = fnMatch ? fnMatch[1] : classMatch[1];

  // Import test suites
  const { getTestSuites } = require('./held-out-test-suites.js');
  // Fallback to inline primary tests for basic coverage
  const primaryTests = getPrimaryTests(problemName, fnName);
  if (!primaryTests || primaryTests.length === 0) {
    return { passed: false, testOutput: 'no test suite found', failCount: 1, passCount: 0 };
  }

  let passCount = 0;
  let failCount = 0;
  const failures = [];

  for (const test of primaryTests) {
    try {
      const { execSync } = require('child_process');
      execSync(`cd ${tmpDir} && python3 -c "${test.replace(/"/g, '\\"')}"`, {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      passCount++;
    } catch (err) {
      failCount++;
      const stderr = err.stderr?.toString() || err.message || String(err);
      failures.push({ test: test.slice(0, 120), error: stderr.slice(0, 300) });
    }
  }

  const testOutput = failures.length > 0
    ? failures.map(f => `Test: ${f.test}\nError: ${f.error}`).join('\n\n')
    : `All ${passCount} tests passed`;

  return {
    passed: failCount === 0,
    testOutput,
    failCount,
    passCount,
  };
}

/**
 * Get primary test cases (inline, matching eval.js format).
 * These are the same tests that runBasicTest uses.
 */
function getPrimaryTests(problemName, fnName) {
  const suites = {
    'binary-search': [
      `from binary_search import ${fnName} as f; assert f([1,3,5,7], 5) == 2`,
      `from binary_search import ${fnName} as f; assert f([1,3,5,7], 4) == -1`,
      `from binary_search import ${fnName} as f; assert f([1], 1) == 0`,
    ],
    'climbing-stairs': [
      `from climbing_stairs import ${fnName} as f; assert f(1) == 1`,
      `from climbing_stairs import ${fnName} as f; assert f(2) == 2`,
      `from climbing_stairs import ${fnName} as f; assert f(3) == 3`,
      `from climbing_stairs import ${fnName} as f; assert f(4) == 5`,
      `from climbing_stairs import ${fnName} as f; assert f(5) == 8`,
    ],
    'container-with-most-water': [
      `from container_with_most_water import ${fnName} as f; assert f([1,8,6,2,5,4,8,3,7]) == 49`,
    ],
    'coin-change-ii': [
      `from coin_change_ii import ${fnName} as f; assert f(5, [1,2,5]) == 4`,
      `from coin_change_ii import ${fnName} as f; assert f(3, [2]) == 0`,
      `from coin_change_ii import ${fnName} as f; assert f(0, [1,2,5]) == 1`,
    ],
    'two-sum': [
      `from two_sum import ${fnName} as f; r = f([2,7,11,15], 9); assert set(r) == {0, 1}`,
      `from two_sum import ${fnName} as f; r = f([3,2,4], 6); assert set(r) == {1, 2}`,
      `from two_sum import ${fnName} as f; r = f([3,3], 6); assert set(r) == {0, 1}`,
    ],
    'valid-palindrome': [
      `from valid_palindrome import ${fnName} as f; assert f("A man, a plan, a canal: Panama") == True`,
      `from valid_palindrome import ${fnName} as f; assert f("race a car") == False`,
      `from valid_palindrome import ${fnName} as f; assert f(" ") == True`,
      `from valid_palindrome import ${fnName} as f; assert f("ab") == False`,
    ],
    'number-of-islands': [
      `from number_of_islands import ${fnName} as f; assert f([["1","1","1"],["0","1","0"],["1","1","1"]]) == 1`,
    ],
    'invert-binary-tree': [
      `import json; from invert_binary_tree import TreeNode, ${fnName} as f; t = TreeNode(4, TreeNode(2, TreeNode(1), TreeNode(3)), TreeNode(7, TreeNode(6), TreeNode(9))); r = f(t); assert r.val == 4 and r.left.val == 7`,
    ],
  };

  return suites[problemName] || [];
}