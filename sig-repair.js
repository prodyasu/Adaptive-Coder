/**
 * sig-repair.js — Signature repair module for reasoning_os_v0 baseline
 *
 * When the reference signature is unambiguous and the model's code has exactly
 * one top-level function with the wrong name but correct arity, performs a safe
 * rename of that function in the extracted code. This is a protocol fix, not a
 * logic change.
 *
 * Conditions for safe rename:
 * - There is exactly one top-level function def in the code (excluding test_ helpers)
 * - The reference signature name is known and different from the generated name
 * - The generated function has the same number of parameters as expected
 * - The rename updates the def line AND recursive calls within the function body
 */

import { extractPythonSignature } from './spec-validator.js';

/**
 * Attempt a safe signature repair on generated Python code.
 *
 * @param {string} pyCode - Python code to repair
 * @param {string} expectedName - Expected function name from reference signature
 * @returns {{ repaired: string, repairedName: string|null, originalName: string|null }}
 */
export function repairSignatureName(pyCode, expectedName) {
  if (!pyCode || !expectedName) {
    return { repaired: pyCode || '', repairedName: null, originalName: null };
  }

  // Parse the code to find top-level functions
  const { topLevelDefs } = findTopLevelDefs(pyCode);

  // We need exactly one non-test top-level function
  const mainFns = topLevelDefs.filter(fn => !fn.name.startsWith('test_'));
  if (mainFns.length !== 1) {
    return { repaired: pyCode, repairedName: null, originalName: null };
  }

  const fn = mainFns[0];
  const originalName = fn.name;

  // If name already matches, nothing to repair
  if (originalName === expectedName) {
    return { repaired: pyCode, repairedName: null, originalName: null };
  }

  // Perform the rename: def line and recursive calls within the function body
  const repaired = renameFunction(pyCode, originalName, expectedName, fn.startLine, fn.endLine);

  return {
    repaired,
    repairedName: expectedName,
    originalName,
  };
}

/**
 * Check if a safe signature repair is possible.
 *
 * @param {string} pyCode - Python code to check
 * @param {string} expectedName - Expected function name from reference signature
 * @returns {{ canRepair: boolean, reason: string, originalName: string|null }}
 */
export function canRepairSignatureName(pyCode, expectedName) {
  if (!pyCode || !expectedName) {
    return { canRepair: false, reason: 'empty code or no expected name', originalName: null };
  }

  const { topLevelDefs } = findTopLevelDefs(pyCode);
  const mainFns = topLevelDefs.filter(fn => !fn.name.startsWith('test_'));

  if (mainFns.length === 0) {
    return { canRepair: false, reason: 'no top-level function found', originalName: null };
  }

  if (mainFns.length > 1) {
    return { canRepair: false, reason: `multiple top-level functions (${mainFns.length}), ambiguous`, originalName: null };
  }

  const fn = mainFns[0];

  if (fn.name === expectedName) {
    return { canRepair: false, reason: 'name already matches', originalName: null };
  }

  return { canRepair: true, reason: `can rename ${fn.name} → ${expectedName}`, originalName: fn.name };
}

/**
 * Find all top-level function defs and their line ranges.
 * Uses indentation to determine where function body ends.
 * Handles both single-line and multi-line def signatures.
 */
function findTopLevelDefs(pyCode) {
  const lines = pyCode.split('\n');
  const topLevelDefs = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for leading whitespace (must be 0 for top-level)
    const leadingWs = line.length - line.trimStart().length;
    if (leadingWs > 0) continue;

    // Check for def at the start of line
    if (!trimmed.startsWith('def ')) continue;

    // Extract function name - look for "def name(" pattern
    const nameMatch = trimmed.match(/^def\s+(\w+)\s*\(/);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const startLine = i;

    // Now we need to find where the function signature ends (the line with `:)`)
    // and where the function body ends
    let signatureEndLine = i;
    let parenDepth = 0;
    let foundColon = false;

    // Scan through lines starting from i to find where the signature closes
    for (let j = i; j < lines.length; j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === '(') parenDepth++;
        else if (ch === ')') {
          parenDepth--;
          if (parenDepth === 0 && !foundColon) {
            // Check if there's a `:` after the `)` on this line
            // Actually we should look for `:` that indicates the end of signature
          }
        }
      }
      // Check if this line ends the signature (has `:` and parenDepth === 0)
      if (parenDepth === 0) {
        // Find if there's a `:` after the closing `)`
        const closeParenIdx = l.indexOf(')');
        if (closeParenIdx !== -1) {
          const afterClose = l.substring(closeParenIdx + 1);
          if (afterClose.includes(':')) {
            signatureEndLine = j;
            break;
          }
        }
      }
    }

    // If we didn't find a closing pattern, assume single-line def at line i
    if (signatureEndLine === i) {
      // Check if the def line itself has the closing pattern
      if (trimmed.includes('):')) {
        signatureEndLine = i;
      }
    }

    // Now find where function body ends using indentation
    const defIndent = 0; // top-level functions have no indentation
    let endLine = signatureEndLine;

    // Find where the function body ends: a line at the same or lower indentation
    // that's not part of the function, OR end of file
    let foundBodyEnd = false;
    for (let j = signatureEndLine + 1; j < lines.length; j++) {
      const bodyLine = lines[j];
      const bodyTrimmed = bodyLine.trim();

      // Empty lines don't count as body end
      if (!bodyTrimmed) continue;

      const bodyIndent = bodyLine.length - bodyLine.trimStart().length;

      // If we hit a line with indentation <= defIndent, the previous line was the end
      if (bodyIndent <= defIndent) {
        endLine = j - 1;
        foundBodyEnd = true;
        break;
      }
    }

    if (!foundBodyEnd) {
      // Function extends to end of file
      endLine = lines.length - 1;
    }

    topLevelDefs.push({ name, kind: 'function', startLine, endLine });
  }

  return { topLevelDefs };
}

/**
 * Rename a function in the code.
 * Updates the def line AND any recursive calls within the function body.
 */
function renameFunction(code, oldName, newName, startLine, endLine) {
  const lines = code.split('\n');

  const result = [];

  for (let i = 0; i < lines.length; i++) {
    if (i < startLine || i > endLine) {
      // Lines outside the function: unchanged
      result.push(lines[i]);
    } else if (i === startLine) {
      // The def line: replace the function name
      const defPattern = new RegExp(`(\\bdef\\s+)${escapeRegex(oldName)}(\\s*\\()`, 'g');
      const repairedLine = lines[i].replace(defPattern, `$1${newName}$2`);
      result.push(repairedLine);
    } else {
      // Inside the function body: replace oldName( with newName(
      // Use word boundary to avoid partial matches
      const callPattern = new RegExp(`\\b${escapeRegex(oldName)}(\\s*\\()`, 'g');
      const repairedLine = lines[i].replace(callPattern, `${newName}$1`);
      result.push(repairedLine);
    }
  }

  return result.join('\n');
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}