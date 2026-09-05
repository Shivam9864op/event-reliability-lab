# Event Reliability Lab

Event Reliability Lab is a dependency-free Node.js reference implementation for the failure paths that small webhook automations often ignore:

`signed intake → schema validation → idempotency → deterministic routing → delivery → retry/backoff → dead-letter queue → redacted audit log`

It is a personal open-source project, built with synthetic data and an in-memory mock sink. It is not a production connector or evidence of paid client work.

## Why this is a serious project

- HMAC-SHA256 signatures are checked with a timing-safe comparison.
- Validation and normalization happen before a sink can run.
- An idempotency key makes repeated webhook delivery safe.
- Retry timing is deterministic and bounded; exhausted attempts go to a dead-letter queue.
- Audit records redact credentials and email addresses before storage.
- Unknown event types stop at a human-review destination instead of being guessed.
- The HTTP layer has a body-size limit and returns readable error fields.

## Run it

```text
npm test
npm run demo
npm start
```

Then send a signed event to `POST http://127.0.0.1:8787/webhook/events`. The demo uses `local-demo-secret` unless `WEBHOOK_SECRET` is supplied. `GET /health` exposes only aggregate counts; `GET /audit` returns redacted local audit entries.

## Example event

The signing helper is intentionally explicit so a reviewer can reproduce the request without a secret from a real system:

```json
{
  "eventId": "lead-001",
  "type": "lead.created",
  "occurredAt": "2026-09-05T10:00:00.000Z",
  "idempotencyKey": "lead-001",
  "payload": {
    "name": "Asha Rao",
    "email": "asha@example.com",
    "message": "Need help automating lead follow-up",
    "consent": true
  },
  "signature": "<HMAC over the unsigned canonical JSON>"
}
```

## Design notes

See [the threat model](docs/threat-model.md), [the n8n mapping](docs/n8n-mapping.md), and [the architecture diagram](docs/architecture.svg). The code intentionally avoids external credentials, WhatsApp accounts, private data, and outbound customer messages.

## Scope and limitations

The stores are in memory, so restarting the process loses state. A real deployment would need a durable queue, secret management, access controls, metrics, and a reviewed connector for each destination. Those are deliberately listed as follow-up engineering work instead of being implied by this demo.

## License

MIT. See [LICENSE](LICENSE).
