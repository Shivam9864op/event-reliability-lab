import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const SENSITIVE_KEY = /(password|passwd|secret|token|api[-_]?key|authorization|cookie)/i;
const SENSITIVE_STRING = /([\w.+-]+)@([\w-]+\.[\w.-]+)/g;

export class EventValidationError extends Error {
  constructor(message, field = 'event') {
    super(message);
    this.name = 'EventValidationError';
    this.field = field;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function signingBody(event) {
  if (!isPlainObject(event)) return event;
  const { signature: _signature, ...unsigned } = event;
  return canonicalize(unsigned);
}

export function signEvent(event, secret) {
  const body = JSON.stringify(signingBody(event));
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return { ...event, signature };
}

export function verifySignature(event, secret) {
  if (typeof event?.signature !== 'string' || !event.signature) return false;
  const expected = createHmac('sha256', secret)
    .update(JSON.stringify(signingBody(event)))
    .digest('hex');
  const supplied = Buffer.from(event.signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return supplied.length === expectedBuffer.length && timingSafeEqual(supplied, expectedBuffer);
}

export function normalizeEvent(input) {
  if (!isPlainObject(input)) throw new EventValidationError('Body must be a JSON object');
  if (typeof input.eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(input.eventId)) {
    throw new EventValidationError('eventId must be 3–128 safe characters', 'eventId');
  }
  if (typeof input.type !== 'string' || !/^[a-z][a-z0-9_.-]{2,63}$/.test(input.type)) {
    throw new EventValidationError('type must be a lowercase event name', 'type');
  }
  if (typeof input.occurredAt !== 'string' || Number.isNaN(Date.parse(input.occurredAt))) {
    throw new EventValidationError('occurredAt must be an ISO-8601 timestamp', 'occurredAt');
  }
  if (!isPlainObject(input.payload)) throw new EventValidationError('payload must be an object', 'payload');
  const idempotencyKey = input.idempotencyKey ?? input.eventId;
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 3 || idempotencyKey.length > 160) {
    throw new EventValidationError('idempotencyKey must be 3–160 characters', 'idempotencyKey');
  }
  return {
    eventId: input.eventId,
    type: input.type,
    occurredAt: new Date(input.occurredAt).toISOString(),
    payload: structuredClone(input.payload),
    idempotencyKey,
    signature: input.signature ?? null
  };
}

export function destinationFor(type) {
  if (type === 'lead.created' || type.startsWith('lead.')) return 'crm.leads';
  if (type === 'support.ticket' || type.startsWith('support.')) return 'support.queue';
  if (type.startsWith('billing.')) return 'finance.review';
  return 'human_review';
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item)
    ]));
  }
  if (typeof value === 'string') return value.replace(SENSITIVE_STRING, '[REDACTED_EMAIL]');
  return value;
}

function asMs(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function backoffMs(attempt, baseMs) {
  return baseMs * (2 ** Math.max(0, attempt - 1));
}

export function createProcessor({
  secret,
  sink = async () => {},
  now = () => new Date(),
  maxAttempts = 3,
  backoffBaseMs = 1000,
  requireSignature = true
} = {}) {
  if (typeof secret !== 'string' || secret.length < 8) throw new Error('A secret of at least 8 characters is required');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('maxAttempts must be 1–10');

  const records = new Map();
  const idempotency = new Map();
  const retries = [];
  const deadLetters = [];
  const audit = [];

  function log(level, message, record, details = {}) {
    audit.push({
      at: new Date(now()).toISOString(),
      level,
      message,
      traceId: record?.traceId ?? null,
      eventId: record?.eventId ?? null,
      details: redact(details)
    });
  }

  async function deliver(record) {
    record.attempt += 1;
    try {
      await sink({
        eventId: record.eventId,
        type: record.type,
        destination: record.destination,
        payload: structuredClone(record.payload),
        traceId: record.traceId,
        attempt: record.attempt
      });
      record.status = 'completed';
      record.completedAt = new Date(now()).toISOString();
      log('info', 'event delivered', record, { destination: record.destination, attempt: record.attempt });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (record.attempt < maxAttempts) {
        record.status = 'retry_scheduled';
        record.nextAttemptAt = new Date(asMs(now()) + backoffMs(record.attempt, backoffBaseMs)).toISOString();
        retries.push(record.eventId);
        log('warn', 'delivery failed; retry scheduled', record, { reason, nextAttemptAt: record.nextAttemptAt });
      } else {
        record.status = 'dead_letter';
        record.failedAt = new Date(now()).toISOString();
        deadLetters.push(record.eventId);
        log('error', 'delivery failed; moved to dead letter queue', record, { reason, attempt: record.attempt });
      }
    }
    return resultFor(record);
  }

  function resultFor(record) {
    return {
      eventId: record.eventId,
      traceId: record.traceId,
      type: record.type,
      destination: record.destination,
      status: record.status,
      attempt: record.attempt,
      ...(record.nextAttemptAt ? { nextAttemptAt: record.nextAttemptAt } : {})
    };
  }

  async function ingest(input) {
    const event = normalizeEvent(input);
    if (requireSignature && !verifySignature(event, secret)) {
      throw new EventValidationError('signature is missing or invalid', 'signature');
    }
    const existingId = idempotency.get(event.idempotencyKey);
    if (existingId) {
      const existing = records.get(existingId);
      log('info', 'duplicate ignored', existing, { idempotencyKey: event.idempotencyKey });
      return { ...resultFor(existing), status: 'duplicate' };
    }
    const record = {
      ...event,
      traceId: randomUUID(),
      destination: destinationFor(event.type),
      status: 'accepted',
      attempt: 0
    };
    records.set(record.eventId, record);
    idempotency.set(record.idempotencyKey, record.eventId);
    log('info', 'event accepted', record, { destination: record.destination, payload: record.payload });
    return deliver(record);
  }

  async function drainDue(at = now()) {
    const cutoff = asMs(at);
    const dueIds = [...new Set(retries.splice(0, retries.length))];
    const processed = [];
    for (const eventId of dueIds) {
      const record = records.get(eventId);
      if (!record || record.status !== 'retry_scheduled') continue;
      if (asMs(record.nextAttemptAt) > cutoff) {
        retries.push(eventId);
        continue;
      }
      delete record.nextAttemptAt;
      processed.push(await deliver(record));
    }
    return processed;
  }

  function health() {
    return {
      status: 'ok',
      accepted: records.size,
      completed: [...records.values()].filter((record) => record.status === 'completed').length,
      retryScheduled: [...records.values()].filter((record) => record.status === 'retry_scheduled').length,
      deadLettered: deadLetters.length,
      auditEntries: audit.length
    };
  }

  function snapshot() {
    return {
      events: structuredClone([...records.values()].map(resultFor)),
      deadLetters: [...deadLetters],
      audit: structuredClone(audit)
    };
  }

  return { ingest, drainDue, health, snapshot };
}
