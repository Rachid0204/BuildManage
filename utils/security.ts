import type { Building, UserProfile } from '../types';

const HASH_PREFIX = 'sha256$v1$';
const SESSION_SECRET_SALT = 'immogest_syndik_auth_v1_9f4b2c8e';

export function isAlreadyHashedPassword(value: string | undefined): boolean {
  return Boolean(
    value && (value.startsWith(HASH_PREFIX) || value.startsWith('pbkdf2$'))
  );
}

/**
 * Legacy compatibility digest for migration and historical session envelopes; not a password KDF.
 * The backend uses server/passwords.ts (scrypt). Existing callers
 * must never use this legacy digest to create production credentials.
 */
export function hashPasswordSync(password: string, emailSalt = ''): string {
  const normalizedSalt = emailSalt.trim().toLowerCase();
  const raw = `${SESSION_SECRET_SALT}:${normalizedSalt}:${password}`;

  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
    0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ];

  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    for (let s = 0; s < seeds.length; s++) {
      let h = seeds[s] ^ ((ch + i * 17 + s * 31) & 0xff);
      h = Math.imul(h, 0x01000193 + s * 2);
      h ^= h >>> 13;
      seeds[s] = h >>> 0;
    }
  }

  // Extra mixing rounds
  for (let r = 0; r < 16; r++) {
    for (let s = 0; s < seeds.length; s++) {
      const prev = seeds[(s + 7) & 7];
      let h = (seeds[s] ^ (prev >>> 7)) + Math.imul(prev, 0x9e3779b1);
      h ^= h >>> 16;
      h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13;
      seeds[s] = h >>> 0;
    }
  }

  const hex = seeds.map((v) => v.toString(16).padStart(8, '0')).join('');
  return `${HASH_PREFIX}${hex}`;
}

export function verifyPasswordSync(
  candidatePassword: string,
  storedHashOrLegacy: string | undefined,
  emailSalt = ''
): boolean {
  if (!candidatePassword || !storedHashOrLegacy) return false;
  // Never allow a stored hash string to authenticate as a plaintext password (Audit P0-2 / P0-3)
  if (isAlreadyHashedPassword(candidatePassword)) {
    return false;
  }
  const candidateHash = hashPasswordSync(candidatePassword, emailSalt);
  if (storedHashOrLegacy.startsWith(HASH_PREFIX)) {
    return candidateHash === storedHashOrLegacy;
  }
  const legacyUpgraded = hashPasswordSync(storedHashOrLegacy, emailSalt);
  return candidateHash === legacyUpgraded;
}

export function computeSessionSignature(profile: UserProfile): string {
  const canonical = [
    profile.uid || '',
    (profile.email || '').toLowerCase(),
    profile.role || '',
    profile.syndicId || '',
    profile.buildingId || '',
    profile.apartmentId || '',
    profile.residentId || '',
    profile.prestataireId || '',
  ].join('|');
  return hashPasswordSync(canonical, profile.uid || 'session');
}

/**
 * Generates a cryptographically strong random alphanumeric code or temporary password
 * using Web Crypto API (crypto.getRandomValues) instead of predictable Math.random().
 */
export function generateSecureRandomDigits(length = 6): string {
  const digits = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const buf = new Uint32Array(length);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buf);
  } else { throw new Error('A cryptographic random generator is required'); }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += digits[buf[i] % digits.length];
  }
  return out;
}

export interface SignedSessionEnvelope {
  profile: UserProfile;
  signature: string;
  issuedAt: number;
  serverToken?: string;
}

export function createSignedSessionEnvelope(
  profile: UserProfile,
  serverToken?: string
): SignedSessionEnvelope {
  return {
    profile,
    signature: computeSessionSignature(profile),
    issuedAt: Date.now(),
    ...(serverToken ? { serverToken } : {}),
  };
}

export function verifySignedSessionEnvelope(raw: unknown): UserProfile | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, any>;
  // Reject unsigned legacy profile JSON so manually edited localStorage cannot escalate privileges
  if (!obj.profile || typeof obj.signature !== 'string') {
    return null;
  }
  const profile = obj.profile as UserProfile;
  if (!profile.uid || !profile.role) return null;
  const expectedSig = computeSessionSignature(profile);
  if (obj.signature !== expectedSig) {
    return null;
  }
  return profile;
}

let inMemoryAuthHeaderToken: string | null = null;
let inMemoryUserContext: {
  uid: string;
  role: string;
  syndicId?: string;
  buildingId?: string;
  signature: string;
} | null = null;

export function setActiveAuthContext(profile: UserProfile | null, idToken?: string | null) {
  if (!profile) {
    inMemoryAuthHeaderToken = null;
    inMemoryUserContext = null;
    return;
  }
  const sig = computeSessionSignature(profile);
  inMemoryAuthHeaderToken = idToken || null;
  inMemoryUserContext = {
    uid: profile.uid,
    role: profile.role,
    syndicId: profile.syndicId,
    buildingId: profile.buildingId,
    signature: sig,
  };
}

