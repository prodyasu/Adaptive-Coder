export const REASONING_OS_VERSION = 'reasoning-os/v0';

export const CRITERIA = Object.freeze([
  'correctness',
  'interfaceContract',
  'edgeCases',
  'specAlignment',
  'formatProtocol',
  'repairability',
  'cohAtrRisk',
]);

export const COMPONENTS = Object.freeze([
  'algorithmic_strategy_scaffold',
  'signature_contract',
  'edge_case_scaffold',
  'spec_alignment_scaffold',
  'structured_output_contract',
  'repair_loop_policy',
  'coh_atr_audit_gate',
]);

export const CRITERION_COMPONENT_MAP = Object.freeze({
  correctness: 'algorithmic_strategy_scaffold',
  interfaceContract: 'signature_contract',
  edgeCases: 'edge_case_scaffold',
  specAlignment: 'spec_alignment_scaffold',
  formatProtocol: 'structured_output_contract',
  repairability: 'repair_loop_policy',
  cohAtrRisk: 'coh_atr_audit_gate',
});

export function validateCriterionComponentMap(map) {
  const errors = [];
  for (const criterion of Object.keys(map ?? {})) {
    if (!CRITERIA.includes(criterion)) {
      errors.push({ path: criterion, message: 'unknown criterion' });
    }
    if (!COMPONENTS.includes(map[criterion])) {
      errors.push({ path: criterion, message: 'unknown component' });
    }
  }
  for (const criterion of CRITERIA) {
    if (!map || typeof map[criterion] !== 'string') {
      errors.push({ path: criterion, message: 'missing component mapping' });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function routeTask({ problemName, baselineKind, taskKind = 'coding_eval' } = {}) {
  if (!problemName) throw new Error('problemName is required');
  if (taskKind !== 'coding_eval') throw new Error(`unsupported taskKind: ${taskKind}`);
  return {
    osVersion: REASONING_OS_VERSION,
    problemName,
    baselineKind,
    taskKind,
    mode: 'code_generation',
    reasoningStyle: 'spec_first',
    risk: 'local_eval',
    requiredChecks: [
      'signature_contract',
      'edge_cases',
      'runtime_tests',
      'structured_output_contract',
    ],
    uncertaintyPolicy: 'tool_before_claim',
  };
}

const FAILURE_TO_CRITERION = Object.freeze({
  pass: null,
  logic_assertion: 'correctness',
  format_protocol: 'formatProtocol',
  timeout: 'repairability',
  spec_validation: 'interfaceContract',
  model_error: 'repairability',
});

function fullPassVector() {
  return {
    correctness: 1,
    interfaceContract: 1,
    edgeCases: 1,
    specAlignment: 1,
    formatProtocol: 1,
    repairability: 1,
    cohAtrRisk: 0,
  };
}

export function buildCriteriaVector({ pass, failureKind = 'model_error', failureCode, failureSubKind } = {}) {
  const vector = fullPassVector();
  const failureCriterion = pass ? null : (FAILURE_TO_CRITERION[failureKind] ?? 'repairability');
  if (failureCriterion) vector[failureCriterion] = 0;
  return {
    ...vector,
    failureKind: pass ? 'pass' : failureKind,
    failureSubKind,
    failureCode: pass ? 'pass' : failureCode,
    failureCriterion,
  };
}

/**
 * Build a graded criteria vector using continuous metrics from test results.
 *
 * Grading rules:
 *   - correctness: primaryPassRate (fraction of primary tests passed)
 *   - interfaceContract: 1 if sig-repair not needed, else 0.5 (name was wrong but repairable)
 *   - edgeCases: heldOutPassRate (fraction of held-out tests passed)
 *   - specAlignment: 1 - (failureKind === 'spec_validation' ? 1 : 0)
 *   - formatProtocol: 1 - (failureKind === 'format_protocol' ? 1 : 0)
 *   - repairability: 1 if code produced, 0 if empty; 0.5 if autorepair exhausted
 *   - cohAtrRisk: continuous metric from held-out discriminativity (0 = no risk, 1 = max risk)
 *
 * When held-out data is unavailable, falls back to binary buildCriteriaVector.
 */
export function buildGradedCriteriaVector({
  primaryPassRate = null,
  heldOutPassRate = null,
  cohAtrRisk = null,
  failureKind = 'model_error',
  failureCode,
  failureSubKind,
  sigRepair = null,
  codeProduced = true,
  autorepairExhausted = false,
} = {}) {
  const vector = fullPassVector();

  // Correctness: fraction of primary tests passed (continuous)
  if (primaryPassRate !== null) {
    vector.correctness = primaryPassRate;
  } else if (failureKind === 'pass' || failureKind === null) {
    vector.correctness = 1;
  } else {
    vector.correctness = 0;
  }

  // Interface contract: penalized if sig-repair was needed
  vector.interfaceContract = sigRepair ? 0.5 : 1;

  // Edge cases: use held-out pass rate (continuous — primary tests don't test edges well)
  if (heldOutPassRate !== null) {
    vector.edgeCases = heldOutPassRate;
  }

  // Spec alignment: penalize spec_validation failures
  vector.specAlignment = failureKind === 'spec_validation' ? 0 : 1;

  // Format protocol: penalize format_protocol failures
  vector.formatProtocol = failureKind === 'format_protocol' ? 0 : 1;

  // Repairability: 0 if no code, 0.5 if autorepair exhausted, 1 if code produced
  if (!codeProduced) {
    vector.repairability = 0;
  } else if (autorepairExhausted) {
    vector.repairability = 0.5;
  }

  // COH_ATR risk: continuous from held-out discriminativity
  if (cohAtrRisk !== null && !isNaN(cohAtrRisk)) {
    vector.cohAtrRisk = cohAtrRisk;
  }

  const failureCriterion = primaryPassRate === 1 && cohAtrRisk === 0
    ? null
    : (FAILURE_TO_CRITERION[failureKind] ?? 'repairability');

  return {
    ...vector,
    failureKind: primaryPassRate === 1 ? 'pass' : failureKind,
    failureSubKind,
    failureCode: primaryPassRate === 1 ? 'pass' : failureCode,
    failureCriterion,
    _graded: true,  // Marker for downstream to know this is graded, not binary
  };
}

export function validateCriteriaVector(vector) {
  const errors = [];
  for (const criterion of CRITERIA) {
    const value = vector?.[criterion];
    if (typeof value !== 'number' || value < 0 || value > 1) {
      errors.push({ path: criterion, message: 'must be number in [0,1]' });
    }
  }
  if (vector?.failureCriterion !== null && vector?.failureCriterion !== undefined && !CRITERIA.includes(vector.failureCriterion)) {
    errors.push({ path: 'failureCriterion', message: 'must be null or known criterion' });
  }
  return { valid: errors.length === 0, errors };
}

export function resolveUpdateTarget(criteriaVector, map = CRITERION_COMPONENT_MAP) {
  const criterion = criteriaVector?.failureCriterion ?? null;
  if (!criterion) {
    return { actionable: false, criterion: null, component: null };
  }
  const component = map[criterion] ?? null;
  return {
    actionable: Boolean(component),
    criterion,
    component,
    failureKind: criteriaVector.failureKind,
    failureCode: criteriaVector.failureCode,
  };
}

/**
 * Attach Reasoning OS metadata (route, criteriaVector, updateTarget) to an
 * attempt object. Used by evalProblem when baselineKind === 'reasoning_os_v0'.
 * If held-out metrics are available on the trace, uses graded criteria vector.
 */
export function attachReasoningOsToAttempt({ attempt, route, trace } = {}) {
  // Check if we have held-out data for graded criteria vector
  const traceData = trace || attempt?.traceLog || {};
  const hasHeldOut = traceData.primaryPassRate !== undefined || traceData.heldOutPassRate !== undefined;

  let criteriaVector;
  if (hasHeldOut) {
    // Use graded criteria vector with continuous metrics
    criteriaVector = buildGradedCriteriaVector({
      primaryPassRate: traceData.primaryPassRate ?? (attempt.pass ? 1 : 0),
      heldOutPassRate: traceData.heldOutPassRate ?? null,
      cohAtrRisk: traceData.cohAtrRisk ?? null,
      failureKind: attempt.failureKind ?? (attempt.pass ? 'pass' : 'model_error'),
      failureCode: attempt.failureCode,
      failureSubKind: attempt.failureSubKind,
      sigRepair: traceData.sigRepair ?? null,
      codeProduced: attempt.errorDetail !== 'empty response' && attempt.errorDetail !== 'coder produced no code',
      autorepairExhausted: attempt.errorDetail === 'autorepair exhausted',
    });
  } else {
    // Fall back to binary criteria vector
    criteriaVector = buildCriteriaVector({
      pass: Boolean(attempt.pass),
      failureKind: attempt.failureKind ?? (attempt.pass ? 'pass' : 'model_error'),
      failureCode: attempt.failureCode,
      failureSubKind: attempt.failureSubKind,
    });
  }

  const updateTarget = resolveUpdateTarget(criteriaVector);
  return {
    ...attempt,
    reasoningOs: {
      route,
      criteriaVector,
      updateTarget,
      // deltaId may be added later by proposeDeltaFromAttempt
    },
  };
}

const COMPONENT_HYPOTHESIS = Object.freeze({
  formatProtocol: 'Tightening JSON-only verifier output should reduce format/protocol failures without changing logic failures.',
  interfaceContract: 'Enforcing strict signature compliance should reduce spec validation failures.',
  correctness: 'Adding more test cases or algorithmic guidance should reduce logic assertion failures.',
  edgeCases: 'Pre-emptive edge case scaffolding should reduce boundary condition failures.',
  specAlignment: 'Improving spec clarity should reduce misalignment between implementation and acceptance criteria.',
  repairability: 'Improving autorepair feedback quality should increase successful recovery from failures.',
  cohAtrRisk: 'Adding coherent attribution logging should surface overclaimed reasoning.',
});

/**
 * Generate a proposed scaffold delta from a failed attempt.
 * Returns null for pass attempts.
 */
export function proposeDeltaFromAttempt({ problemName, baselineKind, attempt }) {
  if (!attempt.reasoningOs) return null;
  const { criteriaVector, updateTarget } = attempt.reasoningOs;
  if (!criteriaVector || criteriaVector.failureCriterion === null) return null;
  const criterion = criteriaVector.failureCriterion;
  const hypothesis = COMPONENT_HYPOTHESIS[criterion] ?? 'Scaffold improvement hypothesis not yet defined.';
  return {
    schemaVersion: 'scaffold-delta/v0',
    id: `delta-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    trigger: {
      problemId: problemName,
      baselineKind,
      failureKind: criteriaVector.failureKind,
      criterion,
      component: updateTarget.component,
    },
    hypothesis,
    patch: {
      component: updateTarget.component,
      before: '...',
      after: '...',
    },
    expectedEffect: {
      decreaseFailureKinds: [criteriaVector.failureKind],
      notExpectedToChange: [],
    },
    status: 'proposed',
    evidence: [],
  };
}

function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}