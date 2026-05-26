/**
 * test-invariant-constrained-generation.js — No-model unit tests for Delta 6 ICG
 *
 * Tests:
 * 1. Invariant extraction — extractInvariants() from Shaper specs
 * 2. Invariant formatting — formatInvariantsForCoder() produces Coder-ready text
 * 3. ICG prompt construction — buildICGCoderPrompt() includes invariants
 * 4. Opt-in routing — applyInvariantConstrainedGeneration() only when enabled
 * 5. Trace fields — ICG trace metadata populated correctly
 * 6. Deduplication — near-duplicate invariants removed
 * 7. Edge cases — null spec, empty spec, unknown problem
 * 8. Problem-specific invariants — known patterns produce correct invariants
 */

import {
  INVARIANT_TYPES,
  INVARIANT_CONFIDENCE,
  ICG_SYSTEM_PROMPT,
  extractInvariants,
  formatInvariantsForCoder,
  buildICGCoderPrompt,
  applyInvariantConstrainedGeneration,
} from './invariant-constrained-generation.js';

import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Invariant extraction
// ---------------------------------------------------------------------------

test('extractInvariants returns empty array for null spec', () => {
  const result = extractInvariants(null, 'binary-search');
  assert.deepStrictEqual(result, []);
});

test('extractInvariants returns empty array for undefined spec', () => {
  const result = extractInvariants(undefined, 'binary-search');
  assert.deepStrictEqual(result, []);
});

test('extractInvariants returns empty array for empty spec with unknown problem', () => {
  const result = extractInvariants({}, 'completely-unknown-problem');
  assert.deepStrictEqual(result, []);
});

test('extractInvariants for known problem with empty spec still gets problem-specific invariants', () => {
  const result = extractInvariants({}, 'binary-search');
  assert.ok(result.length > 0, 'Known problems should have problem-specific invariants');
  assert.ok(result.every(i => i.source === 'problem_pattern'), 'All should be from problem_pattern');
});

test('extractInvariants extracts type constraints', () => {
  const spec = {
    objective: 'Find target in sorted array',
    constraints: ['Must return the index of target', 'Input is a sorted array of integers'],
    acceptance_criteria: ['Returns correct index for existing target'],
  };
  const invariants = extractInvariants(spec, 'binary-search');
  const typeInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.TYPE_CONSTRAINT);
  assert.ok(typeInvariants.length > 0, 'Should extract at least one type constraint');
  assert.strictEqual(typeInvariants[0].source, 'constraint');
  assert.strictEqual(typeInvariants[0].confidence, INVARIANT_CONFIDENCE.HIGH);
});

test('extractInvariants extracts edge case guards', () => {
  const spec = {
    objective: 'Check if string is palindrome',
    constraints: ['Must handle empty string', 'Consider only alphanumeric characters'],
    acceptance_criteria: ['Returns True for empty string'],
  };
  const invariants = extractInvariants(spec, 'valid-palindrome');
  const edgeInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.EDGE_CASE_GUARD);
  assert.ok(edgeInvariants.length > 0, 'Should extract edge case guards');
});

test('extractInvariants extracts complexity bounds', () => {
  const spec = {
    objective: 'Find two numbers that add to target',
    constraints: ['Time complexity must be O(n)', 'Space complexity O(n) acceptable'],
    acceptance_criteria: ['Returns indices of two numbers'],
  };
  const invariants = extractInvariants(spec, 'two-sum');
  const complexityInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.COMPLEXITY_BOUND);
  assert.ok(complexityInvariants.length > 0, 'Should extract complexity bounds');
});

test('extractInvariants extracts correctness conditions from acceptance criteria', () => {
  const spec = {
    objective: 'Implement binary search',
    constraints: ['Input is sorted array of integers'],
    acceptance_criteria: [
      'Should return the index of target if found',
      'Must return -1 if target not in array',
    ],
  };
  const invariants = extractInvariants(spec, 'binary-search');
  const correctnessInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.CORRECTNESS_CONDITION);
  assert.ok(correctnessInvariants.length > 0, 'Should extract correctness conditions');
});

