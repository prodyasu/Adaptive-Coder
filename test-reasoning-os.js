import assert from 'node:assert/strict';
import {
  REASONING_OS_VERSION,
  CRITERIA,
  COMPONENTS,
  CRITERION_COMPONENT_MAP,
  validateCriterionComponentMap,
} from './reasoning-os.js';

assert.equal(REASONING_OS_VERSION, 'reasoning-os/v0');
assert.ok(CRITERIA.includes('interfaceContract'));
assert.ok(COMPONENTS.includes('signature_contract'));
assert.equal(CRITERION_COMPONENT_MAP.interfaceContract, 'signature_contract');

const validation = validateCriterionComponentMap(CRITERION_COMPONENT_MAP);
assert.equal(validation.valid, true, JSON.stringify(validation.errors));

const invalid = validateCriterionComponentMap({ unknownCriterion: 'missing_component' });
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.length > 0);

console.log('test-reasoning-os: PASS');

// Task 2: routeTask
import { routeTask } from './reasoning-os.js';

const route = routeTask({
  problemName: 'binary-search',
  baselineKind: 'reasoning_os_v0',
  taskKind: 'coding_eval',
});

assert.deepEqual(route.requiredChecks, [
  'signature_contract',
  'edge_cases',
  'runtime_tests',
  'structured_output_contract',
]);
assert.equal(route.mode, 'code_generation');
assert.equal(route.reasoningStyle, 'spec_first');
assert.equal(route.uncertaintyPolicy, 'tool_before_claim');
assert.equal(route.risk, 'local_eval');

console.log('routeTask: PASS');

// Task 3: buildCriteriaVector, validateCriteriaVector
import { buildCriteriaVector, validateCriteriaVector } from './reasoning-os.js';

const passVector = buildCriteriaVector({ pass: true, failureKind: 'pass' });
assert.equal(passVector.correctness, 1);
assert.equal(passVector.interfaceContract, 1);
assert.equal(passVector.formatProtocol, 1);
assert.equal(passVector.failureCriterion, null);
assert.equal(validateCriteriaVector(passVector).valid, true);

const formatFail = buildCriteriaVector({
  pass: false,
  failureKind: 'format_protocol',
  failureCode: 'format_protocol.no_json',
});
assert.equal(formatFail.formatProtocol, 0);
assert.equal(formatFail.failureCriterion, 'formatProtocol');
assert.equal(formatFail.failureCode, 'format_protocol.no_json');
assert.equal(validateCriteriaVector(formatFail).valid, true);

const logicFail = buildCriteriaVector({ pass: false, failureKind: 'logic_assertion' });
assert.equal(logicFail.correctness, 0);
assert.equal(logicFail.failureCriterion, 'correctness');

console.log('buildCriteriaVector: PASS');

// Task 4: resolveUpdateTarget
import { resolveUpdateTarget } from './reasoning-os.js';

const target = resolveUpdateTarget(formatFail);
assert.equal(target.criterion, 'formatProtocol');
assert.equal(target.component, 'structured_output_contract');
assert.equal(target.actionable, true);

const noTarget = resolveUpdateTarget(passVector);
assert.equal(noTarget.actionable, false);
assert.equal(noTarget.component, null);

console.log('resolveUpdateTarget: PASS');

// Task 8: attachReasoningOsToAttempt
import { attachReasoningOsToAttempt, proposeDeltaFromAttempt } from './reasoning-os.js';

const failedAttempt = {
  attempt: 0,
  pass: false,
  failureKind: 'format_protocol',
  failureCode: 'format_protocol.no_json',
  failureSubKind: 'missing_json',
};

const failedWithOs = attachReasoningOsToAttempt({ attempt: failedAttempt, route });
assert(failedWithOs.reasoningOs, 'reasoningOs attached to failed attempt');
assert(failedWithOs.reasoningOs.route === route, 'route attached');
assert(failedWithOs.reasoningOs.criteriaVector.formatProtocol === 0, 'criteriaVector has 0 for failed criterion');
assert(failedWithOs.reasoningOs.criteriaVector.failureCriterion === 'formatProtocol', 'failureCriterion set');
assert(failedWithOs.reasoningOs.updateTarget.component === 'structured_output_contract', 'updateTarget.component set');
assert(failedWithOs.reasoningOs.updateTarget.actionable === true, 'updateTarget.actionable true');

const passAttempt = { attempt: 0, pass: true };
const passWithOs = attachReasoningOsToAttempt({ attempt: passAttempt, route });
assert(passWithOs.reasoningOs, 'reasoningOs attached to pass attempt');
assert(passWithOs.reasoningOs.criteriaVector.failureCriterion === null, 'pass attempt has null failureCriterion');
assert(passWithOs.reasoningOs.updateTarget.actionable === false, 'pass attempt updateTarget not actionable');

console.log('attachReasoningOsToAttempt: PASS');

// Task 9: proposeDeltaFromAttempt
const delta = proposeDeltaFromAttempt({
  problemName: 'binary-search',
  baselineKind: 'reasoning_os_v0',
  attempt: failedWithOs,
});
assert(delta, 'delta generated for failed attempt');
assert(delta.trigger.component === 'structured_output_contract', 'delta trigger component set');
assert(delta.trigger.criterion === 'formatProtocol', 'delta trigger criterion set');
assert(delta.status === 'proposed', 'delta status is proposed');
assert(delta.hypothesis.length > 0, 'delta has hypothesis');
assert(delta.schemaVersion === 'scaffold-delta/v0', 'delta has correct schema version');

const nullDelta = proposeDeltaFromAttempt({
  problemName: 'binary-search',
  baselineKind: 'reasoning_os_v0',
  attempt: passWithOs,
});
assert(nullDelta === null, 'no delta for pass attempt');

console.log('proposeDeltaFromAttempt: PASS');
