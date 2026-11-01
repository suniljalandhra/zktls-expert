import { createRequire } from 'node:module';
import { JsonRpcProvider } from 'ethers';
import { SCHEMA } from '../server/src/eas.ts';

// Reads an attestation back from the chain and decodes it. Stand-in for EAS Scan on a local chain.
// Usage: npm --prefix scripts run read-attestation -- <uid>

const { EAS, SchemaEncoder } = createRequire(import.meta.url)(
  '@ethereum-attestation-service/eas-sdk',
) as typeof import('@ethereum-attestation-service/eas-sdk');

const uid = process.argv[2];
const { RPC_URL, EAS_ADDRESS } = process.env;
if (!uid) throw new Error('Usage: npm --prefix scripts run read-attestation -- <uid>');
if (!RPC_URL || !EAS_ADDRESS) throw new Error('Set RPC_URL and EAS_ADDRESS in .env');

const eas = new EAS(EAS_ADDRESS);
eas.connect(new JsonRpcProvider(RPC_URL));
const a = await eas.getAttestation(uid);
if (a.uid === `0x${'0'.repeat(64)}`) throw new Error(`No attestation ${uid} on this chain`);

const fields = Object.fromEntries(
  new SchemaEncoder(SCHEMA).decodeData(a.data).map((f) => [f.name, String(f.value.value)]),
);
console.log({
  uid: a.uid,
  schema: a.schema,
  recipient: a.recipient,
  attester: a.attester,
  time: new Date(Number(a.time) * 1000).toISOString(),
  revoked: a.revocationTime > 0n,
  ...fields,
});