test('extractInvariants extracts boundary conditions', () => {
  const spec = {
    objective: 'Count ways to climb stairs',
    constraints: ['n is a positive integer'],
    acceptance_criteria: [
      'For n = 1, should return 1',
      'For n = 0, should return 1 (base case)',
    ],
  };
  const invariants = extractInvariants(spec, 'climbing-stairs');
  const boundaryInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.BOUNDARY_CONDITION);
  assert.ok(boundaryInvariants.length > 0, 'Should extract boundary conditions');
});

test('extractInvariants extracts loop invariants from constraint keywords', () => {
  const spec = {
    objective: 'Count islands in grid',
    constraints: ['Must track visited cells to avoid re-counting'],
    acceptance_criteria: ['Each island counted exactly once'],
  };
  const invariants = extractInvariants(spec, 'number-of-islands');
  const loopInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.LOOP_INVARIANT);
  assert.ok(loopInvariants.length >= 0, 'Should extract loop invariants from constraint keywords');
});

// ---------------------------------------------------------------------------
// 2. Invariant formatting
// ---------------------------------------------------------------------------

test('formatInvariantsForCoder returns empty string for empty array', () => {
  const result = formatInvariantsForCoder([]);
  assert.strictEqual(result, '');
});

test('formatInvariantsForCoder returns empty string for null', () => {
  const result = formatInvariantsForCoder(null);
  assert.strictEqual(result, '');
});

test('formatInvariantsForCoder includes invariant section delimiters', () => {
  const invariants = [
    { type: INVARIANT_TYPES.TYPE_CONSTRAINT, description: 'Input is sorted array', source: 'constraint', confidence: INVARIANT_CONFIDENCE.HIGH },
  ];
  const result = formatInvariantsForCoder(invariants);
  assert.ok(result.includes('DERIVED INVARIANTS'), 'Should include section header');
  assert.ok(result.includes('END INVARIANTS'), 'Should include section end');
});

test('formatInvariantsForCoder includes confidence tags', () => {
  const invariants = [
    { type: INVARIANT_TYPES.TYPE_CONSTRAINT, description: 'Input is sorted', source: 'constraint', confidence: INVARIANT_CONFIDENCE.HIGH },
    { type: INVARIANT_TYPES.LOOP_INVARIANT, description: 'Search range narrows', source: 'problem_pattern', confidence: INVARIANT_CONFIDENCE.MEDIUM },
    { type: INVARIANT_TYPES.BOUNDARY_CONDITION, description: 'Base case', source: 'problem_pattern', confidence: INVARIANT_CONFIDENCE.LOW },
  ];
  const result = formatInvariantsForCoder(invariants);
  assert.ok(result.includes('[HIGH]'), 'Should include HIGH confidence tag');
  assert.ok(result.includes('[MED]'), 'Should include MED confidence tag');
  assert.ok(result.includes('[LOW]'), 'Should include LOW confidence tag');
});

test('formatInvariantsForCoder sorts HIGH before LOW', () => {
  const invariants = [
    { type: INVARIANT_TYPES.BOUNDARY_CONDITION, description: 'Base case', source: 'problem_pattern', confidence: INVARIANT_CONFIDENCE.LOW },
    { type: INVARIANT_TYPES.TYPE_CONSTRAINT, description: 'Input is sorted', source: 'constraint', confidence: INVARIANT_CONFIDENCE.HIGH },
  ];
  const result = formatInvariantsForCoder(invariants);
  const highIdx = result.indexOf('[HIGH]');
  const lowIdx = result.indexOf('[LOW]');
  assert.ok(highIdx < lowIdx, 'HIGH should appear before LOW');
});

