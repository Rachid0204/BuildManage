import type {
  Apartment,
  Building,
  Charge,
  PaymentProof,
  Quittance,
  Transaction,
} from '../../../types';
import {
  allocateBudgetInCentimes,
  computeBuildingFundBalances,
  getRecordedReserveSplit,
  isIncomeTransaction,
  signedTransactionAmount,
} from '../../../utils/security';
import { isChargeEffectivelyOverdue, todayCasablancaIsoDate } from '../../../shared/moroccoDate';
import { normalizeBillingPeriodKey } from '../../../shared/domain/billingPeriod';

export interface OverdueResidentGroup {
  residentId: string;
  residentName: string;
  apartmentNumbers: string[];
  apartmentNumber: string;
  apartment?: Apartment;
  apartments: Apartment[];
  charges: Charge[];
  totalOverdue: number;
  overdueCount: number;
  oldestDate: string;
}

export interface FinanceOverviewStats {
  balance: number;
  reserveFund: number;
  pendingChargesTotal: number;
  overdueChargesTotal: number;
  pendingProofsCount: number;
}

export interface AgingBuckets {
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
}

export interface ChargePreviewRow {
  id: string;
  number: string;
  existing: boolean;
  amount: number;
}

export function computeAvailableFiscalYears(
  charges: ReadonlyArray<Charge>,
  currentYear: number = new Date().getFullYear(),
): number[] {
  const years = new Set<number>([
    currentYear,
    currentYear - 1,
    currentYear - 2,
    currentYear - 3,
    currentYear - 4,
  ]);
  charges.forEach((c) => {
    const m = `${c.period || ''} ${c.dueDate || ''}`.match(/\b(20\d{2})\b/);
    if (m) years.add(Number(m[1]));
  });
  return Array.from(years).sort((a, b) => b - a);
}

export function computeHasBillableLots(building: Building): boolean {
  return building.apartments
    .filter((a) => !a.archivedAt)
    .some((apt) =>
      Boolean(
        apt.ownerId ||
          apt.tenantId ||
          building.residents.some((r) => !r.archivedAt && r.apartmentId === apt.id),
      ),
    );
}

export function computeChargePreview(params: {
  building: Building;
  charges: ReadonlyArray<Charge>;
  periodName: string;
  useTantiemes: boolean;
  totalBudgetInput: string;
}): {
  chargePreview: ChargePreviewRow[];
  vacantLotsInTantiemesMode: number;
} {
  const { building, charges, periodName, useTantiemes, totalBudgetInput } = params;
  const buildingTantiemesBase = building.totalTantiemes || 1000;
  const lots = building.apartments.filter((a) => !a.archivedAt);
  const parsedBudget = Number(totalBudgetInput);
  let allocations: Map<string, number> | null = null;
  if (useTantiemes && Number.isFinite(parsedBudget) && parsedBudget > 0 && lots.length > 0) {
    try {
      allocations = allocateBudgetInCentimes(
        parsedBudget,
        lots.map((a) => ({ id: a.id, tantiemes: a.tantiemes ?? 100 })),
        buildingTantiemesBase,
      );
    } catch {
      allocations = null;
    }
  }
  let vacantCount = 0;
  const rows: ChargePreviewRow[] = lots.flatMap((apt) => {
    const residentId =
      apt.ownerId ||
      apt.tenantId ||
      building.residents.find((r) => !r.archivedAt && r.apartmentId === apt.id)?.id;
    if (!residentId) {
      vacantCount += 1;
      return [];
    }
    const existing = charges.find(
      (c) =>
        c.apartmentId === apt.id &&
        normalizeBillingPeriodKey(c.period || '') === normalizeBillingPeriodKey(periodName) &&
        (c.chargeType || 'courante') === 'courante',
    );
    return [
      {
        id: apt.id,
        number: apt.number,
        existing: !!existing,
        amount:
          existing?.amount ??
          (useTantiemes
            ? allocations?.get(apt.id) ?? Number.NaN
            : Math.round((apt.monthlyFees ?? building.monthlySyndicFees ?? 0) * 100) / 100),
      },
    ];
  });
  return { chargePreview: rows, vacantLotsInTantiemesMode: vacantCount };
}

