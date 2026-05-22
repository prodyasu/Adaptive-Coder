/**
 * test-ts-to-py.js — Unit tests for TypeScript to Python translator
 *
 * Tests type translation on real reference.ts fixtures.
 */

import { translateType, translateSignature, formatPythonSignature } from './ts-to-py.js';
import { loadReference, getPrimarySignature } from './ref-sig.js';

// Test fixtures: problems with known reference.ts files
const FIXTURES = [
  {
    name: 'climbing-stairs',
    path: '../shaper-autorepair/testcases/climbing-stairs/reference.ts',
    expectedFn: 'climb',
    expectedParams: [{ name: 'n', type: 'int' }],
    expectedReturn: 'int',
  },
  {
    name: 'binary-search',
    path: '../shaper-autorepair/testcases/binary-search/reference.ts',
    expectedFn: 'search',
    expectedParams: [
      { name: 'nums', type: 'List[int]' },
      { name: 'target', type: 'int' },
    ],
    expectedReturn: 'int',
  },
  {
    name: 'container-with-most-water',
    path: '../shaper-autorepair/testcases/container-with-most-water/reference.ts',
    expectedFn: 'maxArea',
    expectedParams: [{ name: 'h', type: 'List[int]' }],
    expectedReturn: 'int',
  },
  {
    name: 'coin-change-ii',
    path: '../shaper-autorepair/testcases/coin-change-ii/reference.ts',
    expectedFn: 'change',
    expectedParams: [
      { name: 'amount', type: 'int' },
      { name: 'coins', type: 'List[int]' },
    ],
    expectedReturn: 'int',
  },
  {
    name: 'reverse-linked-list',
    path: './testcases-expansion/reverse-linked-list/reference.ts',
    expectedFn: 'reverseList',
    expectedParams: [{ name: 'head', type: 'Optional[ListNode]' }],
    expectedReturn: 'Optional[ListNode]',
  },
];

function runTests() {
  let passed = 0;
  let failed = 0;
  
  console.log('=== Type Translation Unit Tests ===\n');
  
  for (const fixture of FIXTURES) {
    try {
      process.stdout.write(`${fixture.name}: `);
      
      const sigs = loadReference(fixture.path);
      const primary = getPrimarySignature(sigs, fixture.name);
      
      if (!primary) {
        throw new Error(`No primary signature found`);
      }
      
      // Translate to Python
      const pySig = translateSignature(primary);
      
      // Check function name
      if (pySig.name !== fixture.expectedFn) {
        throw new Error(`Name mismatch: got ${pySig.name}, expected ${fixture.expectedFn}`);
      }
      
      // Check params
      if (pySig.params.length !== fixture.expectedParams.length) {
        throw new Error(`Param count mismatch: got ${pySig.params.length}, expected ${fixture.expectedParams.length}`);
      }
      
      for (let i = 0; i < fixture.expectedParams.length; i++) {
        const got = pySig.params[i];
        const exp = fixture.expectedParams[i];
        
        if (got.name !== exp.name) {
          throw new Error(`Param ${i} name mismatch: got ${got.name}, expected ${exp.name}`);
        }
        if (got.type !== exp.type) {
          throw new Error(`Param ${i} type mismatch: got ${got.type}, expected ${exp.type}`);
        }
      }
      
      // Check return type
      if (pySig.returnType !== fixture.expectedReturn) {
        throw new Error(`Return type mismatch: got ${pySig.returnType}, expected ${fixture.expectedReturn}`);
      }
      
      // Format and display
      const formatted = formatPythonSignature(pySig);
      console.log(`✓ ${formatted}`);
      passed++;
      
    } catch (err) {
      console.log(`✗ ${err.message}`);
      failed++;
    }
  }
  
  console.log(`\n=== Results: ${passed}/${FIXTURES.length} passed ===`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

// Type-level unit tests
function runTypeTests() {
  const tests = [
    ['number', 'int'],
    ['string', 'str'],
    ['boolean', 'bool'],
    ['number[]', 'List[int]'],
    ['string[]', 'List[str]'],
    ['number[][]', 'List[List[int]]'],
    ['ListNode | null', 'Optional[ListNode]'],
    ['TreeNode | null', 'Optional[TreeNode]'],
    ['Map<string, number>', 'Dict[str, int]'],
    ['void', 'None'],
  ];
  
  console.log('\n=== Type Translation Tests ===\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const [input, expected] of tests) {
    const got = translateType(input);
    if (got === expected) {
      console.log(`✓ ${input} → ${got}`);
      passed++;
    } else {
      console.log(`✗ ${input} → ${got} (expected ${expected})`);
      failed++;
    }
  }
  
  console.log(`\n=== Results: ${passed}/${tests.length} passed ===`);
  
  return failed === 0;
}

// Run all tests
try {
  const typesOk = runTypeTests();
  runTests();
  
  if (!typesOk) {
    console.log('\n❌ Type tests failed');
    process.exit(1);
  }
  
  console.log('\n✅ All tests passed');
} catch (e) {
  console.error('Test error:', e);
  process.exit(1);
}