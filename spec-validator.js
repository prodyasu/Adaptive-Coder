/**
 * spec-validator.js — Post-coder signature validation gate
 *
 * Parses generated Python code, extracts function signature,
 * and compares against TypeScript reference signature.
 * Rejects mismatches before evaluator pass.
 */

import { loadReference, getPrimarySignature } from './ref-sig.js';
import { translateSignature, formatPythonSignature } from './ts-to-py.js';
import { join } from 'path';
import { existsSync } from 'fs';

const __dirname = import.meta.dirname;

/**
 * Extract function signature from Python source code.
 * @param {string} pyCode - Python code from coder
 * @returns {Object|null} { name, params: [string], returnType? } or null
 */
export function extractPythonSignature(pyCode) {
  if (!pyCode || pyCode.length < 20) return null;

  // Strip markdown fences if any
  const clean = pyCode.replace(/^```python\n?|^```\n?/gm, '').trim();

  // Match: def name(param1: type1, param2: type2) -> returnType:
  const defRegex = /^def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/gm;

  // Also match class definitions: class ClassName:
  const classRegex = /^class\s+(\w+)(?:\([^)]*\))?:\s*$/gm;

  const defs = [];
  let match;

  while ((match = defRegex.exec(clean)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const returnType = match[3] ? match[3].trim() : undefined;

    // Parse parameter names (ignore types for comparison)
    const paramNames = paramsStr
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => {
        // Handle "self", "cls", typed params
        const parts = p.split(/[:=]/).map(s => s.trim());
        // parts[0] is name, parts[1] may be type or default
        return parts[0];
      });

    defs.push({ name, params: paramNames, returnType, kind: 'function' });
  }

  // Class signatures
  while ((match = classRegex.exec(clean)) !== null) {
    defs.push({ name: match[1], params: [], returnType: match[1], kind: 'class' });
  }

  if (defs.length === 0) return null;

  // Prefer function over class if both exist
  const fns = defs.filter(d => d.kind === 'function' && d.name !== '__init__');
  if (fns.length > 0) return fns[0];

  return defs[0];
}

/**
 * Load expected signature from TypeScript reference.
 * @param {string} problemName
 * @returns {Object|null} Expected Python signature
 */
export function loadExpectedSignature(problemName) {
  // Search paths: shaper-autorepair testcases, then expansion
  const searchPaths = [
    join(__dirname, '../shaper-autorepair/testcases', problemName, 'reference.ts'),
    join(__dirname, 'testcases-expansion', problemName, 'reference.ts'),
  ];

  for (const refPath of searchPaths) {
    if (existsSync(refPath)) {
      const sigs = loadReference(refPath);
      const primary = getPrimarySignature(sigs, problemName);
      if (!primary) return null;

      const pySig = translateSignature(primary);
      return {
        name: pySig.name,
        params: pySig.params.map(p => p.name),
        returnType: pySig.returnType,
        kind: primary.kind === 'class' ? 'class' : 'function',
      };
    }
  }
  return null;
}

/**
 * Compare generated Python signature against reference.
 * @param {Object} generated - From extractPythonSignature
 * @param {Object} expected - From loadExpectedSignature
 * @returns {Object} { match: boolean, mismatches: string[], guidance: string }
 */
export function compareSignatures(generated, expected) {
  const mismatches = [];

  if (!generated) {
    return {
      match: false,
      mismatches: ['no_python_function'],
      guidance: 'No Python function or class found in generated code.',
    };
  }

  if (!expected) {
    return {
      match: true,
      mismatches: [],
      guidance: 'No reference signature available — skipping validation.',
    };
  }

  // Name mismatch
  if (generated.name !== expected.name) {
    mismatches.push('name');
  }

  // Arity mismatch
  if (generated.params.length !== expected.params.length) {
    mismatches.push('arity');
  } else {
    // Parameter order mismatch
    for (let i = 0; i < expected.params.length; i++) {
      if (generated.params[i] !== expected.params[i]) {
        mismatches.push('param_order');
        break;
      }
    }
  }

  if (mismatches.length === 0) {
    return { match: true, mismatches: [], guidance: '' };
  }

  // Build targeted guidance
  const parts = [];
  if (mismatches.includes('name')) {
    parts.push(`function name should be "${expected.name}" (got "${generated.name}")`);
  }
  if (mismatches.includes('arity')) {
    parts.push(`expected ${expected.params.length} parameters (${expected.params.join(', ')}) but got ${generated.params.length}`);
  }
  if (mismatches.includes('param_order')) {
    parts.push(`parameter order must be (${expected.params.join(', ')}), match names exactly`);
  }

  const guidance = `Signature mismatch: ${parts.join('; ')}. Use the exact function signature from the spec.`;

  return { match: false, mismatches, guidance };
}

/**
 * Validate generated Python code against reference signature.
 * Convenience wrapper.
 * @param {string} problemName
 * @param {string} pyCode
 * @returns {Object} { match, mismatches, guidance }
 */
export function validateSpec(problemName, pyCode) {
  const generated = extractPythonSignature(pyCode);
  const expected = loadExpectedSignature(problemName);
  return compareSignatures(generated, expected);
}