export function computeFinanceOverviewStats(
  building: Building,
  charges: ReadonlyArray<Charge>,
  paymentProofs: ReadonlyArray<PaymentProof>,
): FinanceOverviewStats {
  const { operatingBalance: balance, reserveBalance: reserveFund } =
    computeBuildingFundBalances(building);

  let pendingCents = 0;
  let overdueCents = 0;
  charges.forEach((c) => {
    const remCents = Math.max(0, Math.round((c.amount - (c.paidAmount || 0)) * 100));
    if (remCents <= 0 || c.status === 'paid') return;
    if (isChargeEffectivelyOverdue(c)) {
      overdueCents += remCents;
    } else {
      pendingCents += remCents;
    }
  });

  const pendingProofsCount = paymentProofs.filter((p) => p.status === 'pending').length;

  return {
    balance,
    reserveFund,
    pendingChargesTotal: pendingCents / 100,
    overdueChargesTotal: overdueCents / 100,
    pendingProofsCount,
  };
}

export function groupOverdueChargesByResident(
  charges: ReadonlyArray<Charge>,
  building: Building,
  fallbackResidentLabel: string,
): OverdueResidentGroup[] {
  const overdueList = charges.filter((c) => isChargeEffectivelyOverdue(c));
  const grouped: Record<string, OverdueResidentGroup> = {};

  overdueList.forEach((c) => {
    const res = building.residents.find((r) => r.id === c.residentId);
    const apt = building.apartments.find((a) => a.id === c.apartmentId);
    if (!grouped[c.residentId]) {
      grouped[c.residentId] = {
        residentId: c.residentId,
        residentName: res?.name || fallbackResidentLabel,
        apartmentNumbers: apt?.number ? [apt.number] : [],
        apartmentNumber: apt?.number || 'Lot',
        apartment: apt,
        apartments: apt ? [apt] : [],
        charges: [],
        totalOverdue: 0,
        overdueCount: 0,
        oldestDate: c.dueDate,
      };
    } else if (apt && !grouped[c.residentId].apartments.some((a) => a.id === apt.id)) {
      grouped[c.residentId].apartments.push(apt);
      if (apt.number && !grouped[c.residentId].apartmentNumbers.includes(apt.number)) {
        grouped[c.residentId].apartmentNumbers.push(apt.number);
        grouped[c.residentId].apartmentNumber = grouped[c.residentId].apartmentNumbers.join(', ');
      }
    }
    grouped[c.residentId].charges.push(c);
    grouped[c.residentId].totalOverdue =
      Math.round(
        (grouped[c.residentId].totalOverdue + Math.max(0, c.amount - (c.paidAmount || 0))) * 100,
      ) / 100;
    grouped[c.residentId].overdueCount += 1;
    if (new Date(c.dueDate) < new Date(grouped[c.residentId].oldestDate)) {
      grouped[c.residentId].oldestDate = c.dueDate;
    }
  });

  return Object.values(grouped).sort((a, b) => b.totalOverdue - a.totalOverdue);
}

export function computeAgingBuckets(
  charges: ReadonlyArray<Charge>,
  todayIso: string = todayCasablancaIsoDate(),
): AgingBuckets {
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  charges.forEach((c) => {
    if (!isChargeEffectivelyOverdue(c)) return;
    const remCents = Math.max(0, Math.round((c.amount - (c.paidAmount || 0)) * 100));
    if (remCents <= 0) return;
    const dueIso = (c.dueDate || '').slice(0, 10);
    const dueMs = Date.parse(`${dueIso}T00:00:00Z`);
    const ageDays = Number.isFinite(dueMs)
      ? Math.max(0, Math.floor((todayMs - dueMs) / 86_400_000))
      : 0;
    if (ageDays <= 30) buckets.d0_30 += remCents;
    else if (ageDays <= 60) buckets.d31_60 += remCents;
    else if (ageDays <= 90) buckets.d61_90 += remCents;
    else buckets.d90_plus += remCents;
  });
  return {
    d0_30: buckets.d0_30 / 100,
    d31_60: buckets.d31_60 / 100,
    d61_90: buckets.d61_90 / 100,
    d90_plus: buckets.d90_plus / 100,
  };
}

