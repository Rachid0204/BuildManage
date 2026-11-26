import type { Transaction } from '../../../types';
import { isIncomeTransaction, signedTransactionAmount } from '../../../utils/security';
import { todayCasablancaIsoDate } from '../../../shared/moroccoDate';

export interface ResidentStatementRow {
  residentId: string;
  name: string;
  openingArrears?: number;
  openingArrearsBilled?: number;
  openingArrearsOutstanding?: number;
  billed: number;
  paid: number;
  outstanding: number;
  over90Days: number;
}

export interface ReversiblePaymentSummary {
  paymentId: string;
  totalAmount: number;
  description: string;
  date: string;
}

export function computeDefaultLockMonth(todayIso: string = todayCasablancaIsoDate()): string {
  const match = /^(\d{4})-(\d{2})/.exec(todayIso.trim());
  if (!match) {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return prev.toISOString().slice(0, 7);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month <= 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

export function findReversiblePayments(
  ledger: ReadonlyArray<Transaction>,
): Map<string, ReversiblePaymentSummary> {
  const reversedPaymentIds = new Set<string>();
  for (const entry of ledger) {
    if (entry.reversalOf) {
      reversedPaymentIds.add(entry.reversalOf);
    }
  }

  const grouped = new Map<
    string,
    { totalCents: number; description: string; date: string; hasChargeAllocation: boolean }
  >();

  for (const entry of ledger) {
    if (
      entry.type !== 'income' ||
      !entry.paymentId ||
      entry.transferId ||
      entry.reversalOf ||
      reversedPaymentIds.has(entry.paymentId)
    ) {
      continue;
    }

    const hasChargeAllocation =
      Boolean((entry as any).sourceChargeId) ||
      (Array.isArray(entry.paymentAllocations) && entry.paymentAllocations.length > 0);

    const cents = Math.round(Math.abs(entry.amount || 0) * 100);
    if (cents <= 0) continue;

    const existing = grouped.get(entry.paymentId);
    if (existing) {
      existing.totalCents += cents;
      if (hasChargeAllocation) existing.hasChargeAllocation = true;
    } else {
      grouped.set(entry.paymentId, {
        totalCents: cents,
        description: entry.description || '',
        date: entry.date || '',
        hasChargeAllocation,
      });
    }
  }

  const result = new Map<string, ReversiblePaymentSummary>();
  for (const [paymentId, meta] of grouped.entries()) {
    if (!meta.hasChargeAllocation) continue;
    result.set(paymentId, {
      paymentId,
      totalAmount: meta.totalCents / 100,
      description: meta.description,
      date: meta.date,
    });
  }
  return result;
}

function escapeCsvCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `"${value.toFixed(2)}"`;
  }
  const str = String(value ?? '')
    .replace(/^(?=[\s\t\r]*[=+\-@]|[\t\r])/, "'")
    .replaceAll('"', '""');
  return `"${str}"`;
}

export function formatStatementsCsv(
  statements: ReadonlyArray<ResidentStatementRow>,
  isAr: boolean,
): string {
  const headers = isAr
    ? [
        'المالك المشترك',
        'إجمالي المطالب به (درهم)',
        'المؤدى (درهم)',
        'المتأخرات السابقة المتبقية (درهم)',
        'الباقي للأداء (درهم)',
        'متأخرات أكثر من 90 يوماً (درهم)',
      ]
    : [
        'Copropriétaire',
        'Total appelé (MAD)',
        'Déjà payé (MAD)',
        'Dont anciens impayés restants (MAD)',
        'Reste à payer (MAD)',
        'En retard > 90 jours (MAD)',
      ];

  const rows = [
    headers.map(escapeCsvCell).join(';'),
    ...statements.map((row) => {
      const arrearsDue = row.openingArrearsOutstanding ?? row.openingArrears ?? 0;
      return [
        row.name,
        row.billed ?? 0,
        row.paid ?? 0,
        arrearsDue,
        row.outstanding ?? 0,
        row.over90Days ?? 0,
      ]
        .map(escapeCsvCell)
        .join(';');
    }),
  ];

  return '\uFEFF' + rows.join('\r\n');
}

export function formatLedgerCsv(
  ledger: ReadonlyArray<Transaction>,
  isAr: boolean,
): string {
  const headers = isAr
    ? [
        'التاريخ',
        'البيان',
        'الاتجاه',
        'الصندوق',
        'الفئة',
        'المبلغ (درهم)',
        'طريقة الأداء',
        'المرجع',
        'المستفيد / الدافع',
        'الشقة',
        'رقم الوثيقة',
      ]
    : [
        'Date',
        'Libellé',
        'Sens',
        'Fonds',
        'Catégorie',
        'Montant (MAD)',
        'Mode de paiement',
        'Référence',
        'Bénéficiaire / Payeur',
        'Lot',
        'N° Facture / Pièce',
      ];

  const rows = [
    headers.map(escapeCsvCell).join(';'),
    ...ledger.map((trx) => {
      const income = isIncomeTransaction(trx);
      const signed = signedTransactionAmount(trx);
      return [
        trx.date ? trx.date.slice(0, 10) : '',
        trx.description || '',
        income ? (isAr ? 'مدخول (+)' : 'Recette (+)') : isAr ? 'مصروف (-)' : 'Dépense (-)',
        trx.fundType === 'reserve'
          ? isAr
            ? 'صندوق الاحتياط'
            : 'Fonds de réserve'
          : isAr
          ? 'الحساب الجاري'
          : 'Compte courant',
        trx.category || '',
        signed,
        trx.paymentMethod || '',
        trx.reference || '',
        trx.thirdPartyName || '',
        trx.lotNumber || '',
        trx.invoiceNumber || '',
      ]
        .map(escapeCsvCell)
        .join(';');
    }),
  ];

  return '\uFEFF' + rows.join('\r\n');
}