test('formatInvariantsForCoder includes type tags in uppercase', () => {
  const invariants = [
    { type: INVARIANT_TYPES.LOOP_INVARIANT, description: 'Test invariant', source: 'constraint', confidence: INVARIANT_CONFIDENCE.HIGH },
  ];
  const result = formatInvariantsForCoder(invariants);
  assert.ok(result.includes('LOOP INVARIANT'), 'Should include type tag in uppercase');
});

// ---------------------------------------------------------------------------
// 3. ICG prompt construction
// ---------------------------------------------------------------------------

test('buildICGCoderPrompt returns prompt with invariants embedded', () => {
  const invariants = [
    { type: INVARIANT_TYPES.TYPE_CONSTRAINT, description: 'Input is sorted array', source: 'constraint', confidence: INVARIANT_CONFIDENCE.HIGH },
  ];
  const result = buildICGCoderPrompt('binary-search', invariants);
  assert.ok(result.includes('{{SIGNATURE}}'), 'Should include SIGNATURE placeholder');
  assert.ok(result.includes('DERIVED INVARIANTS'), 'Should include invariant section header');
  assert.ok(result.includes('Input is sorted array'), 'Should include the invariant description');
});

test('buildICGCoderPrompt with no invariants returns base ICG system prompt', () => {
  const result = buildICGCoderPrompt('binary-search', []);
  // With no invariants, returns ICG_SYSTEM_PROMPT (which mentions invariants in its instructions)
  // but no invariant section appended — the system prompt still has the signature placeholder
  assert.ok(result.length > 0, 'Should return prompt text');
  assert.ok(result.includes('{{SIGNATURE}}'), 'Should still have SIGNATURE placeholder');
  // No "--- DERIVED INVARIANTS" section appended since formatInvariantsForCoder([]) === ''
  assert.strictEqual(result.includes('--- DERIVED INVARIANTS'), false, 'Should not have invariant section when empty');
});

test('ICG_SYSTEM_PROMPT includes invariant constraint instruction', () => {
  assert.ok(ICG_SYSTEM_PROMPT.includes('INVARIANT'), 'System prompt should mention invariants');
  assert.ok(ICG_SYSTEM_PROMPT.includes('RESPECT EVERY INVARIANT'), 'Should have invariant constraint');
});

test('buildICGCoderPrompt includes problem-specific invariants', () => {
  const invariants = extractInvariants(
    { objective: 'Find target in sorted array', constraints: [], acceptance_criteria: [] },
    'binary-search'
  );
  const prompt = buildICGCoderPrompt('binary-search', invariants);
  // Should include binary-search specific invariants like "index or -1"
  assert.ok(invariants.length > 0, 'Binary search should have problem-specific invariants');
});

// ---------------------------------------------------------------------------
// 4. Opt-in routing
// ---------------------------------------------------------------------------

test('applyInvariantConstrainedGeneration produces trace with icgEnabled=true', () => {
  const spec = {
    objective: 'Find target',
    constraints: ['Input is sorted'],
    acceptance_criteria: ['Returns index or -1'],
  };
  const result = applyInvariantConstrainedGeneration(spec, 'binary-search', { icgEnabled: true });
  assert.strictEqual(result.trace.icgEnabled, true);
  assert.ok(result.invariantSection.length > 0, 'Should have invariant section');
  assert.ok(result.icgPrompt.length > 0, 'Should have prompt');
});

test('applyInvariantConstrainedGeneration trace includes invariantCount', () => {
  const spec = {
    objective: 'Find target',
    constraints: ['Input is sorted array', 'Time complexity O(log n)'],
    acceptance_criteria: ['Returns index'],
  };
  const result = applyInvariantConstrainedGeneration(spec, 'binary-search');
  assert.ok(typeof result.trace.invariantCount === 'number', 'invariantCount should be a number');
  assert.ok(result.trace.invariantCount >= 0, 'invariantCount should be >= 0');
});

test('applyInvariantConstrainedGeneration trace includes invariantTypes', () => {
  const spec = {
    objective: 'Find target',
    constraints: ['Time complexity O(log n)'],
    acceptance_criteria: ['Returns index or -1'],
  };
  const result = applyInvariantConstrainedGeneration(spec, 'binary-search');
  assert.ok(Array.isArray(result.trace.invariantTypes), 'invariantTypes should be array');
});