export function filterTransactions(
  transactions: ReadonlyArray<Transaction>,
  filters: {
    fund: 'all' | 'courant' | 'reserve';
    type: 'all' | 'income' | 'expense';
    category: string;
    search: string;
  },
): Transaction[] {
  return transactions.filter((trx) => {
    if (filters.fund === 'courant' && trx.fundType === 'reserve') return false;
    if (filters.fund === 'reserve' && trx.fundType !== 'reserve') return false;

    if (filters.type === 'income' && !isIncomeTransaction(trx)) return false;
    if (filters.type === 'expense' && isIncomeTransaction(trx)) return false;

    if (filters.category !== 'all' && trx.category !== filters.category) return false;

    if (filters.search.trim()) {
      const q = filters.search.toLowerCase();
      const desc = (trx.description || '').toLowerCase();
      const ref = (trx.reference || '').toLowerCase();
      const third = (trx.thirdPartyName || '').toLowerCase();
      const ice = (trx.thirdPartyIce || '').toLowerCase();
      const inv = (trx.invoiceNumber || '').toLowerCase();
      const lot = (trx.lotNumber || '').toLowerCase();
      if (
        !desc.includes(q) &&
        !ref.includes(q) &&
        !third.includes(q) &&
        !ice.includes(q) &&
        !inv.includes(q) &&
        !lot.includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

export function computeFilteredTransactionStats(
  allTransactions: ReadonlyArray<Transaction>,
  filteredList: ReadonlyArray<Transaction>,
  filterFund: 'all' | 'courant' | 'reserve',
): { income: number; expense: number; net: number; count: number } {
  const reversedOriginalIds = new Set(
    allTransactions
      .map((t) => t.reversalOf)
      .filter((id): id is string => Boolean(id)),
  );
  let incomeCents = 0;
  let expenseCents = 0;
  let netCents = 0;
  filteredList.forEach((t) => {
    const signedCents = Math.round(signedTransactionAmount(t) * 100);
    netCents += signedCents;
    // Exclude inter-fund transfers when viewing both funds combined, and exclude cancelled original+reversal pairs from gross flows
    if (filterFund === 'all' && t.transferId) return;
    if (t.reversalOf || reversedOriginalIds.has(t.id)) return;
    if (signedCents >= 0) incomeCents += signedCents;
    else expenseCents += Math.abs(signedCents);
  });
  return {
    income: incomeCents / 100,
    expense: expenseCents / 100,
    net: netCents / 100,
    count: filteredList.length,
  };
}

export function filterQuittances(
  quittances: ReadonlyArray<Quittance>,
  quittanceSearch: string,
  quittanceFilterMethod: string,
): Quittance[] {
  const search = quittanceSearch.trim().toLowerCase();
  return quittances.filter((q) => {
    const qNum = (q.quittanceNumber || '').toLowerCase();
    const resName = (q.residentName || '').toLowerCase();
    const aptNum = (q.apartmentNumber || '').toLowerCase();
    const ref = (q.referenceNumber || '').toLowerCase();

    const matchesSearch =
      search === '' ||
      qNum.includes(search) ||
      resName.includes(search) ||
      aptNum.includes(search) ||
      ref.includes(search);

    const matchesMethod =
      quittanceFilterMethod === 'all' || q.paymentMethod === quittanceFilterMethod;

    return matchesSearch && matchesMethod;
  });
}

export function computeQuittanceTotals(quittances: ReadonlyArray<Quittance>): {
  activeCount: number;
  totalAmount: number;
  totalReserveFundAmount: number;
} {
  const activeQuittances = quittances.filter((q) => !q.voidedAt);
  const totalAmount =
    activeQuittances.reduce((sum, q) => sum + Math.round((q.amount || 0) * 100), 0) / 100;
  const totalReserveFundAmount =
    activeQuittances.reduce(
      (sum, q) => sum + Math.round((getRecordedReserveSplit(q)?.reserveFundAmount ?? 0) * 100),
      0,
    ) / 100;

  return {
    activeCount: activeQuittances.length,
    totalAmount,
    totalReserveFundAmount,
  };
}