export function getAuthenticatedRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (inMemoryAuthHeaderToken && inMemoryUserContext) {
    headers['Authorization'] = `Bearer ${inMemoryAuthHeaderToken}`;
    headers['X-Syndik-Uid'] = inMemoryUserContext.uid;
    headers['X-Syndik-Role'] = inMemoryUserContext.role;
    headers['X-Syndik-Sig'] = inMemoryUserContext.signature;
    if (inMemoryUserContext.syndicId) {
      headers['X-Syndik-Tenant'] = inMemoryUserContext.syndicId;
    }
    if (inMemoryUserContext.buildingId) {
      headers['X-Syndik-Building'] = inMemoryUserContext.buildingId;
    }
    return headers;
  }

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('syndik_auth_session_v1');
      if (raw) {
        const parsedObj = JSON.parse(raw);
        const verified = verifySignedSessionEnvelope(parsedObj);
        if (verified && typeof parsedObj.serverToken === 'string' && parsedObj.serverToken) {
          const sig = computeSessionSignature(verified);
          const tokenToUse =
            typeof parsedObj?.serverToken === 'string' && parsedObj.serverToken
              ? parsedObj.serverToken
              : '';
          headers['Authorization'] = `Bearer ${tokenToUse}`;
          headers['X-Syndik-Uid'] = verified.uid;
          headers['X-Syndik-Role'] = verified.role;
          headers['X-Syndik-Sig'] = sig;
          if (verified.syndicId) headers['X-Syndik-Tenant'] = verified.syndicId;
          if (verified.buildingId) headers['X-Syndik-Building'] = verified.buildingId;
        }
      }
    } catch {
      // ignore
    }
  }

  return headers;
}

/**
 * Fund totals = one opening balance + signed ledger movements, in integer centimes.
 * Canonical openings (including zero) take precedence over the legacy working alias.
 * Aggregate-only legacy records infer their opening from stored total minus ledger delta.
 * This is a read-only projection: no stored totals, aliases or ledger entries are migrated.
 */
export function computeBuildingFinancialBalances(building?: Building | null): {
  workingBalance: number;
  operatingBalance: number;
  reserveBalance: number;
} {
  if (!building) {
    return { workingBalance: 0, operatingBalance: 0, reserveBalance: 0 };
  }

  const financials = building.financials;
  const transactions = financials?.transactions || (building as any)?.transactions || [];
  const toCentimes = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : undefined;
  };
  let workingDelta = 0, reserveDelta = 0;
  for (const transaction of transactions) {
    const amount = toCentimes(transaction.amount) ?? 0;
    const signed = transaction.type === 'expense' ? -Math.abs(amount)
      : transaction.type === 'income' ? Math.abs(amount) : amount;
    if (transaction.fundType === 'reserve') reserveDelta += signed;
    else workingDelta += signed;
  }

  const openingWorking = toCentimes(financials?.openingWorkingBalance)
    ?? toCentimes(financials?.openingBalance)
    ?? ((toCentimes(financials?.balance) ?? workingDelta) - workingDelta);
  const openingReserve = toCentimes(financials?.openingReserveBalance)
    ?? ((toCentimes(financials?.reserveFundBalance) ?? reserveDelta) - reserveDelta);
  const working = (openingWorking + workingDelta) / 100 || 0;
  const reserve = (openingReserve + reserveDelta) / 100 || 0;
  return {
    workingBalance: working,
    operatingBalance: working,
    reserveBalance: reserve,
  };
}

export const computeBuildingFundBalances = computeBuildingFinancialBalances;

/**
 * Centime-accurate budget allocation using largest-remainder method (Audit Item 16).
 * Guarantees that the sum of allocated amounts across lots equals totalBudgetMad to the exact centime.
 */
export function allocateBudgetInCentimes(
  totalBudgetMad: number,
  lots: { id: string; tantiemes: number }[],
  totalTantiemesOverride?: number
): Map<string, number> {
  const result = new Map<string, number>();
  if (lots.length === 0 || totalBudgetMad <= 0) {
    for (const lot of lots) result.set(lot.id, 0);
    return result;
  }

  const sumShares = lots.reduce((acc, l) => acc + Math.max(0, l.tantiemes || 0), 0);
  const denominator = sumShares > 0 ? sumShares : (totalTantiemesOverride || 1000);
  const totalBudgetCentimes = Math.round(totalBudgetMad * 100);

  const floors = lots.map((lot, idx) => {
    const share = Math.max(0, lot.tantiemes || 0);
    const exactCentimes = (totalBudgetCentimes * share) / denominator;
    const floored = Math.floor(exactCentimes);
    const remainder = exactCentimes - floored;
    return { id: lot.id, idx, floored, remainder };
  });

  const allocatedCentimes = floors.reduce((acc, f) => acc + f.floored, 0);
  let leftoverCentimes = totalBudgetCentimes - allocatedCentimes;

  const sortedByRemainder = [...floors].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) {
      return b.remainder - a.remainder;
    }
    return a.idx - b.idx;
  });

  for (let i = 0; i < sortedByRemainder.length && leftoverCentimes > 0; i++) {
    sortedByRemainder[i].floored += 1;
    leftoverCentimes -= 1;
  }

  for (const item of floors) {
    result.set(item.id, item.floored / 100);
  }

  return result;
}

export const allocateBudgetCentimes = allocateBudgetInCentimes;

/**
 * Splits a paid charge amount into operating (chargesCourantesAmount) and reserve (reserveFundAmount)
 * using the building's configured reserve percentage (default 5%) in centimes so the two parts sum to amountMad.
 */
export function splitChargeReserveAndOperating(
  amountMad: number,
  reservePercentage = 5
): {
  chargesCourantesAmount: number;
  reserveFundAmount: number;
  reservePercentageUsed: number;
} {
  const pct =
    Number.isFinite(reservePercentage) && reservePercentage >= 0 && reservePercentage <= 100
      ? reservePercentage
      : 5;
  const totalCentimes = Math.round(Math.max(0, Number(amountMad) || 0) * 100);
  const reserveCentimes = Math.round((totalCentimes * pct) / 100);
  const operatingCentimes = totalCentimes - reserveCentimes;
  return {
    chargesCourantesAmount: operatingCentimes / 100,
    reserveFundAmount: reserveCentimes / 100,
    reservePercentageUsed: pct,
  };
}
