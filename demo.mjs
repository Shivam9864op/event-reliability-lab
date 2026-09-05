import { signEvent } from './src/reliability.mjs';
import { createApp } from './server.mjs';

const secret = 'local-demo-secret';
const event = signEvent({
  eventId: 'lead-001',
  type: 'lead.created',
  occurredAt: '2026-09-05T10:00:00.000Z',
  idempotencyKey: 'lead-001',
  payload: {
    name: 'Asha Rao',
    email: 'asha@example.com',
    message: 'Need help automating lead follow-up',
    consent: true
  }
}, secret);

const { server, processor } = createApp({ secret });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const response = await fetch(`http://127.0.0.1:${port}/webhook/events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(event)
});
console.log(JSON.stringify(await response.json(), null, 2));
console.log(JSON.stringify(processor.health(), null, 2));
server.close();
