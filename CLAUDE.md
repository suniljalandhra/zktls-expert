# zktls-expert — CLAUDE.md

Take-home exercise 2 for EulerPhi (Unify/Fai). A **zkTLS verification system using Reclaim Protocol**,
with no SP1. Claim: **GitHub expertise** (e.g. owns or contributes to a repo, or contribution count), fitting
Fai's expert verification. Output: an **EAS attestation** to the user's wallet. Keep it simple.

Read docs/ARCHITECTURE.md, then docs/PHASES.md.

## Tech (verify current versions)
- Reclaim Protocol JS SDK (`@reclaimprotocol/js-sdk`): proof request + verifyProof. App ID/secret from the Reclaim dev tool.
- Server: Node + TypeScript (Express or Hono). Holds APP_SECRET and the attester key.
- Web: Next.js (App Router) + TypeScript, wagmi/viem, QR code for the Reclaim session. UI only, no secrets.
- EAS SDK (`@ethereum-attestation-service/eas-sdk`) on Sepolia or Base Sepolia.

## Layout
```
server/   POST /session -> request URL + session id; webhook/poll for proof; verify; attest
web/      single page, 3 steps
scripts/  register the EAS schema
docs/
```

## Rules
- Secrets (APP_SECRET, attester private key) stay server-side only; keep .env.example up to date.
- Always verify the proof server-side with the Reclaim SDK before attesting. Never trust the client.
- After each phase: run it, summarize, explain it in plain language, and give me 3 reviewer questions.
- Every commit message is a single line. No body, no bullet lists.
- docs/ is git-ignored: keep docs local, never commit them.
