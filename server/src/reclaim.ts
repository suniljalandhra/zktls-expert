import { ReclaimProofRequest, fetchStatusUrl, verifyProof, type Proof } from '@reclaimprotocol/js-sdk';
import type { Config } from './config.js';

// Thin wrapper over the Reclaim SDK so the rest of the server (and the tests) don't touch it directly.

export type CreatedRequest = { sessionId: string; requestUrl: string; providerVersion: string };

export type ProofStatus =
  | { state: 'pending' }
  | { state: 'failed'; reason: string }
  | { state: 'ready'; proofs: Proof[]; providerId: string };

export type VerifyResult =
  | { ok: true; context: Record<string, unknown>; extractedParameters: Record<string, string> }
  | { ok: false; reason: string };

export interface ReclaimClient {
  createRequest(wallet: string): Promise<CreatedRequest>;
  fetchProofs(sessionId: string): Promise<ProofStatus>;
  verify(proof: Proof, providerVersion: string): Promise<VerifyResult>;
}

const TERMINAL_FAILURES = new Set(['PROOF_SUBMISSION_FAILED', 'ERROR_SUBMITTED', 'ERROR_SUBMISSION_FAILED', 'SESSION_CANCELLED']);

export function reclaimClient(config: Config): ReclaimClient {
  return {
    async createRequest(wallet) {
      const request = await ReclaimProofRequest.init(
        config.RECLAIM_APP_ID,
        config.RECLAIM_APP_SECRET,
        config.RECLAIM_PROVIDER_ID,
        config.RECLAIM_PROVIDER_VERSION ? { providerVersion: config.RECLAIM_PROVIDER_VERSION } : undefined,
      );
      // context.contextAddress ends up inside the attestor-signed claim, binding the proof to this wallet.
      request.setContext(wallet, 'zktls-expert');
      const sessionId = request.getSessionId();
      const requestUrl = await request.getRequestUrl();
      const { providerVersion } = request.getProviderVersion();
      return { sessionId, requestUrl, providerVersion };
    },

    // We poll Reclaim's status endpoint from the server, so the proof never passes through the browser.
    async fetchProofs(sessionId) {
      const res = await fetchStatusUrl(sessionId);
      const session = res.session;
      if (!session) return { state: 'pending' };
      // PROOF_GENERATION_FAILED is retryable in the Reclaim flow, so we keep waiting (the session TTL caps it).
      if (TERMINAL_FAILURES.has(session.statusV2)) {
        return { state: 'failed', reason: session.error?.message ?? session.statusV2 };
      }
      if (!session.proofs?.length) return { state: 'pending' };
      return { state: 'ready', proofs: session.proofs, providerId: session.providerId };
    },

    async verify(proof, providerVersion) {
      // Checks attestor signatures AND that the proof content matches our pinned provider's hash.
      const result = await verifyProof(proof, { providerId: config.RECLAIM_PROVIDER_ID, providerVersion });
      if (!result.isVerified) return { ok: false, reason: `proof not verified: ${result.error?.message ?? 'unknown'}` };
      const [data] = result.data;
      if (!data) return { ok: false, reason: 'proof verified but returned no data' };
      return { ok: true, context: data.context, extractedParameters: data.extractedParameters };
    },
  };
}
