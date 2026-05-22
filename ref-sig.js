/**
 * ref-sig.js — Reference signature extractor
 *
 * Parses TypeScript reference.ts files to extract function/class signatures.
 * Outputs structured signature data compatible with ts-to-py.js translator.
 */

import { readFileSync } from 'fs';

/**
 * Extract function signatures from TypeScript source.
 * @param {string} tsSource - TypeScript file content
 * @returns {Array} Array of signature objects { name, params: [{name, type}], returnType }
 */
export function extractSignatures(tsSource) {
  const signatures = [];
  
  // Match: export function name(param: type, ...): returnType {
  // Return type can include union types: "ListNode | null", "number | string"
  // Match until we hit { or newline, capturing union types
  const fnRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\s{][^\n{]*?))?\s*[{\n]/g;
  
  let match;
  while ((match = fnRegex.exec(tsSource)) !== null) {
    const name = match[1];
    const paramsStr = match[2];
    const returnType = match[3] || 'void';
    
    const params = parseParams(paramsStr);
    
    signatures.push({
      name,
      params,
      returnType,
      kind: 'function',
    });
  }
  
  // Match: export class Name { ... methods ... }
  const classRegex = /export\s+class\s+(\w+)\s*(?:extends\s+\w+)?\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
  
  while ((match = classRegex.exec(tsSource)) !== null) {
    const className = match[1];
    const classBody = match[2];
    
    // Extract methods from class body
    const methodRegex = /(?:public\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\s{]+))?\s*[{\n]/g;
    let methodMatch;
    
    while ((methodMatch = methodRegex.exec(classBody)) !== null) {
      const methodName = methodMatch[1];
      // Skip constructor
      if (methodName === 'constructor') continue;
      
      const paramsStr = methodMatch[2];
      const returnType = methodMatch[3] || 'void';
      
      const params = parseParams(paramsStr);
      
      signatures.push({
        name: `${className}.${methodName}`,
        className,
        methodName,
        params,
        returnType,
        kind: 'method',
      });
    }
    
    // Also store the class itself as a signature (for instantiation)
    signatures.push({
      name: className,
      params: [],
      returnType: className,
      kind: 'class',
    });
  }
  
  return signatures;
}

/**
 * Parse parameter string like "amount: number, coins: number[]".
 * @param {string} paramsStr - Parameter string from function signature
 * @returns {Array} Array of { name, type } objects
 */
function parseParams(paramsStr) {
  if (!paramsStr.trim()) return [];
  
  const params = [];
  
  // Split on commas, but be careful about generic types like Map<K,V>
  // Simple approach: split by comma, then clean up
  const parts = paramsStr.split(',').map(p => p.trim()).filter(Boolean);
  
  for (const part of parts) {
    // Match: name: type (with optional default value)
    const match = part.match(/^(\w+)\s*:\s*([^=]+)(?:=.*)?$/);
    if (match) {
      params.push({
        name: match[1],
        type: match[2].trim(),
      });
    }
  }
  
  return params;
}

/**
 * Load and parse reference.ts file.
 * @param {string} filePath - Path to reference.ts
 * @returns {Array} Signatures
 */
export function loadReference(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return extractSignatures(content);
}

/**
 * Get primary signature from reference (main function, not helpers).
 * Uses multiple heuristics: problem-name matching, then param count, then exclude helpers.
 * @param {Array} signatures - Output from extractSignatures
 * @param {string} problemName - Problem name for matching (e.g., "reverse-linked-list")
 * @returns {Object|null} Primary signature
 */
export function getPrimarySignature(signatures, problemName = '') {
  const fns = signatures.filter(s => s.kind === 'function');
  if (fns.length === 0) {
    // For class-based problems (like MinStack), return class signature
    const cls = signatures.find(s => s.kind === 'class');
    if (cls) return cls;
    return signatures[0] || null;
  }
  
  // Heuristic 1: Prefer function whose name matches the problem name
  // e.g., "reverse-linked-list" → prefer function with "reverse" in name
  if (problemName) {
    const problemWords = problemName.toLowerCase().split('-').filter(w => w.length > 2);
    const scored = fns.map(f => {
      const fnNameLower = f.name.toLowerCase();
      const matches = problemWords.filter(w => fnNameLower.includes(w)).length;
      return { fn: f, score: matches };
    });
    const bestMatch = scored.reduce((a, b) => a.score >= b.score ? a : b);
    if (bestMatch.score > 0) {
      return bestMatch.fn;
    }
  }
  
  // Heuristic 2: Not helpers like "arrayToList", "listToArray", "buildTree"
  const helperNames = ['arrayToList', 'listToArray', 'buildTree', 'treeToArray', 'createList', 'toArray', 'fromArray'];
  const nonHelpers = fns.filter(f => !helperNames.includes(f.name));
  
  if (nonHelpers.length > 0) {
    // Heuristic 3: Prefer function with most parameters (main logic over utilities)
    return nonHelpers.reduce((best, current) => 
      current.params.length > best.params.length ? current : best
    );
  }
  
  // All are helpers, return first with most params
  return fns.reduce((best, current) => 
    current.params.length > best.params.length ? current : best
  );
}