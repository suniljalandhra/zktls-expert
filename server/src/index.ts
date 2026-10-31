import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { easAttester } from './eas.js';
import { reclaimClient } from './reclaim.js';
import { Store } from './store.js';

const config = loadConfig();

const attester = easAttester(config);
console.log(attester ? 'EAS attestation enabled' : 'Verify-only mode: proofs are checked, nothing is written on-chain');

const app = createApp({ config, reclaim: reclaimClient(config), attester, store: new Store(config.STORE_PATH) });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
