import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { Proof } from '@reclaimprotocol/js-sdk';
import { Wallet } from 'ethers';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Attester } from '../src/eas.js';
import type { ProofStatus, ReclaimClient, VerifyResult } from '../src/reclaim.js';
import { Store } from '../src/store.js';

// Fake Reclaim + EAS so we can drive every attack path without network or real proofs.

const PROVIDER = 'github-provider-id';
const config = loadConfig({
  RECLAIM_APP_ID: 'app',
  RECLAIM_APP_SECRET: `0x${'1'.repeat(64)}`,
  RECLAIM_PROVIDER_ID: PROVIDER,
  ATTESTER_PRIVATE_KEY: `0x${'2'.repeat(64)}`,
  RPC_URL: 'http://localhost:8545',
  EAS_ADDRESS: `0x${'3'.repeat(40)}`,
  SCHEMA_UID: `0x${'4'.repeat(64)}`,
  CLAIM_COUNT_PARAM: 'contributions',
  CLAIM_MIN_COUNT: '10',
  EXPLORER_URL: 'https://sepolia.easscan.org',
});

type ProofSpec = {
  sessionId?: string;
  wallet?: string;
  username?: string;
  contributions?: string;
  providerId?: string;
  verified?: boolean;
  identifier?: string;
  timestampS?: number;
};

let sessionCounter = 0;
let pendingProof: Record<string, ProofSpec> = {};
let attestCalls: unknown[] = [];

const fakeProof = (sessionId: string, spec: ProofSpec): Proof =>
  ({
    identifier: spec.identifier ?? `proof-${sessionId}`,
    claimData: { timestampS: spec.timestampS ?? Math.floor(Date.now() / 1000) },
    // stash the spec so verify() can read it back
    extractedParameterValues: { ...spec, sessionId: spec.sessionId ?? sessionId },
  }) as unknown as Proof;

const reclaim: ReclaimClient = {
  async createRequest() {
    const sessionId = `sess-${++sessionCounter}`;
    return { sessionId, requestUrl: `https://reclaim.example/${sessionId}`, providerVersion: '1.0.0' };
  },
  async fetchProofs(sessionId): Promise<ProofStatus> {
    const spec = pendingProof[sessionId];
    if (!spec) return { state: 'pending' };
    return { state: 'ready', proofs: [fakeProof(sessionId, spec)], providerId: spec.providerId ?? PROVIDER };
  },
  async verify(proof): Promise<VerifyResult> {
    const spec = proof.extractedParameterValues as ProofSpec & { sessionId: string };
    if (spec.verified === false) return { ok: false, reason: 'proof not verified: bad signature' };
    return {
      ok: true,
      context: { reclaimSessionId: spec.sessionId, contextAddress: spec.wallet },
      extractedParameters: { username: spec.username ?? 'alice', contributions: spec.contributions ?? '42' },
    };
  },
};

const attester: Attester = {
  async attest(input) {
    attestCalls.push(input);
    return { uid: `0x${'a'.repeat(64)}`, txHash: `0x${'b'.repeat(64)}` };
  },
};

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  pendingProof = {};
  attestCalls = [];
  app = createApp({ config, reclaim, attester, store: new Store(null), log: () => {} });
});

const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

async function startSession(wallet = Wallet.createRandom()) {
  const { nonce, message } = await (await post('/challenge', { wallet: wallet.address })).json();
  const signature = await wallet.signMessage(message);
  const res = await post('/session', { wallet: wallet.address, nonce, signature });
  assert.equal(res.status, 200);
  const { sessionId } = await res.json();
  return { wallet, sessionId: sessionId as string };
}

// Poll until the session leaves pending/verifying (processing runs in the background).
async function finish(sessionId: string) {
  for (let i = 0; i < 50; i++) {
    const state = await (await app.request(`/session/${sessionId}`)).json();
    if (state.status !== 'pending' && state.status !== 'verifying') return state;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('session never finished');
}

describe('happy path', () => {
  it('attests to the signing wallet with a hashed username', async () => {
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address };
    const state = await finish(sessionId);
    assert.equal(state.status, 'attested');
    assert.equal(state.claim, 'contributions>=10');
    assert.match(state.explorerUrl, /attestation\/view\/0xa+$/);
    assert.equal(attestCalls.length, 1);
    const call = attestCalls[0] as { recipient: string; subjectHash: string };
    assert.equal(call.recipient, wallet.address);
    assert.notEqual(call.subjectHash, 'alice'); // username never goes on-chain in clear
  });
});

