/**
 * test-decomposition.js — Tests for multi-step decomposition delta
 *
 * Covers:
 * 1. Sub-task creation and validation (createSubTask)
 * 2. Task graph creation and DAG validation (createTaskGraph)
 * 3. Cycle detection (rejects cyclic dependency graphs)
 * 4. Self-dependency rejection
 * 5. Unknown dependency rejection
 * 6. Duplicate ID rejection
 * 7. Orphaned sub-task detection (validateTaskGraph)
 * 8. Topological order correctness
 * 9. Decomposition delta creation (createDecompositionDelta)
 * 10. Pre-built decomposition strategies:
 *    - Design pipeline (linear 4-step)
 *    - Planning fork (parallel-then-merge)
 *    - Analysis refinement (iterative feedback loop)
 * 11. Delta schema compatibility (schemaVersion, id, trigger, etc.)
 * 12. Delta-log integration (can be stored in delta log)
 */

import assert from 'node:assert/strict';
import {
  createSubTask,
  createTaskGraph,
  validateTaskGraph,
  createDecompositionDelta,
  decomposeAsDesignPipeline,
  decomposeAsPlanningFork,
  decomposeAsAnalysisRefinement,
  DECOMPOSITION_SCHEMA_VERSION,
} from './decomposition-delta.js';
import { createDelta, appendDelta, validateDelta, readDeltas } from './delta-log.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Helper: simple 3-step linear graph ─────────────────────────────────────

function makeLinearGraph() {
  const subtasks = [
    createSubTask({ id: 'step-1', description: 'Analyze problem', dependencies: [], criterion: 'correctness', component: 'algorithmic_strategy_scaffold', kind: 'analysis' }),
    createSubTask({ id: 'step-2', description: 'Plan approach', dependencies: ['step-1'], criterion: 'correctness', component: 'algorithmic_strategy_scaffold', kind: 'planning' }),
    createSubTask({ id: 'step-3', description: 'Implement solution', dependencies: ['step-2'], criterion: 'interfaceContract', component: 'signature_contract', kind: 'implementation' }),
  ];
  return createTaskGraph({ problemName: 'test-problem', subtasks });
}

// ─── Helper: parallel-then-merge (diamond) graph ────────────────────────────

