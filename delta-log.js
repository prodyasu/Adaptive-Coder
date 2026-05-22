import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const DELTA_SCHEMA_VERSION = 'scaffold-delta/v0';

/**
 * Frozen list of all valid delta lifecycle statuses.
 * Order reflects the intended progression, but the system does not
 * enforce ordering — any status can be set explicitly via updateDeltaStatus.
 */
export const DELTA_STATUSES = Object.freeze([
  'proposed',
  'validated_local',
  'validated_scoped',
  'accepted',
  'rejected',
  'superseded',
]);

export function createDelta({ trigger, hypothesis, patch, expectedEffect, status = 'proposed' }) {
  return {
    schemaVersion: DELTA_SCHEMA_VERSION,
    id: `delta-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    trigger,
    hypothesis,
    patch,
    expectedEffect,
    status,
    evidence: [],
  };
}

export function validateDelta(delta) {
  const errors = [];
  if (delta?.schemaVersion !== DELTA_SCHEMA_VERSION) errors.push({ path: 'schemaVersion', message: 'invalid schema' });
  if (typeof delta?.id !== 'string' || !delta.id.startsWith('delta-')) errors.push({ path: 'id', message: 'invalid id' });
  if (typeof delta?.createdAt !== 'string') errors.push({ path: 'createdAt', message: 'required' });
  if (typeof delta?.hypothesis !== 'string' || delta.hypothesis.length === 0) errors.push({ path: 'hypothesis', message: 'required' });
  if (!delta?.trigger?.criterion) errors.push({ path: 'trigger.criterion', message: 'required' });
  if (!delta?.trigger?.component) errors.push({ path: 'trigger.component', message: 'required' });
  if (!delta?.patch?.component) errors.push({ path: 'patch.component', message: 'required' });
  if (!DELTA_STATUSES.includes(delta?.status)) errors.push({ path: 'status', message: 'invalid status' });
  return { valid: errors.length === 0, errors };
}

export function appendDelta(path, delta) {
  const validation = validateDelta(delta);
  if (!validation.valid) throw new Error(`invalid delta: ${JSON.stringify(validation.errors)}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(delta) + '\n', { flag: 'a' });
}

export function readDeltas(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Append-only status update using JSONL audit semantics.
 * Does NOT mutate the existing delta record; instead appends a new full
 * delta record with the same id, original fields preserved (except evidence
 * which is accumulated), updated status, updatedAt, and an evidence array
 * that includes the provided evidenceEntry (if given).
 *
 * @param {string} path - Path to the .jsonl delta log file.
 * @param {string} deltaId - The id of the delta to update.
 * @param {string} status - New status; must be one of DELTA_STATUSES.
 * @param {object} [evidenceEntry] - Optional evidence object to append.
 * @returns {object} The newly appended delta record.
 * @throws {Error} If deltaId is not found in the log or status is not a known lifecycle status.
 */
export function updateDeltaStatus(path, deltaId, status, evidenceEntry) {
  if (!DELTA_STATUSES.includes(status)) {
    throw new Error(`updateDeltaStatus: invalid status '${status}' — must be one of: ${DELTA_STATUSES.join(', ')}`);
  }

  // Find the LATEST record for this delta id (last occurrence in append-order log)
  const records = readDeltas(path);
  let latestRecord = null;
  for (const record of records) {
    if (record.id === deltaId) latestRecord = record;
  }
  if (!latestRecord) {
    throw new Error(`updateDeltaStatus: delta '${deltaId}' not found in ${path}`);
  }

  // Build new evidence array from latest record's evidence + optional new entry
  const newEvidence = evidenceEntry
    ? [...(latestRecord.evidence || []), { ...evidenceEntry, timestamp: new Date().toISOString() }]
    : latestRecord.evidence || [];

  const updated = {
    ...latestRecord,
    status,
    evidence: newEvidence,
    updatedAt: new Date().toISOString(),
  };

  appendDelta(path, updated);
  return updated;
}

/**
 * Return the latest delta record per unique id, in append order (last
 * occurrence of each id wins).
 *
 * @param {string} path - Path to the .jsonl delta log file.
 * @returns {object[]} Array of latest records, one per unique id.
 */
export function getLatestDeltas(path) {
  const records = readDeltas(path);
  const latest = [];
  for (const record of records) {
    const idx = latest.findIndex(r => r.id === record.id);
    if (idx === -1) {
      latest.push(record);
    } else {
      latest[idx] = record;
    }
  }
  return latest;
}