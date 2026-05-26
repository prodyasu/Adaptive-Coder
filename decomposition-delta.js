/**
 * decomposition-delta.js — Multi-step decomposition delta for Reasoning OS v0
 *
 * Decomposes a complex problem into a task graph (DAG) of sub-tasks with
 * dependency relationships. This is the "reasoning-improving" delta that
 * transforms a single flat problem into a structured decomposition where
 * sub-tasks have clear parent-child edges, no cycles, and no orphaned steps.
 *
 * Schema: scaffold-delta/v0 compatible with the existing delta-log system.
 */

import { randomUUID } from 'node:crypto';

export const DECOMPOSITION_SCHEMA_VERSION = 'scaffold-delta/v0';

// ─── Task graph node ───────────────────────────────────────────────────────

/**
 * Create a sub-task node in the decomposition graph.
 * @param {object} opts
 * @param {string} opts.id - Unique identifier for this sub-task
 * @param {string} opts.description - What this sub-task accomplishes
 * @param {string[]} opts.dependencies - IDs of sub-tasks that must complete before this one
 * @param {string} opts.criterion - Which criterion this sub-task addresses
 * @param {string} opts.component - Which component this sub-task targets
 * @param {string} [opts.kind] - Sub-task kind: 'analysis' | 'planning' | 'implementation' | 'verification'
 * @param {object} [opts.spec] - Problem spec fragment for this sub-task
 */
export function createSubTask({ id, description, dependencies = [], criterion, component, kind = 'implementation', spec = null }) {
  if (!id || typeof id !== 'string') throw new Error('sub-task id is required');
  if (!description || typeof description !== 'string') throw new Error('sub-task description is required');
  if (!criterion || typeof criterion !== 'string') throw new Error('sub-task criterion is required');
  if (!component || typeof criterion !== 'string') throw new Error('sub-task component is required');
  if (!['analysis', 'planning', 'implementation', 'verification'].includes(kind)) {
    throw new Error(`invalid sub-task kind: ${kind}`);
  }
  for (const dep of dependencies) {
    if (typeof dep !== 'string' || dep.length === 0) {
      throw new Error(`invalid dependency: ${JSON.stringify(dep)}`);
    }
  }
  return {
    id,
    description,
    dependencies: [...dependencies],
    criterion,
    component,
    kind,
    spec,
    status: 'pending',
  };
}

// ─── Task graph ─────────────────────────────────────────────────────────────

/**
 * Create a task graph from a list of sub-tasks.
 * Validates that the graph is a DAG (no cycles), has no orphaned nodes,
 * and all dependency references resolve.
 */
export function createTaskGraph({ problemName, subtasks }) {
  if (!problemName || typeof problemName !== 'string') {
    throw new Error('problemName is required');
  }
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    throw new Error('subtasks must be a non-empty array');
  }

  const ids = new Set(subtasks.map(t => t.id));
  const duplicates = subtasks.map(t => t.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`duplicate sub-task ids: ${duplicates.join(', ')}`);
  }

  // All dependency references must resolve
  for (const task of subtasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) {
        throw new Error(`sub-task '${task.id}' references unknown dependency '${dep}'`);
      }
    }
    // No self-dependency
    if (task.dependencies.includes(task.id)) {
      throw new Error(`sub-task '${task.id}' has self-dependency`);
    }
  }

  // Cycle detection via topological sort (Kahn's algorithm)
  const inDegree = new Map();
  const adjacency = new Map();
  for (const task of subtasks) {
    inDegree.set(task.id, task.dependencies.length);
    adjacency.set(task.id, []);
  }
  for (const task of subtasks) {
    for (const dep of task.dependencies) {
      adjacency.get(dep).push(task.id);
    }
  }

  const queue = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }
  const sorted = [];
  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);
    for (const neighbor of adjacency.get(current)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== subtasks.length) {
    throw new Error('task graph contains a cycle — decomposition must be a DAG');
  }

  // Find roots (no dependencies)
  const roots = subtasks.filter(t => t.dependencies.length === 0);
  // Find leaves (nothing depends on them)
  const allDeps = new Set(subtasks.flatMap(t => t.dependencies));
  const leaves = subtasks.filter(t => !allDeps.has(t.id));

  return {
    problemName,
    subtasks: [...subtasks],
    roots: roots.map(t => t.id),
    leaves: leaves.map(t => t.id),
    topologicalOrder: sorted,
    createdAt: new Date().toISOString(),
  };
}

// ─── Decomposition delta creation ──────────────────────────────────────────

/**
 * Validate a task graph for structural correctness.
 * Returns { valid, errors } where errors are { path, message } objects.
 */
