import { z } from 'zod';
import target from '../deploy/target.json' with { type: 'json' };

const secret = z.string().min(32).refine(value =>
 value === value.trim() && new Set(value).size >= 12 &&
 !/^(.{1,16})\1+$/.test(value) &&
 !/change.?me|replace.?me|your.?secret|default|insecure|example|synthetic|test.?secret|dev.?secret|temporary|ephemeral/i.test(value));
const encryptionKeys = z.string().min(1).superRefine((raw, ctx) => {
 try {
  const value = JSON.parse(raw), primary = value?.primary, retired = value?.retired ?? [];
  const valid = (entry: any) => entry && typeof entry.kid === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(entry.kid) &&
   typeof entry.key === 'string' && entry.key.length >= 32;
  if (!valid(primary) || !Array.isArray(retired) || !retired.every(valid) ||
   new Set([primary?.kid, ...retired.map((entry: any) => entry.kid)]).size !== 1 + retired.length)
   ctx.addIssue({ code: 'custom', message: 'Expected a primary key and unique retired keys with kid and 32+ character key values' });
 } catch { ctx.addIssue({ code: 'custom', message: 'Must be valid JSON' }); }
});
const origin = z.string().url().refine(value => {
 try {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
   url.pathname === '/' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 } catch { return false; }
});

/** Production has no inferred backend, project, database or durable key defaults. */
export const productionEnvironmentSchema = z.object({
 NODE_ENV: z.literal('production'),
 SYNDIK_STATE_BACKEND: z.literal('firestore'),
 SYNDIK_UPLOAD_BACKEND: z.literal('gcs'),
 SYNDIK_AUTH_PROVIDER: z.literal('firebase'),
 SYNDIK_SERVER_SECRET: secret,
 SYNDIK_SESSION_SECRET: secret.optional(),
 SYNDIK_ENCRYPTION_KEYS: encryptionKeys,
 SYNDIK_SCHEDULER_SECRET: secret,
 GOOGLE_CLOUD_PROJECT: z.literal(target.projectId),
 FIRESTORE_DATABASE_ID: z.literal(target.databaseId),
 PUBLIC_APP_URL: origin,
 SYNDIK_UPLOAD_BUCKET: z.string().min(3).max(222).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/),
 FIREBASE_PROJECT_ID: z.literal(target.projectId).optional(),
 K_SERVICE: z.literal(target.service).optional(),
 CLOUD_RUN_PROJECT_ID: z.literal(target.projectId).optional(),
 CLOUD_RUN_SERVICE: z.literal(target.service).optional(),
 CLOUD_RUN_REGION: z.literal(target.region).optional(),
 FIRESTORE_EMULATOR_HOST: z.literal('').optional(),
 FIREBASE_AUTH_EMULATOR_HOST: z.literal('').optional(),
 STORAGE_EMULATOR_HOST: z.literal('').optional(),
 FIREBASE_STORAGE_EMULATOR_HOST: z.literal('').optional(),
 FUNCTIONS_EMULATOR: z.literal('').optional(),
 SYNDIK_TEST_MODE: z.literal('').optional(),
}).refine(env => !env.SYNDIK_SESSION_SECRET || env.SYNDIK_SESSION_SECRET !== env.SYNDIK_SERVER_SECRET,
 { path: ['SYNDIK_SESSION_SECRET'], message: 'Must be independent from the legacy compatibility secret' })
 .refine(env => {
  let primary: string;
  try { primary = JSON.parse(env.SYNDIK_ENCRYPTION_KEYS).primary.key; } catch { return false; }
  return primary !== env.SYNDIK_SERVER_SECRET && (!env.SYNDIK_SESSION_SECRET || primary !== env.SYNDIK_SESSION_SECRET);
 }, { path: ['SYNDIK_ENCRYPTION_KEYS'], message: 'Primary encryption key must be independent from signing and legacy compatibility secrets' })
 .refine(env => env.SYNDIK_SERVER_SECRET !== env.SYNDIK_SCHEDULER_SECRET &&
  (!env.SYNDIK_SESSION_SECRET || env.SYNDIK_SESSION_SECRET !== env.SYNDIK_SCHEDULER_SECRET),
 { path: ['SYNDIK_SCHEDULER_SECRET'], message: 'Must differ from session-signing and legacy compatibility keys' });
export type ProductionEnvironment = z.infer<typeof productionEnvironmentSchema>;

export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env): ProductionEnvironment | undefined {
 if (env.NODE_ENV !== 'production') return undefined;
 const result = productionEnvironmentSchema.safeParse(env);
 if (!result.success) {
  const fields = [...new Set(result.error.issues.map(issue => issue.path.join('.')))];
  throw new Error(`PRODUCTION_CONFIG_INVALID: ${fields.join(', ')}. See docs/deployment-contract.md; no fallback is permitted.`);
 }
 return result.data;
}
