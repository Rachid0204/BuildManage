import type { CashChannel, SubscriptionPaymentMethod } from '../../../types';

export function escapeCsvCell(value: string | number | undefined | null): string {
  const raw = String(value ?? '');
  const sanitized = /^[=+\-@\t\r]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${sanitized.replace(/"/g, '""')}"`;
}

export function getCasablancaMonthKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
  })
    .format(date)
    .slice(0, 7);
}

export function parseExpiryMs(raw?: string): number {
  const trimmed = (raw || '').trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T23:59:59.999Z`
    : trimmed;
  return Date.parse(normalized);
}

export function getDaysRemaining(raw?: string): number | null {
  const ms = parseExpiryMs(raw);
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86_400_000);
}

export function normalizeRibDigits(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function formatRibMoroccan(raw: string): string {
  const digits = normalizeRibDigits(raw);
  if (!/^\d{24}$/.test(digits)) return raw.trim();
  return digits.replace(/^(\d{3})(\d{3})(\d{16})(\d{2})$/, '$1 $2 $3 $4');
}

export function getCashChannelLabel(
  channel: CashChannel | undefined,
  tr: (fr: string, ar: string) => string,
): string {
  switch (channel) {
    case 'wafacash':
      return 'Wafacash';
    case 'cashplus':
      return 'Cash Plus';
    case 'baridcash':
      return 'Barid Cash';
    case 'check':
      return tr('Chèque', 'شيك بنكي');
    default:
      return tr('Guichet / Bureau', 'المكتب / الشباك');
  }
}

export function getMethodBadgeMeta(
  method: SubscriptionPaymentMethod | undefined,
  tr: (fr: string, ar: string) => string,
) {
  switch (method) {
    case 'cmi':
      return {
        label: tr('CMI Maroc (3DS)', 'بطاقة مغربية CMI'),
        badgeClass: 'bg-teal-100 text-teal-800',
      };
    case 'card':
      return {
        label: tr('Carte (PayPal)', 'بطاقة بنكية (PayPal)'),
        badgeClass: 'bg-indigo-100 text-indigo-800',
      };
    case 'paypal':
      return {
        label: 'PayPal',
        badgeClass: 'bg-sky-100 text-sky-800',
      };
    case 'virement':
      return {
        label: tr('Virement Maroc', 'تحويل بنكي'),
        badgeClass: 'bg-emerald-100 text-emerald-800',
      };
    case 'cash':
      return {
        label: tr('Espèces (Guichet)', 'نقداً (الشباك)'),
        badgeClass: 'bg-amber-100 text-amber-900',
      };
    case 'wafacash':
      return {
        label: 'Wafacash',
        badgeClass: 'bg-amber-100 text-amber-900',
      };
    case 'cashplus':
      return {
        label: 'Cash Plus',
        badgeClass: 'bg-orange-100 text-orange-900',
      };
    case 'baridcash':
      return {
        label: 'Barid Cash',
        badgeClass: 'bg-yellow-100 text-yellow-900',
      };
    case 'check':
      return {
        label: tr('Chèque', 'شيك'),
        badgeClass: 'bg-purple-100 text-purple-800',
      };
    default:
      return {
        label: tr('Manuel', 'يدوي'),
        badgeClass: 'bg-slate-100 text-slate-700',
      };
  }
}
