import { z } from 'zod';

const hex = (bytes: number) => new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`);
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

// Fail fast on missing config. Secrets are read here and never sent to the client.
const Env = z.object({
  PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  RECLAIM_APP_ID: z.string().min(1),
  RECLAIM_APP_SECRET: z.string().regex(hex(32)),
  RECLAIM_PROVIDER_ID: z.string().min(1),
  // Optional: pin an exact provider version so a provider edit can't change what we accept.
  RECLAIM_PROVIDER_VERSION: optionalString,
  ATTESTER_PRIVATE_KEY: z.string().regex(hex(32)),
  RPC_URL: z.string().url(),
  EAS_ADDRESS: z.string().regex(hex(20)),
  SCHEMA_UID: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(hex(32)).optional()),
  EXPLORER_URL: z.string().url().default('https://sepolia.easscan.org'),
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
