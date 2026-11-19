import { randomUUID } from 'node:crypto';
import type {
  CreateQuittanceCommand,
  PostIncomeCommand,
} from '../../shared/domain/commands';
import { syncBuildingFinancialBalances } from '../../shared/domain/balances';
import { parseIsoBillingPeriod } from '../../shared/domain/billingPeriod';
import {
  allocateBudgetInCentimes,
  centimes,
  getBuildingReserveRate,
  getRecordedReserveSplit,
  resolveChargeReserveRate,
  splitChargeReserveAndOperating,
} from '../../shared/domain/money';
import { bankDate } from '../../shared/domain/paymentDates';
import { resolveOpenStatus } from '../../shared/moroccoDate';
import type {
  Building,
  Charge,
  Invoice,
  PaymentPostingOptions,
  PaymentProof,
  Quittance,
  Syndic,
  Transaction,
} from '../../types';
import {
  assertBudgetConserved,
  billingPayer,
  requireBudgetPayer,
} from './billingAllocation';
import { normalizeBillingPeriodKey } from './billingPeriod';
import type { DomainContext } from './context';
import { assertContext } from './context';
import { PostIncomeSchema, SetOpeningBalancesSchema } from './contracts';
import { OperationError } from './errors';
import { paymentDates } from './paymentDates';
import type { BankStatementCSVRow, GenerateChargesResult } from './records';
import { STORAGE_KEYS } from './records';
import { transactionRecords } from './state';
export function createFinanceService(context: DomainContext) {
  assertContext(context);
  const {
    read: getLocalItem,
    write: setLocalItem,
    write,
  } = transactionRecords(context.state);
  const generateMonthlyCharges = async (
    buildingId: string,
    syndicId: string,
    periodOrOptions?:
      | string
      | {
          useTantiemes?: boolean;
          periodName?: string;
          totalMonthlyBudget?: number;
          totalBudgetToSplit?: number;
          chargeType?: Charge['chargeType'];
        },
    maybeOptions?:
      | boolean
      | {
          periodName?: string;
          chargeType?: Charge['chargeType'];
          totalBudgetToSplit?: number;
          totalMonthlyBudget?: number;
          useTantiemes?: boolean;
        },
  ): Promise<GenerateChargesResult> => {
    const now = new Date();
    const defaultPeriod = now.toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
    const normalizedMaybeOptions =
      typeof maybeOptions === 'boolean'
        ? { useTantiemes: maybeOptions }
        : maybeOptions || {};
    const opts =
      typeof periodOrOptions === 'object' && periodOrOptions !== null
        ? { ...periodOrOptions, ...normalizedMaybeOptions }
        : normalizedMaybeOptions;
    const resolvedPeriod =
      typeof periodOrOptions === 'string' && periodOrOptions.trim()
        ? periodOrOptions.trim()
        : opts.periodName?.trim() || defaultPeriod;
    const resolvedChargeType: Charge['chargeType'] =
      opts.chargeType || 'courante';
    const normalizedPeriodKey = normalizeBillingPeriodKey(resolvedPeriod);
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    const syndic =
      syndics.find((s) => s.id === syndicId) ||
      syndics.find((s) => s.buildings.some((b) => b.id === buildingId));
    const building = syndic?.buildings.find((b) => b.id === buildingId);
    if (!building) {
      const empty = Object.assign([] as Charge[], {
        success: false,
        count: 0,
        createdCount: 0,
        skippedCount: 0,
      });
      return empty;
    }
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []);
    const parsedPeriod = parseIsoBillingPeriod(normalizedPeriodKey);
    if (!parsedPeriod) {
      throw new Error(
        'Période de facturation invalide. Utilisez un mois valide (ex. 2026-04 ou Avril 2026).',
      );
    }
    const dueDate = new Date(
      Date.UTC(parsedPeriod.year, parsedPeriod.month - 1, 5),
    )
      .toISOString()
      .split('T')[0];
    const totalTantiemes = building.totalTantiemes ?? 1000;
    const budgetToSplit = opts.totalBudgetToSplit ?? opts.totalMonthlyBudget;
    if (budgetToSplit !== undefined) centimes(budgetToSplit);
    const useTantiemesBudget =
      budgetToSplit !== undefined && opts.useTantiemes !== false;
    const isArchivedResident = (id: string | null | undefined) =>
      Boolean(
        id && building.residents.some((r: any) => r.id === id && r.archivedAt),
      );
    const targets = building.apartments
      .filter((a: any) => !a.archivedAt)
      .map((apt) => {
        if (useTantiemesBudget) {
          return { apt, residentId: billingPayer(building, apt) };
        }
        const canonicalPayer = billingPayer(
          { ...building, syndicId: building.syndicId || syndicId },
          apt,
        );
        if (canonicalPayer) {
          return { apt, residentId: canonicalPayer };
        }
        const candidateId =
          (!isArchivedResident(apt.ownerId) ? apt.ownerId : undefined) ||
          (!isArchivedResident(apt.tenantId) ? apt.tenantId : undefined) ||
          building.residents.find(
            (r: any) => !r.archivedAt && r.apartmentId === apt.id,
          )?.id;
        return {
          apt,
          residentId:
            candidateId && !isArchivedResident(candidateId)
              ? candidateId
              : undefined,
        };
      });
    if (useTantiemesBudget)
      targets.forEach(({ apt, residentId }) =>
        requireBudgetPayer(apt, residentId),
      );
    // Precompute centime-exact allocations across all apartments in the building (Audit Item 16)
    const centimeAllocationMap = useTantiemesBudget
      ? allocateBudgetInCentimes(
          budgetToSplit!,
          targets.map(({ apt }) => ({
            id: apt.id,
            tantiemes: apt.tantiemes ?? 100,
          })),
          totalTantiemes,
        )
      : null;
    const newCharges: Charge[] = [];
    let skippedCount = 0;
    targets.forEach(({ apt, residentId }) => {
      if (!residentId) return;
      // Audit Item 12: Stable period uniqueness check per (buildingId, apartmentId, normalizedPeriod, chargeType)
      const alreadyBilled = charges.find(
        (existing) =>
          existing.buildingId === buildingId &&
          existing.apartmentId === apt.id &&
          normalizeBillingPeriodKey(existing.period || '') ===
            normalizedPeriodKey &&
          (existing.chargeType || 'courante') === resolvedChargeType,
      );
      if (alreadyBilled) {
        if (centimeAllocationMap) {
          if (
            alreadyBilled.syndicId !== syndicId ||
            centimes(alreadyBilled.amount) !==
              centimes(centimeAllocationMap.get(apt.id)!)
          )
            throw new Error(
              'Charge existante incompatible avec le budget. Rapprochement nécessaire.',
            );
        }
        skippedCount += 1;
        return;
      }
      const shares = apt.tantiemes ?? 100;
      // Audit Item 16: Respect explicitly configured 0 fee via ?? instead of ||
      const baseFee = apt.monthlyFees ?? building.monthlySyndicFees ?? 0;
      const computedAmount = centimeAllocationMap
        ? (centimeAllocationMap.get(apt.id) ?? baseFee)
        : Math.round(baseFee * 100) / 100;
      if (centimeAllocationMap && centimes(computedAmount) <= 0) return;
      const stableId = `chg-${buildingId}-${apt.id}-${normalizedPeriodKey.replace(/[^a-z0-9]/g, '_')}-${resolvedChargeType}`;
      const newCharge: Charge = {
        id: stableId,
        syndicId: building.syndicId || syndicId,
        buildingId,
        apartmentId: apt.id,
        residentId,
        amount: computedAmount,
        paidAmount: 0,
        dueDate,
        status: 'unpaid',
        period: resolvedPeriod,
        periodKey: normalizedPeriodKey,
        chargeType: resolvedChargeType,
        tantiemesApplied: shares,
        createdAt: now.toISOString(),
      };
      newCharges.push(newCharge);
    });
    if (centimeAllocationMap)
      assertBudgetConserved(
        [
          ...charges.filter(
            (c) =>
              c.buildingId === buildingId &&
              c.syndicId === syndicId &&
              normalizeBillingPeriodKey(c.period || '') ===
                normalizedPeriodKey &&
              (c.chargeType || 'courante') === resolvedChargeType,
          ),
          ...newCharges,
        ].map((c) => c.amount),
        budgetToSplit!,
      );
    if (newCharges.length > 0) {
      const updated = [...newCharges, ...charges];
      setLocalItem(STORAGE_KEYS.CHARGES, updated);
    }
    return Object.assign(newCharges, {
      success: true,
      count: newCharges.length,
      createdCount: newCharges.length,
      skippedCount,
    });
  };

  function paidAmount(charge: Charge): number {
    return charge.paidAmount ?? (charge.status === 'paid' ? charge.amount : 0);
  }

  const submitPaymentProof = async (
    proofData: Omit<PaymentProof, 'id' | 'submissionDate' | 'status'>,
  ): Promise<PaymentProof> => {
    if (proofData.bankTransactionDate !== undefined)
      proofData.bankTransactionDate = bankDate(proofData.bankTransactionDate);
    if (!proofData.amount || proofData.amount <= 0) {
      throw new Error(
        'Le montant du justificatif doit être supérieur à 0 MAD.',
      );
    }
    // Phase 3.1: Pre-compute confidence score against target Charge for 1-click batch approval
    let matchScore = 70;
    let matchStatus: PaymentProof['matchStatus'] = 'partial_match';
    let matchedChargeAmount: number | undefined;
    try {
      const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []);
      const targetCharge = charges.find((c) => c.id === proofData.chargeId);
      if (targetCharge) {
        const remaining = Math.max(
          0,
          targetCharge.amount - (targetCharge.paidAmount || 0),
        );
        matchedChargeAmount = remaining;
        if (Math.abs(proofData.amount - remaining) < 0.01) {
          matchScore =
            proofData.referenceNumber &&
            proofData.referenceNumber.trim().length >= 3
              ? 98
              : 92;
          matchStatus = 'exact_match';
        } else if (proofData.amount <= remaining) {
          matchScore = 82;
          matchStatus = 'partial_match';
        } else {
          matchScore = 45;
          matchStatus = 'unmatched';
        }
      }
    } catch {}
    const newProof: PaymentProof = {
      id: `prf-${crypto.randomUUID()}`,
      status: 'pending',
      matchScore,
      matchStatus,
      matchedChargeAmount,
      ...proofData,
      submissionDate: new Date().toISOString(),
    };
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, []);
    proofs.unshift(newProof);
    setLocalItem(STORAGE_KEYS.PROOFS, proofs);
    return newProof;
  };

  const approvePaymentProofsBatch = async (
    buildingId: string,
    proofIds?: string[],
    options: PaymentPostingOptions = {},
  ): Promise<{
    approvedCount: number;
    skippedCount: number;
    skippedProofIds: string[];
    totalAmountMad: number;
    quittances: Quittance[];
  }> => {
    if (Array.isArray(proofIds) && proofIds.length === 0) {
      return {
        approvedCount: 0,
        skippedCount: 0,
        skippedProofIds: [],
        totalAmountMad: 0,
        quittances: [],
      };
    }
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, []);
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []);
    const candidates = proofs.filter((p) => {
      if (p.buildingId !== buildingId || p.status !== 'pending') return false;
      if (Array.isArray(proofIds)) {
        return proofIds.includes(p.id);
      }
      if (
        p.matchStatus === 'exact_match' ||
        (p.matchScore && p.matchScore >= 90)
      )
        return true;
      const chg = charges.find((c) => c.id === p.chargeId);
      if (!chg) return false;
      const remainingCents = Math.max(
        0,
        centimes(chg.amount) - centimes(chg.paidAmount || 0),
      );
      return centimes(p.amount) === remainingCents;
    });
    let approvedCount = 0;
    let totalAmountCents = 0;
    const skippedProofIds: string[] = [];
    const quittances: Quittance[] = [];
    for (const cand of candidates) {
      const currentChg = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []).find(
        (c) => c.id === cand.chargeId,
      );
      const remCents = currentChg
        ? Math.max(
            0,
            centimes(currentChg.amount) - centimes(currentChg.paidAmount || 0),
          )
        : 0;
      if (centimes(cand.amount) > remCents) {
        skippedProofIds.push(cand.id);
        continue;
      }
      const res = await reviewPaymentProof(
        cand.id,
        'approved',
        undefined,
        options,
      );
      if (res.success) {
        approvedCount += 1;
        totalAmountCents += centimes(cand.amount);
        if (res.quittance) quittances.push(res.quittance);
      } else {
        skippedProofIds.push(cand.id);
      }
    }
    return {
      approvedCount,
      skippedCount: skippedProofIds.length,
      skippedProofIds,
      totalAmountMad: totalAmountCents / 100,
      quittances,
    };
  };

  const reviewPaymentProof = async (
    proofId: string,
    decision: 'approved' | 'rejected' | 'approve' | 'reject',
    rejectionReason?: string,
    options: PaymentPostingOptions = {},
  ): Promise<{
    proof: PaymentProof;
    quittance?: Quittance;
    success: boolean;
  }> => {
    const canonicalDecision =
      decision === 'approve'
        ? 'approved'
        : decision === 'reject'
          ? 'rejected'
          : decision;

    if (!['approved', 'approve', 'rejected', 'reject'].includes(decision))
      throw new Error('Décision invalide.');
    const approved = decision === 'approved' || decision === 'approve';
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, []);
    const proof = proofs.find((p) => p.id === proofId);
    if (!proof) throw new Error('Justificatif introuvable.');
    if (proof.status !== 'pending') {
      if ((proof.status === 'approved') !== approved)
        throw new Error('Ce justificatif a déjà été traité.');
      const existing = getLocalItem<Quittance[]>(
        STORAGE_KEYS.QUITTANCES,
        [],
      ).find(
        (q) =>
          q.paymentId === `proof:${proof.id}` ||
          q.id === `quit-prf-${proof.id}`,
      );
      if (!approved || existing)
        return { proof, success: true, quittance: existing };
    }
    let quittance: Quittance | undefined;
    if (approved) {
      const charge = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []).find(
        (c) => c.id === proof.chargeId,
      );
      const syndic = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []).find(
        (s) => s.id === charge?.syndicId,
      );
      const building = syndic?.buildings.find((b) => b.id === proof.buildingId);
      if (
        !charge ||
        !syndic ||
        !building ||
        charge.buildingId !== building.id ||
        charge.residentId !== proof.residentId ||
        (proof.syndicId && proof.syndicId !== syndic.id)
      )
        throw new Error('Justificatif non lié à cette charge.');
      const apartment = building.apartments.find(
        (a) => a.id === charge.apartmentId,
      );
      if (
        !apartment ||
        (proof.apartmentId && proof.apartmentId !== apartment.id) ||
        proof.apartmentNumber !== apartment.number
      ) {
        throw new Error('Lot non lié au justificatif.');
      }
      const recorded =
        proof.status === 'approved'
          ? building.financials.transactions
              .flatMap((t) => t.receiptSnapshots || [])
              .find(
                (q) =>
                  q.paymentId === `proof:${proof.id}` &&
                  q.chargeId === charge.id &&
                  q.buildingId === building.id &&
                  q.syndicId === syndic.id,
              )
          : undefined;
      if (recorded) {
        // Receipt recovery does not post again, including after its period closes.
        quittance = await createQuittance({
          ...recorded,
          addTransactionToLedger: false,
        });
      } else {
        const dates = paymentDates(
          context,
          building.id,
          proof.bankTransactionDate ??
            (proof as PaymentProof & { date?: string }).date,
          proof.submissionDate,
          options,
        );
        quittance = await createQuittance({
          ...dates,
          paymentId: `proof:${proof.id}`,
          chargeId: charge.id,
          buildingId: building.id,
          buildingName: building.name,
          syndicId: syndic.id,
          syndicName: syndic.name,
          residentId: proof.residentId,
          residentName:
            building.residents.find((r) => r.id === proof.residentId)?.name ||
            proof.residentName,
          apartmentId: apartment.id,
          apartmentNumber: apartment.number,
          amount: proof.amount,
          paymentDate: dates.bankTransactionDate ?? proof.submissionDate,
          paymentMethod: proof.paymentMethod,
          periodCovered: charge.period || '',
          bankName: proof.bankName,
          referenceNumber: proof.referenceNumber,
          addTransactionToLedger: true,
        });
      }
    }
    // Validation/posting must finish before the proof becomes approved.
    if (quittance) {
      proof.bankTransactionDate = quittance.bankTransactionDate;
      proof.postingDate = quittance.postingDate;
      proof.priorPeriodAdjustmentReason = quittance.priorPeriodAdjustmentReason;
    }
    proof.status = approved ? 'approved' : 'rejected';
    proof.reviewedAt = new Date().toISOString();
    if (!approved) proof.rejectionReason = rejectionReason;
    setLocalItem(STORAGE_KEYS.PROOFS, proofs);
    return { proof, quittance, success: true };
  };

  const createQuittance = async (
    input: CreateQuittanceCommand,
  ): Promise<Quittance> => {
    if (
      input.addTransactionToLedger !== undefined &&
      typeof input.addTransactionToLedger !== 'boolean'
    ) {
      throw new Error('Mode de comptabilisation invalide.');
    }
    if (
      input.paymentId !== undefined &&
      (typeof input.paymentId !== 'string' ||
        !input.paymentId.trim() ||
        input.paymentId.length > 3000)
    ) {
      throw new Error('Référence de paiement invalide.');
    }
    const { addTransactionToLedger = true, ...core } = input;
    const amount = centimes(core.amount);
    if (amount <= 0) throw new Error('Montant du paiement invalide.');
    const receipts = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, []);
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    const building = syndics
      .find((s) => s.id === core.syndicId)
      ?.buildings.find((b) => b.id === core.buildingId);
    if (!building) throw new Error('Immeuble hors du cabinet.');
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []);
    const matches = charges.filter(
      (c) =>
        c.buildingId === core.buildingId &&
        c.syndicId === core.syndicId &&
        c.residentId === core.residentId &&
        (!core.apartmentId || c.apartmentId === core.apartmentId) &&
        (core.chargeId
          ? c.id === core.chargeId
          : normalizeBillingPeriodKey(c.period || '') ===
            normalizeBillingPeriodKey(core.periodCovered)),
    );
    const charge = matches.length === 1 ? matches[0] : undefined;
    if (!charge)
      throw new Error('Sélectionnez une charge unique liée à ce paiement.');
    const lot = building.apartments.find((a) => a.id === charge.apartmentId);
    if (
      !building.residents.some((r) => r.id === core.residentId) ||
      !lot ||
      lot.number !== core.apartmentNumber
    ) {
      throw new Error('Copropriétaire ou lot non lié à cette charge.');
    }
    core.chargeId = charge.id;
    core.amount = amount / 100;
    const paymentId = addTransactionToLedger
      ? core.paymentId ||
        (core.referenceNumber?.trim()
          ? `manual:${core.buildingId}:${charge.id}:${core.paymentMethod}:${core.referenceNumber.trim()}`
          : undefined)
      : core.paymentId;
    if (addTransactionToLedger && !paymentId)
      throw new Error('Référence unique de paiement obligatoire.');
    if (
      paymentId &&
      building.financials.transactions.some(
        (t: any) => t.reversalOf === paymentId,
      )
    )
      throw new Error(
        'Paiement contrepassé : enregistrez un nouveau règlement.',
      );
    const scoped = receipts.filter(
      (q) => !q.voidedAt && receiptScope(q, building, charge),
    );
    const candidates = scoped.filter((q) =>
      paymentId ? q.paymentId === paymentId : centimes(q.amount) === amount,
    );
    if (candidates.length > 1)
      throw new Error(
        'Plusieurs reçus historiques : sélectionnez le reçu original.',
      );
    const existing = candidates[0];
    if (existing) {
      if (
        existing.residentId !== core.residentId ||
        centimes(existing.amount) !== amount ||
        existing.paymentMethod !== core.paymentMethod
      ) {
        throw new Error(
          'Référence de paiement déjà utilisée avec des données différentes.',
        );
      }
      if (
        existing.paymentId &&
        building.financials.transactions.some(
          (t) => t.reversalOf === existing.paymentId,
        )
      ) {
        throw new Error('Paiement contrepassé : reçu annulé.');
      }
      return existing;
    }
    const posted = building.financials.transactions.filter(
      (t) => paymentId && t.paymentId === paymentId,
    );
    const snapshots = building.financials.transactions
      .filter(
        (t) => t.type === 'income' && (!paymentId || t.paymentId === paymentId),
      )
      .flatMap((t) => t.receiptSnapshots || [])
      .filter(
        (q) =>
          receiptScope(q, building, charge) && centimes(q.amount) === amount,
      );
    const saved = [...new Map(snapshots.map((q) => [q.id, q])).values()];
    if (saved.length > 1)
      throw new Error('Sélectionnez la référence du paiement enregistré.');
    const original = saved[0];
    if (original) {
      if (
        scoped.some((q) => !q.paymentId) ||
        receipts.some((q) => q.id === original.id && q.voidedAt)
      ) {
        throw new Error(
          'Reçu historique non lié ou annulé : rapprochement nécessaire.',
        );
      }
      const rows = building.financials.transactions.filter(
        (t) => t.paymentId === original.paymentId,
      );
      if (
        original.voidedAt ||
        original.residentId !== core.residentId ||
        original.paymentMethod !== core.paymentMethod ||
        building.financials.transactions.some(
          (t) => t.reversalOf === original.paymentId,
        ) ||
        allocationAmount(rows, charge.id) !== amount
      ) {
        throw new Error('Paiement ou ventilation du reçu non valide.');
      }
      assertReceiptCapacity(receipts, building, charge, amount);
      setLocalItem(STORAGE_KEYS.QUITTANCES, [original, ...receipts]);
      return original;
    }
    if (!addTransactionToLedger || posted.length) {
      throw new Error(
        'Aucun paiement suffisant avec reçu canonique enregistré : rapprochement nécessaire.',
      );
    }
    if (core.quittanceNumber)
      throw new Error(
        'La numérotation des quittances est réservée au serveur.',
      );
    if (
      core.bankTransactionDate !== undefined ||
      core.postingDate !== undefined
    ) {
      Object.assign(
        core,
        paymentDates(
          context,
          building.id,
          core.bankTransactionDate,
          core.submissionDate ?? new Date().toISOString(),
          core,
        ),
      );
    } else if (addTransactionToLedger) {
      bankDate(core.paymentDate);
    }
    assertReceiptCapacity(receipts, building, charge);
    let split: ReturnType<typeof getRecordedReserveSplit>;
    const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    if (addTransactionToLedger && !posted.length) {
      if (amount > outstanding(charge))
        throw new Error('Le paiement dépasse le solde restant de la charge.');
      const linked = invoices.filter(
        (i) => i.chargeIds.includes(charge.id) && i.status !== 'cancelled',
      );
      if (linked.length > 1)
        throw new Error(
          'Plusieurs factures couvrent cette charge : rapprochement nécessaire.',
        );
      const invoice = linked[0];
      if (
        invoice &&
        (invoice.syndicId !== core.syndicId ||
          invoice.buildingId !== core.buildingId ||
          invoice.residentId !== core.residentId ||
          amount >
            centimes(invoice.totalAmount) - centimes(invoice.paidAmount ?? 0))
      ) {
        throw new Error('Facture liée incompatible avec ce paiement.');
      }
      charge.paidAmount = (centimes(paidAmount(charge)) + amount) / 100;
      charge.status = resolveOpenStatus(charge.dueDate, outstanding(charge));
      charge.paidAt = core.paymentDate;
      charge.paymentMethod = core.paymentMethod;
      if (invoice) {
        invoice.paidAmount = (centimes(invoice.paidAmount ?? 0) + amount) / 100;
        invoice.status = resolveOpenStatus(
          invoice.dueDate,
          centimes(invoice.totalAmount) - centimes(invoice.paidAmount),
        );
        invoice.paymentIds = [...(invoice.paymentIds || []), paymentId!];
        charge.invoiceId = invoice.id;
      }
      split = postIncome(building, core.amount, paymentId!, {
        reserveRateOverride: resolveChargeReserveRate(building, charge),
        sourceChargeId: charge.id,
        sourceInvoiceId: invoice?.id,
        date: core.postingDate ?? core.paymentDate,
        ...(core.postingDate
          ? {
              bankTransactionDate: core.bankTransactionDate,
              postingDate: core.postingDate,
              submissionDate: core.submissionDate,
              priorPeriodAdjustmentReason: core.priorPeriodAdjustmentReason,
            }
          : {}),
        paymentMethod: core.paymentMethod,
        reference: core.referenceNumber,
        description: `Paiement lot ${lot.number}`,
        documentType: 'quittance',
      });
    }
    if (
      allocationAmount(
        building.financials.transactions.filter(
          (t) => t.paymentId === paymentId,
        ),
        charge.id,
      ) !== amount ||
      !split
    ) {
      throw new Error('Encaissement non confirmé.');
    }
    assertReceiptCapacity(receipts, building, charge, amount);
    const receipt = numberedReceipt(
      { ...core, paymentId },
      split,
      receipts,
      syndics,
    );
    building.financials.transactions.find(
      (t) => t.paymentId === paymentId,
    )!.receiptSnapshots = [receipt];
    if (core.priorPeriodAdjustmentReason) {
      (context.state.syndik_prod_audit_v1 ??= []).push({
        id: crypto.randomUUID(),
        actorUid: context.actor.uid,
        actorRole: context.actor.role,
        syndicId: core.syndicId,
        buildingId: core.buildingId,
        operation: 'priorPeriodPaymentAdjustment',
        createdAt: new Date().toISOString(),
        detail: {
          paymentId,
          bankTransactionDate: core.bankTransactionDate,
          postingDate: core.postingDate,
          reason: core.priorPeriodAdjustmentReason,
        },
      });
    }
    setLocalItem(STORAGE_KEYS.CHARGES, charges);
    setLocalItem(STORAGE_KEYS.INVOICES, invoices);
    setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
    setLocalItem(STORAGE_KEYS.QUITTANCES, [receipt, ...receipts]);
    return receipt;
  };

  function receiptScope(
    receipt: Quittance,
    building: Building,
    charge: Charge,
  ) {
    return (
      receipt.buildingId === building.id &&
      receipt.syndicId === building.syndicId &&
      receipt.chargeId === charge.id
    );
  }

  function allocationAmount(
    rows: Transaction[],
    chargeId: string,
  ): number | undefined {
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.type !== 'income' ||
          !Number.isFinite(row.amount) ||
          row.amount < 0,
      )
    )
      return undefined;
    const total = rows.reduce((sum, row) => sum + centimes(row.amount), 0);
    if (rows.every((row) => row.sourceChargeId === chargeId)) return total;
    const allocations = rows[0].paymentAllocations;
    if (
      !allocations ||
      rows.some(
        (row) =>
          JSON.stringify(row.paymentAllocations) !==
          JSON.stringify(allocations),
      ) ||
      new Set(allocations.map((a) => a.chargeId)).size !== allocations.length ||
      allocations.reduce((sum, a) => sum + centimes(a.amount), 0) !== total
    )
      return undefined;
    const allocation = allocations.find((a) => a.chargeId === chargeId);
    return allocation ? centimes(allocation.amount) : undefined;
  }

  function assertReceiptCapacity(
    receipts: Quittance[],
    building: Building,
    charge: Charge,
    additional = 0,
  ) {
    const receipted = receipts
      .filter((q) => !q.voidedAt && receiptScope(q, building, charge))
      .reduce((sum, q) => sum + centimes(q.amount), 0);
    const journal = building.financials.transactions;
    const reversed = new Set(
      journal.map((row) => row.reversalOf).filter(Boolean),
    );
    const payments = new Map<string, Transaction[]>();
    for (const row of journal)
      if (
        row.type === 'income' &&
        row.paymentId &&
        !reversed.has(row.paymentId)
      ) {
        const rows = payments.get(row.paymentId) || [];
        rows.push(row);
        payments.set(row.paymentId, rows);
      }
    const verified = [...payments.values()].reduce(
      (sum, rows) => sum + (allocationAmount(rows, charge.id) ?? 0),
      0,
    );
    if (
      receipted + additional >
      Math.min(centimes(paidAmount(charge)), verified)
    ) {
      throw new Error(
        'Montant déjà quittancé : rapprochez les reçus et les paiements enregistrés.',
      );
    }
  }

  function outstanding(charge: Charge): number {
    return Math.max(0, centimes(charge.amount) - centimes(paidAmount(charge)));
  }

  function postIncome(
    building: Building,
    amount: number,
    paymentId: string,
    details: PostIncomeCommand['details'],
  ) {
    PostIncomeSchema.parse({
      buildingId: building.id,
      amount,
      paymentId,
      details,
    });
    const { reserveRateOverride, reserveSplitOverride, ...txDetails } = details;
    const split = reserveSplitOverride
      ? (() => {
          const totalCents = centimes(amount);
          const courantCents = centimes(reserveSplitOverride.chargesCourantesAmount);
          const reserveCents = centimes(reserveSplitOverride.reserveFundAmount);
          if (courantCents + reserveCents !== totalCents) {
            throw new Error('Ventilation réserve / courant incohérente.');
          }
          return {
            chargesCourantesAmount: courantCents / 100,
            reserveFundAmount: reserveCents / 100,
            reservePercentageUsed: reserveSplitOverride.reservePercentageUsed,
          };
        })()
      : splitChargeReserveAndOperating(
          amount,
          reserveRateOverride ?? getBuildingReserveRate(building),
        );
    building.financials.transactions ||= [];
    for (const [fundType, value] of [
      ['courant', split.chargesCourantesAmount],
      ['reserve', split.reserveFundAmount],
    ] as const) {
      if (value === 0) continue;
      building.financials.transactions.unshift({
        ...txDetails,
        ...(split.reservePercentageUsed !== undefined
          ? { reserveRateApplied: split.reservePercentageUsed }
          : {}),
        id: `trx-${paymentId}-${fundType}`,
        paymentId,
        date: txDetails.date || new Date().toISOString(),
        description: txDetails.description || 'Encaissement',
        amount: value,
        type: 'income',
        category: 'fees',
        fundType,
      });
    }
    syncBuildingFinancialBalances(building);
    return split;
  }

  function numberedReceipt(
    core: Omit<Quittance, 'id' | 'quittanceNumber' | 'createdAt'>,
    split: NonNullable<ReturnType<typeof getRecordedReserveSplit>>,
    receipts: Quittance[],
    syndics: Syndic[],
  ): Quittance {
    // Include the durable journal snapshots: deleting a receipt document must never free its number.
    const prefix = `QUIT-${new Date().getFullYear()}-`;
    const history = [
      ...receipts,
      ...syndics.flatMap((s) =>
        (s.buildings || []).flatMap((b) =>
          (b.financials?.transactions || []).flatMap(
            (row) => row.receiptSnapshots || [],
          ),
        ),
      ),
    ];
    const max = history
      .filter(
        (q) =>
          q.syndicId === core.syndicId &&
          typeof q.quittanceNumber === 'string' &&
          q.quittanceNumber.startsWith(prefix),
      )
      .reduce((n, q) => {
        const sequence = Number(q.quittanceNumber.slice(prefix.length));
        return Number.isSafeInteger(sequence) && sequence >= 0
          ? Math.max(n, sequence)
          : n;
      }, 0);
    if (!Number.isSafeInteger(max + 1))
      throw new Error(
        'Séquence de quittance invalide : rapprochement nécessaire.',
      );
    return {
      ...core,
      reserveRateApplied: split.reservePercentageUsed,
      reserveFundAmount: split.reserveFundAmount,
      chargesCourantesAmount: split.chargesCourantesAmount,
      id: `quit-${[core.buildingId, core.paymentId!, core.chargeId].map(encodeURIComponent).join(':')}`,
      quittanceNumber: `${prefix}${String(max + 1).padStart(5, '0')}`,
      createdAt: new Date().toISOString(),
    };
  }

  const reconcileBankStatementCSV = async (
    buildingId: string,
    rows: BankStatementCSVRow[],
    options: PaymentPostingOptions & { preview?: boolean } = {},
  ): Promise<{
    preview: Array<{
      bankTransactionDate?: string;
      postingDate?: string;
      amount: number;
      label: string;
    }>;
    matchedCount: number;
    unmatchedCount: number;
    unmatchedRows?: Array<{
      date: string;
      amount: number;
      label: string;
      reference?: string;
      reason: 'non_positive' | 'duplicate' | 'no_match' | 'ambiguous';
      candidates?: Array<{
        chargeId?: string;
        invoiceId?: string;
        invoiceNumber?: string;
        residentId: string;
        residentName: string;
        apartmentNumber: string;
        remainingAmount: number;
      }>;
    }>;
    totalReconciledMad: number;
    quittances: Quittance[];
  }> => {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    let targetBuilding: Building | undefined;
    let targetSyndic: Syndic | undefined;
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        targetBuilding = bld;
        targetSyndic = s;
        break;
      }
    }
    if (!targetBuilding) {
      throw new Error('Immeuble introuvable pour le rapprochement bancaire.');
    }
    const submittedAt = new Date().toISOString();
    // Validate every row's bank date upfront; apply accounting-period checks only to posted credit rows.
    const datedRows = rows.map((row) => {
      const parsedBankDate = bankDate(row.date);
      const rawAmt = Number(row.amount);
      const isPositiveCredit = Number.isFinite(rawAmt) && Math.round(rawAmt * 100) > 0;
      const dates = isPositiveCredit
        ? paymentDates(context, buildingId, parsedBankDate, submittedAt, options)
        : { bankTransactionDate: parsedBankDate, submissionDate: submittedAt };
      return { row, dates };
    });
    const preview = datedRows.map(({ row, dates }) => ({
      bankTransactionDate: dates.bankTransactionDate,
      postingDate: dates.postingDate,
      amount: row.amount,
      label: row.label,
    }));
    if (options.preview)
      return {
        preview,
        matchedCount: 0,
        unmatchedCount: 0,
        totalReconciledMad: 0,
        quittances: [],
      };
    const openInvoices = () =>
      getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []).filter(
        (inv) =>
          inv.buildingId === buildingId &&
          inv.status !== 'paid' &&
          inv.status !== 'cancelled' &&
          centimes(inv.totalAmount) - centimes(inv.paidAmount ?? 0) > 0,
      );
    const existingProofs = getLocalItem<PaymentProof[]>(
      STORAGE_KEYS.PROOFS,
      [],
    ).filter((p) => p.buildingId === buildingId && p.status !== 'rejected');
    const reversedPaymentIds = new Set(
      (targetBuilding.financials?.transactions || [])
        .map((t) => t.reversalOf)
        .filter((id): id is string => Boolean(id)),
    );
    const seenBankEventKeys = new Set<string>([
      ...existingProofs
        .map((p) => (p.referenceNumber || '').trim().toUpperCase())
        .filter(Boolean),
      ...(targetBuilding.financials?.transactions || [])
        .filter(
          (t) =>
            t.type === 'income' &&
            t.reference &&
            (!t.paymentId || !reversedPaymentIds.has(t.paymentId)),
        )
        .map((t) => t.reference!.trim().toUpperCase())
        .filter(Boolean),
      ...(targetBuilding.financials?.transactions || [])
        .filter(
          (t) =>
            t.type === 'income' &&
            t.paymentId &&
            !reversedPaymentIds.has(t.paymentId),
        )
        .map((t) => t.paymentId!.trim().toUpperCase())
        .filter(Boolean),
    ]);
    let matchedCount = 0;
    let unmatchedCount = 0;
    let totalReconciledMad = 0;
    const generatedQuittances: Quittance[] = [];
    const unmatchedRows: Array<{
      date: string;
      amount: number;
      label: string;
      reference?: string;
      reason: 'non_positive' | 'duplicate' | 'no_match' | 'ambiguous';
      candidates?: Array<{
        chargeId?: string;
        invoiceId?: string;
        invoiceNumber?: string;
        residentId: string;
        residentName: string;
        apartmentNumber: string;
        remainingAmount: number;
      }>;
    }> = [];
    const batchKeyOccurrences = new Map<string, number>();

    const tokenMatch = (label: string, value: string) => {
      const escaped = value
        .trim()
        .toUpperCase()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (
        escaped.length > 0 &&
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,
          'u',
        ).test(label)
      );
    };
    const lotMatch = (label: string, aptNumber: string) => {
      const clean = aptNumber.trim().toUpperCase();
      if (!clean) return false;
      const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (/^\d{1,2}$/.test(clean)) {
        return (
          label.trim() === clean ||
          new RegExp(
            `(^|[^\\p{L}\\p{N}])(?:LOT|APT|APP(?:ARTEMENT)?|STUDIO|VILLA|BOX|PARKING|N°|NO|#)\\s*0*${escaped}($|[^\\p{L}\\p{N}])`,
            'u',
          ).test(label)
        );
      }
      return tokenMatch(label, clean);
    };

    for (const { row, dates } of datedRows) {
      const rawAmt = Number(row.amount);
      // Reject non-positive (debit/zero/NaN) rows — never Math.abs() a bank debit into an income receipt
      if (!Number.isFinite(rawAmt) || rawAmt <= 0) {
        unmatchedCount += 1;
        unmatchedRows.push({
          date: dates.bankTransactionDate || row.date,
          amount: Number.isFinite(rawAmt) ? rawAmt : 0,
          label: row.label,
          reference: row.reference,
          reason: 'non_positive',
        });
        continue;
      }
      const cleanAmt = Math.round(rawAmt * 100) / 100;
      const cleanAmtCents = Math.round(cleanAmt * 100);
      if (cleanAmtCents <= 0) {
        unmatchedCount += 1;
        unmatchedRows.push({
          date: dates.bankTransactionDate || row.date,
          amount: 0,
          label: row.label,
          reference: row.reference,
          reason: 'non_positive',
        });
        continue;
      }
      const upperLabel = (row.label || '').trim().toUpperCase();
      const cleanRef = (row.reference || '').trim().toUpperCase();
      let bankEventKey: string;
      if (cleanRef) {
        bankEventKey = cleanRef;
      } else {
        const baseKey = `CSV-${buildingId}-${dates.bankTransactionDate}-${cleanAmt.toFixed(2)}-${upperLabel.replace(/[^A-Z0-9]/g, '_').slice(0, 48)}`;
        const count = (batchKeyOccurrences.get(baseKey) || 0) + 1;
        batchKeyOccurrences.set(baseKey, count);
        bankEventKey = count === 1 ? baseKey : `${baseKey}#${count}`;
      }
      // Bank-event idempotency: never reconcile the same bank row twice across repeated imports or within the same file
      if (seenBankEventKeys.has(bankEventKey)) {
        unmatchedCount += 1;
        unmatchedRows.push({
          date: dates.bankTransactionDate || row.date,
          amount: cleanAmt,
          label: row.label,
          reference: row.reference,
          reason: 'duplicate',
        });
        continue;
      }

      // Priority 1: Match explicit invoice number (e.g. FAC-2026-0001) in label or reference
      const matchingInvoices = openInvoices().filter((inv) => {
        const invNum = (inv.invoiceNumber || '').trim().toUpperCase();
        if (!invNum) return false;
        const remainingInvCents =
          centimes(inv.totalAmount) - centimes(inv.paidAmount ?? 0);
        if (remainingInvCents < cleanAmtCents) return false;
        return (
          cleanRef === invNum ||
          tokenMatch(upperLabel, invNum) ||
          (cleanRef.length > 0 && tokenMatch(cleanRef, invNum))
        );
      });
      if (matchingInvoices.length === 1) {
        const matchedInv = matchingInvoices[0];
        seenBankEventKeys.add(bankEventKey);
        await recordPayment(
          matchedInv,
          cleanAmt,
          'virement',
          bankEventKey,
          {
            ...options,
            bankTransactionDate: dates.bankTransactionDate,
          },
        );
        const createdReceipts = getLocalItem<Quittance[]>(
          STORAGE_KEYS.QUITTANCES,
          [],
        ).filter(
          (q) =>
            q.buildingId === buildingId &&
            !q.voidedAt &&
            q.paymentId === bankEventKey,
        );
        generatedQuittances.push(...createdReceipts);
        matchedCount += 1;
        totalReconciledMad =
          Math.round((totalReconciledMad + cleanAmt) * 100) / 100;
        continue;
      }

      const openCharges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []).filter(
        (c) =>
          c.buildingId === buildingId &&
          c.status !== 'paid' &&
          outstanding(c) > 0,
      );

      // Priority 2: Exact single-charge match by lot number or resident name
      const exactAmountCharges = openCharges.filter(
        (c) => outstanding(c) === cleanAmtCents,
      );
      const exactLots = exactAmountCharges.filter((c) =>
        lotMatch(
          upperLabel,
          targetBuilding!.apartments.find((a) => a.id === c.apartmentId)
            ?.number || '',
        ),
      );
      const exactNames = exactLots.length
        ? exactLots
        : exactAmountCharges.filter((c) => {
            const name =
              targetBuilding!.residents.find((r) => r.id === c.residentId)
                ?.name || '';
            return name.trim().length >= 3 && tokenMatch(upperLabel, name);
          });
      const matchedCharge = exactNames.length === 1 ? exactNames[0] : undefined;
      if (matchedCharge) {
        seenBankEventKeys.add(bankEventKey);
        const apt = targetBuilding.apartments.find(
          (a) => a.id === matchedCharge.apartmentId,
        );
        const res = targetBuilding.residents.find(
          (r) => r.id === matchedCharge.residentId,
        );
        const submitted = await submitPaymentProof({
          bankTransactionDate: dates.bankTransactionDate,
          chargeId: matchedCharge.id,
          buildingId,
          syndicId: targetSyndic?.id,
          residentId: matchedCharge.residentId,
          residentName: res?.name || 'Copropriétaire',
          apartmentId: matchedCharge.apartmentId,
          apartmentNumber: apt?.number || 'Lot',
          amount: cleanAmt,
          paymentMethod: 'virement',
          bankName:
            row.bankName || targetBuilding.bankName || 'Banque Copropriété',
          referenceNumber: bankEventKey,
          receiptNote: `Rapprochement CSV bancaire : ${row.label}`,
        });
        const approved = await reviewPaymentProof(
          submitted.id,
          'approved',
          undefined,
          options,
        );
        if (approved.quittance) generatedQuittances.push(approved.quittance);
        matchedCount += 1;
        totalReconciledMad =
          Math.round((totalReconciledMad + cleanAmt) * 100) / 100;
        continue;
      }

      // Priority 3: Unambiguous multi-charge combined transfer for a single lot/resident (oldest-first prefix sum)
      const lotScopedOpen = openCharges.filter((c) =>
        lotMatch(
          upperLabel,
          targetBuilding!.apartments.find((a) => a.id === c.apartmentId)
            ?.number || '',
        ),
      );
      const scopedOpen = lotScopedOpen.length
        ? lotScopedOpen
        : openCharges.filter((c) => {
            const name =
              targetBuilding!.residents.find((r) => r.id === c.residentId)
                ?.name || '';
            return name.trim().length >= 3 && tokenMatch(upperLabel, name);
          });
      const distinctResidents = new Set(scopedOpen.map((c) => c.residentId));
      let multiMatched: Charge[] | undefined;
      if (scopedOpen.length > 1 && distinctResidents.size === 1) {
        const sorted = [...scopedOpen].sort((a, b) =>
          String(a.dueDate || a.createdAt).localeCompare(
            String(b.dueDate || b.createdAt),
          ),
        );
        let running = 0;
        const prefix: Charge[] = [];
        for (const chg of sorted) {
          running += outstanding(chg);
          prefix.push(chg);
          if (running === cleanAmtCents) {
            multiMatched = prefix;
            break;
          }
          if (running > cleanAmtCents) break;
        }
      }

      if (multiMatched && multiMatched.length > 1) {
        seenBankEventKeys.add(bankEventKey);
        for (let idx = 0; idx < multiMatched.length; idx += 1) {
          const chg = multiMatched[idx];
          const chgRem = outstanding(chg) / 100;
          const apt = targetBuilding.apartments.find(
            (a) => a.id === chg.apartmentId,
          );
          const res = targetBuilding.residents.find(
            (r) => r.id === chg.residentId,
          );
          const subRef = `${bankEventKey}-${idx + 1}`;
          seenBankEventKeys.add(subRef);
          const submitted = await submitPaymentProof({
            bankTransactionDate: dates.bankTransactionDate,
            chargeId: chg.id,
            buildingId,
            syndicId: targetSyndic?.id,
            residentId: chg.residentId,
            residentName: res?.name || 'Copropriétaire',
            apartmentId: chg.apartmentId,
            apartmentNumber: apt?.number || 'Lot',
            amount: chgRem,
            paymentMethod: 'virement',
            bankName:
              row.bankName || targetBuilding.bankName || 'Banque Copropriété',
            referenceNumber: subRef,
            receiptNote: `Rapprochement CSV multi-échéances : ${row.label}`,
          });
          const approved = await reviewPaymentProof(
            submitted.id,
            'approved',
            undefined,
            options,
          );
          if (approved.quittance) generatedQuittances.push(approved.quittance);
        }
        matchedCount += 1;
        totalReconciledMad =
          Math.round((totalReconciledMad + cleanAmt) * 100) / 100;
        continue;
      }

      // Unmatched: surface structured diagnostics + candidate suggestions for manual reconciliation
      unmatchedCount += 1;
      const candidatePool =
        exactNames.length > 1
          ? exactNames
          : scopedOpen.length > 0
            ? scopedOpen
            : exactAmountCharges;
      const reason: 'ambiguous' | 'no_match' =
        exactNames.length > 1 || matchingInvoices.length > 1
          ? 'ambiguous'
          : 'no_match';
      unmatchedRows.push({
        date: dates.bankTransactionDate || row.date,
        amount: cleanAmt,
        label: row.label,
        reference: row.reference,
        reason,
        candidates: candidatePool.slice(0, 5).map((c) => {
          const apt = targetBuilding!.apartments.find(
            (a) => a.id === c.apartmentId,
          );
          const res = targetBuilding!.residents.find(
            (r) => r.id === c.residentId,
          );
          return {
            chargeId: c.id,
            residentId: c.residentId,
            residentName: res?.name || 'Copropriétaire',
            apartmentNumber: apt?.number || 'Lot',
            remainingAmount: outstanding(c) / 100,
          };
        }),
      });
    }
    return {
      preview,
      matchedCount,
      unmatchedCount,
      unmatchedRows,
      totalReconciledMad,
      quittances: generatedQuittances,
    };
  };

  const generateQuittanceForCharge = async (
    chargeOrId: Charge | string,
    buildingIdOrPaymentMethod: string = 'virement',
    referenceNumber?: string,
    bankName?: string,
  ): Promise<Quittance> => {
    const chargeId =
      typeof chargeOrId === 'string' ? chargeOrId : chargeOrId.id;
    const charge = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []).find(
      (c) => c.id === chargeId,
    );
    if (!charge) throw new Error('Charge introuvable');
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    const building = syndics
      .find((s) => s.id === charge.syndicId)
      ?.buildings.find((b) => b.id === charge.buildingId);
    if (!building) throw new Error('Immeuble introuvable');
    const receipts = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, []);
    const existing = receipts.find(
      (q) => !q.voidedAt && receiptScope(q, building, charge),
    );
    const saved = building.financials.transactions
      .filter(
        (t) =>
          t.type === 'income' &&
          !building.financials.transactions.some(
            (reversal) => reversal.reversalOf === t.paymentId,
          ),
      )
      .flatMap((t) => t.receiptSnapshots || [])
      .find((q) => receiptScope(q, building, charge));
    const original = existing || saved;
    if (!original)
      throw new Error(
        'Reçu original introuvable : rapprochez le paiement avant toute émission.',
      );
    return createQuittance({ ...original, addTransactionToLedger: false });
  };

  // ==========================================
  // 10. FINANCIAL TRANSACTIONS & INVOICES (Audit Items 04, 15, 25)
  // ==========================================
  const addTransaction = async (
    buildingId: string,
    transaction: Omit<Transaction, 'id'>,
  ) => {
    const signedAmount =
      transaction.type === 'expense'
        ? -Math.abs(transaction.amount)
        : transaction.type === 'income'
          ? Math.abs(transaction.amount)
          : transaction.amount;
    const newTrx: Transaction = {
      id: `trx-${randomUUID()}`,
      ...transaction,
      amount: Math.round(signedAmount * 100) / 100,
      type: signedAmount >= 0 ? 'income' : 'expense',
    };
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        bld.financials.transactions = bld.financials.transactions || [];
        const balances = computeBuildingFinancialBalances(bld);
        const targetFund =
          transaction.fundType === 'reserve' ? 'reserve' : 'courant';
        const currentFundBalance =
          targetFund === 'reserve'
            ? balances.reserveBalance
            : balances.workingBalance;
        const projectedCents =
          Math.round(currentFundBalance * 100) + Math.round(newTrx.amount * 100);
        if (newTrx.type === 'expense' && projectedCents < 0) {
          const overrideReason = transaction.overdraftOverrideReason?.trim();
          if (!overrideReason || overrideReason.length < 3) {
            throw new OperationError(
              'Solde du fonds insuffisant pour cette dépense. Fournissez un motif de dérogation explicite.',
              409,
              'INSUFFICIENT_FUND_BALANCE',
            );
          }
          newTrx.overdraftOverrideReason = overrideReason;
          (context.state.syndik_prod_audit_v1 ??= []).push({
            id: randomUUID(),
            actorUid: context.actor.uid,
            actorRole: context.actor.role,
            syndicId: bld.syndicId,
            buildingId: bld.id,
            operation: 'overdraftExpenseOverride',
            createdAt: new Date().toISOString(),
            detail: {
              transactionId: newTrx.id,
              fundType: targetFund,
              amount: Math.abs(newTrx.amount),
              availableBalance: currentFundBalance,
              projectedBalance: projectedCents / 100,
              reason: overrideReason,
            },
          });
        } else {
          delete newTrx.overdraftOverrideReason;
        }
        bld.financials.transactions.unshift(newTrx);
        // Separate operating fund vs mandatory reserve fund (Law 106-12)
        syncBuildingFinancialBalances(bld);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        return newTrx;
      }
    }
  };

  const createInvoiceForResident = async (
    residentId: string,
    buildingId: string,
    syndicId: string,
  ): Promise<Invoice> => {
    const building = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, [])
      .find((s) => s.id === syndicId)
      ?.buildings.find((b) => b.id === buildingId);
    if (!building?.residents.some((r) => !r.archivedAt && r.id === residentId))
      throw new OperationError(
        'Copropriétaire hors de cet immeuble.',
        400,
        'BILLING_PAYER_INVALID',
      );
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []);
    const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const eligible = charges.filter(
      (c) =>
        c.syndicId === syndicId &&
        c.buildingId === buildingId &&
        c.residentId === residentId &&
        !c.invoiceId &&
        outstanding(c) > 0,
    );
    if (!eligible.length) {
      const existing = invoices.find(
        (i) =>
          i.syndicId === syndicId &&
          i.buildingId === buildingId &&
          i.residentId === residentId &&
          i.status !== 'paid' &&
          i.status !== 'cancelled',
      );
      if (existing) return existing;
      throw new OperationError(
        'Aucune nouvelle charge impayée à facturer.',
        409,
        'NO_BILLABLE_CHARGES',
      );
    }
    const year = new Date().getFullYear();
    const yearPrefix = `FAC-${year}-`;
    const nextInvoiceSeq =
      invoices
        .filter(
          (i) =>
            i.syndicId === syndicId &&
            typeof i.invoiceNumber === 'string' &&
            i.invoiceNumber.startsWith(yearPrefix),
        )
        .reduce(
          (max, i) =>
            Math.max(max, Number(i.invoiceNumber.slice(yearPrefix.length)) || 0),
          0,
        ) + 1;
    const invoice: Invoice = {
      id: `inv-${crypto.randomUUID()}`,
      syndicId,
      buildingId,
      residentId,
      invoiceNumber: `${yearPrefix}${String(nextInvoiceSeq).padStart(4, '0')}`,
      totalAmount: eligible.reduce((sum, c) => sum + outstanding(c), 0) / 100,
      paidAmount: 0,
      status: 'unpaid',
      createdAt: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      chargeIds: eligible.map((c) => c.id),
      items: eligible.map((c) => ({
        description: c.description || 'Charges de copropriété',
        period: c.period ?? c.periodKey ?? '',
        amount: outstanding(c) / 100,
      })),
      issuedTo: Object.fromEntries(
        Object.entries(
          building.residents.find((r) => r.id === residentId)!,
        ).filter(([key]) =>
          ['name', 'email', 'phone', 'cin', 'isOwner'].includes(key),
        ),
      ) as any,
    };
    for (const charge of eligible) charge.invoiceId = invoice.id;
    setLocalItem(STORAGE_KEYS.CHARGES, charges);
    setLocalItem(STORAGE_KEYS.INVOICES, [invoice, ...invoices]);
    return invoice;
  };

  const recordPayment = async (
    invoice: Invoice,
    amount: number,
    method: string,
    paymentReference?: string,
    options: PaymentPostingOptions = {},
  ) => {
    const cents = centimes(amount);
    if (cents <= 0) throw new Error('Montant invalide.');
    const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const current = invoices.find((i) => i.id === invoice.id);
    if (!current || current.status === 'cancelled')
      throw new Error('Facture introuvable ou annulée.');
    const paymentId = paymentReference || `invoice:${crypto.randomUUID()}`;
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    const building = syndics
      .find((s) => s.id === current.syndicId)
      ?.buildings.find((b) => b.id === current.buildingId);
    if (!building) throw new Error('Immeuble hors du cabinet.');
    const previous = building.financials.transactions.filter(
      (t) => t.paymentId === paymentId,
    );
    if (previous.length) {
      if (
        previous.some(
          (t) => t.sourceInvoiceId !== current.id || t.paymentMethod !== method,
        ) ||
        previous.reduce((sum, t) => sum + centimes(t.amount), 0) !== cents
      )
        throw new Error('Référence déjà utilisée.');
      return true;
    }
    const dates =
      options &&
      (options.bankTransactionDate !== undefined ||
        options.postingDate !== undefined)
        ? paymentDates(
            context,
            building.id,
            options.bankTransactionDate,
            options.submissionDate ?? new Date().toISOString(),
            options,
          )
        : undefined;
    if (
      cents >
      centimes(current.totalAmount) - centimes(current.paidAmount ?? 0)
    )
      throw new Error('Paiement supérieur au solde de la facture.');
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []);
    const linked = [...new Set(current.chargeIds)].map((id) => {
      const c = charges.find((charge) => charge.id === id);
      if (
        !c ||
        c.syndicId !== current.syndicId ||
        c.buildingId !== current.buildingId ||
        c.residentId !== current.residentId ||
        (c.invoiceId && c.invoiceId !== current.id)
      )
        throw new Error('Charge non liée à la facture.');
      return c;
    });
    if (cents > linked.reduce((sum, c) => sum + outstanding(c), 0))
      throw new Error('Paiement supérieur aux charges dues.');
    let remaining = cents;
    const paymentAllocations: Array<{
      chargeId: string;
      amount: number;
    }> = [];
    for (const charge of linked) {
      const allocated = Math.min(remaining, outstanding(charge));
      if (allocated)
        paymentAllocations.push({
          chargeId: charge.id,
          amount: allocated / 100,
        });
      charge.paidAmount = (centimes(paidAmount(charge)) + allocated) / 100;
      charge.status = resolveOpenStatus(charge.dueDate, outstanding(charge));
      charge.invoiceId = current.id;
      remaining -= allocated;
    }
    current.paidAmount = (centimes(current.paidAmount ?? 0) + cents) / 100;
    current.status = resolveOpenStatus(
      current.dueDate,
      centimes(current.totalAmount) - centimes(current.paidAmount),
    );
    current.paymentIds = [...(current.paymentIds || []), paymentId];
    const receipts = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, []);
    const allocationSplits = paymentAllocations.map((allocation) => {
      const charge = linked.find((c) => c.id === allocation.chargeId)!;
      const rate = resolveChargeReserveRate(building, charge);
      const chargeSplit = splitChargeReserveAndOperating(
        allocation.amount,
        rate,
      );
      return { allocation, charge, rate, chargeSplit };
    });
    const totalCourantCents = allocationSplits.reduce(
      (sum, item) => sum + centimes(item.chargeSplit.chargesCourantesAmount),
      0,
    );
    const totalReserveCents = allocationSplits.reduce(
      (sum, item) => sum + centimes(item.chargeSplit.reserveFundAmount),
      0,
    );
    const distinctRates = new Set(allocationSplits.map((item) => item.rate));
    const commonRate =
      distinctRates.size === 1 ? [...distinctRates][0] : undefined;
    postIncome(building, cents / 100, paymentId, {
      sourceInvoiceId: current.id,
      ...(dates
        ? {
            date: dates.postingDate,
            bankTransactionDate: dates.bankTransactionDate,
            postingDate: dates.postingDate,
            submissionDate: dates.submissionDate,
            priorPeriodAdjustmentReason: dates.priorPeriodAdjustmentReason,
          }
        : {}),
      paymentMethod: method,
      description: `Paiement facture ${current.invoiceNumber}`,
      invoiceNumber: current.invoiceNumber,
      paymentAllocations,
      reserveSplitOverride: {
        chargesCourantesAmount: totalCourantCents / 100,
        reserveFundAmount: totalReserveCents / 100,
        ...(commonRate !== undefined
          ? { reservePercentageUsed: commonRate }
          : {}),
      },
    });
    for (const allocation of paymentAllocations) {
      assertReceiptCapacity(
        receipts,
        building,
        linked.find((c) => c.id === allocation.chargeId)!,
        centimes(allocation.amount),
      );
    }
    const snapshots: Quittance[] = [];
    for (const { allocation, charge, chargeSplit } of allocationSplits) {
      const apartment = building.apartments.find(
        (a) => a.id === charge.apartmentId,
      );
      const resident = building.residents.find(
        (r) => r.id === charge.residentId,
      );
      if (!apartment || !resident)
        throw new Error('Lot ou résident non lié au paiement.');
      const receipt = numberedReceipt(
        {
          ...(dates
            ? {
                bankTransactionDate: dates.bankTransactionDate,
                postingDate: dates.postingDate,
                submissionDate: dates.submissionDate,
                priorPeriodAdjustmentReason: dates.priorPeriodAdjustmentReason,
              }
            : {}),
          paymentId,
          chargeId: charge.id,
          syndicId: current.syndicId,
          syndicName:
            syndics.find((s) => s.id === current.syndicId)?.name || '',
          buildingId: building.id,
          buildingName: building.name,
          residentId: resident.id,
          residentName: resident.name,
          apartmentId: apartment.id,
          apartmentNumber: apartment.number,
          amount: allocation.amount,
          periodCovered: charge.period || '',
          paymentDate: dates?.bankTransactionDate ?? new Date().toISOString(),
          paymentMethod: method,
          referenceNumber: paymentReference,
        },
        chargeSplit,
        receipts,
        syndics,
      );
      receipts.unshift(receipt);
      snapshots.push(receipt);
    }
    building.financials.transactions.find(
      (t) => t.paymentId === paymentId,
    )!.receiptSnapshots = snapshots;
    if (dates?.priorPeriodAdjustmentReason) {
      (context.state.syndik_prod_audit_v1 ??= []).push({
        id: randomUUID(),
        actorUid: context.actor.uid,
        actorRole: context.actor.role,
        syndicId: current.syndicId,
        buildingId: building.id,
        operation: 'priorPeriodPaymentAdjustment',
        createdAt: new Date().toISOString(),
        detail: {
          paymentId,
          bankTransactionDate: dates.bankTransactionDate,
          postingDate: dates.postingDate,
          reason: dates.priorPeriodAdjustmentReason,
        },
      });
    }
    setLocalItem(STORAGE_KEYS.INVOICES, invoices);
    setLocalItem(STORAGE_KEYS.CHARGES, charges);
    setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
    setLocalItem(STORAGE_KEYS.QUITTANCES, receipts);
    return true;
  };
  return {
    generateMonthlyCharges,
    paidAmount,
    submitPaymentProof,
    approvePaymentProofsBatch,
    reviewPaymentProof,
    createQuittance,
    receiptScope,
    allocationAmount,
    assertReceiptCapacity,
    outstanding,
    postIncome,
    numberedReceipt,
    reconcileBankStatementCSV,
    generateQuittanceForCharge,
    addTransaction,
    createInvoiceForResident,
    recordPayment,
  };
}

