import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Proof } from '@reclaimprotocol/js-sdk';
import { JsonRpcProvider, Wallet } from 'ethers';
import { createApp } from '../src/app.js';
import { subjectHash } from '../src/checks.js';
import { loadConfig } from '../src/config.js';
import { SCHEMA, easAttester } from '../src/eas.js';
import type { ReclaimClient } from '../src/reclaim.js';
import { Store } from '../src/store.js';

// Integration test: whole server flow with a fake Reclaim proof but the REAL EAS attester on the local Anvil chain.
// Opt-in, since it needs the chain running and deployed:
//   npm --prefix scripts run chain   (another terminal)
//   npm --prefix scripts run deploy-local
//   npm --prefix server run test:local

const enabled = process.env.LOCAL_CHAIN === '1';

it('attests a verified proof on the local chain and the chain agrees', { skip: !enabled }, async () => {
  const config = loadConfig({ ...process.env, RECLAIM_PROVIDER_ID: 'provider', EXPLORER_URL: '' });
  const attester = easAttester(config);
  assert.ok(attester, 'EAS settings missing from .env: run deploy-local');

  const username = `local-${Date.now()}`; // fresh each run, so one-per-account never blocks it
  const reclaim: ReclaimClient = {
    async createRequest() {
      return { sessionId: 'local-session', requestUrl: 'https://reclaim.example', providerVersion: '1.0.0' };
    },
    async fetchProofs() {
      const proof = { identifier: `proof-${username}`, claimData: { timestampS: Math.floor(Date.now() / 1000) } };
      return { state: 'ready', proofs: [proof as unknown as Proof], providerId: 'provider' };
    },
    async verify() {
      return {
        ok: true,
        context: { reclaimSessionId: 'local-session', contextAddress: wallet.address },
        extractedParameters: { username },
      };
    },
  };

  const wallet = Wallet.createRandom();
  const app = createApp({ config, reclaim, attester, store: new Store(null), log: () => {} });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  const { nonce, message } = await (await post('/challenge', { wallet: wallet.address })).json();
  await post('/session', { wallet: wallet.address, nonce, signature: await wallet.signMessage(message) });

  let state: { status: string; uid?: string; explorerUrl?: string | null } = { status: 'pending' };
  for (let i = 0; i < 100 && (state.status === 'pending' || state.status === 'verifying'); i++) {
    state = await (await app.request('/session/local-session')).json();
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(state.status, 'attested', JSON.stringify(state));
  assert.equal(state.explorerUrl, null);

  // Read it back from the chain, independent of the server's own bookkeeping.
  const { EAS, SchemaEncoder } = createRequire(import.meta.url)(
    '@ethereum-attestation-service/eas-sdk',
  ) as typeof import('@ethereum-attestation-service/eas-sdk');
  const eas = new EAS(config.EAS_ADDRESS!);
  eas.connect(new JsonRpcProvider(config.RPC_URL));
  const onchain = await eas.getAttestation(state.uid!);
  assert.equal(onchain.recipient, wallet.address);
  assert.equal(onchain.attester, new Wallet(config.ATTESTER_PRIVATE_KEY!).address);
  const fields = Object.fromEntries(new SchemaEncoder(SCHEMA).decodeData(onchain.data).map((f) => [f.name, f.value.value]));
  assert.equal(fields.subjectHash, subjectHash(username));
  assert.equal(fields.method, 'reclaim-zktls');
});
