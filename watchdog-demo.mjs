import { readFile } from 'node:fs/promises';
import { evaluateHeartbeat } from './src/watchdog.mjs';

const now = new Date('2026-09-07T12:00:00.000Z');
for (const name of ['heartbeat-healthy.json', 'heartbeat-alert.json']) {
  const heartbeat = JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  console.log(name, JSON.stringify(evaluateHeartbeat(heartbeat, { now }), null, 2));
}
