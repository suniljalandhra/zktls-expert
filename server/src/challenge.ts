import { randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';

// Proves the caller controls the wallet before we bind a Reclaim session to it.
// Without this, anyone could attach their GitHub claim to someone else's wallet.

const TTL_MS = 5 * 60 * 1000;

type Challenge = { wallet: string; message: string; expiresAt: number };

export function challengeMessage(wallet: string, nonce: string, origin: string): string {
  return [
    'zktls-expert: prove GitHub expertise for this wallet.',
    `Wallet: ${wallet}`,
    `Origin: ${origin}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

export class Challenges {
  private byNonce = new Map<string, Challenge>();

  constructor(private origin: string, private now: () => number = Date.now) {}

  issue(walletInput: string): { nonce: string; message: string } {
    for (const [n, c] of this.byNonce) if (c.expiresAt < this.now()) this.byNonce.delete(n);
    const wallet = getAddress(walletInput);
    const nonce = randomBytes(16).toString('hex');
    const message = challengeMessage(wallet, nonce, this.origin);
    this.byNonce.set(nonce, { wallet, message, expiresAt: this.now() + TTL_MS });
    return { nonce, message };
  }

  // Single use: the nonce is deleted whether or not the signature checks out.
  consume(nonce: string, walletInput: string, signature: string): string {
    const challenge = this.byNonce.get(nonce);
    this.byNonce.delete(nonce);
    if (!challenge || challenge.expiresAt < this.now()) throw new Error('challenge expired or unknown');
    const wallet = getAddress(walletInput);
    if (wallet !== challenge.wallet) throw new Error('challenge was issued for a different wallet');
    let signer: string;
    try {
      signer = verifyMessage(challenge.message, signature);
    } catch {
      throw new Error('malformed signature');
    }
    if (signer !== wallet) throw new Error('signature does not match wallet');
    return wallet;
  }
}
