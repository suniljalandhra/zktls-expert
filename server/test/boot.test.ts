import assert from 'node:assert/strict';
import { it } from 'node:test';

// Loads the real SDK modules, not fakes. Catches packaging breakage (e.g. the EAS SDK's ESM build failing to
// load under Node) that the fake-based tests can't see.
it('loads the real Reclaim and EAS modules and builds an attester', async () => {
  const { loadConfig } = await import('../src/config.js');
  const { easAttester } = await import('../src/eas.js');
  const { reclaimClient } = await import('../src/reclaim.js');
  const config = loadConfig({
    RECLAIM_APP_ID: 'app',
    RECLAIM_APP_SECRET: `0x${'1'.repeat(64)}`,
    RECLAIM_PROVIDER_ID: 'provider',
    ATTESTER_PRIVATE_KEY: `0x${'2'.repeat(64)}`,
    RPC_URL: 'http://localhost:8545',
    EAS_ADDRESS: `0x${'3'.repeat(40)}`,
    SCHEMA_UID: `0x${'4'.repeat(64)}`,
  });
  assert.equal(typeof easAttester(config).attest, 'function');
  assert.equal(typeof reclaimClient(config).verify, 'function');
});
