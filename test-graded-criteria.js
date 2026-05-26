/**
 * test-graded-criteria.js — Tests for graded criteria vector functionality
 */
import { buildCriteriaVector, buildGradedCriteriaVector, validateCriteriaVector, CRITERIA } from './reasoning-os.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

// Test 1: Binary criteria vector still works (backward compat)
console.log('Test 1: Binary criteria vector backward compat...');
const binary = buildCriteriaVector({ pass: true });
assert(binary.correctness === 1, 'pass → correctness 1');
assert(binary.cohAtrRisk === 0, 'pass → cohAtrRisk 0');
assert(binary._graded === undefined, 'binary vector has no _graded marker');
assert(binary.failureKind === 'pass', 'pass → failureKind "pass"');
assert(binary.failureCriterion === null, 'pass → failureCriterion null');

const binaryFail = buildCriteriaVector({ pass: false, failureKind: 'logic_assertion' });
assert(binaryFail.correctness === 0, 'logic failure → correctness 0');
assert(binaryFail.failureCriterion === 'correctness', 'logic → failureCriterion correctness');

// Test 2: Graded criteria vector with full held-out data
console.log('Test 2: Graded criteria vector with held-out data...');
const graded = buildGradedCriteriaVector({
  primaryPassRate: 0.67,
  heldOutPassRate: 0.5,
  cohAtrRisk: 0.25,
  failureKind: 'logic_assertion',
});
assert(graded.correctness === 0.67, `graded correctness should be 0.67, got ${graded.correctness}`);
assert(graded.edgeCases === 0.5, `graded edgeCases should be 0.5, got ${graded.edgeCases}`);
assert(graded.cohAtrRisk === 0.25, `graded cohAtrRisk should be 0.25, got ${graded.cohAtrRisk}`);
assert(graded._graded === true, 'graded vector has _graded marker');
assert(graded.interfaceContract === 1, 'no sig-repair → interfaceContract 1');

// Test 3: Graded with sig-repair
console.log('Test 3: Graded with sig-repair...');
const gradedRepair = buildGradedCriteriaVector({
  primaryPassRate: 1,
  heldOutPassRate: 1,
  cohAtrRisk: 0,
  sigRepair: { originalName: 'climb', repairedName: 'climb' },
});
assert(gradedRepair.interfaceContract === 0.5, `sig-repair → interfaceContract 0.5, got ${gradedRepair.interfaceContract}`);
assert(gradedRepair.correctness === 1, 'full pass → correctness 1');

// Test 4: Graded with autorepair exhausted
console.log('Test 4: Graded with autorepair exhausted...');
const gradedAE = buildGradedCriteriaVector({
  primaryPassRate: 0,
  failureKind: 'autorepair_exhausted',
  autorepairExhausted: true,
});
assert(gradedAE.repairability === 0.5, `autorepair exhausted → repairability 0.5, got ${gradedAE.repairability}`);

// Test 5: Graded with no code produced
console.log('Test 5: Graded with no code produced...');
const gradedNoCode = buildGradedCriteriaVector({
  primaryPassRate: 0,
  failureKind: 'coder_error',
  codeProduced: false,
});
assert(gradedNoCode.repairability === 0, `no code → repairability 0, got ${gradedNoCode.repairability}`);

// Test 6: Graded with spec validation failure
console.log('Test 6: Graded with spec validation failure...');
const gradedSpec = buildGradedCriteriaVector({
  primaryPassRate: 0,
  failureKind: 'spec_validation',
});
assert(gradedSpec.specAlignment === 0, `spec validation failure → specAlignment 0, got ${gradedSpec.specAlignment}`);
assert(gradedSpec.interfaceContract === 1, 'spec validation failure doesn\'t affect interfaceContract');

// Test 7: Graded with format protocol failure
console.log('Test 7: Graded with format protocol failure...');
const gradedFormat = buildGradedCriteriaVector({
  primaryPassRate: 0,
  failureKind: 'format_protocol',
});
assert(gradedFormat.formatProtocol === 0, `format failure → formatProtocol 0, got ${gradedFormat.formatProtocol}`);

// Test 8: Graded vector validates
console.log('Test 8: Graded vector validates...');
const validation = validateCriteriaVector(graded);
assert(validation.valid, `graded vector should validate: ${JSON.stringify(validation.errors)}`);

// Test 9: Full pass with zero cohAtrRisk
console.log('Test 9: Full pass, zero risk...');
const perfectGraded = buildGradedCriteriaVector({
  primaryPassRate: 1,
  heldOutPassRate: 1,
  cohAtrRisk: 0,
});
assert(perfectGraded.correctness === 1, 'perfect → correctness 1');
assert(perfectGraded.edgeCases === 1, 'perfect → edgeCases 1');
assert(perfectGraded.cohAtrRisk === 0, 'perfect → cohAtrRisk 0');
assert(perfectGraded.failureCriterion === null, 'perfect → no failure criterion');

// Test 10: Fallback to null held-out
console.log('Test 10: Fallback with null held-out...');
const noHeldOut = buildGradedCriteriaVector({
  primaryPassRate: 0.5,
  heldOutPassRate: null,
  cohAtrRisk: null,
  failureKind: 'logic_assertion',
});
assert(noHeldOut.correctness === 0.5, `fallback correctness 0.5, got ${noHeldOut.correctness}`);
assert(noHeldOut.cohAtrRisk === 0, `fallback cohAtrRisk stays 0 (default), got ${noHeldOut.cohAtrRisk}`);

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}