/**
 * pgg-filter.js — PGG rejection filter (Predicate-Gated Generation)
 *
 * Runs the PGG assertions against generated code BEFORE the verifier.
 * If any assertion fails, the code is rejected and the pipeline resamples
 * (up to MAX_PGG_RESAMPLES) without counting against k.
 *
 * Mechanism:
 *   Coder → [PGG filter] → Verifier → (fail) → Autorepair → [PGG filter] → ...
 *
 * The filter executes Python assertions via execFileSync with a 2000ms timeout.
 * This is intentionally cheap — no model calls, just subprocess execution.
 *
 * Module exports:
 *   - pggFilter(code, problemName, assertions, fnName) — returns { accepted, results, failedCount, totalCount }
 *   - pggFilterSync(code, problemName, assertions, fnName) — sync version for eval.js integration
 */

import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PGG_ASSERTION_TIMEOUT_MS = 2000;
export const MAX_PGG_RESAMPLES = 10;

// ---------------------------------------------------------------------------
// Core filter function
// ---------------------------------------------------------------------------

/**
 * Rewrite assertion imports so curated assertions can consistently call `f(...)`
 * while generated code keeps the problem's real signature name.
 *
 * Example:
 *   from word_break import f; assert f(...)
 * becomes:
 *   from word_break import wordBreak as f; assert f(...)
 *
 * Also handles mixed imports like:
 *   from detect_cycle import ListNode, f; ...
 */
function rewriteAssertionImport(expr, fnName) {
  if (!fnName || fnName === 'f') return expr;

  return expr.replace(/from\s+(\S+)\s+import\s+([^;\n]+)/, (match, moduleName, importList) => {
    const rewrittenImports = importList.split(',').map(part => {
      const trimmed = part.trim();
      if (trimmed === 'f' || trimmed.startsWith('f as ')) {
        return ` ${fnName} as f`;
      }
      return part;
    }).join(',');

    return `from ${moduleName} import${rewrittenImports}`;
  });
}

/**
 * Run PGG assertions against generated code.
 *
 * @param {string} code - Python code from Coder
 * @param {string} problemName - Problem identifier
 * @param {Array<{input: string, expected: string, expr: string}>} assertions - PGG assertions
 * @param {string} fnName - Function name to test against
 * @returns {{ accepted: boolean, results: Array, failedCount: number, totalCount: number }}
 */
export function pggFilter(code, problemName, assertions, fnName) {
  if (!assertions || assertions.length === 0) {
    return { accepted: true, results: [], failedCount: 0, totalCount: 0, reason: 'no_assertions' };
  }

  const tmpDir = tmpdir();
  const moduleName = problemName.replace(/-/g, '_');

  // Write code to temp file
  const modulePath = join(tmpDir, `${moduleName}.py`);
  let safeCode = code;
  try {
    writeFileSync(modulePath, safeCode);
  } catch (err) {
    return {
      accepted: false,
      results: [],
      failedCount: assertions.length,
      totalCount: assertions.length,
      reason: 'file_write_error',
      error: err.message,
    };
  }

  const results = [];

  for (const assertion of assertions) {
    // Build the test script — import the function and run the assertion
    // The assertion.expr already has the full "from module import f; assert ..." form
    let testScript;
    if (assertion.expr.includes('import')) {
      // Already has import statement embedded. Rewrite any imported `f` alias
      // to point at the real generated function name before executing.
      testScript = rewriteAssertionImport(assertion.expr, fnName);
    } else {
      // Build from parts
      testScript = `from ${moduleName} import ${fnName} as f\nassert ${assertion.expr}`;
    }

    try {
      execFileSync('python3', ['-c', testScript], {
        cwd: tmpDir,
        timeout: PGG_ASSERTION_TIMEOUT_MS,
        stdio: 'pipe',
        env: { ...process.env, PYTHONPATH: tmpDir },
      });
      results.push({
        ...assertion,
        passed: true,
      });
    } catch (err) {
      const errorStr = (err.stderr || Buffer.alloc(0)).toString().slice(0, 300) ||
                       (err.stdout || Buffer.alloc(0)).toString().slice(0, 300) ||
                       err.message?.slice(0, 300) || 'unknown';
      results.push({
        ...assertion,
        passed: false,
        error: errorStr,
      });
    }
  }

  const failedCount = results.filter(r => !r.passed).length;
  const allPassed = failedCount === 0;

  return {
    accepted: allPassed,
    results,
    failedCount,
    totalCount: results.length,
  };
}

/**
 * Sync wrapper for pggFilter that extracts fnName from code dynamically.
 * Used when fnName is not explicitly provided.
 *
 * @param {string} code - Python code
 * @param {string} problemName - Problem identifier
 * @param {Array} assertions - PGG assertions
 * @returns {{ accepted: boolean, results: Array, failedCount: number, totalCount: number }}
 */
