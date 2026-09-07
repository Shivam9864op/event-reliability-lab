import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHeartbeat, HeartbeatValidationError } from '../src/watchdog.mjs';

const now = new Date('2026-09-07T12:00:00.000Z');
const base = {
  workflowId: 'lead-sync',
  lastStartedAt: '2026-09-07T11:59:00.000Z',
  lastFinishedAt: '2026-09-07T11:59:10.000Z',
  inputCount: 4,
  outputCount: 4
};

test('fresh heartbeat with output is healthy', () => {
  assert.deepEqual(evaluateHeartbeat(base, { now }), {
    workflowId: 'lead-sync',
    status: 'healthy',
    ageMs: 50_000,
    inputCount: 4,
    outputCount: 4,
    reasons: []
  });
});

test('stale heartbeat is an alert even when the last run was successful', () => {
  const result = evaluateHeartbeat({
    ...base,
    lastStartedAt: '2026-09-07T10:59:00.000Z',
    lastFinishedAt: '2026-09-07T11:00:00.000Z'
  }, { now });
  assert.equal(result.status, 'alert');
  assert.deepEqual(result.reasons, ['stale_heartbeat']);
});

test('zero output with inputs is an alert', () => {
  const result = evaluateHeartbeat({ ...base, outputCount: 0 }, { now });
  assert.equal(result.status, 'alert');
  assert.deepEqual(result.reasons, ['zero_output']);
});

test('invalid heartbeat produces a readable field error', () => {
  assert.throws(
    () => evaluateHeartbeat({ ...base, inputCount: -1 }, { now }),
    (error) => error instanceof HeartbeatValidationError && error.field === 'inputCount'
  );
});
