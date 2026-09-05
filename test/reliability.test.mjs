import assert from 'node:assert/strict';
import test from 'node:test';
import { createProcessor, signEvent, verifySignature } from '../src/reliability.mjs';
import { createApp } from '../server.mjs';

const secret = 'test-secret-123';
const baseEvent = (overrides = {}) => signEvent({
  eventId: 'evt-001',
  type: 'lead.created',
  occurredAt: '2026-09-05T10:00:00.000Z',
  idempotencyKey: 'idem-001',
  payload: { name: 'Asha Rao', email: 'asha@example.com', token: 'do-not-log' },
  ...overrides
}, secret);

test('valid signed event is delivered to the deterministic destination', async () => {
  const calls = [];
  const processor = createProcessor({ secret, sink: async (event) => calls.push(event) });
  const result = await processor.ingest(baseEvent());
  assert.equal(result.destination, 'crm.leads');
  assert.equal(result.status, 'completed');
  assert.equal(calls[0].attempt, 1);
  assert.equal(verifySignature(baseEvent(), secret), true);
});

test('invalid signatures are rejected before delivery', async () => {
  const processor = createProcessor({ secret, sink: async () => assert.fail('sink must not run') });
  await assert.rejects(() => processor.ingest({ ...baseEvent(), signature: 'bad' }), /signature is missing or invalid/);
});

test('duplicate idempotency keys do not deliver twice', async () => {
  let calls = 0;
  const processor = createProcessor({ secret, sink: async () => { calls += 1; } });
  const first = await processor.ingest(baseEvent());
  const duplicate = await processor.ingest(baseEvent({ eventId: 'evt-002' }));
  assert.equal(first.status, 'completed');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(calls, 1);
});

test('failed delivery is retried with exponential backoff', async () => {
  let calls = 0;
  const now = new Date('2026-09-05T10:00:00.000Z');
  const processor = createProcessor({
    secret,
    now: () => now,
    backoffBaseMs: 10,
    sink: async () => { calls += 1; if (calls === 1) throw new Error('temporary outage'); }
  });
  const first = await processor.ingest(baseEvent());
  assert.equal(first.status, 'retry_scheduled');
  assert.equal(first.nextAttemptAt, '2026-09-05T10:00:00.010Z');
  assert.deepEqual(await processor.drainDue(new Date('2026-09-05T10:00:00.009Z')), []);
  const retried = await processor.drainDue(new Date('2026-09-05T10:00:00.010Z'));
  assert.equal(retried[0].status, 'completed');
  assert.equal(calls, 2);
});

test('exhausted attempts become a dead-letter record', async () => {
  const processor = createProcessor({ secret, maxAttempts: 2, backoffBaseMs: 1, sink: async () => { throw new Error('permanent outage'); } });
  const first = await processor.ingest(baseEvent());
  assert.equal(first.status, 'retry_scheduled');
  const second = await processor.drainDue(new Date(first.nextAttemptAt));
  assert.equal(second[0].status, 'dead_letter');
  assert.equal(processor.health().deadLettered, 1);
});

test('audit logs redact credentials and email addresses', async () => {
  const processor = createProcessor({ secret, sink: async () => {} });
  await processor.ingest(baseEvent());
  const text = JSON.stringify(processor.snapshot().audit);
  assert.equal(text.includes('do-not-log'), false);
  assert.equal(text.includes('asha@example.com'), false);
  assert.match(text, /REDACTED/);
});

test('support and unknown event types take safe routes', async () => {
  const processor = createProcessor({ secret, sink: async () => {} });
  const support = await processor.ingest(baseEvent({ eventId: 'evt-support', idempotencyKey: 'idem-support', type: 'support.ticket' }));
  const unknown = await processor.ingest(baseEvent({ eventId: 'evt-unknown', idempotencyKey: 'idem-unknown', type: 'profile.updated' }));
  assert.equal(support.destination, 'support.queue');
  assert.equal(unknown.destination, 'human_review');
});

test('HTTP endpoint returns a traceable result and health status', async () => {
  const { server } = createApp({ secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/webhook/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(baseEvent({ eventId: 'evt-http', idempotencyKey: 'idem-http' }))
  });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.status, 'completed');
  assert.match(body.traceId, /^[0-9a-f-]{36}$/);
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal((await health.json()).completed, 1);
  server.close();
});
