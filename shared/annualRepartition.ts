import type { Apartment, Building, Charge, Quittance } from '../types';
import { normalizeBillingPeriodKey } from './domain/billingPeriod';
import { getRecordedReserveTotal } from './domain/money';

function extractYear(value?: string | null): number | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  const iso = /^(\d{4})-/.exec(trimmed);
  if (iso) return Number(iso[1]);
  const normalized = normalizeBillingPeriodKey(trimmed);
  const normYear = /^(\d{4})-/.exec(normalized);
  if (normYear) return Number(normYear[1]);
  const anyYear = /\b(19\d{2}|20\d{2}|21\d{2})\b/.exec(trimmed);
  return anyYear ? Number(anyYear[1]) : null;
}

export function chargeMatchesFiscalYear(
  charge: Pick<Charge, 'periodKey' | 'period' | 'dueDate' | 'createdAt'>,
  fiscalYear: number,
): boolean {
  const year =
    extractYear(charge.periodKey) ??
    extractYear(charge.period) ??
    extractYear(charge.dueDate) ??
    extractYear(charge.createdAt);
  return year === fiscalYear;
}

export function quittanceMatchesFiscalYear(
  quittance: Pick<
    Quittance,
    | 'voidedAt'
    | 'postingDate'
    | 'bankTransactionDate'
    | 'paymentDate'
    | 'createdAt'
    | 'periodCovered'
  >,
  fiscalYear: number,
): boolean {
  if (quittance.voidedAt) return false;
  const year =
    extractYear(quittance.postingDate) ??
    extractYear(quittance.bankTransactionDate) ??
    extractYear(quittance.paymentDate) ??
    extractYear(quittance.createdAt) ??
    extractYear(quittance.periodCovered);
  return year === fiscalYear;
}

export interface AnnualRepartitionRow {
  apartmentId: string;
  apartmentNumber: string;
  archived: boolean;
  ownerName: string;
  tantiemes: number;
  calledMad: number;
  paidMad: number;
  remainingMad: number;
  reserveMad: number | undefined;
}

export interface AnnualRepartitionSummary {
  fiscalYear: number;
  totalTantiemes: number;
  rows: AnnualRepartitionRow[];
  totalCalledMad: number;
  totalPaidMad: number;
  totalRemainingMad: number;
  totalReserveMad: number;
  reserveDocumented: boolean;
  receiptCount: number;
}

export function buildAnnualRepartitionSummary(
  building: Building,
  charges: Charge[],
  quittances: Quittance[],
  fiscalYear: number,
): AnnualRepartitionSummary {
  const totalTantiemes = building.totalTantiemes || 1000;
  const yearCharges = charges.filter(
    (c) => c.buildingId === building.id && chargeMatchesFiscalYear(c, fiscalYear),
  );
  const yearQuittances = quittances.filter(
    (q) =>
      q.buildingId === building.id &&
      quittanceMatchesFiscalYear(q, fiscalYear),
  );

  // Include all active apartments plus any archived/unlisted lots that had charges in this fiscal year
  const aptMap = new Map<string, Apartment & { __synthetic?: boolean }>();
  for (const apt of building.apartments || []) {
    aptMap.set(apt.id, apt);
  }
  for (const chg of yearCharges) {
    if (!aptMap.has(chg.apartmentId)) {
      const matchingReceipt = yearQuittances.find(
        (q) => q.apartmentId === chg.apartmentId || q.chargeId === chg.id,
      );
      aptMap.set(chg.apartmentId, {
        id: chg.apartmentId,
        buildingId: building.id,
        number: matchingReceipt?.apartmentNumber || chg.apartmentId,
        floor: 0,
        area: 0,
        ownerId: chg.residentId || null,
        tenantId: null,
        monthlyFees: 0,
        tantiemes: chg.tantiemesApplied ?? 0,
        archivedAt: 'historical',
        __synthetic: true,
      });
    }
  }

  let totalCalledCents = 0;
  let totalPaidCents = 0;
  let totalReserveCents = 0;
  let reserveDocumented = true;
  const rows: AnnualRepartitionRow[] = [];

  for (const apt of aptMap.values()) {
    const aptCharges = yearCharges.filter((c) => c.apartmentId === apt.id);
    // Skip archived/historical lots with zero activity in this fiscal year
    if ((apt.archivedAt || apt.__synthetic) && aptCharges.length === 0) {
      continue;
    }

    const owner =
      (building.residents || []).find(
        (r) => r.id === apt.ownerId || r.apartmentId === apt.id,
      ) ||
      (aptCharges[0]
        ? (building.residents || []).find(
            (r) => r.id === aptCharges[0].residentId,
          )
        : undefined);

    const calledCents = aptCharges.reduce(
      (sum, c) => sum + Math.round((Number(c.amount) || 0) * 100),
      0,
    );
    const paidCents = aptCharges.reduce(
      (sum, c) =>
        sum +
        Math.round(
          (Number(c.paidAmount ?? (c.status === 'paid' ? c.amount : 0)) || 0) *
            100,
        ),
      0,
    );
    const remainingCents = Math.max(0, calledCents - paidCents);

    const aptChargeIds = new Set(aptCharges.map((c) => c.id));
    const lotYearQuittances = yearQuittances.filter(
      (receipt) =>
        (receipt.chargeId && aptChargeIds.has(receipt.chargeId)) ||
        (receipt.apartmentId
          ? receipt.apartmentId === apt.id
          : receipt.apartmentNumber === apt.number),
    );
    const reserveContrib = getRecordedReserveTotal(
      lotYearQuittances,
      paidCents / 100,
    );

    totalCalledCents += calledCents;
    totalPaidCents += paidCents;
    if (reserveContrib === undefined) {
      reserveDocumented = false;
    } else {
      totalReserveCents += Math.round(reserveContrib * 100);
    }

    rows.push({
      apartmentId: apt.id,
      apartmentNumber: String(apt.number),
      archived: Boolean(apt.archivedAt || apt.__synthetic),
      ownerName:
        owner?.name ||
        lotYearQuittances[0]?.residentName ||
        'Non assigné',
      tantiemes: apt.tantiemes ?? 100,
      calledMad: calledCents / 100,
      paidMad: paidCents / 100,
      remainingMad: remainingCents / 100,
      reserveMad: reserveContrib,
    });
  }

  return {
    fiscalYear,
    totalTantiemes,
    rows,
    totalCalledMad: totalCalledCents / 100,
    totalPaidMad: totalPaidCents / 100,
    totalRemainingMad: Math.max(0, totalCalledCents - totalPaidCents) / 100,
    totalReserveMad: totalReserveCents / 100,
    reserveDocumented,
    receiptCount: yearQuittances.length,
  };
}