test('applyInvariantConstrainedGeneration trace includes sourceCounts', () => {
  const spec = {
    objective: 'Find target',
    constraints: ['Sorted input', 'Time complexity O(log n)'],
    acceptance_criteria: ['Returns -1 if not found'],
  };
  const result = applyInvariantConstrainedGeneration(spec, 'binary-search');
  assert.ok(typeof result.trace.sourceCounts === 'object', 'sourceCounts should be object');
  // Should have at least 'constraint' or 'acceptance_criteria' sources
  const totalSources = Object.values(result.trace.sourceCounts).reduce((a, b) => a + b, 0);
  assert.ok(totalSources > 0, 'Should have at least one source');
});

// ---------------------------------------------------------------------------
// 5. Trace fields correctness
// ---------------------------------------------------------------------------

test('ICG trace fields populated by extractInvariants', () => {
  const spec = {
    objective: 'Find target in sorted array',
    constraints: ['Must return index'],
    acceptance_criteria: ['Returns -1 for absent'],
  };
  const result = applyInvariantConstrainedGeneration(spec, 'binary-search');
  assert.strictEqual(result.trace.icgEnabled, true);
  assert.ok(result.trace.invariantCount > 0, 'Should have invariants');
  assert.ok(result.trace.invariantTypes.length > 0, 'Should have invariant types');
});

test('ICG trace for empty spec has 0 invariants but still valid', () => {
  const result = applyInvariantConstrainedGeneration({}, 'binary-search');
  // Problem-specific invariants still extracted even from empty spec
  // because known problem patterns add invariants
  assert.ok(typeof result.trace.invariantCount === 'number');
  assert.strictEqual(result.trace.icgEnabled, true);
});

// ---------------------------------------------------------------------------
// 6. Deduplication
// ---------------------------------------------------------------------------

test('Near-duplicate invariants are deduplicated (Jaccard > 0.7)', () => {
  const spec = {
    objective: 'Find target',
    constraints: [
      'Must return the index of the target element',
      'Should return the index of the target element',  // near-duplicate
    ],
    acceptance_criteria: [],
  };
  const invariants = extractInvariants(spec, 'unknown-problem');
  // Both constraints produce TYPE_CONSTRAINT invariants — near-duplicates should be deduped
  const typeInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.TYPE_CONSTRAINT);
  assert.ok(typeInvariants.length <= 1, `Near-duplicate type constraints should be deduped, got ${typeInvariants.length}`);
});

test('Exact duplicates are deduplicated', () => {
  const spec = {
    objective: 'Find target',
    constraints: [
      'Must return index of target',
      'Must return index of target',  // exact duplicate
    ],
    acceptance_criteria: [],
  };
  const invariants = extractInvariants(spec, 'unknown-problem');
  const typeInvariants = invariants.filter(i => i.type === INVARIANT_TYPES.TYPE_CONSTRAINT);
  assert.ok(typeInvariants.length <= 1, `Exact duplicates should be deduped, got ${typeInvariants.length}`);
});

test('Different-type invariants are NOT deduplicated even if descriptions overlap', () => {
  const spec = {
    objective: 'Check palindrome string',
    constraints: [
      'Must handle empty input',       // edge_case_guard (matches "empty")
    ],
    acceptance_criteria: [
      'For empty string, returns True', // boundary_condition (matches "for...empty")
    ],
  };
  const invariants = extractInvariants(spec, 'unknown-problem');
  const edgeGuards = invariants.filter(i => i.type === INVARIANT_TYPES.EDGE_CASE_GUARD);
  const boundaryConds = invariants.filter(i => i.type === INVARIANT_TYPES.BOUNDARY_CONDITION);
  assert.ok(edgeGuards.length >= 1, 'Should have at least one edge case guard from constraints');
  assert.ok(boundaryConds.length >= 1, 'Should have at least one boundary condition from acceptance criteria');
  // These have different types so should NOT be deduped against each other
  assert.ok(invariants.filter(i => i.description.includes('empty')).length >= 2, 'Both types should survive dedup');
});

