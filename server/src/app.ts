import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isAddress } from 'ethers';
import { z } from 'zod';
import { Challenges } from './challenge.js';
import { CheckError, checkProof, type Session } from './checks.js';
import type { Config } from './config.js';
import type { Attester } from './eas.js';
import type { ReclaimClient } from './reclaim.js';
import type { Store } from './store.js';

const SESSION_TTL_MS = 15 * 60 * 1000;

type Status =
  | { status: 'pending' }
  | { status: 'verifying' }
  | { status: 'verified'; claim: string } // proof accepted, verify-only mode (EAS not configured)
  | { status: 'attested'; claim: string; uid: string; txHash: string; explorerUrl: string }
  | { status: 'failed'; error: string };

type Entry = Session & { state: Status };

export type Deps = {
  config: Config;
  reclaim: ReclaimClient;
  attester: Attester | null;
  store: Store;
  challenges?: Challenges;
  now?: () => number;
  log?: (msg: string, data?: unknown) => void;
};

const Address = z.string().refine(isAddress, 'invalid address');
const ChallengeBody = z.object({ wallet: Address });
const SessionBody = z.object({
  wallet: Address,
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export function createApp(deps: Deps) {
  const { config, reclaim, attester, store } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((msg, data) => console.log(msg, data ?? ''));
  const challenges = deps.challenges ?? new Challenges(config.WEB_ORIGIN, now);
  const sessions = new Map<string, Entry>();

  const app = new Hono();
  app.use('*', cors({ origin: config.WEB_ORIGIN }));
  app.onError((err, c) => {
    log('unhandled error', err.message);
    return c.json({ error: 'internal error' }, 500);
  });

  app.get('/health', (c) => c.json({ ok: true, attesting: attester !== null }));

  app.post('/challenge', async (c) => {
    const body = ChallengeBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid wallet' }, 400);
    return c.json(challenges.issue(body.data.wallet));
  });

  app.post('/session', async (c) => {
    const body = SessionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid request' }, 400);

    let wallet: string;
    try {
      wallet = challenges.consume(body.data.nonce, body.data.wallet, body.data.signature);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 401);
    }

    for (const [id, s] of sessions) if (now() - s.createdAt > SESSION_TTL_MS) sessions.delete(id);

    const created = await reclaim.createRequest(wallet);
    sessions.set(created.sessionId, {
      id: created.sessionId,
      wallet,
      providerVersion: created.providerVersion,
      createdAt: now(),
      state: { status: 'pending' },
    });
    log('session created', { sessionId: created.sessionId, wallet });
    return c.json({ sessionId: created.sessionId, requestUrl: created.requestUrl });
  });

  // The browser polls this. We only ever act on sessions we created ourselves.
  app.get('/session/:id', async (c) => {
    const entry = sessions.get(c.req.param('id'));
    if (!entry) return c.json({ error: 'unknown session' }, 404);

    if (entry.state.status === 'pending') {
      if (now() - entry.createdAt > SESSION_TTL_MS) {
        entry.state = { status: 'failed', error: 'session expired' };
      } else {
        const status = await reclaim.fetchProofs(entry.id);
        if (status.state === 'failed') entry.state = { status: 'failed', error: status.reason };
        if (status.state === 'ready') {
          // Flip state before any await so concurrent polls can't process the same proof twice.
          entry.state = { status: 'verifying' };
          void process(entry, status.proofs, status.providerId);
        }
      }
    }
    return c.json(entry.state);
  });

  async function process(entry: Entry, proofs: Parameters<typeof checkProof>[0], providerId: string) {
    let reservedSubject: string | null = null;
    try {
      const verified = await checkProof(proofs, providerId, entry, config, reclaim);
      log('proof verified', { sessionId: entry.id, params: verified.params, claim: verified.claim });

      store.reserve(verified.subjectHash, verified.proofId);
      reservedSubject = verified.subjectHash;

      if (!attester) {
        store.release(verified.subjectHash);
        entry.state = { status: 'verified', claim: verified.claim };
        return;
      }

      const { uid, txHash } = await attester.attest({
        recipient: entry.wallet,
        subjectHash: verified.subjectHash,
        claim: verified.claim,
        verifiedAt: verified.verifiedAt,
      });
      store.commit(verified.subjectHash, { wallet: entry.wallet, uid, txHash, proofId: verified.proofId, at: now() });
      log('attested', { sessionId: entry.id, uid, txHash });
      entry.state = {
        status: 'attested',
        claim: verified.claim,
        uid,
        txHash,
        explorerUrl: `${config.EXPLORER_URL}/attestation/view/${uid}`,
      };
    } catch (e) {
      if (reservedSubject) store.release(reservedSubject);
      const known = e instanceof CheckError;
      log('verification failed', { sessionId: entry.id, error: (e as Error).message });
      entry.state = { status: 'failed', error: known ? (e as Error).message : 'attestation failed, try again later' };
    }
  }

  return app;
}
