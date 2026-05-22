/**
 * ts-to-py.js — TypeScript to Python type translator
 *
 * Translates TypeScript type annotations to Python type hints.
 * Handles primitives, arrays, optionals, custom domain types.
 */

const TYPE_MAP = {
  // Primitives
  'number': 'int',
  'string': 'str',
  'boolean': 'bool',
  'void': 'None',
  'any': 'Any',
  'unknown': 'Any',
  
  // Arrays (handled specially via regex)
  // number[] → List[int]
  // string[] → List[str]
  // T[] → List[T]
  
  // Generics (basic)
  'Map': 'Dict',
  'Set': 'Set',
  'Array': 'List',
  'Promise': 'Awaitable',
};

const CUSTOM_DOMAIN_TYPES = ['ListNode', 'TreeNode'];

/**
 * Split generic parameters, handling nested generics.
 * e.g., "string, number" → ["string", "number"]
 * e.g., "Map<K,V>, string" → ["Map<K,V>", "string"]
 * @param {string} str
 * @returns {string[]}
 */
function splitGenericParams(str) {
  const parts = [];
  let depth = 0;
  let current = '';
  
  for (const char of str) {
    if (char === '<') depth++;
    else if (char === '>') depth--;
    
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    parts.push(current.trim());
  }
  
  return parts;
}

/**
 * Translate a TypeScript type to Python type hint.
 * @param {string} tsType - TypeScript type (e.g., "number[]", "ListNode | null")
 * @returns {string} Python type hint (e.g., "List[int]", "Optional[ListNode]")
 */
export function translateType(tsType) {
  if (!tsType) return 'Any';
  
  let pyType = tsType.trim();
  
  // Handle union types with null (optional)
  const nullUnionMatch = pyType.match(/^(.+?)\s*\|\s*null\s*$/);
  if (nullUnionMatch) {
    const inner = translateType(nullUnionMatch[1]);
    if (CUSTOM_DOMAIN_TYPES.includes(nullUnionMatch[1].trim())) {
      return `Optional[${inner}]`;
    }
    return `Optional[${inner}]`;
  }
  
  // Handle arrays: T[] → List[T]
  const arrayMatch = pyType.match(/^(.+?)\[\]$/);
  if (arrayMatch) {
    const inner = translateType(arrayMatch[1]);
    return `List[${inner}]`;
  }
  
  // Handle generics: X<Y> → X[Y] (recursively translate inner)
  const genericMatch = pyType.match(/^([A-Z][a-zA-Z0-9_]*)<(.+)>$/);
  if (genericMatch) {
    const container = TYPE_MAP[genericMatch[1]] || genericMatch[1];
    // Split by comma for multiple type params, but only at top level
    const innerTypes = splitGenericParams(genericMatch[2]);
    const innerTranslated = innerTypes.map(t => translateType(t.trim()));
    return `${container}[${innerTranslated.join(', ')}]`;
  }
  
  // Handle tuple types: [T1, T2] → Tuple[T1, T2]
  if (pyType.startsWith('[') && pyType.endsWith(']')) {
    const inner = pyType.slice(1, -1);
    const parts = inner.split(',').map(p => translateType(p.trim()));
    return `Tuple[${parts.join(', ')}]`;
  }
  
  // Map primitive types
  if (TYPE_MAP[pyType]) {
    return TYPE_MAP[pyType];
  }
  
  // Custom domain types - pass through but mark as from types module
  if (CUSTOM_DOMAIN_TYPES.includes(pyType)) {
    return pyType; // Caller will handle import
  }
  
  // Default: pass through (for user-defined types)
  return pyType;
}

/**
 * Translate a full function signature from TypeScript to Python.
 * @param {Object} sig - Extracted signature { name, params: [{name, type}], returnType }
 * @returns {Object} Python signature with imports needed
 */
export function translateSignature(sig) {
  const imports = new Set();
  
  // Translate params
  const pyParams = sig.params.map(p => {
    const pyType = translateType(p.type);
    // Check if type needs Optional import
    if (pyType.includes('Optional')) {
      imports.add('Optional');
    }
    if (pyType.includes('List')) {
      imports.add('List');
    }
    if (pyType.includes('Dict')) {
      imports.add('Dict');
    }
    if (pyType.includes('Tuple')) {
      imports.add('Tuple');
    }
    // Custom domain types need to be imported from types module
    if (CUSTOM_DOMAIN_TYPES.some(ct => pyType.includes(ct))) {
      imports.add('ListNode'); // Will add special handling
      imports.add('TreeNode');
    }
    return { name: p.name, type: pyType };
  });
  
  // Translate return type
  const pyReturn = translateType(sig.returnType);
  if (pyReturn.includes('Optional')) imports.add('Optional');
  if (pyReturn.includes('List')) imports.add('List');
  if (pyReturn.includes('Dict')) imports.add('Dict');
  if (pyReturn.includes('Tuple')) imports.add('Tuple');
  
  return {
    name: sig.name,
    params: pyParams,
    returnType: pyReturn,
    imports: Array.from(imports),
  };
}

/**
 * Generate Python function signature string from translated signature.
 * @param {Object} pySig - Output from translateSignature
 * @returns {string} Python def statement
 */
export function formatPythonSignature(pySig) {
  const params = pySig.params.map(p => `${p.name}: ${p.type}`).join(', ');
  return `def ${pySig.name}(${params}) -> ${pySig.returnType}:`;
}

/**
 * Generate Python import statements for a signature.
 * @param {Object} pySig - Output from translateSignature
 * @returns {string[]} Import statements
 */
export function generateImports(pySig) {
  const stdlibImports = [];
  const typingImports = [];
  
  for (const imp of pySig.imports) {
    if (['Optional', 'List', 'Dict', 'Set', 'Tuple', 'Any'].includes(imp)) {
      typingImports.push(imp);
    }
  }
  
  const result = [];
  if (typingImports.length > 0) {
    result.push(`from typing import ${typingImports.join(', ')}`);
  }
  
  // Check for custom domain types
  const needsListNode = pySig.params.some(p => p.type.includes('ListNode')) || 
                        pySig.returnType.includes('ListNode');
  const needsTreeNode = pySig.params.some(p => p.type.includes('TreeNode')) || 
                        pySig.returnType.includes('TreeNode');
  
  if (needsListNode || needsTreeNode) {
    result.push('# from problem_types import ListNode, TreeNode  # Uncomment when types module ready');
  }
  
  return result;
}