// Talks to our server only. The server holds every secret and makes every trust decision;
// this file just moves requests and shows the answers.

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:8787';

export type SessionState =
  | { status: 'pending' }
  | { status: 'verifying' }
  | { status: 'verified'; claim: string }
  | { status: 'attested'; claim: string; uid: string; txHash: string; explorerUrl: string | null }
  | { status: 'failed'; error: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error(`Can't reach the verification server at ${SERVER_URL}. Check that it's running.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Server returned ${res.status}`);
  return body as T;
}

export const getChallenge = (wallet: string) =>
  call<{ nonce: string; message: string }>('/challenge', { method: 'POST', body: JSON.stringify({ wallet }) });

export const createSession = (wallet: string, nonce: string, signature: string) =>
  call<{ sessionId: string; requestUrl: string }>('/session', {
    method: 'POST',
    body: JSON.stringify({ wallet, nonce, signature }),
  });

export const getSession = (sessionId: string) => call<SessionState>(`/session/${encodeURIComponent(sessionId)}`);

// "contributions>=50" -> "At least 50 contributions"
export function describeClaim(claim: string): string {
  if (claim === 'github-account-verified') return 'GitHub account verified';
  const match = /^(.+)>=(\d+)$/.exec(claim);
  if (!match) return claim;
  const [, param, min] = match;
  const noun = param.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return Number(min) === 0 ? `GitHub ${noun} verified` : `At least ${min} ${noun}`;
}
