import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk';
import { JsonRpcProvider, Wallet, ZeroAddress } from 'ethers';
import { SCHEMA } from '../server/src/eas.ts';

// Registers the attestation schema once and prints SCHEMA_UID for .env. Safe to re-run:
// the UID is deterministic, so if it's already registered we just print it.

const REVOCABLE = true; // lets the attester revoke an attestation if a proof turns out to be bad

const { ATTESTER_PRIVATE_KEY, RPC_URL, SCHEMA_REGISTRY_ADDRESS } = process.env;
if (!ATTESTER_PRIVATE_KEY || !RPC_URL || !SCHEMA_REGISTRY_ADDRESS) {
  throw new Error('Set ATTESTER_PRIVATE_KEY, RPC_URL and SCHEMA_REGISTRY_ADDRESS in .env');
}

const signer = new Wallet(ATTESTER_PRIVATE_KEY, new JsonRpcProvider(RPC_URL));
const registry = new SchemaRegistry(SCHEMA_REGISTRY_ADDRESS);
registry.connect(signer);

const uid = SchemaRegistry.getSchemaUID(SCHEMA, ZeroAddress, REVOCABLE);
const existing = await registry.getSchema({ uid }).catch(() => null);

if (existing && existing.uid !== `0x${'0'.repeat(64)}`) {
  console.log(`Schema already registered.\nSCHEMA_UID=${uid}`);
} else {
  console.log(`Registering "${SCHEMA}" from ${signer.address}...`);
  const tx = await registry.register({ schema: SCHEMA, resolverAddress: ZeroAddress, revocable: REVOCABLE });
  const registered = await tx.wait();
  console.log(`Registered.\nSCHEMA_UID=${registered}`);
}
