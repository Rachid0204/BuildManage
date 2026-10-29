/** Only opaque IDs, hashes and private file references cross a reload. Never persist command arguments. */
export interface PendingOperation {
  operationId: string;
  operation: string;
  target: string;
  timestamp: number;
  requestHash: string;
  uploads: Record<string, string>;
}
const PREFIX = 'syndik_pending_operations_v1:';
export async function operationHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
function storage() {
  if (!window.sessionStorage) throw new Error('Activez le stockage de session avant de soumettre cette opération.');
  return window.sessionStorage;
}
export function pendingFor(uid: string): PendingOperation[] {
  const value = JSON.parse(storage().getItem(PREFIX + uid) || '[]');
  if (!Array.isArray(value) || value.some(r => !r || typeof r.operationId !== 'string' ||
      !/^op:\d{13}:[a-zA-Z0-9_-]+$/.test(r.operationId) || typeof r.operation !== 'string' ||
      typeof r.target !== 'string' || !Number.isFinite(r.timestamp) || !/^[a-f0-9]{64}$/.test(r.requestHash) ||
      !r.uploads || Object.entries(r.uploads).some(([hash, url]) => !/^[a-f0-9]{64}$/.test(hash) || typeof url !== 'string' || !/^\/api\/uploads\/[a-zA-Z0-9_-]+$/.test(url))))
    throw new Error('Métadonnées de reprise invalides. Vérifiez les opérations avant de continuer.');
  return value;
}
export function savePending(uid: string, record: PendingOperation) {
  const rows = pendingFor(uid).filter(r => r.operationId !== record.operationId);
  if (rows.length >= 100) throw new Error('Trop de demandes non résolues. Vérifiez leurs résultats avant de continuer.');
  // Explicit allowlist prevents accidental persistence of arguments, credentials or response bodies.
  rows.push({ operationId: record.operationId, operation: record.operation, target: record.target,
    timestamp: record.timestamp, requestHash: record.requestHash, uploads: record.uploads });
  const text = JSON.stringify(rows);
  if (text.length > 65536) throw new Error('Métadonnées de reprise trop volumineuses.');
  storage().setItem(PREFIX + uid, text);
}
export function removePending(uid: string, id: string) {
  storage().setItem(PREFIX + uid, JSON.stringify(pendingFor(uid).filter(r => r.operationId !== id)));
}
export function operationTarget(operation: string, args: unknown[]): string {
  // Use IDs only, never titles, names, email addresses, passwords or free-form text.
  const item: any = args[0];
  const ids = item && typeof item === 'object' ? ['buildingId', 'residentId', 'apartmentId', 'id']
    .filter(k => typeof item[k] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item[k]))
    .map(k => `${k}:${item[k]}`).join('/') : '';
  const knownIdFirst = /^(addAnnouncement|addTransaction|attachDocument|generateMonthlyCharges|createInvoiceForResident|deleteResident|updateResident|reviewPaymentProof|deleteMarketplaceItem|updateMarketplaceItemStatus)$/;
  return ids || (knownIdFirst.test(operation) && typeof item === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item) ? item : 'command');
}
