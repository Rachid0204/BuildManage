// Server snapshots are memory-only. Authentication and pending command identities
// have separate, explicit persistence paths. No domain storage adapter lives here.
const records = new Map<string, string>();
export const engineStorage = {
  getItem: (key: string): string | null => records.get(key) ?? null,
  setItem: (key: string, value: string): void => { records.set(key, value); },
  removeItem: (key: string): void => { records.delete(key); },
};
export function clearBusinessCache(): void { records.clear(); }