export function pggFilterAuto(code, problemName, assertions) {
  // Detect function name from code
  const fnMatch = code.match(/^def\s+(\w+)/m);
  const classMatch = code.match(/^class\s+(\w+)/m);

  let fnName;
  if (fnMatch) {
    fnName = fnMatch[1];
  } else if (classMatch) {
    fnName = classMatch[1];
  } else {
    return {
      accepted: false,
      results: [],
      failedCount: assertions?.length || 0,
      totalCount: assertions?.length || 0,
      reason: 'no_function_found',
    };
  }

  return pggFilter(code, problemName, assertions, fnName);
}

// ---------------------------------------------------------------------------
// Prompt formatting for Coder injection
// ---------------------------------------------------------------------------

/**
 * Format PGG assertions into a Coder system prompt section.
 *
 * Pattern from spec:
 *   --- VERIFIABLE ASSERTIONS ---
 *   After implementation, your function `f` must pass:
 *       assert f(1) == 1
 *       assert f(2) == 2
 *       assert f(5) == 8
 *   These will be executed against your code before any further evaluation.
 *   A failing assertion = rejection, no scoring.
 *   --- END ASSERTIONS ---
 *
 * @param {Array<{input: string, expected: string, expr: string}>} assertions - PGG assertions
 * @param {string} fnName - The function name (optional, extracted from code if not provided)
 * @returns {string} Formatted assertion block for Coder prompt
 */
export function formatAssertionsForPrompt(assertions, fnName = 'f') {
  if (!assertions || assertions.length === 0) {
    return '';
  }

  const lines = [
    '\n--- VERIFIABLE ASSERTIONS (your code MUST satisfy these) ---',
    'After implementation, your function must pass these assertions:',
  ];

  for (const a of assertions) {
    // Extract just the assertion expression (strip "from module import ...")
    // For prompt display, we show executable assert statements
    if (a.expr.includes('assert ')) {
      // Extract the assert part from the full expr
      const assertPart = a.expr.replace(/^from\s+\S+\s+import\s+\S+\s+as\s+\w+;\s*/, '');
      lines.push(`    ${assertPart}`);
    } else {
      lines.push(`    assert ${a.expr}`);
    }
  }

  lines.push('These will be executed against your code before any further evaluation.');
  lines.push('A failing assertion = rejection, no scoring.');
  lines.push('--- END ASSERTIONS ---\n');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Diagnostician integration (failure classification for PGG failures)
// ---------------------------------------------------------------------------

/**
 * Given a pggFilter result, classify WHY it failed.
 * Returns a failure class suitable for diagnostician.js classification.
 *
 * @param {{ accepted: boolean, results: Array, failedCount: number, totalCount: number }} filterResult
 * @returns {{ failureKind: string, failureSubKind: string, testDetail: string }}
 */
export function classifyPggFailure(filterResult) {
  if (filterResult.accepted) {
    return { failureKind: 'none', failureSubKind: 'none', testDetail: 'pgg_passed' };
  }

  const failedAssertions = filterResult.results?.filter(r => !r.passed) || [];

  if (failedAssertions.length === 0) {
    return { failureKind: 'pgg_filter', failureSubKind: 'unknown', testDetail: 'no_assertions_failed_but_rejected' };
  }

  // Analyze failure patterns
  const errors = failedAssertions.map(a => a.error || '').join(' | ').toLowerCase();

  if (errors.includes('timeout') || errors.includes('timed out')) {
    return { failureKind: 'timeout', failureSubKind: 'pgg_execution', testDetail: 'pgg_assertion_timeout' };
  }

  if (errors.includes('typeerror') || errors.includes('attributeerror')) {
    return { failureKind: 'logic', failureSubKind: 'type_error', testDetail: 'pgg_type_error' };
  }

  if (errors.includes('assertionerror')) {
    // Check if it's off-by-one
    const assertionErrors = failedAssertions
      .filter(a => a.error?.includes('AssertionError'))
      .map(a => {
        const match = a.error?.match(/assert\s+(.+?)\s*==\s*(.+)/);
        if (match) {
          const got = parseFloat(match[1]);
          const expected = parseFloat(match[2]);
          if (!isNaN(got) && !isNaN(expected) && Math.abs(got - expected) === 1) {
            return 'off_by_one';
          }
        }
        return 'assertion_failed';
      });

    if (assertionErrors.some(e => e === 'off_by_one')) {
      return { failureKind: 'logic', failureSubKind: 'off_by_one', testDetail: 'pgg_off_by_one' };
    }

    return { failureKind: 'logic', failureSubKind: 'assertion_failed', testDetail: 'pgg_assertion_failed' };
  }

  return { failureKind: 'pgg_filter', failureSubKind: 'execution_error', testDetail: errors.slice(0, 200) };
}