# zktls-expert

Proves a GitHub fact (an account, optionally a contribution count above a threshold) with a Reclaim
Protocol zkTLS proof. The server verifies the proof and issues an EAS attestation to the user's wallet.

By default it attests on a local Anvil chain with EAS deployed locally. Leave the EAS settings empty for
verify-only mode, or point them at Sepolia.

## Flow

1. User connects a wallet and signs a server nonce.
2. Server creates a Reclaim session with the wallet in the proof context and returns a QR link.
3. User logs into GitHub inside the Reclaim flow.
4. Server fetches the proof from Reclaim, verifies it, and attests to the wallet.

Schema: `string platform, bytes32 subjectHash, string claim, uint64 verifiedAt, string method`, where
`subjectHash = keccak256(lowercase username)`.

## Run

Requires Node 24+, [Foundry](https://getfoundry.sh/) and a browser wallet.

1. Create an app with a GitHub provider at [dev.reclaimprotocol.org](https://dev.reclaimprotocol.org/).
2. `cp .env.example .env`. Fill in the Reclaim app ID, secret and provider ID, and set
   `ATTESTER_PRIVATE_KEY` to a fresh key (the deploy script funds it).
3. Install:
   ```bash
   npm --prefix server ci && npm --prefix web ci && npm --prefix scripts ci
   ```
4. Start Anvil in its own terminal (state is saved to `.anvil/`):
   ```bash
   npm --prefix scripts run chain
   ```
   Deploy EAS and register the schema, then copy the printed values into `.env`:
   ```bash
   npm --prefix scripts run deploy-local
   ```
5. Start the server and web app, then open http://localhost:3000:
   ```bash
   npm --prefix server run dev
   ```
   ```bash
   npm --prefix web run dev
   ```

If your provider uses different parameter names, set `GITHUB_USERNAME_PARAM`, `CLAIM_COUNT_PARAM` and
`CLAIM_MIN_COUNT`. The server logs the real names on the first proof.

## Test

```bash
npm --prefix server test
```
```bash
npm --prefix server run test:local
```
The first uses fakes for Reclaim and EAS. The second needs Anvil running and attests on the local chain.

Read an attestation: `npm --prefix scripts run read-attestation -- <uid>`

To reset, stop Anvil and delete both `.anvil/` and `server/data/`. They must be reset together.

For Sepolia, set `RPC_URL`, `EAS_ADDRESS=0xC2679fBD37d54388Ce493F1DB75320D236e1815e`,
`SCHEMA_REGISTRY_ADDRESS=0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` and
`EXPLORER_URL=https://sepolia.easscan.org`, fund the attester, and run
`npm --prefix scripts run register-schema`.

## Trust model

- Reclaim's attestors are trusted. Colluding attestors could forge a proof.
- The server is trusted. It holds the attester key, so an attestation means this server checked the proof.
- The browser is not trusted. It supplies only a wallet address and a signature; the server fetches the proof.

Before attesting, the server checks: `verifyProof` against the pinned provider, exactly one proof, a known
session ID, the context wallet matches the signer, the proof is newer than the session, the claim rule
passes, and neither the GitHub account nor the proof has been attested before.

## Limitations

- Single process. Sessions and challenges are in memory; the one-per-account store is a JSON file.
- `subjectHash` is an unsalted hash of a public username, so anyone can check whether a username is attested.
- EOA signatures only (no EIP-1271).
- One attestation per GitHub account; revocation is manual.
- No rate limiting.
