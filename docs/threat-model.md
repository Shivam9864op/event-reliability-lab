# Threat model

## Assets

- Event integrity and ordering metadata.
- Idempotency state that prevents duplicate side effects.
- Audit records that help a maintainer diagnose failures.

## Trust boundaries

1. An external webhook sender crosses into the HTTP process.
2. The processor crosses into a destination connector (mocked here).
3. Operators inspect aggregate health and redacted audit records.

## Mitigations in this demo

- HMAC-SHA256 signature verification before processing.
- Strict event names, timestamp parsing, payload shape, and body-size limit.
- Idempotency map checked before the sink runs.
- Bounded retry count and a dead-letter state for manual review.
- Key-based and email-shaped log redaction.
- Unknown types route to `human_review` rather than an unreviewed side effect.

## Out of scope

The project does not provide authentication for an operator dashboard, durable storage, replay authorization, rate limiting, or a production secrets vault. Those omissions are intentional and documented so they are not mistaken for a production security claim.
