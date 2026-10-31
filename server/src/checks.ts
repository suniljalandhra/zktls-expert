import type { Proof } from '@reclaimprotocol/js-sdk';
import { getAddress, keccak256, toUtf8Bytes } from 'ethers';
import type { Config } from './config.js';
import { CheckError } from './errors.js';
import type { ReclaimClient } from './reclaim.js';

// Everything we check about a proof before we're willing to attest. Each failure is a reason string
// so the API and tests can tell exactly which check rejected it.

export type Session = {
  id: string; // Reclaim session id
  wallet: string; // checksummed, proven by signature
  providerVersion: string;
  createdAt: number; // ms
};

export type Verified = {
  username: string;
  subjectHash: string;
  claim: string;
  verifiedAt: number; // seconds, from the attestor-signed claim
  proofId: string;
  params: Record<string, string>;
};

export { CheckError };

const CLOCK_SKEW_S = 60;

export async function checkProof(
  proofs: Proof[],
  statusProviderId: string,
  session: Session,
  config: Config,
  reclaim: ReclaimClient,
): Promise<Verified> {
  if (proofs.length !== 1) throw new CheckError(`expected exactly 1 proof, got ${proofs.length}`);
  const [proof] = proofs;

  // 1. Pinned provider: the session must be for our provider. verify() below also checks content hashes.
  if (statusProviderId !== config.RECLAIM_PROVIDER_ID) throw new CheckError('wrong provider');

  // 2. Cryptographic verification (attestor signatures + provider hash) via the SDK.
  const result = await reclaim.verify(proof, session.providerVersion);
  if (!result.ok) throw new CheckError(result.reason);
  const { context, extractedParameters: params } = result;

  // 3. Binding: the signed context must name this session and this wallet.
  if (context.reclaimSessionId !== session.id) throw new CheckError('proof belongs to a different session');
  const contextAddress = typeof context.contextAddress === 'string' ? context.contextAddress : '';
  if (!sameAddress(contextAddress, session.wallet)) throw new CheckError('proof is bound to a different wallet');

  // 4. Freshness: the claim must be created after this session started.
  const verifiedAt = proof.claimData.timestampS;
  if (verifiedAt + CLOCK_SKEW_S < Math.floor(session.createdAt / 1000)) throw new CheckError('proof predates session');

  // 5. Claim rule.
  const { username, claim } = applyRule(params, config);

  return { username, subjectHash: subjectHash(username), claim, verifiedAt, proofId: proof.identifier, params };
}

export function applyRule(params: Record<string, string>, config: Config): { username: string; claim: string } {
  const username = params[config.GITHUB_USERNAME_PARAM]?.trim();
  if (!username || !/^[a-zA-Z0-9-]{1,39}$/.test(username)) {
    throw new CheckError(`missing or invalid GitHub username in "${config.GITHUB_USERNAME_PARAM}"`);
  }
  if (!config.CLAIM_COUNT_PARAM) return { username, claim: 'github-account-verified' };

  const raw = params[config.CLAIM_COUNT_PARAM];
  const count = Number(String(raw ?? '').replace(/,/g, ''));
  if (!Number.isFinite(count)) throw new CheckError(`"${config.CLAIM_COUNT_PARAM}" is not a number`);
  if (count < config.CLAIM_MIN_COUNT) {
    throw new CheckError(`${config.CLAIM_COUNT_PARAM} ${count} is below the required ${config.CLAIM_MIN_COUNT}`);
  }
  return { username, claim: `${config.CLAIM_COUNT_PARAM}>=${config.CLAIM_MIN_COUNT}` };
}

// GitHub logins are case-insensitive, so normalise before hashing or "Alice" and "alice" get two attestations.
export function subjectHash(username: string): string {
  return keccak256(toUtf8Bytes(username.toLowerCase()));
}

function sameAddress(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return false;
  }
}
