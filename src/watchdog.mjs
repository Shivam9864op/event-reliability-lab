export class HeartbeatValidationError extends Error {
  constructor(message, field = 'heartbeat') {
    super(message);
    this.name = 'HeartbeatValidationError';
    this.field = field;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function timestamp(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new HeartbeatValidationError(`${field} must be an ISO-8601 timestamp`, field);
  }
  return new Date(value).getTime();
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new HeartbeatValidationError(`${field} must be a non-negative integer`, field);
  }
  return value;
}

/**
 * Evaluate a heartbeat record without contacting the workflow system.
 * A healthy execution can still be wrong, so this checks both freshness and
 * whether work was actually produced when inputs were present.
 */
export function evaluateHeartbeat(input, {
  now = new Date(),
  maxAgeMs = 15 * 60 * 1000
} = {}) {
  if (!isPlainObject(input)) throw new HeartbeatValidationError('Heartbeat must be a JSON object');
  if (typeof input.workflowId !== 'string' || input.workflowId.trim() === '') {
    throw new HeartbeatValidationError('workflowId must be a non-empty string', 'workflowId');
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new HeartbeatValidationError('maxAgeMs must be a non-negative number', 'maxAgeMs');
  }

  const startedAt = timestamp(input.lastStartedAt, 'lastStartedAt');
  const finishedAt = timestamp(input.lastFinishedAt, 'lastFinishedAt');
  const observedAt = now instanceof Date ? now.getTime() : timestamp(now, 'now');
  const inputCount = nonNegativeInteger(input.inputCount, 'inputCount');
  const outputCount = nonNegativeInteger(input.outputCount, 'outputCount');
  if (finishedAt < startedAt) {
    throw new HeartbeatValidationError('lastFinishedAt cannot be before lastStartedAt', 'lastFinishedAt');
  }

  const ageMs = observedAt - finishedAt;
  const reasons = [];
  if (ageMs > maxAgeMs) reasons.push('stale_heartbeat');
  if (inputCount > 0 && outputCount === 0) reasons.push('zero_output');

  return {
    workflowId: input.workflowId,
    status: reasons.length === 0 ? 'healthy' : 'alert',
    ageMs,
    inputCount,
    outputCount,
    reasons
  };
}
