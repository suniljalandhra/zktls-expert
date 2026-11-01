import { z } from 'zod';

const hex = (bytes: number) => new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);
const empty = (v: unknown) => (v === '' || v === '0x' ? undefined : v);
const optionalString = z.preprocess(empty, z.string().optional());

// Fail fast on missing config. Secrets are read here and never sent to the client.
const Env = z.object({
  PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  RECLAIM_APP_ID: z.string().min(1),
  RECLAIM_APP_SECRET: z.string().regex(hex(32)),
  RECLAIM_PROVIDER_ID: z.string().min(1),
  // Optional: pin an exact provider version so a provider edit can't change what we accept.
  RECLAIM_PROVIDER_VERSION: optionalString,
  // EAS is optional: leave these empty to verify proofs and show the result without writing anything on-chain.
  ATTESTER_PRIVATE_KEY: z.preprocess(empty, z.string().regex(hex(32)).optional()),
  RPC_URL: z.preprocess(empty, z.string().url().optional()),
  EAS_ADDRESS: z.preprocess(empty, z.string().regex(hex(20)).optional()),
  SCHEMA_UID: z.preprocess(empty, z.string().regex(hex(32)).optional()),
  // EAS Scan base URL for result links. Empty for a local chain, which no explorer can see.
  EXPLORER_URL: z.preprocess(empty, z.string().url().optional()),
  // Claim rule: which extracted parameter holds the GitHub login, and an optional numeric threshold.
  GITHUB_USERNAME_PARAM: z.string().min(1).default('username'),
  CLAIM_COUNT_PARAM: optionalString,
  CLAIM_MIN_COUNT: z.coerce.number().int().nonnegative().default(0),
  STORE_PATH: z.string().default('./data/store.json'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid or missing env vars: ${fields} (see .env.example)`);
  }
  return parsed.data;
}
