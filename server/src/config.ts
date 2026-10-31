import { z } from 'zod';

// Fail fast on missing config. Secrets are read here and never sent to the client.
const Env = z.object({
  PORT: z.coerce.number().default(8787),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  RECLAIM_APP_ID: z.string().min(1),
  RECLAIM_APP_SECRET: z.string().min(1),
  RECLAIM_PROVIDER_ID: z.string().min(1),
  ATTESTER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  RPC_URL: z.string().url(),
  EAS_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  SCHEMA_UID: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(): Config {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid or missing env vars: ${fields} (see .env.example)`);
  }
  return parsed.data;
}
