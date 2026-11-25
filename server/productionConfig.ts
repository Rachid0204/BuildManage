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
 TRUST_PROXY_HOPS: z.string().regex(/^\d+$/).optional(),
 SYNDIK_CORS_ORIGINS: z.string().optional(),
 CSP_MODE: z.enum(['report-only', 'enforce']).optional(),
 SESSION_TRANSPORT_MODE: z.enum(['bearer-only', 'dual', 'cookie-web']).optional(),
 SESSION_COOKIE_NAME: z.enum(['syndik_session', '__session']).optional(),
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

const NON_SECRET_EXPECTED: Readonly<Record<string, string>> = {
 SYNDIK_STATE_BACKEND: 'firestore',
 SYNDIK_UPLOAD_BACKEND: 'gcs',
 SYNDIK_AUTH_PROVIDER: 'firebase',
 CSP_MODE: 'report-only | enforce',
 SESSION_TRANSPORT_MODE: 'bearer-only | dual | cookie-web',
 SESSION_COOKIE_NAME: 'syndik_session | __session',
 GOOGLE_CLOUD_PROJECT: target.projectId,
 FIRESTORE_DATABASE_ID: target.databaseId,
 FIREBASE_PROJECT_ID: target.projectId,
 K_SERVICE: target.service,
 CLOUD_RUN_PROJECT_ID: target.projectId,
 CLOUD_RUN_SERVICE: target.service,
 CLOUD_RUN_REGION: target.region,
};

const SECRET_ENV_KEYS = [
 'SYNDIK_SERVER_SECRET',
 'SYNDIK_SESSION_SECRET',
 'SYNDIK_ENCRYPTION_KEYS',
 'SYNDIK_SCHEDULER_SECRET',
 'SYNDIK_BACKUP_KEY',
 'SENDGRID_API_KEY',
 'PAYPAL_CLIENT_SECRET',
] as const;

function formatObservedValue(raw: string | undefined, secretValues: ReadonlySet<string>): string {
 if (raw === undefined) return 'undefined';
 if (raw === '') return '""';
 if (secretValues.has(raw)) return '[REDACTED]';
 const bounded = raw.length > 120 ? `${raw.slice(0, 120)}...` : raw;
 return /^[^\s,"'\\]+$/.test(bounded) && !/[\x00-\x1f\x7f]/.test(bounded)
  ? bounded
  : JSON.stringify(bounded);
}

export class ProductionConfigError extends Error {
 readonly code: 'PRODUCTION_CONFIG_INVALID';
 readonly fields: string[];

 constructor(fields: string[], message: string) {
  super(message);
  this.name = 'ProductionConfigError';
  this.code = 'PRODUCTION_CONFIG_INVALID';
  this.fields = fields;
 }
}

export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env): ProductionEnvironment | undefined {
 if (env.NODE_ENV !== 'production') return undefined;
 const result = productionEnvironmentSchema.safeParse(env);
 if (!result.success) {
  const fields = [...new Set(result.error.issues.map(issue => issue.path.join('.')))];
  const secretValues = new Set(
   SECRET_ENV_KEYS.map(key => env[key]).filter((v): v is string => typeof v === 'string' && v.length > 0),
  );
  const details = fields.map(field => {
   if (Object.hasOwn(NON_SECRET_EXPECTED, field)) {
    return `${field} (expected ${NON_SECRET_EXPECTED[field]}, got ${formatObservedValue(env[field], secretValues)})`;
   }
   return field;
  });
  const message = `PRODUCTION_CONFIG_INVALID: ${details.join(', ')}. See docs/deployment-contract.md; no fallback is permitted.`;
  console.error(JSON.stringify({
   severity: 'ERROR',
   event: 'production_config_invalid',
   fields,
   message,
  }));
  throw new ProductionConfigError(fields, message);
 }
 return result.data;
}