describe('attacks', () => {
  it('rejects an invalid proof (SDK verification fails)', async () => {
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address, verified: false };
    const state = await finish(sessionId);
    assert.equal(state.status, 'failed');
    assert.match(state.error, /not verified/);
    assert.equal(attestCalls.length, 0);
  });

  it('rejects a proof from the wrong provider', async () => {
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address, providerId: 'some-other-provider' };
    const state = await finish(sessionId);
    assert.deepEqual(state, { status: 'failed', error: 'wrong provider' });
  });

  it('rejects a proof bound to a different wallet', async () => {
    const { sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: Wallet.createRandom().address };
    const state = await finish(sessionId);
    assert.deepEqual(state, { status: 'failed', error: 'proof is bound to a different wallet' });
  });

  it('rejects a proof generated for a different session', async () => {
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address, sessionId: 'someone-elses-session' };
    const state = await finish(sessionId);
    assert.deepEqual(state, { status: 'failed', error: 'proof belongs to a different session' });
  });

  it('allows only one attestation per GitHub username (case-insensitive)', async () => {
    const first = await startSession();
    pendingProof[first.sessionId] = { wallet: first.wallet.address, username: 'Alice' };
    assert.equal((await finish(first.sessionId)).status, 'attested');

    const second = await startSession();
    pendingProof[second.sessionId] = { wallet: second.wallet.address, username: 'alice', identifier: 'other' };
    const state = await finish(second.sessionId);
    assert.deepEqual(state, { status: 'failed', error: 'this GitHub account already has an attestation' });
    assert.equal(attestCalls.length, 1);
  });

  it('rejects a reused proof even for a new username slot', async () => {
    const first = await startSession();
    pendingProof[first.sessionId] = { wallet: first.wallet.address, username: 'bob', identifier: 'same' };
    assert.equal((await finish(first.sessionId)).status, 'attested');

    const second = await startSession();
    pendingProof[second.sessionId] = { wallet: second.wallet.address, username: 'carol', identifier: 'same' };
    assert.deepEqual(await finish(second.sessionId), { status: 'failed', error: 'this proof was already used' });
  });

  it('rejects a proof below the contribution threshold', async () => {
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address, contributions: '3' };
    const state = await finish(sessionId);
    assert.deepEqual(state, { status: 'failed', error: 'contributions 3 is below the required 10' });
  });

  it('rejects a stale proof created before the session', async () => {
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address, timestampS: Math.floor(Date.now() / 1000) - 3600 };
    assert.deepEqual(await finish(sessionId), { status: 'failed', error: 'proof predates session' });
  });

  it('processes a proof once even under concurrent polling', async () => {
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address };
    await Promise.all(Array.from({ length: 5 }, () => app.request(`/session/${sessionId}`)));
    assert.equal((await finish(sessionId)).status, 'attested');
    assert.equal(attestCalls.length, 1);
  });

  it('ignores sessions the server did not create', async () => {
    const res = await app.request('/session/made-up');
    assert.equal(res.status, 404);
  });
});

describe('wallet ownership', () => {
  it('rejects a session signed by a different wallet', async () => {
    const victim = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const { nonce, message } = await (await post('/challenge', { wallet: victim.address })).json();
    const res = await post('/session', { wallet: victim.address, nonce, signature: await attacker.signMessage(message) });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'signature does not match wallet' });
  });

  it('rejects a reused challenge nonce', async () => {
    const wallet = Wallet.createRandom();
    const { nonce, message } = await (await post('/challenge', { wallet: wallet.address })).json();
    const signature = await wallet.signMessage(message);
    assert.equal((await post('/session', { wallet: wallet.address, nonce, signature })).status, 200);
    const again = await post('/session', { wallet: wallet.address, nonce, signature });
    assert.equal(again.status, 401);
  });

  it('rejects malformed input', async () => {
    assert.equal((await post('/challenge', { wallet: 'not-an-address' })).status, 400);
    assert.equal((await post('/session', { wallet: 'x' })).status, 400);
  });
});

describe('verify-only mode (no EAS)', () => {
  it('verifies the proof and reports the claim without attesting', async () => {
    app = createApp({ config, reclaim, attester: null, store: new Store(null), log: () => {} });
    const { wallet, sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: wallet.address };
    assert.deepEqual(await finish(sessionId), { status: 'verified', claim: 'contributions>=10' });
    assert.equal(attestCalls.length, 0);
  });

  it('still rejects a proof bound to a different wallet', async () => {
    app = createApp({ config, reclaim, attester: null, store: new Store(null), log: () => {} });
    const { sessionId } = await startSession();
    pendingProof[sessionId] = { wallet: Wallet.createRandom().address };
    assert.deepEqual(await finish(sessionId), { status: 'failed', error: 'proof is bound to a different wallet' });
  });
});