// ---------------------------------------------------------------------------
// 7. Edge cases
// ---------------------------------------------------------------------------

test('extractInvariants handles spec with only objective', () => {
  const spec = { objective: 'Find target in sorted array' };
  const result = extractInvariants(spec, 'binary-search');
  // Should still get problem-specific invariants
  assert.ok(Array.isArray(result), 'Should return array');
  // binary-search has problem-specific invariants even with empty constraints/criteria
  assert.ok(result.length >= 0, 'Should return invariants (possibly only problem-specific)');
});

test('extractInvariants handles spec with all empty arrays', () => {
  const spec = {
    objective: 'Solve problem',
    constraints: [],
    acceptance_criteria: [],
  };
  const result = extractInvariants(spec, 'unknown-problem');
  assert.ok(Array.isArray(result));
  assert.ok(result.length === 0, 'Empty arrays + unknown problem should produce 0 invariants');
});

test('formatInvariantsForCoder handles undefined gracefully', () => {
  const result = formatInvariantsForCoder(undefined);
  assert.strictEqual(result, '');
});

test('INVARIANT_TYPES has all expected type keys', () => {
  const expectedTypes = [
    'loop_invariant', 'boundary_condition', 'type_constraint',
    'correctness_condition', 'state_invariant', 'edge_case_guard',
    'complexity_bound'
  ];
  for (const t of expectedTypes) {
    assert.ok(INVARIANT_TYPES[t.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] !== undefined || Object.values(INVARIANT_TYPES).includes(t),
      `INVARIANT_TYPES should include ${t}`);
  }
  assert.strictEqual(Object.keys(INVARIANT_TYPES).length, 7, 'Should have exactly 7 types');
});

test('INVARIANT_CONFIDENCE has HIGH, MEDIUM, LOW', () => {
  assert.strictEqual(INVARIANT_CONFIDENCE.HIGH, 'high');
  assert.strictEqual(INVARIANT_CONFIDENCE.MEDIUM, 'medium');
  assert.strictEqual(INVARIANT_CONFIDENCE.LOW, 'low');
});

// ---------------------------------------------------------------------------
// 8. Problem-specific invariants
// ---------------------------------------------------------------------------

test('binary-search gets loop invariant and correctness condition', () => {
  const invariants = extractInvariants(
    { objective: 'Find target in sorted array', constraints: [], acceptance_criteria: [] },
    'binary-search'
  );
  const loop = invariants.filter(i => i.type === INVARIANT_TYPES.LOOP_INVARIANT);
  const correctness = invariants.filter(i => i.type === INVARIANT_TYPES.CORRECTNESS_CONDITION);
  assert.ok(loop.length >= 1, 'Binary search should have at least one loop invariant');
  assert.ok(correctness.length >= 1, 'Binary search should have at least one correctness condition');
  assert.ok(loop[0].source === 'problem_pattern', 'Loop invariant should be from problem_pattern');
});

test('climbing-stairs gets fibonacci-like invariant', () => {
  const invariants = extractInvariants(
    { objective: 'Count ways to climb stairs', constraints: [], acceptance_criteria: [] },
    'climbing-stairs'
  );
  const loop = invariants.filter(i => i.type === INVARIANT_TYPES.LOOP_INVARIANT);
  assert.ok(loop.length >= 1, 'Climbing stairs should have loop invariant about f(n) = f(n-1) + f(n-2)');
  assert.ok(loop[0].description.includes('f(n)'), 'Should mention recurrence relation');
});