export function validateTaskGraph(graph) {
  const errors = [];

  if (!graph || typeof graph !== 'object') {
    return { valid: false, errors: [{ path: 'root', message: 'graph must be an object' }] };
  }
  if (!graph.problemName) errors.push({ path: 'problemName', message: 'required' });
  if (!Array.isArray(graph.subtasks) || graph.subtasks.length === 0) {
    errors.push({ path: 'subtasks', message: 'must be non-empty array' });
  }
  if (!Array.isArray(graph.roots) || graph.roots.length === 0) {
    errors.push({ path: 'roots', message: 'must have at least one root node' });
  }
  if (!Array.isArray(graph.leaves) || graph.leaves.length === 0) {
    errors.push({ path: 'leaves', message: 'must have at least one leaf node' });
  }
  if (!Array.isArray(graph.topologicalOrder) || graph.topologicalOrder.length === 0) {
    errors.push({ path: 'topologicalOrder', message: 'required (must be a DAG)' });
  }

  if (errors.length > 0) return { valid: false, errors };

  // Check all subtask IDs are unique
  const ids = graph.subtasks.map(t => t.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    errors.push({ path: 'subtasks', message: 'duplicate sub-task ids' });
  }

  // Check all dependency refs resolve
  for (const task of graph.subtasks) {
    for (const dep of task.dependencies) {
      if (!uniqueIds.has(dep)) {
        errors.push({ path: `subtasks/${task.id}/dependencies`, message: `unknown dependency '${dep}'` });
      }
    }
    if (task.dependencies.includes(task.id)) {
      errors.push({ path: `subtasks/${task.id}/dependencies`, message: 'self-dependency' });
    }
  }

  // Check topological order contains all subtasks
  const topoSet = new Set(graph.topologicalOrder);
  for (const id of ids) {
    if (!topoSet.has(id)) {
      errors.push({ path: 'topologicalOrder', message: `missing sub-task '${id}'` });
    }
  }

  // Check roots are in subtasks
  for (const rootId of graph.roots) {
    if (!uniqueIds.has(rootId)) {
      errors.push({ path: 'roots', message: `unknown root '${rootId}'` });
    }
  }

  // Check leaves are in subtasks
  for (const leafId of graph.leaves) {
    if (!uniqueIds.has(leafId)) {
      errors.push({ path: 'leaves', message: `unknown leaf '${leafId}'` });
    }
  }

  // Detect orphans: nodes not reachable from any root
  const reachable = new Set();
  const visit = (id) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const task = graph.subtasks.find(t => t.id === id);
    if (task) {
      // Also visit tasks that depend on this one
      const dependents = graph.subtasks.filter(t => t.dependencies.includes(id));
      for (const dep of dependents) visit(dep.id);
    }
  };
  for (const rootId of graph.roots) visit(rootId);
  for (const id of ids) {
    if (!reachable.has(id)) {
      errors.push({ path: `subtasks/${id}`, message: 'orphaned sub-task (not reachable from any root)' });
    }
  }

  // Verify topological order: every dependency appears before its dependent
  const position = new Map();
  graph.topologicalOrder.forEach((id, idx) => position.set(id, idx));
  for (const task of graph.subtasks) {
    for (const dep of task.dependencies) {
      if ((position.get(dep) ?? -1) >= (position.get(task.id) ?? Infinity)) {
        errors.push({ path: `subtasks/${task.id}/dependencies/${dep}`, message: `dependency '${dep}' must come before '${task.id}' in topological order` });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create a decomposition delta that turns a failed attempt's criteria vector
 * into a structured task decomposition.
 *
 * This is a "reasoning-improving" delta: it doesn't patch extraction or
 * signature issues, but instead decomposes a complex problem into a graph
 * of dependent sub-tasks that can be solved sequentially or in parallel
 * (subject to their dependency edges).
 */
export function createDecompositionDelta({ problemName, baselineKind, criteriaVector, taskGraph }) {
  const graphValidation = validateTaskGraph(taskGraph);
  if (!graphValidation.valid) {
    throw new Error(`invalid task graph: ${JSON.stringify(graphValidation.errors)}`);
  }

  const trigger = {
    problemId: problemName,
    baselineKind,
    failureKind: criteriaVector?.failureKind ?? 'logic_assertion',
    criterion: criteriaVector?.failureCriterion ?? 'correctness',
    component: criteriaVector?.failureCriterion
      ? { correctness: 'algorithmic_strategy_scaffold', interfaceContract: 'signature_contract' }[criteriaVector.failureCriterion] ?? 'algorithmic_strategy_scaffold'
      : 'algorithmic_strategy_scaffold',
  };

  return {
    schemaVersion: DECOMPOSITION_SCHEMA_VERSION,
    id: `delta-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    trigger,
    hypothesis: `Decomposing '${problemName}' into ${taskGraph.subtasks.length} sub-tasks enables structured reasoning: ${taskGraph.subtasks.map(t => t.description).join(', ')}`,
    patch: {
      component: trigger.component,
      before: 'single flat attempt',
      after: `structured decomposition: ${taskGraph.topologicalOrder.join(' → ')}`,
      taskGraph: {
        problemName: taskGraph.problemName,
        subtasks: taskGraph.subtasks.map(t => ({
          id: t.id,
          description: t.description,
          dependencies: t.dependencies,
          criterion: t.criterion,
          kind: t.kind,
        })),
        roots: taskGraph.roots,
        leaves: taskGraph.leaves,
        topologicalOrder: taskGraph.topologicalOrder,
      },
    },
    expectedEffect: {
      decreaseFailureKinds: [trigger.failureKind],
      notExpectedToChange: ['format_protocol', 'spec_validation'],
    },
    status: 'proposed',
    evidence: [],
  };
}

// ─── Pre-built decomposition strategies ──────────────────────────────────────

/**
 * Multi-step design decomposition: analysis → planning → implementation → verification.
 * Breaks a design problem into sequential reasoning stages.
 */
export function decomposeAsDesignPipeline({ problemName, criteriaVector }) {
  const subtasks = [
    createSubTask({
      id: `${problemName}-analyze`,
      description: `Analyze requirements and constraints for '${problemName}'`,
      dependencies: [],
      criterion: 'correctness',
      component: 'algorithmic_strategy_scaffold',
      kind: 'analysis',
      spec: { objective: `Understand problem structure for ${problemName}` },
    }),
    createSubTask({
      id: `${problemName}-plan`,
      description: `Design algorithmic strategy for '${problemName}'`,
      dependencies: [`${problemName}-analyze`],
      criterion: 'correctness',
      component: 'algorithmic_strategy_scaffold',
      kind: 'planning',
      spec: { objective: `Plan approach for ${problemName}` },
    }),
    createSubTask({
      id: `${problemName}-implement`,
      description: `Implement solution for '${problemName}'`,
      dependencies: [`${problemName}-plan`],
      criterion: 'interfaceContract',
      component: 'signature_contract',
      kind: 'implementation',
      spec: { objective: `Write code for ${problemName}` },
    }),
    createSubTask({
      id: `${problemName}-verify`,
      description: `Verify solution correctness for '${problemName}'`,
      dependencies: [`${problemName}-implement`],
      criterion: 'specAlignment',
      component: 'spec_alignment_scaffold',
      kind: 'verification',
      spec: { objective: `Check solution for ${problemName}` },
    }),
  ];

  const taskGraph = createTaskGraph({ problemName, subtasks });
  return createDecompositionDelta({ problemName, baselineKind: 'reasoning_os_v0', criteriaVector, taskGraph });
}

/**
 * Multi-step planning decomposition: parallel analysis of constraints, then merge.
 * Models a problem where multiple constraint groups can be analyzed independently
 * before being merged into an implementation plan.
 */
export function decomposeAsPlanningFork({ problemName, criteriaVector }) {
  const subtasks = [
    createSubTask({
      id: `${problemName}-constraints`,
      description: `Extract and classify constraints for '${problemName}'`,
      dependencies: [],
      criterion: 'correctness',
      component: 'algorithmic_strategy_scaffold',
      kind: 'analysis',
    }),
    createSubTask({
      id: `${problemName}-edge-cases`,
      description: `Identify edge cases and boundary conditions for '${problemName}'`,
      dependencies: [],
      criterion: 'edgeCases',
      component: 'edge_case_scaffold',
      kind: 'analysis',
    }),
    createSubTask({
      id: `${problemName}-plan`,
      description: `Merge constraint analysis and edge cases into a unified plan for '${problemName}'`,
      dependencies: [`${problemName}-constraints`, `${problemName}-edge-cases`],
      criterion: 'specAlignment',
      component: 'spec_alignment_scaffold',
      kind: 'planning',
    }),
    createSubTask({
      id: `${problemName}-implement`,
      description: `Implement merged solution for '${problemName}'`,
      dependencies: [`${problemName}-plan`],
      criterion: 'interfaceContract',
      component: 'signature_contract',
      kind: 'implementation',
    }),
  ];

  const taskGraph = createTaskGraph({ problemName, subtasks });
  return createDecompositionDelta({ problemName, baselineKind: 'reasoning_os_v0', criteriaVector, taskGraph });
}

/**
 * Multi-step analysis decomposition: iterative refinement loop.
 * Models a problem requiring progressive refinement where each pass
 * sharpens the solution based on verification feedback.
 */
export function decomposeAsAnalysisRefinement({ problemName, criteriaVector }) {
  const subtasks = [
    createSubTask({
      id: `${problemName}-initial`,
      description: `Produce initial solution attempt for '${problemName}'`,
      dependencies: [],
      criterion: 'formatProtocol',
      component: 'structured_output_contract',
      kind: 'implementation',
    }),
    createSubTask({
      id: `${problemName}-review`,
      description: `Review initial solution against acceptance criteria for '${problemName}'`,
      dependencies: [`${problemName}-initial`],
      criterion: 'specAlignment',
      component: 'spec_alignment_scaffold',
      kind: 'verification',
    }),
    createSubTask({
      id: `${problemName}-refine`,
      description: `Refine solution based on review feedback for '${problemName}'`,
      dependencies: [`${problemName}-review`],
      criterion: 'correctness',
      component: 'algorithmic_strategy_scaffold',
      kind: 'implementation',
    }),
  ];

  const taskGraph = createTaskGraph({ problemName, subtasks });
  return createDecompositionDelta({ problemName, baselineKind: 'reasoning_os_v0', criteriaVector, taskGraph });
}