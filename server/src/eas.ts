import { createRequire } from 'node:module';
import { JsonRpcProvider, Wallet } from 'ethers';
import type { Config } from './config.js';

// The SDK's ESM build does `import { isEqual } from 'lodash'`, which Node's ESM loader rejects (lodash is CJS),
// so the server crashes on boot. Load the CommonJS build instead; types still come from the package.
const { EAS, NO_EXPIRATION, SchemaEncoder } = createRequire(import.meta.url)(
  '@ethereum-attestation-service/eas-sdk',
) as typeof import('@ethereum-attestation-service/eas-sdk');

// Must match scripts/register-schema.ts exactly, or the schema UID won't line up.
export const SCHEMA = 'string platform,bytes32 subjectHash,string claim,uint64 verifiedAt,string method';

export type AttestInput = { recipient: string; subjectHash: string; claim: string; verifiedAt: number };
export type AttestOutput = { uid: string; txHash: string };

export interface Attester {
  attest(input: AttestInput): Promise<AttestOutput>;
}

export function easAttester(config: Config): Attester {
  if (!config.SCHEMA_UID) throw new Error('SCHEMA_UID is not set: run the schema registration script first');
  const schemaUID = config.SCHEMA_UID;
  const signer = new Wallet(config.ATTESTER_PRIVATE_KEY, new JsonRpcProvider(config.RPC_URL));
  const eas = new EAS(config.EAS_ADDRESS);
  eas.connect(signer);
  const encoder = new SchemaEncoder(SCHEMA);

  return {
    async attest({ recipient, subjectHash, claim, verifiedAt }) {
      const data = encoder.encodeData([
        { name: 'platform', value: 'github', type: 'string' },
        { name: 'subjectHash', value: subjectHash, type: 'bytes32' },
        { name: 'claim', value: claim, type: 'string' },
        { name: 'verifiedAt', value: BigInt(verifiedAt), type: 'uint64' },
        { name: 'method', value: 'reclaim-zktls', type: 'string' },
      ]);
      const tx = await eas.attest({
        schema: schemaUID,
        data: { recipient, expirationTime: NO_EXPIRATION, revocable: true, data },
      });
      const uid = await tx.wait();
      return { uid, txHash: tx.receipt?.hash ?? '' };
    },
  };
}