import { z } from 'zod';
import { computeBuildingFinancialBalances } from '../../shared/domain/balances';
import type { SetOpeningBalancesCommand } from '../../shared/domain/commands';
import type { State } from '../repository';
import type { CommandDependencies } from './dependencies';
import type { Actor } from './errors';


export function createFinanceCommands(transactionState: State, dependencies: CommandDependencies) {
const state=transactionState;
const check: CommandDependencies['check'] = dependencies.check;
const {object, str, cents, appendAudit, assertPeriod, cabinetFor, buildingFor, canWrite, record, actorIdentity, dispatch, emailAvailable}=dependencies;
function financialOperation(
  actor: Actor,
  operation: string,
  args: any[],
  b: any,
  operationId: string,
): any {
  const state = transactionState;
  if (operation === "setOpeningBalances") {
    check(
      !b.financials?.openingBalancesRecordedAt,
      "Soldes initiaux déjà figés.",
      409,
    );
    const input = object(args[1]),
      working = cents(input.working),
      reserve = cents(input.reserve),
      reason = str(input.reason),
      transactions = b.financials?.transactions || [];
    SetOpeningBalancesSchema.parse({buildingId:b.id,working:working/100,reserve:reserve/100,reason});
    // Keep the existing write-time validation; the shared selector also reads legacy data.
    for (const transaction of transactions) cents(transaction.amount);
    const financials = {
      ...(b.financials || {}),
      transactions,
      openingWorkingBalance: working / 100,
      openingReserveBalance: reserve / 100,
      openingBalancesRecordedAt: new Date().toISOString(),
    };
    delete financials.openingBalance;
    const balances = computeBuildingFinancialBalances({ ...b, financials });
    b.financials = {
      ...financials,
      balance: balances.workingBalance,
      reserveFundBalance: balances.reserveBalance,
    };
    appendAudit(transactionState, actor, operation, b.id, {
      reason,
      working: working / 100,
      reserve: reserve / 100,
    } satisfies Omit<SetOpeningBalancesCommand, "buildingId">);
    return b.financials;
  }
  if (
    operation === "closeFinancialPeriod" ||
    operation === "reopenFinancialPeriod"
  ) {
    const period = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(args[1]),
      reason = str(args[2]);
    if (operation === "reopenFinancialPeriod")
      check(actor.role === "admin", "Réouverture réservée à l’administration.");
    if (operation === "closeFinancialPeriod")
      (transactionState.__closedPeriods ??= {})[`${b.id}:${period}`] = {
        closedAt: new Date().toISOString(),
        actorUid: actor.uid,
        reason,
      };
    else delete (transactionState.__closedPeriods || {})[`${b.id}:${period}`];
    appendAudit(transactionState, actor, operation, b.id, { period, reason });
    return true;
  }
  if (operation === "attachDocument") {
    const meta = transactionState.__files?.[String(args[1]?.fileId)];
    check(meta?.buildingId === b.id, "Fichier non lié.");
    const item = {
      id: randomUUID(),
      name: meta.name,
      url: `/api/uploads/${meta.fileId}`,
      mimeType: meta.mimeType,
      size: `${(meta.sizeBytes / 1048576).toFixed(1)} MB`,
      uploadedAt: new Date().toISOString(),
      category: "autre",
    };
    (b.documents ??= []).push(item);
    appendAudit(transactionState, actor, operation, b.id);
    return item;
  }
  if (operation === "importOpeningArrears") {
    const rows = z.array(z.any()).max(100).parse(args[1]),
      charges = (transactionState.syndik_prod_charges_v1 ??= []);
    for (const row of rows) {
      const lot = b.apartments.find(
        (a: any) => a.id === row.apartmentId && !a.archivedAt,
      );
      check(
        lot &&
          b.residents.some(
            (r: any) => r.id === row.residentId && !r.archivedAt,
          ) &&
          [lot.ownerId, lot.tenantId].includes(row.residentId),
        "Lot/résident non lié.",
        400,
      );
      check(cents(row.amount) > 0, "Montant invalide.", 400);
      const period = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(row.period);
      const id = `opening:${b.id}:${lot.id}:${period}`;
      check(
        !charges.some((c: any) => c.id === id),
        "Arriéré initial déjà saisi.",
        409,
      );
      const dueDate = `${period}-01`;
      const amountCents = cents(row.amount);
      charges.push({
        id,
        buildingId: b.id,
        syndicId: b.syndicId,
        apartmentId: lot.id,
        residentId: row.residentId,
        period,
        periodKey: period,
        amount: amountCents / 100,
        paidAmount: 0,
        status: resolveOpenStatus(dueDate, amountCents),
        dueDate,
        chargeType: "opening_arrears",
        openingArrears: true,
        description: str(row.description || "Arriéré initial"),
        createdAt: new Date().toISOString(),
      });
    }
    appendAudit(transactionState, actor, operation, b.id, { rows: rows.length });
    return true;
  }
  if (operation === "reversePayment") {
    check(
      b.financials?.openingBalancesRecordedAt,
      "Confirmez les soldes initiaux dans les outils financiers.",
      409,
    );
    const paymentId = str(args[1]),
      reason = str(args[2]),
      journal = b.financials?.transactions || [];
    assertPeriod(b, new Date().toISOString());
    check(
      !journal.some((t: any) => t.reversalOf === paymentId),
      "Paiement déjà contrepassé.",
      409,
    );
    const original = journal.filter(
      (t: any) => t.paymentId === paymentId && t.type === "income",
    );
    check(original.length, "Encaissement introuvable.", 404);
    for (const t of original) assertPeriod(b, t.date);
    const total = original.reduce(
        (sum: number, t: any) => sum + cents(t.amount),
        0,
      ),
      source = original[0],
      allocations =
        source.paymentAllocations ||
        (source.sourceChargeId
          ? [{ chargeId: source.sourceChargeId, amount: total / 100 }]
          : undefined);
    check(
      Array.isArray(allocations) && allocations.length > 0,
      "Ancien paiement sans ventilation : rapprochement nécessaire.",
      409,
    );
    check(
      new Set(allocations.map((a: any) => a.chargeId)).size === allocations.length &&
        allocations.every((a: any) => cents(a.amount) > 0) &&
        allocations.reduce((sum: number, a: any) => sum + cents(a.amount), 0) === total,
      "Ventilation incohérente.",
      409,
    );
    const inScope = (row: any) => row.syndicId === b.syndicId && row.buildingId === b.id;
    // Resolve and validate every relationship before changing financial records.
    const allocatedCharges = allocations.map((allocation: any) => {
      const charge = (transactionState.syndik_prod_charges_v1 || []).find(
        (c: any) => c.id === allocation.chargeId && inScope(c),
      );
      check(
        charge && cents(charge.paidAmount || 0) >= cents(allocation.amount),
        "Solde de charge incohérent.",
        409,
      );
      return { charge, amount: cents(allocation.amount) };
    });
    let invoice: any;
    if (source.sourceInvoiceId) {
      invoice = (transactionState.syndik_prod_invoices_v1 || []).find(
        (i: any) => i.id === source.sourceInvoiceId && inScope(i),
      );
      check(
        invoice && cents(invoice.paidAmount || 0) >= total &&
          allocatedCharges.every(({ charge }: any) =>
            invoice.chargeIds?.includes(charge.id) &&
            invoice.residentId === charge.residentId &&
            (!charge.invoiceId || charge.invoiceId === invoice.id)),
        "Solde facture incohérent.",
        409,
      );
    }
    const nowIso = new Date().toISOString();
    for (const { charge, amount } of allocatedCharges) {
      const remainingPaidCents = cents(charge.paidAmount) - amount;
      charge.paidAmount = remainingPaidCents / 100;
      charge.status = resolveOpenStatus(
        charge.dueDate,
        cents(charge.amount) - remainingPaidCents,
      );
      if (remainingPaidCents <= 0) {
        delete charge.paidAt;
      }
    }
    if (invoice) {
      const remainingInvPaidCents = cents(invoice.paidAmount) - total;
      invoice.paidAmount = remainingInvPaidCents / 100;
      invoice.status = resolveOpenStatus(
        invoice.dueDate,
        cents(invoice.totalAmount) - remainingInvPaidCents,
      );
      if (Array.isArray(invoice.paymentIds)) {
        invoice.paymentIds = invoice.paymentIds.filter((id: string) => id !== paymentId);
      }
    }
    if (paymentId.startsWith("proof:")) {
      const proofId = paymentId.slice("proof:".length);
      const proof = (transactionState.syndik_prod_proofs_v1 || []).find(
        (p: any) =>
          p.id === proofId &&
          p.buildingId === b.id &&
          (!p.syndicId || p.syndicId === b.syndicId),
      );
      if (proof) {
        proof.status = "rejected";
        proof.rejectionReason = reason;
        proof.reviewedAt = nowIso;
      }
    }
    for (const t of original) {
      const { receiptSnapshots: _rs, ...txRest } = t;
      const originalAbsCents = Math.abs(cents(t.amount));
      const inverse = {
        ...txRest,
        id: randomUUID(),
        paymentId: `reversal:${operationId}`,
        reversalOf: paymentId,
        type: "expense",
        amount: -originalAbsCents / 100,
        description: `Contrepassation : ${reason}`,
        date: nowIso,
      };
      journal.unshift(inverse);
    }
    const syncedBalances = syncBuildingFinancialBalances(b);
    for (const receipt of transactionState.syndik_prod_quittances_v1 || [])
      if (
        inScope(receipt) &&
        (receipt.paymentId === paymentId ||
        (!receipt.paymentId &&
          allocations.some((a: any) => a.chargeId === receipt.chargeId)))
      ) {
        receipt.voidedAt = nowIso;
        receipt.voidReason = reason;
      }
    appendAudit(transactionState, actor, operation, b.id, {
      paymentId,
      reason,
      total: total / 100,
      ...(syncedBalances.workingBalance < 0 || syncedBalances.reserveBalance < 0
        ? {
            resultingNegativeBalance: true,
            workingBalance: syncedBalances.workingBalance,
            reserveBalance: syncedBalances.reserveBalance,
          }
        : {}),
    });
    return true;
  }
  if (operation === "transferFunds") {
    check(
      b.financials?.openingBalancesRecordedAt,
      "Confirmez les soldes initiaux dans les outils financiers.",
      409,
    );
    const input = object(args[1]);
    const fromFund = input.fromFund === "reserve" ? "reserve" : input.fromFund === "courant" ? "courant" : null;
    const toFund = input.toFund === "reserve" ? "reserve" : input.toFund === "courant" ? "courant" : null;
    check(fromFund && toFund && fromFund !== toFund, "Fonds source et destination invalides ou identiques.", 400);
    const amountCents = cents(input.amount);
    check(amountCents > 0, "Montant du virement invalide.", 400);
    const reason = str(input.reason, 1000).trim();
    check(reason.length >= 3, "Motif du virement requis (min 3 caractères).", 400);
    const dateStr = str(input.date, 40);
    assertPeriod(b, dateStr);
    const balances = computeBuildingFinancialBalances(b);
    const sourceBalCents = Math.round(
      (fromFund === "reserve" ? balances.reserveBalance : balances.workingBalance) * 100,
    );
    if (sourceBalCents < amountCents) {
      throw new OperationError(
        "Solde du fonds source insuffisant pour effectuer ce virement.",
        409,
        "INSUFFICIENT_FUND_BALANCE",
      );
    }
    const transferId = `trf-${operationId}`;
    const labelFrom = fromFund === "reserve" ? "Fonds de Réserve" : "Compte Courant";
    const labelTo = toFund === "reserve" ? "Fonds de Réserve" : "Compte Courant";
    const description = `Virement interne (${labelFrom} -> ${labelTo}) : ${reason}`;
    const outTransaction: Transaction = {
      id: `trx-${transferId}-out`,
      transferId,
      transferDirection: "out",
      paymentId: `${transferId}:out`,
      date: dateStr,
      description,
      amount: -amountCents / 100,
      type: "expense",
      category: "reserve",
      fundType: fromFund,
      notes: reason,
    };
    const inTransaction: Transaction = {
      id: `trx-${transferId}-in`,
      transferId,
      transferDirection: "in",
      paymentId: `${transferId}:in`,
      date: dateStr,
      description,
      amount: amountCents / 100,
      type: "income",
      category: "reserve",
      fundType: toFund,
      notes: reason,
    };
    b.financials.transactions = b.financials.transactions || [];
    b.financials.transactions.unshift(inTransaction, outTransaction);
    const nextBalances = computeBuildingFinancialBalances(b);
    b.financials.balance = nextBalances.workingBalance;
    b.financials.reserveFundBalance = nextBalances.reserveBalance;
    appendAudit(transactionState, actor, operation, b.id, {
      transferId,
      fromFund,
      toFund,
      amount: amountCents / 100,
      date: dateStr,
      reason,
    });
    return {
      transferId,
      outTransaction,
      inTransaction,
      financials: b.financials,
    };
  }
  if (operation === "voidInvoice") {
    const invoiceId = str(args[1]);
    const reason = str(args[2], 1000).trim();
    check(reason.length >= 3, "Motif d'annulation requis (min 3 caractères).", 400);
    const invoices = (transactionState.syndik_prod_invoices_v1 ??= []);
    const invoice = invoices.find(
      (i: any) => i.id === invoiceId && i.buildingId === b.id && i.syndicId === b.syndicId,
    );
    check(invoice, "Facture introuvable.", 404);
    check(invoice.status !== "cancelled", "Facture déjà annulée.", 409);
    check(
      cents(invoice.paidAmount ?? 0) === 0 && !(Array.isArray(invoice.paymentIds) && invoice.paymentIds.length > 0),
      "Impossible d'annuler une facture ayant des règlements enregistrés. Contrepassez d'abord les paiements.",
      409,
    );
    invoice.status = "cancelled";
    invoice.voidedAt = new Date().toISOString();
    invoice.voidReason = reason;
    for (const charge of transactionState.syndik_prod_charges_v1 || []) {
      if (charge.buildingId === b.id && charge.syndicId === b.syndicId && charge.invoiceId === invoice.id) {
        delete charge.invoiceId;
      }
    }
    appendAudit(transactionState, actor, operation, b.id, {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      reason,
    });
    return true;
  }
  if (operation === "reverseExpense") {
    check(
      b.financials?.openingBalancesRecordedAt,
      "Confirmez les soldes initiaux dans les outils financiers.",
      409,
    );
    const transactionId = str(args[1]);
    const reason = str(args[2], 1000).trim();
    check(reason.length >= 3, "Motif de contrepassation requis (min 3 caractères).", 400);
    const nowIso = new Date().toISOString();
    assertPeriod(b, nowIso);
    const journal: Transaction[] = (b.financials.transactions ??= []);
    const original = journal.find((t) => t.id === transactionId);
    check(original, "Écriture comptable introuvable.", 404);
    check(!original.reversalOf, "Impossible de contrepasser une contrepassation.", 409);
    check(!original.transferId, "Les virements internes ne peuvent pas être contrepassés individuellement.", 409);
    const originalCents = cents(original.amount);
    const isExpense = original.type === "expense" || (!original.type && originalCents < 0);
    check(isExpense && Math.abs(originalCents) > 0, "Seules les dépenses peuvent être contrepassées via cette opération.", 409);
    check(
      !journal.some((t) => t.reversalOf === original.id),
      "Dépense déjà contrepassée.",
      409,
    );
    assertPeriod(b, original.date);
    const absCents = Math.abs(originalCents);
    const fund: "courant" | "reserve" = original.fundType === "reserve" ? "reserve" : "courant";
    const reversalTx: Transaction = {
      id: `trx-rev-${randomUUID()}`,
      date: nowIso,
      description: `Contrepassation dépense (${original.description}) : ${reason}`,
      amount: absCents / 100,
      type: "income",
      category: original.category || "other",
      fundType: fund,
      paymentMethod: original.paymentMethod,
      reference: original.reference,
      documentType: original.documentType,
      invoiceNumber: original.invoiceNumber,
      thirdPartyName: original.thirdPartyName,
      thirdPartyIce: original.thirdPartyIce,
      bankName: original.bankName,
      notes: reason,
      reversalOf: original.id,
      paymentId: `expense-reversal:${operationId}`,
    };
    journal.unshift(reversalTx);
    syncBuildingFinancialBalances(b);
    appendAudit(transactionState, actor, operation, b.id, {
      transactionId: original.id,
      reversalId: reversalTx.id,
      fundType: fund,
      amount: absCents / 100,
      reason,
    });
    return reversalTx;
  }
}
return {financialOperation};
}



