import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = new Hono();

app.use('*', cors({ origin: config.WEB_ORIGIN }));

app.get('/health', (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
