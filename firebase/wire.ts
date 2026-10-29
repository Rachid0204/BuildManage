import { z } from 'zod';

export const WireResponseSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  requestId: z.string().optional(),
  status: z.string().optional(),
  operation: z.string().optional(),
  result: z.unknown(),
  resultMeta: z.record(z.unknown()).optional(),
  revision: z.number().finite().optional(),
  unchanged: z.boolean().optional(),
  store: z.record(z.unknown()).optional(),
  ag: z.unknown(),
  url: z.string().optional(),
});
export type WireResponse = z.infer<typeof WireResponseSchema>;
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Snapshot data is server-owned; never retain returned invitation or password material. */
export function sanitizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          ![
            'password',
            'passwordHash',
            'generatedPassword',
            'invitationCode',
            'invitationToken',
          ].includes(key),
      )
      .map(([key, item]) => [key, sanitizeSnapshot(item)]),
  );
}
