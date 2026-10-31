import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { easAttester } from './eas.js';
import { reclaimClient } from './reclaim.js';
import { Store } from './store.js';

const config = loadConfig();

// Without SCHEMA_UID the server still verifies proofs (Phase 1 mode) but doesn't attest.
const attester = config.SCHEMA_UID ? easAttester(config) : null;
if (!attester) console.warn('SCHEMA_UID not set: proofs will be verified but not attested');

const app = createApp({ config, reclaim: reclaimClient(config), attester, store: new Store(config.STORE_PATH) });

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
