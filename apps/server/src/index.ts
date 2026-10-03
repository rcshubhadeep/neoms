import { serve } from '@hono/node-server';
import { app } from './app.js';
import { startQueue, boss, pool } from '../../../packages/db/src/index.js';
await startQueue();
const server = serve({
  fetch: app.fetch,
  hostname: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3001),
});
console.log(
  `Neoms API listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3001}`,
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    server.close();
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