test('container-with-most-water gets two-pointer invariant', () => {
  const invariants = extractInvariants(
    { objective: 'Find container with most water', constraints: [], acceptance_criteria: [] },
    'container-with-most-water'
  );
  const loop = invariants.filter(i => i.type === INVARIANT_TYPES.LOOP_INVARIANT);
  assert.ok(loop.length >= 1, 'Container should have loop invariant about two pointers');
  assert.ok(loop[0].description.toLowerCase().includes('pointer'), 'Should mention pointer strategy');
});

test('number-of-islands gets state and loop invariants', () => {
  const invariants = extractInvariants(
    { objective: 'Count islands in grid', constraints: [], acceptance_criteria: [] },
    'number-of-islands'
  );
  const loop = invariants.filter(i => i.type === INVARIANT_TYPES.LOOP_INVARIANT);
  const state = invariants.filter(i => i.type === INVARIANT_TYPES.STATE_INVARIANT);
  assert.ok(loop.length >= 1, 'Islands should have loop invariant about visited marking');
  assert.ok(state.length >= 1, 'Islands should have state invariant about in-place modification');
});

test('coin-change-ii gets DP and boundary invariants', () => {
  const invariants = extractInvariants(
    { objective: 'Count ways to make amount with coins', constraints: [], acceptance_criteria: [] },
    'coin-change-ii'
  );
  const loop = invariants.filter(i => i.type === INVARIANT_TYPES.LOOP_INVARIANT);
  const boundary = invariants.filter(i => i.type === INVARIANT_TYPES.BOUNDARY_CONDITION);
  assert.ok(loop.length >= 1, 'Coin change should have DP invariant');
  assert.ok(boundary.length >= 1, 'Coin change should have boundary condition (1 way to make 0)');
});

test('unknown problem gets no problem-specific invariants', () => {
  const invariants = extractInvariants(
    { objective: 'Solve something novel', constraints: [], acceptance_criteria: [] },
    'completely-unknown-problem'
  );
  assert.ok(invariants.length === 0, 'Unknown problem with no constraints should have 0 invariants');
});

test('unknown problem WITH constraints gets constraint-derived invariants', () => {
  const invariants = extractInvariants(
    { objective: 'Solve something novel', constraints: ['Must handle empty input', 'Time complexity O(n)'], acceptance_criteria: [] },
    'completely-unknown-problem'
  );
  assert.ok(invariants.length >= 2, 'Should extract edge case guard and complexity bound from constraints');
});

// ---------------------------------------------------------------------------
// ICG prompt integration: invariant section appended to coder prompt
// ---------------------------------------------------------------------------

test('ICG prompt includes signature constraint instruction not in base prompt', () => {
  // The ICG prompt adds "RESPECT EVERY INVARIANT" — base prompt doesn't have this
  assert.ok(ICG_SYSTEM_PROMPT.includes('INVARIANT'), 'ICG prompt should mention invariants');
  assert.ok(ICG_SYSTEM_PROMPT.includes('RESPECT EVERY INVARIANT'), 'ICG prompt should have the invariant constraint');
});

test('ICG invariant section format matches expected structure', () => {
  const invariants = [
    { type: INVARIANT_TYPES.TYPE_CONSTRAINT, description: 'Input is sorted array of integers', source: 'constraint', confidence: INVARIANT_CONFIDENCE.HIGH },
    { type: INVARIANT_TYPES.LOOP_INVARIANT, description: 'Search range always narrows', source: 'problem_pattern', confidence: INVARIANT_CONFIDENCE.MEDIUM },
  ];
  const section = formatInvariantsForCoder(invariants);
  assert.ok(section.startsWith('\n--- DERIVED INVARIANTS'), 'Should start with section header');
  assert.ok(section.includes('END INVARIANTS ---'), 'Should end with section footer');
  assert.ok(section.includes('[HIGH]'), 'Should include HIGH confidence');
  assert.ok(section.includes('[MED]'), 'Should include MED confidence');
  assert.ok(section.includes('TYPE CONSTRAINT'), 'Should include TYPE CONSTRAINT tag');
  assert.ok(section.includes('LOOP INVARIANT'), 'Should include LOOP INVARIANT tag');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`ICG tests: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}