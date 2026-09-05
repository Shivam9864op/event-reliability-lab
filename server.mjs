import { createServer as httpServer } from 'node:http';
import { createProcessor } from './src/reliability.mjs';

function json(response, status, body) {
  const output = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(output);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 64 * 1024) throw new Error('request body exceeds 64 KiB');
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('request body must be valid JSON');
  }
}

export function createApp({ secret = process.env.WEBHOOK_SECRET ?? 'local-demo-secret' } = {}) {
  const delivered = [];
  const processor = createProcessor({
    secret,
    sink: async (event) => {
      // The sink is intentionally a mock. A real connector belongs outside this demo.
      delivered.push({ eventId: event.eventId, destination: event.destination, traceId: event.traceId });
    }
  });

  const server = httpServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') return json(response, 200, processor.health());
      if (request.method === 'GET' && request.url === '/audit') return json(response, 200, processor.snapshot().audit);
      if (request.method === 'POST' && request.url === '/webhook/events') {
        const result = await processor.ingest(await readJson(request));
        return json(response, result.status === 'duplicate' ? 200 : 202, result);
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      const status = error.name === 'EventValidationError' ? (error.field === 'signature' ? 401 : 422) : 400;
      return json(response, status, { error: error.message, ...(error.field ? { field: error.field } : {}) });
    }
  });
  return { server, processor, delivered };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server } = createApp();
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Event Reliability Lab listening on http://127.0.0.1:${port}`);
  });
}
