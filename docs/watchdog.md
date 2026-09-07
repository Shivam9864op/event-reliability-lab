# Heartbeat watchdog

An execution can be green while the workflow is stale or produces no useful output. `src/watchdog.mjs` evaluates a small heartbeat record without needing an n8n account or an external service.

```js
import { evaluateHeartbeat } from './src/watchdog.mjs';

const result = evaluateHeartbeat({
  workflowId: 'lead-sync',
  lastStartedAt: '2026-09-07T11:59:00.000Z',
  lastFinishedAt: '2026-09-07T11:59:10.000Z',
  inputCount: 4,
  outputCount: 4
}, { now: new Date('2026-09-07T12:00:00.000Z') });
```

The result is `healthy` only when the heartbeat is fresh and a run that received inputs produced at least one output. Otherwise it is an `alert` with a stable reason such as `stale_heartbeat` or `zero_output`.

In a real deployment, write the heartbeat to a store independent of the workflow and let a separate scheduler alert on `alert`. The demo does not contact a database, n8n instance, or customer system.
