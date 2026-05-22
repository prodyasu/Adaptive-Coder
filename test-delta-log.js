import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDelta,
  appendDelta,
  readDeltas,
  validateDelta,
  DELTA_STATUSES,
  updateDeltaStatus,
  getLatestDeltas,
} from './delta-log.js';

const dir = mkdtempSync(join(tmpdir(), 'delta-log-'));
const path = join(dir, 'deltas.jsonl');

// ─── 1. DELTA_STATUSES is a frozen array of all lifecycle statuses ───────────
assert.ok(Array.isArray(DELTA_STATUSES), 'DELTA_STATUSES should be an array');
assert.ok(Object.isFrozen(DELTA_STATUSES), 'DELTA_STATUSES should be frozen');
const expectedStatuses = ['proposed', 'validated_local', 'validated_scoped', 'accepted', 'rejected', 'superseded'];
for (const s of expectedStatuses) {
  assert.ok(DELTA_STATUSES.includes(s), `DELTA_STATUSES should include '${s}'`);
}
assert.equal(DELTA_STATUSES.length, expectedStatuses.length, 'DELTA_STATUSES should have exactly 6 statuses');

// ─── 2. validateDelta accepts all lifecycle statuses ─────────────────────────
for (const status of DELTA_STATUSES) {
  const d = createDelta({ trigger: { criterion: 'x', component: 'y' }, hypothesis: 'h', patch: { component: 'y' }, expectedEffect: {}, status });
  const v = validateDelta(d);
  assert.equal(v.valid, true, `validateDelta should accept status '${status}'`);
  assert.equal(v.errors.length, 0, `validateDelta should have no errors for status '${status}'`);
}

// validateDelta rejects unknown status
{
  const d = createDelta({ trigger: { criterion: 'x', component: 'y' }, hypothesis: 'h', patch: { component: 'y' }, expectedEffect: {}, status: 'unknown_status' });
  const v = validateDelta(d);
  assert.equal(v.valid, false, 'validateDelta should reject unknown status');
  const statusErr = v.errors.find(e => e.path === 'status');
  assert.ok(statusErr, 'should have a status error');
}

// ─── 3. updateDeltaStatus: append-only audit, preserves original fields ───────
const delta = createDelta({
  trigger: {
    problemId: 'binary-search',
    baselineKind: 'reasoning_os_v0',
    failureKind: 'format_protocol',
    criterion: 'formatProtocol',
    component: 'structured_output_contract',
  },
  hypothesis: 'Structured output hardening should reduce format/protocol failures.',
  patch: {
    component: 'structured_output_contract',
    before: 'loose JSON instruction',
    after: 'strict JSON instruction',
  },
  expectedEffect: {
    decreaseFailureKinds: ['format_protocol'],
    notExpectedToChange: ['logic_assertion'],
  },
});
appendDelta(path, delta);

// Transition to validated_local
const updated = updateDeltaStatus(path, delta.id, 'validated_local', { type: 'local_validation', passed: true });
assert.equal(updated.status, 'validated_local');
assert.equal(updated.id, delta.id, 'id must be preserved');
assert.equal(updated.hypothesis, delta.hypothesis, 'hypothesis must be preserved');
assert.equal(updated.patch.component, delta.patch.component, 'patch.component must be preserved');
assert.ok(updated.updatedAt, 'updatedAt should be set');
assert.ok(Array.isArray(updated.evidence), 'evidence should be an array');
assert.equal(updated.evidence.length, 1, 'evidence should have 1 entry');
assert.equal(updated.evidence[0].type, 'local_validation');

// readDeltas still returns all raw event records in file order
const allRecords = readDeltas(path);
assert.equal(allRecords.length, 2, 'readDeltas should return 2 records (original + update)');
assert.equal(allRecords[0].status, 'proposed');
assert.equal(allRecords[1].status, 'validated_local');

// getLatestDeltas returns only latest record per id
const latest = getLatestDeltas(path);
assert.equal(latest.length, 1, 'getLatestDeltas should return 1 entry');
assert.equal(latest[0].id, delta.id);
assert.equal(latest[0].status, 'validated_local');

// ─── 4. updateDeltaStatus appends evidence entry ──────────────────────────────
const updated2 = updateDeltaStatus(path, delta.id, 'validated_scoped', { type: 'scoped_validation', passed: true });
assert.equal(updated2.status, 'validated_scoped');
assert.equal(updated2.evidence.length, 2, 'evidence should now have 2 entries');
assert.equal(updated2.evidence[1].type, 'scoped_validation');

// ─── 5. updateDeltaStatus without evidenceEntry leaves evidence unchanged ─────
const updated3 = updateDeltaStatus(path, delta.id, 'accepted');
assert.equal(updated3.status, 'accepted');
assert.equal(updated3.evidence.length, 2, 'evidence count unchanged when no entry provided');

// ─── 6. Error: delta id not found ────────────────────────────────────────────
{
  let threw = false;
  try {
    updateDeltaStatus(path, 'delta-nonexistent', 'accepted');
  } catch (e) {
    threw = true;
    assert.ok(e.message.includes('not found') || e.message.includes(delta.id), 'error should mention not found or the id');
  }
  assert.ok(threw, 'updateDeltaStatus should throw for unknown delta id');
}

// ─── 7. Error: invalid status ───────────────────────────────────────────────
{
  let threw = false;
  try {
    updateDeltaStatus(path, delta.id, 'not_a_lifecycle_status');
  } catch (e) {
    threw = true;
    assert.ok(e.message.includes('invalid') || e.message.includes('status'), 'error should mention invalid status');
  }
  assert.ok(threw, 'updateDeltaStatus should throw for invalid status');
}

// ─── 8. superseded status transitions correctly ─────────────────────────────
const d2 = createDelta({ trigger: { criterion: 'x', component: 'y' }, hypothesis: 'h2', patch: { component: 'y' }, expectedEffect: {} });
appendDelta(path, d2);
const sup = updateDeltaStatus(path, d2.id, 'superseded', { type: 'superseded_by', reason: 'replaced by newer delta' });
assert.equal(sup.status, 'superseded');
assert.equal(sup.evidence[0].type, 'superseded_by');

// ─── 9. getLatestDeltas with multiple distinct deltas ───────────────────────
const d3 = createDelta({ trigger: { criterion: 'x', component: 'y' }, hypothesis: 'h3', patch: { component: 'y' }, expectedEffect: {} });
appendDelta(path, d3);
const latestAll = getLatestDeltas(path);
assert.equal(latestAll.length, 3, 'getLatestDeltas should return 3 latest entries');
const ids = latestAll.map(r => r.id).sort();
assert.ok(ids.includes(delta.id));
assert.ok(ids.includes(d2.id));
assert.ok(ids.includes(d3.id));

console.log('test-delta-log: PASS');