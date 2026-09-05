# n8n mapping

The same control points can be represented in n8n without hiding reliability in a single happy-path node:

1. **Webhook** — receive the JSON event.
2. **Code** — canonicalize and validate fields.
3. **Crypto/Code** — verify the HMAC using a credential stored in n8n, never in the workflow JSON.
4. **Data Store** — check and write the idempotency key.
5. **Switch** — map event type to CRM, support, finance review, or human review.
6. **HTTP Request** — call the destination.
7. **Error Trigger / Wait** — schedule bounded retries with an attempt count.
8. **Data Store / database** — retain a dead-letter record and redacted trace log.

The JSON export in this repository is intentionally a diagram-level template with mock nodes. It contains no credential IDs or live endpoints.