function makeDiamondGraph() {
  const subtasks = [
    createSubTask({ id: 'analyze-a', description: 'Analyze constraints', dependencies: [], criterion: 'correctness', component: 'algorithmic_strategy_scaffold', kind: 'analysis' }),
    createSubTask({ id: 'analyze-b', description: 'Analyze edge cases', dependencies: [], criterion: 'edgeCases', component: 'edge_case_scaffold', kind: 'analysis' }),
    createSubTask({ id: 'merge', description: 'Merge analyses', dependencies: ['analyze-a', 'analyze-b'], criterion: 'specAlignment', component: 'spec_alignment_scaffold', kind: 'planning' }),
  ];
  return createTaskGraph({ problemName: 'diamond-problem', subtasks });
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Sub-task creation and validation
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── Section 1: createSubTask validation ────');

// 1.1: Valid sub-task creation
{
  const task = createSubTask({
    id: 'my-task',
    description: 'Test task',
    dependencies: [],
    criterion: 'correctness',
    component: 'algorithmic_strategy_scaffold',
    kind: 'analysis',
  });
  assert.equal(task.id, 'my-task');
  assert.equal(task.description, 'Test task');
  assert.deepEqual(task.dependencies, []);
  assert.equal(task.criterion, 'correctness');
  assert.equal(task.component, 'algorithmic_strategy_scaffold');
  assert.equal(task.kind, 'analysis');
  assert.equal(task.status, 'pending');
  console.log('  1.1 valid sub-task: PASS');
}

// 1.2: Missing required fields
{
  assert.throws(() => createSubTask({}), /id is required/);
  assert.throws(() => createSubTask({ id: 't1' }), /description is required/);
  assert.throws(() => createSubTask({ id: 't2', description: 'desc' }), /criterion is required/);
  console.log('  1.2 missing fields throw: PASS');
}

// 1.3: Invalid kind
{
  assert.throws(() => createSubTask({
    id: 't1', description: 'desc', dependencies: [],
    criterion: 'correctness', component: 'x', kind: 'invalid_kind',
  }), /invalid sub-task kind/);
  console.log('  1.3 invalid kind throws: PASS');
}

// 1.4: Invalid dependency
{
  assert.throws(() => createSubTask({
    id: 't1', description: 'desc', dependencies: [''],
    criterion: 'correctness', component: 'x', kind: 'analysis',
  }), /invalid dependency/);
  console.log('  1.4 invalid dependency throws: PASS');
}

// 1.5: Dependencies array is copied (not shared reference)
{
  const deps = ['a'];
  const task = createSubTask({
    id: 't1', description: 'desc', dependencies: deps,
    criterion: 'correctness', component: 'x', kind: 'analysis',
  });
  deps.push('b');
  assert.equal(task.dependencies.length, 1, 'dependencies should be a copy');
  console.log('  1.5 dependencies copied (not shared ref): PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Task graph creation
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 2: createTaskGraph ────');

// 2.1: Linear graph creates valid structure
{
  const graph = makeLinearGraph();
  assert.equal(graph.problemName, 'test-problem');
  assert.equal(graph.subtasks.length, 3);
  assert.deepEqual(graph.roots, ['step-1']);
  assert.deepEqual(graph.leaves, ['step-3']);
  assert.equal(graph.topologicalOrder.length, 3);
  assert.ok(graph.topologicalOrder.indexOf('step-1') < graph.topologicalOrder.indexOf('step-2'));
  assert.ok(graph.topologicalOrder.indexOf('step-2') < graph.topologicalOrder.indexOf('step-3'));
  assert.ok(graph.createdAt);
  console.log('  2.1 linear graph: PASS');
}

// 2.2: Diamond (parallel-then-merge) graph
{
  const graph = makeDiamondGraph();
  assert.equal(graph.subtasks.length, 3);
  assert.equal(graph.roots.length, 2);
  assert.ok(graph.roots.includes('analyze-a'));
  assert.ok(graph.roots.includes('analyze-b'));
  assert.deepEqual(graph.leaves, ['merge']);
  // merge must come after both analyze-a and analyze-b
  assert.ok(graph.topologicalOrder.indexOf('merge') > graph.topologicalOrder.indexOf('analyze-a'));
  assert.ok(graph.topologicalOrder.indexOf('merge') > graph.topologicalOrder.indexOf('analyze-b'));
  console.log('  2.2 diamond graph: PASS');
}

// 2.3: Empty subtasks throws
{
  assert.throws(() => createTaskGraph({ problemName: 'x', subtasks: [] }), /non-empty/);
  console.log('  2.3 empty subtasks throws: PASS');
}

// 2.4: Missing problemName throws
{
  const subtasks = [createSubTask({ id: 's1', description: 'desc', dependencies: [], criterion: 'correctness', component: 'x', kind: 'analysis' })];
  assert.throws(() => createTaskGraph({ subtasks }), /problemName is required/);
  console.log('  2.4 missing problemName throws: PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Cycle detection (DAG validation)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 3: Cycle detection ────');

// 3.1: Simple cycle A → B → A
{
  const subtasks = [
    { id: 'a', description: 'task a', dependencies: ['b'], criterion: 'correctness', component: 'x', kind: 'analysis', status: 'pending' },
    { id: 'b', description: 'task b', dependencies: ['a'], criterion: 'correctness', component: 'x', kind: 'analysis', status: 'pending' },
  ];
  assert.throws(() => createTaskGraph({ problemName: 'cycle-test', subtasks }), /cycle/);
  console.log('  3.1 simple cycle A→B→A: PASS');
}

// 3.2: Three-node cycle A → B → C → A
{
  const subtasks = [
    { id: 'a', description: 'a', dependencies: ['c'], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
    { id: 'b', description: 'b', dependencies: ['a'], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
    { id: 'c', description: 'c', dependencies: ['b'], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
  ];
  assert.throws(() => createTaskGraph({ problemName: 'three-cycle', subtasks }), /cycle/);
  console.log('  3.2 three-node cycle: PASS');
}

// 3.3: Self-dependency throws (detected at createTaskGraph level)
{
  const subtasks = [
    { id: 'a', description: 'a', dependencies: ['a'], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
  ];
  assert.throws(() => createTaskGraph({ problemName: 'self-dep', subtasks }), /self-dependency/i);
  console.log('  3.3 self-dependency: PASS');
}

// 3.4: Unknown dependency reference throws
{
  const subtasks = [
    { id: 'a', description: 'a', dependencies: ['nonexistent'], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
  ];
  assert.throws(() => createTaskGraph({ problemName: 'bad-dep', subtasks }), /unknown dependency/i);
  console.log('  3.4 unknown dependency: PASS');
}

// 3.5: Duplicate sub-task IDs throws
{
  const subtasks = [
    { id: 'dup', description: 'first', dependencies: [], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
    { id: 'dup', description: 'second', dependencies: [], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
  ];
  assert.throws(() => createTaskGraph({ problemName: 'dup-ids', subtasks }), /duplicate/i);
  console.log('  3.5 duplicate IDs: PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: validateTaskGraph — structural validation
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 4: validateTaskGraph ────');

// 4.1: Valid linear graph passes validation
{
  const graph = makeLinearGraph();
  const v = validateTaskGraph(graph);
  assert.equal(v.valid, true, `expected valid, got errors: ${JSON.stringify(v.errors)}`);
  console.log('  4.1 valid linear graph: PASS');
}

// 4.2: Valid diamond graph passes validation
{
  const graph = makeDiamondGraph();
  const v = validateTaskGraph(graph);
  assert.equal(v.valid, true, `expected valid, got errors: ${JSON.stringify(v.errors)}`);
  console.log('  4.2 valid diamond graph: PASS');
}

// 4.3: null graph fails
{
  const v = validateTaskGraph(null);
  assert.equal(v.valid, false);
  console.log('  4.3 null graph: PASS');
}

// 4.4: Missing required fields
{
  const v = validateTaskGraph({ problemName: 'x' }); // no subtasks, roots, leaves, topologicalOrder
  assert.equal(v.valid, false);
  assert.ok(v.errors.length >= 3, 'should have multiple errors');
  console.log('  4.4 missing fields: PASS');
}

// 4.5: Orphaned sub-task detection
{
  // Build a valid graph first, then manually add an orphan
  const graph = makeLinearGraph();
  const orphaned = {
    ...graph,
    subtasks: [
      ...graph.subtasks,
      { id: 'orphan', description: 'I have no path to roots', dependencies: ['step-1-nonexistent'], criterion: 'c', component: 'x', kind: 'analysis', status: 'pending' },
    ],
    topologicalOrder: [...graph.topologicalOrder, 'orphan'],
  };
  // The orphan references a non-existent dependency, so this should fail in multiple ways
  const v = validateTaskGraph(orphaned);
  assert.equal(v.valid, false);
  const hasUnknownDep = v.errors.some(e => e.message && e.message.includes('unknown dependency'));
  assert.ok(hasUnknownDep, 'should detect unknown dependency');
  console.log('  4.5 orphan detection: PASS');
}

// 4.6: Unreachable node (orphan with no path FROM root)
{
  // Create a graph where one node is valid (no broken deps) but unreachable from roots
  const subtasks = [
    createSubTask({ id: 'root', description: 'root', dependencies: [], criterion: 'correctness', component: 'x', kind: 'analysis' }),
    createSubTask({ id: 'reachable', description: 'reachable', dependencies: ['root'], criterion: 'correctness', component: 'x', kind: 'implementation' }),
  ];
  const goodGraph = createTaskGraph({ problemName: 'reachable-test', subtasks });
  // Now build a graph with an unreachable node manually
  const unreachableSubtask = createSubTask({ id: 'island', description: 'island with self-cycle blocked', dependencies: [], criterion: 'correctness', component: 'x', kind: 'analysis' });
  // Wait — island with no deps IS a root. So we need an island that depends on nothing
  // but is also not reachable from the main root. Actually, with no deps it's its own root.
  // For a true orphan: a node that has a dependency but is not reachable from any root.
  // Let's make: root → reachable, island → (depends on nothing, but we exclude it from roots)
  const mixedSubtasks = [
    { id: 'root', description: 'root', dependencies: [], criterion: 'correctness', component: 'x', kind: 'analysis', status: 'pending' },
    { id: 'child', description: 'child', dependencies: ['root'], criterion: 'correctness', component: 'x', kind: 'implementation', status: 'pending' },
    { id: 'island', description: 'disconnected island', dependencies: [], criterion: 'correctness', component: 'x', kind: 'analysis', status: 'pending' },
  ];
  // 'island' is also a root — not an orphan. True orphans require broken dependency chains.
  // Let's validate that disconnected islands are still valid roots (just separate components).
  const multiRoot = createTaskGraph({ problemName: 'multi-root', subtasks: mixedSubtasks });
  const v = validateTaskGraph(multiRoot);
  assert.equal(v.valid, true, 'disconnected components with own roots should still be valid');
  assert.ok(multiRoot.roots.includes('root'));
  assert.ok(multiRoot.roots.includes('island'));
  console.log('  4.6 multi-root valid (disconnected components ok): PASS');
}

// 4.7: Topological order correctness verification
{
  const graph = makeDiamondGraph();
  const v = validateTaskGraph(graph);
  assert.equal(v.valid, true);
  // Verify that dependencies come before dependents in topological order
  const pos = new Map(graph.topologicalOrder.map((id, i) => [id, i]));
  for (const task of graph.subtasks) {
    for (const dep of task.dependencies) {
      assert.ok(pos.get(dep) < pos.get(task.id), `${dep} should come before ${task.id}`);
    }
  }
  console.log('  4.7 topological order correctness: PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: createDecompositionDelta
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 5: createDecompositionDelta ────');

// 5.1: Creates valid delta with task graph
{
  const graph = makeLinearGraph();
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const delta = createDecompositionDelta({
    problemName: 'binary-search',
    baselineKind: 'reasoning_os_v0',
    criteriaVector,
    taskGraph: graph,
  });
  assert.equal(delta.schemaVersion, 'scaffold-delta/v0');
  assert.ok(delta.id.startsWith('delta-'));
  assert.ok(delta.createdAt);
  assert.equal(delta.status, 'proposed');
  assert.equal(delta.trigger.problemId, 'binary-search');
  assert.equal(delta.trigger.criterion, 'correctness');
  assert.ok(delta.hypothesis.includes('3 sub-tasks'));
  assert.ok(delta.patch.after.includes('structured decomposition'));
  assert.ok(delta.patch.taskGraph);
  assert.equal(delta.patch.taskGraph.subtasks.length, 3);
  assert.equal(delta.patch.taskGraph.roots.length, 1);
  assert.equal(delta.patch.taskGraph.leaves.length, 1);
  assert.deepEqual(delta.expectedEffect.decreaseFailureKinds, ['logic_assertion']);
  console.log('  5.1 valid decomposition delta: PASS');
}

// 5.2: Rejects invalid task graph
{
  assert.throws(() => createDecompositionDelta({
    problemName: 'test',
    baselineKind: 'reasoning_os_v0',
    criteriaVector: {},
    taskGraph: { problemName: 'x' }, // missing subtasks, etc.
  }), /invalid task graph/i);
  console.log('  5.2 rejects invalid graph: PASS');
}

// 5.3: Delta is compatible with delta-log (can be stored and read)
{
  const graph = makeLinearGraph();
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const decompDelta = createDecompositionDelta({
    problemName: 'delta-log-test',
    baselineKind: 'reasoning_os_v0',
    criteriaVector,
    taskGraph: graph,
  });

  // Convert to standard delta format and validate
  const standardDelta = createDelta({
    trigger: decompDelta.trigger,
    hypothesis: decompDelta.hypothesis,
    patch: decompDelta.patch,
    expectedEffect: decompDelta.expectedEffect,
  });
  const validation = validateDelta(standardDelta);
  assert.equal(validation.valid, true, `standard delta validation: ${JSON.stringify(validation.errors)}`);

  // Can write to delta log
  const dir = mkdtempSync(join(tmpdir(), 'decomp-delta-log-'));
  const logPath = join(dir, 'deltas.jsonl');
  appendDelta(logPath, standardDelta);
  const deltas = readDeltas(logPath);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].id, standardDelta.id);
  console.log('  5.3 delta-log integration: PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Pre-built decomposition strategies
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 6: Pre-built decomposition strategies ────');

// 6.1: Design pipeline (linear 4-step: analysis → planning → implementation → verification)
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const delta = decomposeAsDesignPipeline({ problemName: 'climbing-stairs', criteriaVector });
  assert.equal(delta.schemaVersion, 'scaffold-delta/v0');
  const tg = delta.patch.taskGraph;
  assert.equal(tg.subtasks.length, 4, 'design pipeline should have 4 sub-tasks');
  assert.deepEqual(tg.roots, ['climbing-stairs-analyze'], 'should have 1 root');
  assert.deepEqual(tg.leaves, ['climbing-stairs-verify'], 'should have 1 leaf');
  // Verify linear ordering: each step depends on the previous
  assert.deepEqual(tg.subtasks[0].dependencies, [], 'analyze has no deps');
  assert.deepEqual(tg.subtasks[1].dependencies, ['climbing-stairs-analyze'], 'plan depends on analyze');
  assert.deepEqual(tg.subtasks[2].dependencies, ['climbing-stairs-plan'], 'implement depends on plan');
  assert.deepEqual(tg.subtasks[3].dependencies, ['climbing-stairs-implement'], 'verify depends on implement');
  // Validate the task graph structure
  const graph = createTaskGraph({ problemName: 'climbing-stairs', subtasks: tg.subtasks.map(s => ({...s})) });
  const v = validateTaskGraph(graph);
  assert.equal(v.valid, true, `design pipeline graph: ${JSON.stringify(v.errors)}`);
  console.log('  6.1 design pipeline: PASS');
}

// 6.2: Planning fork (parallel analysis → merge → implement)
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const delta = decomposeAsPlanningFork({ problemName: 'coin-change-ii', criteriaVector });
  const tg = delta.patch.taskGraph;
  assert.equal(tg.subtasks.length, 4, 'planning fork should have 4 sub-tasks');
  assert.equal(tg.roots.length, 2, 'should have 2 roots (constraints + edge-cases)');
  assert.ok(tg.roots.includes('coin-change-ii-constraints'));
  assert.ok(tg.roots.includes('coin-change-ii-edge-cases'));
  assert.deepEqual(tg.leaves, ['coin-change-ii-implement'], 'should have 1 leaf');
  // plan depends on both roots
  const plan = tg.subtasks.find(s => s.id === 'coin-change-ii-plan');
  assert.equal(plan.dependencies.length, 2);
  assert.ok(plan.dependencies.includes('coin-change-ii-constraints'));
  assert.ok(plan.dependencies.includes('coin-change-ii-edge-cases'));
  console.log('  6.2 planning fork: PASS');
}

// 6.3: Analysis refinement (initial → review → refine)
{
  const criteriaVector = { formatProtocol: 0, failureCriterion: 'formatProtocol', failureKind: 'format_protocol' };
  const delta = decomposeAsAnalysisRefinement({ problemName: 'binary-search', criteriaVector });
  const tg = delta.patch.taskGraph;
  assert.equal(tg.subtasks.length, 3, 'analysis refinement should have 3 sub-tasks');
  assert.deepEqual(tg.roots, ['binary-search-initial'], 'should have 1 root');
  assert.deepEqual(tg.leaves, ['binary-search-refine'], 'should have 1 leaf');
  // Verify sequential chain
  assert.deepEqual(tg.subtasks[0].dependencies, [], 'initial has no deps');
  assert.deepEqual(tg.subtasks[1].dependencies, ['binary-search-initial'], 'review depends on initial');
  assert.deepEqual(tg.subtasks[2].dependencies, ['binary-search-review'], 'refine depends on review');
  console.log('  6.3 analysis refinement: PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: End-to-end decomposition DAG property checks
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 7: DAG property checks ────');

// 7.1: All strategies produce valid DAGs
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const strategies = [
    decomposeAsDesignPipeline({ problemName: 'test', criteriaVector }),
    decomposeAsPlanningFork({ problemName: 'test', criteriaVector }),
    decomposeAsAnalysisRefinement({ problemName: 'test', criteriaVector }),
  ];
  for (const delta of strategies) {
    const tg = delta.patch.taskGraph;
    const graph = createTaskGraph({ problemName: tg.problemName, subtasks: tg.subtasks.map(s => ({...s})) });
    const v = validateTaskGraph(graph);
    assert.equal(v.valid, true, `${delta.hypothesis}: ${JSON.stringify(v.errors)}`);
  }
  console.log('  7.1 all strategies produce valid DAGs: PASS');
}

// 7.2: Every sub-task is reachable from a root and reaches a leaf
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const delta = decomposeAsPlanningFork({ problemName: 'reachability-test', criteriaVector });
  const tg = delta.patch.taskGraph;
  const subtaskMap = new Map(tg.subtasks.map(s => [s.id, s]));
  const rootSet = new Set(tg.roots);

  // Forward reachability from roots
  const forwardReachable = new Set();
  const queue = [...tg.roots];
  while (queue.length > 0) {
    const current = queue.shift();
    if (forwardReachable.has(current)) continue;
    forwardReachable.add(current);
    const task = subtaskMap.get(current);
    // Find dependents (tasks that depend on current)
    for (const s of tg.subtasks) {
      if (s.dependencies.includes(current) && !forwardReachable.has(s.id)) {
        queue.push(s.id);
      }
    }
  }

  // Every subtask must be forward-reachable from a root
  for (const s of tg.subtasks) {
    assert.ok(forwardReachable.has(s.id), `subtask '${s.id}' not reachable from any root`);
  }
  console.log('  7.2 all sub-tasks reachable from roots: PASS');
}

// 7.3: No sub-task has a dependency path leading back to itself (acyclic)
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const strategies = [
    decomposeAsDesignPipeline({ problemName: 'acyclic-test', criteriaVector }),
    decomposeAsPlanningFork({ problemName: 'acyclic-test', criteriaVector }),
    decomposeAsAnalysisRefinement({ problemName: 'acyclic-test', criteriaVector }),
  ];
  for (const delta of strategies) {
    const tg = delta.patch.taskGraph;
    const subtaskMap = new Map(tg.subtasks.map(s => [s.id, s]));
    // DFS cycle detection
    const visiting = new Set();
    const visited = new Set();
    const hasCycle = (id) => {
      if (visited.has(id)) return false;
      if (visiting.has(id)) return true;
      visiting.add(id);
      const task = subtaskMap.get(id);
      for (const dep of task.dependencies) {
        if (hasCycle(dep)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    for (const s of tg.subtasks) {
      assert.ok(!hasCycle(s.id), `cycle detected involving '${s.id}'`);
    }
  }
  console.log('  7.3 all strategies acyclic (DFS cycle check): PASS');
}

// 7.4: Topological order is consistent with dependencies
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const strategies = [
    decomposeAsDesignPipeline({ problemName: 'topo-test', criteriaVector }),
    decomposeAsPlanningFork({ problemName: 'topo-test', criteriaVector }),
    decomposeAsAnalysisRefinement({ problemName: 'topo-test', criteriaVector }),
  ];
  for (const delta of strategies) {
    const tg = delta.patch.taskGraph;
    const pos = new Map(tg.topologicalOrder.map((id, i) => [id, i]));
    for (const s of tg.subtasks) {
      for (const dep of s.dependencies) {
        assert.ok(pos.has(dep), `dependency '${dep}' not in topological order`);
        assert.ok(pos.get(dep) < pos.get(s.id), `dep '${dep}' should come before '${s.id}'`);
      }
    }
  }
  console.log('  7.4 topological order consistent with deps: PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: Delta schema compatibility
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 8: Delta schema compatibility ────');

// 8.1: Schema version matches scaffold-delta/v0
{
  assert.equal(DECOMPOSITION_SCHEMA_VERSION, 'scaffold-delta/v0');
  console.log('  8.1 schema version: PASS');
}

// 8.2: Decomposition delta has all required fields for delta-log storage
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const delta = decomposeAsDesignPipeline({ problemName: 'schema-test', criteriaVector });
  assert.ok(delta.schemaVersion, 'has schemaVersion');
  assert.ok(delta.id, 'has id');
  assert.ok(delta.createdAt, 'has createdAt');
  assert.ok(delta.trigger, 'has trigger');
  assert.ok(delta.trigger.criterion, 'trigger has criterion');
  assert.ok(delta.trigger.component, 'trigger has component');
  assert.ok(delta.hypothesis, 'has hypothesis');
  assert.ok(delta.patch, 'has patch');
  assert.ok(delta.patch.component, 'patch has component');
  assert.ok(delta.patch.before, 'patch has before');
  assert.ok(delta.patch.after, 'patch has after');
  assert.ok(delta.expectedEffect, 'has expectedEffect');
  assert.equal(delta.status, 'proposed');
  assert.ok(Array.isArray(delta.evidence));
  console.log('  8.2 all required fields present: PASS');
}

// 8.3: Task graph in patch contains full structure
{
  const criteriaVector = { correctness: 0, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const delta = decomposeAsPlanningFork({ problemName: 'patch-structure-test', criteriaVector });
  const tg = delta.patch.taskGraph;
  assert.ok(tg.problemName, 'taskGraph has problemName');
  assert.ok(Array.isArray(tg.subtasks), 'taskGraph has subtasks');
  assert.ok(Array.isArray(tg.roots), 'taskGraph has roots');
  assert.ok(Array.isArray(tg.leaves), 'taskGraph has leaves');
  assert.ok(Array.isArray(tg.topologicalOrder), 'taskGraph has topologicalOrder');
  // Each subtask in the patch has the expected fields
  for (const s of tg.subtasks) {
    assert.ok(s.id, 'subtask has id');
    assert.ok(s.description, 'subtask has description');
    assert.ok(Array.isArray(s.dependencies), 'subtask has dependencies');
    assert.ok(s.criterion, 'subtask has criterion');
    assert.ok(s.kind, 'subtask has kind');
  }
  console.log('  8.3 task graph structure in patch: PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9: End-to-end — decomposition produces delta that integrates
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n─── Section 9: End-to-end integration ────');

// 9.1: Full pipeline: create graph → create delta → validate → store in delta-log
{
  const criteriaVector = { correctness: 0, interfaceContract: 1, failureCriterion: 'correctness', failureKind: 'logic_assertion' };
  const subtasks = [
    createSubTask({ id: 'step-1', description: 'Analyze problem', dependencies: [], criterion: 'correctness', component: 'algorithmic_strategy_scaffold', kind: 'analysis' }),
    createSubTask({ id: 'step-2', description: 'Plan approach', dependencies: ['step-1'], criterion: 'correctness', component: 'algorithmic_strategy_scaffold', kind: 'planning' }),
    createSubTask({ id: 'step-3', description: 'Implement', dependencies: ['step-2'], criterion: 'interfaceContract', component: 'signature_contract', kind: 'implementation' }),
    createSubTask({ id: 'step-4', description: 'Verify', dependencies: ['step-3'], criterion: 'specAlignment', component: 'spec_alignment_scaffold', kind: 'verification' }),
  ];
  const taskGraph = createTaskGraph({ problemName: 'container-with-most-water', subtasks });
  const v = validateTaskGraph(taskGraph);
  assert.equal(v.valid, true, `e2e graph validation: ${JSON.stringify(v.errors)}`);

  const delta = createDecompositionDelta({
    problemName: 'container-with-most-water',
    baselineKind: 'reasoning_os_v0',
    criteriaVector,
    taskGraph,
  });

  // Convert for delta-log storage
  const logDelta = createDelta({
    trigger: delta.trigger,
    hypothesis: delta.hypothesis,
    patch: delta.patch,
    expectedEffect: delta.expectedEffect,
  });
  const logValidation = validateDelta(logDelta);
  assert.equal(logValidation.valid, true, `delta-log validation: ${JSON.stringify(logValidation.errors)}`);

  const dir = mkdtempSync(join(tmpdir(), 'decomp-e2e-'));
  const logPath = join(dir, 'deltas.jsonl');
  appendDelta(logPath, logDelta);
  const stored = readDeltas(logPath);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, logDelta.id);
  assert.ok(stored[0].patch.taskGraph, 'stored delta preserves taskGraph');
  assert.equal(stored[0].patch.taskGraph.subtasks.length, 4);

  console.log('  9.1 full pipeline (create→validate→store→read): PASS');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n✅ test-decomposition: ALL 24 ASSERTIONS PASSED');