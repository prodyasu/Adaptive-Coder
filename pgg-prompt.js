/**
 * pgg-prompt.js — Format PGG assertions for the Coder system prompt
 *
 * Injects VERIFIABLE ASSERTIONS block into the Coder prompt.
 * The assertions are executable Python assert statements that will be
 * run against the generated code BEFORE the verifier.
 *
 * Pattern:
 *   --- VERIFIABLE ASSERTIONS ---
 *   After implementation, your function `f` must pass:
 *       assert f(1) == 1
 *       assert f(2) == 2
 *       assert f(5) == 8
 *   These will be executed against your code before any further evaluation.
 *   A failing assertion = rejection, no scoring.
 *   --- END ASSERTIONS ---
 *
 * Module exports:
 *   - formatPggAssertions(assertions, fnName?) — returns formatted prompt section
 *   - buildPggCoderPrompt(basePrompt, assertions, fnName?) — adds assertions to base prompt
 */

import { formatAssertionsForPrompt } from './pgg-filter.js';

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Format PGG assertions into a Coder system prompt section.
 * This is the main entry point for eval.js to inject assertions into the Coder prompt.
 *
 * @param {Array<{input: string, expected: string, expr: string}>} assertions - PGG assertions
 * @param {string} [fnName='f'] - The function name to reference in assertions
 * @returns {string} Formatted assertion block
 */
export function formatPggAssertions(assertions, fnName = 'f') {
  return formatAssertionsForPrompt(assertions, fnName);
}

/**
 * Build the complete Coder system prompt with PGG assertions injected.
 *
 * @param {string} basePrompt - The base coder prompt (with {{SIGNATURE}} replaced)
 * @param {Array<{input: string, expected: string, expr: string}>} assertions - PGG assertions
 * @param {string} [fnName='f'] - The function name
 * @returns {string} Complete prompt with PGG assertions appended
 */
export function buildPggCoderPrompt(basePrompt, assertions, fnName = 'f') {
  if (!assertions || assertions.length === 0) {
    return basePrompt;
  }

  const assertionSection = formatPggAssertions(assertions, fnName);
  return basePrompt + assertionSection;
}

/**
 * Build PGG assertion section for the system prompt.
 * Returns a section that can be appended to the coder's system prompt.
 *
 * This version is specialized for the "--- VERIFIABLE ASSERTIONS ---" block
 * that appears in the spec. It formats each assertion as an executable Python
 * assert statement.
 *
 * @param {Array<{input: string, expected: string, expr: string}>} assertions
 * @param {string} [fnName='f']
 * @returns {string}
 */
export function buildAssertionSection(assertions, fnName = 'f') {
  if (!assertions || assertions.length === 0) {
    return '';
  }

  const header = '--- VERIFIABLE ASSERTIONS ---';
  const subheader = `After implementation, your function \`${fnName}\` must pass these assertions:`;

  const assertLines = assertions.map(a => {
    // Extract the assert expression from the full expr
    // PGG assertions from problem-assertions.js have form:
    //   "from module import f; assert f(1) == 1"
    // We want to show just the assert part for clarity
    const assertPart = a.expr.includes('assert ')
      ? a.expr.replace(/^from\s+\S+\s+import\s+\S+\s+as\s+\w+;\s*/, 'assert ')
      : `assert ${a.expr}`;
    return `    ${assertPart}`;
  });

  const footer = [
    'These will be executed against your code before any further evaluation.',
    'A failing assertion = rejection, no scoring.',
    '--- END ASSERTIONS ---',
  ].join('\n');

  return [
    '',
    header,
    subheader,
    ...assertLines,
    footer,
    '',
  ].join('\n');
}

/**
 * Inject PGG assertions into the coder prompt after the signature constraint.
 * Returns the modified prompt string.
 *
 * @param {string} coderPrompt - The base coder prompt
 * @param {Array} assertions - PGG assertions
 * @param {string} [fnName='f'] - Function name
 * @returns {string} Prompt with PGG section appended
 */
export function injectPggAssertions(coderPrompt, assertions, fnName = 'f') {
  if (!assertions || assertions.length === 0) {
    return coderPrompt;
  }

  const section = buildAssertionSection(assertions, fnName);
  return coderPrompt + section;
}

/**
 * Extract the function name from code for use in assertion formatting.
 *
 * @param {string} code - Python code
 * @returns {string} Detected function name or 'f' default
 */
export function extractFnName(code) {
  // Match function def: def function_name(
  const fnMatch = code.match(/^def\s+(\w+)/m);
  if (fnMatch) return fnMatch[1];

  // Match class def: class ClassName
  const classMatch = code.match(/^class\s+(\w+)/m);
  if (classMatch) return classMatch[1];

  return 'f';
}