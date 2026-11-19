import type { AddBuildingCommand } from '../../shared/domain/commands';
import { getBuildingReserveRate } from '../../shared/domain/money';
import {
  countActiveBuildings,
  getBuildingCapacity,
} from '../../shared/domain/subscription';
import type { Apartment, Building, Syndic } from '../../types';
import { isAlreadyHashedPassword } from '../../utils/security';
import { ApartmentSchema, BuildingSchema } from '../../utils/validation';
import { hashPassword } from '../passwords';
import type { DomainContext } from './context';
import { assertContext } from './context';
import { STORAGE_KEYS } from './records';
import { transactionRecords } from './state';

/**
 * Keeps resident login/account registries aligned with live apartment ownership/tenancy
 * whenever lots are added, edited, transferred, or archived.
 */
export function syncResidentAccountApartment(
  state: State,
  bld: Building,
  residentId: string,
) {
  const resident = (bld.residents || []).find((r) => r.id === residentId);
  const aptId = resident?.apartmentId;
  const activeApt = aptId
    ? (bld.apartments || []).find(
        (a: any) => !a.archivedAt && a.id === aptId,
      )
    : undefined;
  const nextAptId = activeApt?.id;
  const nextAptNumber = activeApt?.number;

  for (const user of state.syndik_prod_registered_users_v1 || []) {
    if (user?.profile?.residentId === residentId) {
      if (nextAptId) {
        user.profile.apartmentId = nextAptId;
        if (nextAptNumber !== undefined) user.profile.apartmentNumber = nextAptNumber;
      } else {
        delete user.profile.apartmentId;
        delete user.profile.apartmentNumber;
      }
    }
  }
  for (const acc of state.syndik_prod_resident_accounts_v1 || []) {
    if (acc?.residentId === residentId) {
      if (nextAptId) {
        acc.apartmentId = nextAptId;
        if (nextAptNumber !== undefined) acc.apartmentNumber = nextAptNumber;
      } else {
        delete acc.apartmentId;
        delete acc.apartmentNumber;
      }
    }
  }
}

export function createBuildingService(context: DomainContext) {
  assertContext(context);
  const {
    read: getLocalItem,
    write: setLocalItem,
    write,
  } = transactionRecords(context.state);
  const addBuilding = async (
    syndicId: string,
    buildingData: AddBuildingCommand['building'],
  ) => {
    const { apartments, ...coreBuilding } = buildingData;
    const validation = BuildingSchema.safeParse({
      ...coreBuilding,
      syndicId,
      reserveFundRate:
        coreBuilding.reserveFundRate !== undefined
          ? coreBuilding.reserveFundRate
          : coreBuilding.reserveFundPercentage !== undefined
            ? coreBuilding.reserveFundPercentage
            : 5,
    });
    if (!validation.success) {
      throw new OperationError('Invalid Building Data: ' + validation.error.message, 400);
    }

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    const syndic = syndics.find((s) => s.id === syndicId);
    if (!syndic) throw new OperationError('Syndic introuvable ou non autorisé', 404);
    // Audit Item 21: Delegate subscription expiry check to canonical subscriptionCanWrite with admin bypass
    if (context.actor.role !== 'admin' && !subscriptionCanWrite(syndic)) {
      throw new OperationError(
        'Abonnement expiré. Veuillez renouveler votre abonnement pour ajouter un nouvel immeuble.',
        402,
      );
    }
    const { limit: maxBuildings, canAdd } = getBuildingCapacity(syndic);
    if (!canAdd) {
      throw new OperationError(
        `Limite atteinte pour le forfait ${syndic.subscriptionPlan} (${maxBuildings} immeuble(s) max).`,
        409,
      );
    }
    const newBuildingId = crypto.randomUUID();
    const targetTotalTantiemes = validation.data.totalTantiemes ?? 1000;
    const totalLots = apartments?.length || 0;
    const baseTantiemes =
      totalLots > 0 ? Math.floor(targetTotalTantiemes / totalLots) : 100;
    const remainderTantiemes =
      totalLots > 0 ? targetTotalTantiemes - baseTantiemes * totalLots : 0;
    const generatedApts: Apartment[] = (apartments || []).map((apt, idx) => ({
      id: `apt-${crypto.randomUUID()}`,
      buildingId: newBuildingId,
      number: apt.number.trim(),
      floor: apt.floor,
      area: apt.area,
      monthlyFees: apt.monthlyFees ?? coreBuilding.monthlySyndicFees,
      tantiemes:
        apt.tantiemes ?? baseTantiemes + (idx < remainderTantiemes ? 1 : 0),
      coproType: apt.coproType || 'apartment',
      ownerId: null,
      tenantId: null,
    }));
    const newBuilding: Building = {
      id: newBuildingId,
      syndicId: syndic.id,
      name: coreBuilding.name,
      address: coreBuilding.address,
      city: coreBuilding.city,
      ...((coreBuilding as any).postalCode !== undefined
        ? { postalCode: (coreBuilding as any).postalCode }
        : {}),
      ...((coreBuilding as any).ice !== undefined
        ? { ice: (coreBuilding as any).ice }
        : {}),
      ...((coreBuilding as any).rc !== undefined
        ? { rc: (coreBuilding as any).rc }
        : {}),
      monthlySyndicFees: coreBuilding.monthlySyndicFees,
      totalTantiemes: targetTotalTantiemes,
      reserveFundRate: validation.data.reserveFundRate,
      bankName: coreBuilding.bankName?.trim() || undefined,
      bankRib: coreBuilding.bankRib?.trim() || undefined,
      managerName: coreBuilding.managerName?.trim() || undefined,
      managerPhone: coreBuilding.managerPhone?.trim() || undefined,
      residents: [],
      apartments: generatedApts,
      announcements: [],
      documents: [],
      financials: { balance: 0, reserveFundBalance: 0, transactions: [] },
    };
    syndic.buildings.push(newBuilding);

    setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

    return newBuilding;
  };

  const updateBuilding = async (
    buildingId: string,
    updates: Partial<
      Pick<
        Building,
        | 'name'
        | 'address'
        | 'city'
        | 'monthlySyndicFees'
        | 'reserveFundRate'
        | 'bankName'
        | 'bankRib'
        | 'managerName'
        | 'managerPhone'
      >
    > & {
      syncApartmentFees?: boolean;
    },
  ) => {
    const { syncApartmentFees, ...buildingUpdates } = updates;
    BuildingSchema.partial().parse(buildingUpdates);
    const normalizedUpdates: Record<string, any> = { ...buildingUpdates };
    for (const optField of ['bankName', 'bankRib', 'managerName', 'managerPhone'] as const) {
      if (optField in normalizedUpdates && typeof normalizedUpdates[optField] === 'string') {
        const trimmed = normalizedUpdates[optField].trim();
        normalizedUpdates[optField] = trimmed === '' ? undefined : trimmed;
      }
    }
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const idx = syndic.buildings.findIndex((b) => b.id === buildingId);
      if (idx >= 0) {
        const bld = syndic.buildings[idx];
        const updatedBuilding: Building = {
          ...bld,
          ...normalizedUpdates,
          reserveFundRate:
            buildingUpdates.reserveFundRate ?? getBuildingReserveRate(bld),
        };
        delete updatedBuilding.reserveFundPercentage;
        if (
          syncApartmentFees &&
          typeof buildingUpdates.monthlySyndicFees === 'number'
        ) {
          updatedBuilding.apartments = updatedBuilding.apartments.map(
            (apt) => ({
              ...apt,
              monthlyFees: buildingUpdates.monthlySyndicFees!,
            }),
          );
        }
        syndic.buildings[idx] = updatedBuilding;
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

        return updatedBuilding;
      }
    }
    throw new Error('Building not found');
  };

  const deleteBuilding = async (buildingId: string) => {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const idx = syndic.buildings.findIndex((b) => b.id === buildingId);
      if (idx >= 0) {
        syndic.buildings.splice(idx, 1);

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics, buildingId);

        return true;
      }
    }
    return true;
  };

  // ==========================================
  // 3. APARTMENTS & TANTIÈMES (SINGLE & BULK)
  // ==========================================
  const addApartment = async (apartmentData: Omit<Apartment, 'id'>) => {
    const validation = ApartmentSchema.safeParse(apartmentData);
    if (!validation.success) {
      throw new OperationError('Invalid Apartment Data: ' + validation.error.message, 400);
    }
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find(
        (b) => b.id === apartmentData.buildingId,
      );
      if (bld) {
        const newApt: Apartment = {
          id: `apt-${crypto.randomUUID()}`,
          ...apartmentData,
          number: apartmentData.number.trim(),
          monthlyFees: apartmentData.monthlyFees ?? bld.monthlySyndicFees,
          tantiemes: apartmentData.tantiemes ?? 100,
          coproType: apartmentData.coproType ?? 'apartment',
        };
        bld.apartments.push(newApt);
        if (newApt.ownerId) {
          const owner = bld.residents.find((r) => r.id === newApt.ownerId);
          if (owner && !owner.apartmentId) {
            owner.apartmentId = newApt.id;
            syncResidentAccountApartment(context.state, bld, owner.id);
          }
        }
        if (newApt.tenantId) {
          const tenant = bld.residents.find((r) => r.id === newApt.tenantId);
          if (tenant && !tenant.apartmentId) {
            tenant.apartmentId = newApt.id;
            syncResidentAccountApartment(context.state, bld, tenant.id);
          }
        }
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

        return newApt;
      }
    }
  };

  const addApartmentsBulk = async (
    buildingId: string,
    apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[],
  ) => {
    if (!apartmentsList.length) return [];
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === buildingId);
      if (bld) {
        const existingNumbers = new Set(
          bld.apartments
            .filter((a: any) => !a.archivedAt)
            .map((a) => a.number.trim().toLowerCase()),
        );
        const createdApartments: Apartment[] = [];
        apartmentsList.forEach((aptData) => {
          const normalizedNum = aptData.number.trim().toLowerCase();
          if (existingNumbers.has(normalizedNum)) return;
          existingNumbers.add(normalizedNum);
          const parsedArea =
            aptData.area !== undefined &&
            aptData.area !== null &&
            Number.isFinite(Number(aptData.area))
              ? Number(aptData.area)
              : 60;
          const parsedTantiemes =
            aptData.tantiemes !== undefined &&
            aptData.tantiemes !== null &&
            Number.isFinite(Number(aptData.tantiemes))
              ? Number(aptData.tantiemes)
              : 100;
          const newApt: Apartment = {
            id: `apt-${randomUUID()}`,
            buildingId,
            number: aptData.number.trim(),
            floor: Number(aptData.floor) || 0,
            area: parsedArea,
            monthlyFees:
              aptData.monthlyFees !== undefined && aptData.monthlyFees !== null
                ? Number(aptData.monthlyFees)
                : bld.monthlySyndicFees,
            tantiemes: parsedTantiemes,
            coproType: aptData.coproType || 'apartment',
            ownerId: aptData.ownerId || null,
            tenantId: aptData.tenantId || null,
          };
          bld.apartments.push(newApt);
          if (newApt.ownerId) {
            const owner = bld.residents.find((r) => r.id === newApt.ownerId);
            if (owner && !owner.apartmentId) {
              owner.apartmentId = newApt.id;
              syncResidentAccountApartment(context.state, bld, owner.id);
            }
          }
          if (newApt.tenantId) {
            const tenant = bld.residents.find((r) => r.id === newApt.tenantId);
            if (tenant && !tenant.apartmentId) {
              tenant.apartmentId = newApt.id;
              syncResidentAccountApartment(context.state, bld, tenant.id);
            }
          }
          createdApartments.push(newApt);
        });
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

        return createdApartments;
      }
    }
    throw new Error('Building not found');
  };

  const rebalanceBuildingTantiemes = async (buildingId: string) => {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === buildingId);
      if (bld && bld.apartments.length > 0) {
        const activeApts = bld.apartments.filter((a: any) => !a.archivedAt);
        if (activeApts.length === 0) return bld.apartments;
        const totalTarget = bld.totalTantiemes || 1000;
        if (activeApts.length > totalTarget) {
          throw new OperationError(
            `Impossible de rééquilibrer : ${activeApts.length} lots actifs dépassent le total de ${totalTarget} tantièmes.`,
            400,
          );
        }
        const totalArea = activeApts.reduce(
          (sum, a) => sum + (Number(a.area) || 1),
          0,
        );
        let allocated = 0;
        const updatedActiveIds = new Map<string, number>();
        activeApts.forEach((apt, idx) => {
          if (idx === activeApts.length - 1) {
            updatedActiveIds.set(apt.id, Math.max(1, totalTarget - allocated));
            return;
          }
          const maxAllowed = Math.max(
            1,
            totalTarget - allocated - (activeApts.length - 1 - idx),
          );
          const share = Math.max(
            1,
            Math.min(
              maxAllowed,
              Math.round(((Number(apt.area) || 1) / totalArea) * totalTarget),
            ),
          );
          allocated += share;
          updatedActiveIds.set(apt.id, share);
        });
        bld.apartments = bld.apartments.map((apt) =>
          updatedActiveIds.has(apt.id)
            ? { ...apt, tantiemes: updatedActiveIds.get(apt.id)! }
            : apt,
        );
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

        return bld.apartments;
      }
    }
  };

  const updateApartment = async (apartment: Apartment) => {
    const validation = ApartmentSchema.safeParse(apartment);
    if (!validation.success) {
      throw new OperationError('Invalid Apartment Data: ' + validation.error.message, 400);
    }
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === apartment.buildingId);
      if (bld) {
        const idx = bld.apartments.findIndex((a) => a.id === apartment.id);
        if (idx >= 0) {
          const prevApt = bld.apartments[idx];
          const touchedResidents = new Set<string>();
          bld.apartments[idx] = {
            ...prevApt,
            ...apartment,
            number: apartment.number.trim(),
          };
          if (prevApt.ownerId && prevApt.ownerId !== apartment.ownerId) {
            const oldOwner = bld.residents.find(
              (r) => r.id === prevApt.ownerId,
            );
            if (oldOwner && oldOwner.apartmentId === apartment.id) {
              const otherOwned = bld.apartments.find(
                (a: any) =>
                  !a.archivedAt &&
                  a.id !== apartment.id &&
                  (a.ownerId === oldOwner.id || a.tenantId === oldOwner.id),
              );
              oldOwner.apartmentId = otherOwned?.id || undefined;
              touchedResidents.add(oldOwner.id);
            }
          }
          if (prevApt.tenantId && prevApt.tenantId !== apartment.tenantId) {
            const oldTenant = bld.residents.find(
              (r) => r.id === prevApt.tenantId,
            );
            if (oldTenant && oldTenant.apartmentId === apartment.id) {
              const otherRented = bld.apartments.find(
                (a: any) =>
                  !a.archivedAt &&
                  a.id !== apartment.id &&
                  (a.ownerId === oldTenant.id || a.tenantId === oldTenant.id),
              );
              oldTenant.apartmentId = otherRented?.id || undefined;
              touchedResidents.add(oldTenant.id);
            }
          }
          if (apartment.ownerId) {
            const newOwner = bld.residents.find(
              (r) => r.id === apartment.ownerId,
            );
            if (newOwner) {
              if (!newOwner.apartmentId) newOwner.apartmentId = apartment.id;
              touchedResidents.add(newOwner.id);
            }
          }
          if (apartment.tenantId) {
            const newTenant = bld.residents.find(
              (r) => r.id === apartment.tenantId,
            );
            if (newTenant) {
              if (!newTenant.apartmentId) newTenant.apartmentId = apartment.id;
              touchedResidents.add(newTenant.id);
            }
          }
          for (const resId of touchedResidents) {
            syncResidentAccountApartment(context.state, bld, resId);
          }
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

          return bld.apartments[idx];
        }
      }
    }
  };

  const deleteApartment = async (apartmentId: string) => {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.apartments.findIndex((a) => a.id === apartmentId);
        if (idx >= 0) {
          bld.apartments.splice(idx, 1);
          bld.residents.forEach((res) => {
            if (res.apartmentId === apartmentId) {
              const fallbackApt = bld.apartments.find(
                (a: any) =>
                  !a.archivedAt && (a.ownerId === res.id || a.tenantId === res.id),
              );
              res.apartmentId = fallbackApt?.id || undefined;
              syncResidentAccountApartment(context.state, bld, res.id);
            }
          });
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics, apartmentId);
          return true;
        }
      }
    }
    return true;
  };
  return {
    addBuilding,
    updateBuilding,
    deleteBuilding,
    addApartment,
    addApartmentsBulk,
    rebalanceBuildingTantiemes,
    updateApartment,
    deleteApartment,
  };
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  SubscriptionPayment,
  SubscriptionPaymentMethod,
  SubscriptionPlan,
} from '../../types';
import { PLANS } from '../../shared/domain/subscription';
import { subscriptionCanWrite } from '../../utils/subscriptionPolicy';
import { resolvePlatformBillingConfig } from '../paypalBilling';
import type { State } from '../repository';
import type { CommandDependencies } from './dependencies';
import { OperationError, type Actor } from './errors';

export interface ActivatePlatformSubscriptionInput {
  syndicId: string;
  plan: SubscriptionPlan;
  months: number;
  reference: string;
  amountMad: number;
  method?: SubscriptionPaymentMethod;
  currency?: 'MAD' | 'EUR' | 'USD';
  chargedAmount?: number;
  externalOrderId?: string;
  externalCaptureId?: string;
  proofUrl?: string;
  requestId?: string;
  auditOperation?: string;
}

type CheckFn = (
  condition: unknown,
  message: string,
  status?: number,
) => asserts condition;

function shiftUtcMonths(baseMs: number, deltaMonths: number): Date {
  const result = new Date(baseMs);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + deltaMonths);
  result.setUTCDate(
    Math.min(
      originalDay,
      new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return result;
}

export function voidPlatformSubscriptionPayment(
  state: State,
  actor: Actor,
  paymentId: string,
  reason: string,
  auditOperation: string = 'voidSubscriptionPayment',
): SubscriptionPayment {
  const payments: SubscriptionPayment[] =
    state.syndik_prod_subscription_payments_v1 || [];
  const payment = payments.find((p) => p.id === paymentId);
  if (!payment) throw new OperationError('Paiement introuvable.', 404);
  if (payment.voidedAt) throw new OperationError('Paiement déjà annulé.', 409);

  payment.voidedAt = new Date().toISOString();
  payment.voidReason = reason;
  payment.voidedBy = actor.uid;

  const cabinets = state.syndik_prod_syndics_v1 || [];
  const cabinet = cabinets.find((c: Syndic) => c.id === payment.syndicId);
  if (cabinet && cabinet.subscriptionStatus !== 'cancelled') {
    const cabinetPayments = payments
      .filter((p) => p.syndicId === cabinet.id)
      .sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
      );
    const activePayments = cabinetPayments.filter((p) => !p.voidedAt);
    const firstWithBaseline = cabinetPayments.find(
      (p) => p.previousSubscriptionExpiry !== undefined,
    );

    if (activePayments.length === 0) {
      if (firstWithBaseline?.previousSubscriptionExpiry) {
        const restoredMs = Date.parse(
          firstWithBaseline.previousSubscriptionExpiry,
        );
        cabinet.subscriptionExpiry =
          firstWithBaseline.previousSubscriptionExpiry;
        if (firstWithBaseline.previousSubscriptionPlan) {
          cabinet.subscriptionPlan = firstWithBaseline.previousSubscriptionPlan;
        }
        cabinet.subscriptionStatus =
          Number.isFinite(restoredMs) && restoredMs > Date.now()
            ? firstWithBaseline.previousSubscriptionStatus || 'trialing'
            : 'expired';
      } else {
        const currentMs = Date.parse(cabinet.subscriptionExpiry || '');
        const rolledBack = Number.isFinite(currentMs)
          ? shiftUtcMonths(currentMs, -Math.max(1, Number(payment.months) || 1))
          : new Date(0);
        cabinet.subscriptionExpiry = rolledBack.toISOString();
        cabinet.subscriptionStatus =
          rolledBack.getTime() > Date.now() ? 'active' : 'expired';
      }
    } else if (firstWithBaseline?.previousSubscriptionExpiry) {
      let cursorMs = Date.parse(firstWithBaseline.previousSubscriptionExpiry);
      if (!Number.isFinite(cursorMs)) cursorMs = 0;
      for (const active of activePayments) {
        const createdMs = Date.parse(active.createdAt || '') || 0;
        const baseMs = Math.max(createdMs, cursorMs);
        cursorMs = shiftUtcMonths(baseMs, active.months).getTime();
      }
      const latest = activePayments[activePayments.length - 1];
      cabinet.subscriptionPlan = latest.plan;
      cabinet.subscriptionExpiry = new Date(cursorMs).toISOString();
      cabinet.subscriptionStatus =
        cursorMs > Date.now() ? 'active' : 'expired';
    } else {
      const currentMs = Date.parse(cabinet.subscriptionExpiry || '');
      const rolledBack = Number.isFinite(currentMs)
        ? shiftUtcMonths(currentMs, -Math.max(1, Number(payment.months) || 1))
        : new Date(0);
      const latest = activePayments[activePayments.length - 1];
      cabinet.subscriptionPlan = latest.plan;
      cabinet.subscriptionExpiry = rolledBack.toISOString();
      cabinet.subscriptionStatus =
        rolledBack.getTime() > Date.now() ? 'active' : 'expired';
    }
  }

  (state.syndik_prod_audit_v1 ??= []).push({
    id: randomUUID(),
    actorUid: actor.uid,
    actorRole: actor.role,
    syndicId: payment.syndicId,
    operation: auditOperation,
    detail: {
      paymentId: payment.id,
      syndicId: payment.syndicId,
      reason,
      ...(cabinet
        ? {
            updatedSubscriptionExpiry: cabinet.subscriptionExpiry,
            updatedSubscriptionStatus: cabinet.subscriptionStatus,
          }
        : {}),
    },
    createdAt: new Date().toISOString(),
  });
  return payment;
}

export function activatePlatformSubscription(
  state: State,
  actor: Actor,
  input: ActivatePlatformSubscriptionInput,
): SubscriptionPayment {
  const check: CheckFn = (condition, message, status = 403) => {
    if (!condition) throw new OperationError(message, status);
  };
  const syndicId = z.string().min(1).max(200).parse(input.syndicId);
  const cabinets = state.syndik_prod_syndics_v1 || [];
  const s = cabinets.find((cab: Syndic) => cab.id === syndicId);
  check(
    s &&
      (actor.role === 'admin' ||
        s.createdBy === actor.uid ||
        actor.syndicId === syndicId),
    'Cabinet non autorisé.',
    403,
  );
  check(
    !s.archivedAt,
    "Cabinet archivé : restaurez-le avant d'enregistrer un paiement.",
    409,
  );
  check(
    actor.role === 'admin' || s.subscriptionStatus !== 'cancelled',
    "Votre compte est suspendu. Contactez l'administration pour le réactiver.",
    403,
  );

  const payments: SubscriptionPayment[] = (state.syndik_prod_subscription_payments_v1 ??=
    []);

  if (input.externalOrderId) {
    const existingByOrder = payments.find(
      (p) => !p.voidedAt && p.externalOrderId === input.externalOrderId,
    );
    if (existingByOrder) return existingByOrder;
  }
  if (input.externalCaptureId) {
    const existingByCapture = payments.find(
      (p) => !p.voidedAt && p.externalCaptureId === input.externalCaptureId,
    );
    if (existingByCapture) return existingByCapture;
  }
  if (input.requestId) {
    const existingByRequest = payments.find(
      (p) => !p.voidedAt && p.requestId === input.requestId,
    );
    if (existingByRequest) return existingByRequest;
  }

  const plan = z
    .enum(['starter', 'professional', 'enterprise'])
    .parse(input.plan);
  const activeBuildingsCount = countActiveBuildings(s.buildings);
  const planLimit = PLANS[plan].buildings;
  check(
    activeBuildingsCount <= planLimit,
    `Impossible de passer au forfait ${plan} : ${activeBuildingsCount} immeuble(s) actif(s) pour une limite de ${planLimit}. Archivez des immeubles avant de changer de forfait.`,
    409,
  );
  const months = z.number().int().min(1).max(12).parse(input.months);
  const reference = z.string().min(1).max(200).parse(input.reference).trim();
  const amountCents = Math.round(Number(input.amountMad) * 100);
  check(
    Number.isFinite(input.amountMad) &&
      amountCents === PLANS[plan].price * months * 100,
    'Montant incompatible avec le forfait.',
    400,
  );
  check(
    !payments.some((p) => !p.voidedAt && p.reference === reference),
    'Référence déjà utilisée.',
    409,
  );

  const previousSubscriptionPlan = s.subscriptionPlan;
  const previousSubscriptionStatus = s.subscriptionStatus;
  const previousSubscriptionExpiry = s.subscriptionExpiry;

  const expiry = shiftUtcMonths(
    Math.max(Date.now(), Date.parse(s.subscriptionExpiry) || 0),
    months,
  );
  Object.assign(s, {
    subscriptionPlan: plan,
    subscriptionStatus: 'active',
    subscriptionExpiry: expiry.toISOString(),
  });

  const payment: SubscriptionPayment = {
    id: randomUUID(),
    syndicId: s.id,
    ...(s.name ? { syndicName: s.name } : {}),
    ...(s.email ? { syndicEmail: s.email } : {}),
    plan,
    months,
    reference,
    amount: amountCents / 100,
    ...(input.method ? { method: input.method } : {}),
    ...(input.currency ? { currency: input.currency } : {}),
    ...(input.chargedAmount !== undefined
      ? { chargedAmount: Number(input.chargedAmount.toFixed(2)) }
      : {}),
    ...(input.externalOrderId ? { externalOrderId: input.externalOrderId } : {}),
    ...(input.externalCaptureId
      ? { externalCaptureId: input.externalCaptureId }
      : {}),
    ...(input.proofUrl ? { proofUrl: input.proofUrl } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    recordedBy: actor.uid,
    createdAt: new Date().toISOString(),
    subscriptionExpiry: s.subscriptionExpiry,
    subscriptionStatus: s.subscriptionStatus,
    ...(previousSubscriptionPlan ? { previousSubscriptionPlan } : {}),
    ...(previousSubscriptionStatus ? { previousSubscriptionStatus } : {}),
    ...(previousSubscriptionExpiry ? { previousSubscriptionExpiry } : {}),
  };
  payments.push(payment);
  (state.syndik_prod_audit_v1 ??= []).push({
    id: randomUUID(),
    actorUid: actor.uid,
    actorRole: actor.role,
    syndicId: s.id,
    operation: input.auditOperation || 'recordSubscriptionPayment',
    detail: {
      paymentId: payment.id,
      syndicId: s.id,
      method: input.method || 'manual',
      ...(input.externalOrderId ? { externalOrderId: input.externalOrderId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
    },
    createdAt: new Date().toISOString(),
  });
  return payment;
}

export function createBuildingCommands(transactionState: State, dependencies: CommandDependencies) {
const state=transactionState;
const check: CommandDependencies['check'] = dependencies.check;
const {object, str, cents, appendAudit, assertPeriod, cabinetFor, buildingFor, canWrite, record, actorIdentity, dispatch, emailAvailable, manager, nested, links}=dependencies;
async function createCabinet(actor: Actor, input: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const state = transactionState,
    data = object(input),
    email = z.string().email().parse(data.email).toLowerCase(),
    password = z.string().min(10).max(200).parse(data.password);
  check(!isAlreadyHashedPassword(password), "Mot de passe invalide.", 400);
  check(emailAvailable(email), "Compte déjà existant.", 409);
  const plan = z
      .enum(["starter", "professional", "enterprise"])
      .parse(data.plan),
    id = randomUUID(),
    uid = randomUUID(),
    cabinet = {
      id,
      name: str(data.name, 200),
      email,
      phone: String(data.phone || ""),
      city: String(data.city || ""),
      logoUrl: "",
      createdBy: uid,
      subscriptionPlan: plan,
      subscriptionStatus: "trialing",
      subscriptionExpiry: new Date(Date.now() + 30 * 86400000).toISOString(),
      buildings: [],
    };
  const profile = {
    uid,
    email,
    displayName: str(data.managerName || data.name, 200),
    role: "syndic",
    syndicId: id,
    mustChangePassword: true,
    emailVerified: true,
  };
  (transactionState.syndik_prod_syndics_v1 ??= []).push(cabinet);
  (transactionState.syndik_prod_registered_users_v1 ??= []).push({
    uid,
    email,
    passwordHash: hashPassword(password),
    profile,
  });
  if (data.initialBuilding) {
    const info = object(data.initialBuilding),
      count = z
        .number()
        .int()
        .min(1)
        .max(500)
        .parse(Number(info.apartmentsCount)),
      fee = cents(Number(info.monthlyFees)) / 100;
    await dispatch(actor, "addBuilding", [
      id,
      {
        name: str(info.name, 200),
        address: str(info.address, 500),
        city: cabinet.city,
        monthlySyndicFees: fee,
        syndicId: id,
        reserveFundRate: 5,
        apartments: Array.from({ length: count }, (_, i) => ({
          number: String(i + 1),
          floor: 0,
          area: 0,
          monthlyFees: fee,
          tantiemes: Math.floor(1000 / count) + (i < 1000 % count ? 1 : 0),
          ownerId: null,
          tenantId: null,
        })),
      },
    ]);
  }
  appendAudit(transactionState, actor, "adminCreateCabinet", undefined, { syndicId: id });
  return cabinet;
}

function subscriptionPayment(actor: Actor, input: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const data = object(input);
  return activatePlatformSubscription(transactionState, actor, {
    syndicId: str(data.syndicId),
    plan: z.enum(["starter", "professional", "enterprise"]).parse(data.plan),
    months: z.number().int().min(1).max(12).parse(data.months),
    reference: str(data.reference, 200),
    amountMad: cents(data.amount) / 100,
    method: "manual",
    currency: "MAD",
    chargedAmount: cents(data.amount) / 100,
    auditOperation: "recordSubscriptionPayment",
  });
}

function submitSubscriptionBankTransfer(actor: Actor, input: any) {
  manager(actor);
  const data = object(input);
  const s = cabinetFor(actor, str(data.syndicId));
  check(
    !s.archivedAt,
    "Cabinet archivé : impossible de soumettre un virement.",
    409,
  );
  check(
    s.subscriptionStatus !== "cancelled",
    "Votre compte est suspendu. Contactez l'administration pour le réactiver.",
    403,
  );

  const billing = resolvePlatformBillingConfig(transactionState).publicConfig;
  check(
    billing.bankTransfer.enabled,
    "Le paiement par virement bancaire n'est pas activé.",
    400,
  );

  const plan = z
    .enum(["starter", "professional", "enterprise"])
    .parse(data.plan);
  const activeBuildingsCount = countActiveBuildings(s.buildings);
  const planLimit = PLANS[plan].buildings;
  check(
    activeBuildingsCount <= planLimit,
    `Impossible de passer au forfait ${plan} : ${activeBuildingsCount} immeuble(s) actif(s) pour une limite de ${planLimit}. Archivez des immeubles avant de changer de forfait.`,
    409,
  );
  const months = z.number().int().min(1).max(12).parse(data.months);
  const transferReference = str(data.transferReference, 120).trim();
  check(
    transferReference.length >= 3,
    "Référence de virement invalide (min. 3 caractères).",
    400,
  );
  const bankName = str(data.bankName, 120).trim();
  check(bankName.length >= 2, "Indiquez la banque émettrice.", 400);

  const transferDate = str(data.transferDate, 32).trim();
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(transferDate),
    "Date de virement invalide (AAAA-MM-JJ).",
    400,
  );
  const [yr, mo, dy] = transferDate.split("-").map(Number);
  const utc = new Date(Date.UTC(yr, mo - 1, dy));
  check(
    utc.getUTCFullYear() === yr &&
      utc.getUTCMonth() === mo - 1 &&
      utc.getUTCDate() === dy &&
      utc.getTime() <= Date.now() + 2 * 86_400_000,
    "Date de virement invalide.",
    400,
  );

  let proofUrl: string | undefined;
  if (typeof data.proofUrl === "string" && data.proofUrl.trim()) {
    const rawProof = data.proofUrl.trim();
    const match = /^\/api\/uploads\/([A-Za-z0-9_-]+)$/.exec(rawProof);
    check(match, "Lien de justificatif invalide.", 400);
    const meta = transactionState.__files?.[match[1]];
    check(
      meta && meta.lifecycle !== "deleting",
      "Justificatif introuvable ou expiré. Téléversez-le à nouveau.",
      400,
    );
    check(
      meta.scope === "subscription" && meta.syndicId === s.id,
      "Justificatif non autorisé pour ce cabinet.",
      403,
    );
    proofUrl = rawProof;
  }

  const notes =
    typeof data.notes === "string" && data.notes.trim()
      ? data.notes.trim().slice(0, 500)
      : undefined;

  const refKey = transferReference.toLowerCase();
  const payments = transactionState.syndik_prod_subscription_payments_v1 || [];
  const requests = (transactionState.syndik_prod_subscription_requests_v1 ??= []);
  check(
    !payments.some(
      (p: any) =>
        !p.voidedAt && String(p.reference || "").toLowerCase() === refKey,
    ) &&
      !requests.some(
        (r: any) =>
          r.status !== "rejected" &&
          String(r.transferReference || "").toLowerCase() === refKey,
      ),
    "Cette référence de virement est déjà enregistrée ou en attente de validation.",
    409,
  );

  const amount = PLANS[plan].price * months;
  const reqRecord = {
    id: randomUUID(),
    syndicId: s.id,
    syndicName: s.name,
    ...(s.email ? { syndicEmail: s.email } : {}),
    plan,
    months,
    amount,
    transferReference,
    bankName,
    transferDate,
    ...(proofUrl ? { proofUrl } : {}),
    ...(notes ? { notes } : {}),
    status: "pending" as const,
    submittedBy: actor.uid,
    createdAt: new Date().toISOString(),
  };
  requests.push(reqRecord);
  appendAudit(
    transactionState,
    actor,
    "submitSubscriptionBankTransfer",
    undefined,
    {
      requestId: reqRecord.id,
      syndicId: s.id,
      plan,
      months,
      amount,
    },
  );
  return reqRecord;
}

function reviewSubscriptionBankTransfer(actor: Actor, input: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const data = object(input);
  const requestId = str(data.requestId, 120);
  const action = z.enum(["approve", "reject"]).parse(data.action);
  const requests = transactionState.syndik_prod_subscription_requests_v1 || [];
  const reqRecord = requests.find((r: any) => r.id === requestId);
  check(reqRecord, "Demande de virement introuvable.", 404);
  check(
    reqRecord.status === "pending",
    "Cette demande a déjà été traitée.",
    409,
  );

  if (action === "reject") {
    const reason = str(data.rejectionReason, 1000).trim();
    check(
      reason.length >= 3,
      "Indiquez un motif de refus (min. 3 caractères).",
      400,
    );
    reqRecord.status = "rejected";
    reqRecord.rejectionReason = reason;
    reqRecord.reviewedAt = new Date().toISOString();
    reqRecord.reviewedBy = actor.uid;
    appendAudit(
      transactionState,
      actor,
      "reviewSubscriptionBankTransfer",
      undefined,
      {
        requestId: reqRecord.id,
        syndicId: reqRecord.syndicId,
        action: "reject",
        reason,
      },
    );
    return { request: reqRecord };
  }

  const payment = activatePlatformSubscription(transactionState, actor, {
    syndicId: reqRecord.syndicId,
    plan: reqRecord.plan,
    months: reqRecord.months,
    reference: reqRecord.transferReference,
    amountMad: reqRecord.amount,
    method: "virement",
    currency: "MAD",
    chargedAmount: reqRecord.amount,
    ...(reqRecord.proofUrl ? { proofUrl: reqRecord.proofUrl } : {}),
    requestId: reqRecord.id,
    auditOperation: "reviewSubscriptionBankTransfer",
  });
  reqRecord.status = "approved";
  reqRecord.paymentId = payment.id;
  reqRecord.reviewedAt = new Date().toISOString();
  reqRecord.reviewedBy = actor.uid;
  return { request: reqRecord, payment };
}
function archiveCabinet(actor: Actor, syndicId: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const s = cabinetFor(actor, str(syndicId));
  if (!s.archivedAt) {
    s.archivedAt = new Date().toISOString();
    appendAudit(transactionState, actor, "adminArchiveCabinet", undefined, { syndicId: s.id });
  }
  return s;
}
function restoreCabinet(actor: Actor, syndicId: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const s = cabinetFor(actor, str(syndicId));
  if (s.archivedAt) {
    delete s.archivedAt;
    appendAudit(transactionState, actor, "adminRestoreCabinet", undefined, { syndicId: s.id });
  }
  return s;
}
function voidSubscriptionPayment(actor: Actor, paymentId: any, reasonArg: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const id = str(paymentId);
  const reason = str(reasonArg, 1000).trim();
  check(reason.length >= 3, "Indiquez un motif d'annulation (min. 3 caractères).", 400);
  return voidPlatformSubscriptionPayment(
    transactionState,
    actor,
    id,
    reason,
    "voidSubscriptionPayment",
  );
}
function restoreArchived(actor: Actor,args:any[]) { const operation='restoreArchived';

    manager(actor);
    let b: any;
    const [kind, id] = args;
    check(
      ["buildings", "apartments", "residents", "prestataires"].includes(kind),
      "Archive invalide.",
      400,
    );
    let item: any;
    if (kind === "buildings") {
      b = buildingFor(actor, id);
      const s = cabinetFor(actor, b.syndicId);
      check(
        !s.archivedAt,
        "Cabinet archivé : restaurez d'abord le cabinet.",
        409,
      );
      check(
        actor.role === "admin" || subscriptionCanWrite(s),
        "Abonnement expiré : renouvelez votre abonnement pour restaurer un immeuble.",
        402,
      );
      if (b.archivedAt) check(
        getBuildingCapacity(s).canAdd,
        "Limite du forfait atteinte. Archivez un immeuble actif ou changez de forfait avant cette restauration.",
        409,
      );
      item = b;
    } else if (kind === "prestataires") {
      ({ b, item } = record(actor, "syndik_prod_prestataires_v1", id));
    } else ({ b, item } = nested(actor, kind, id));
    if (kind === "apartments") links(b, item);
    delete item.archivedAt;
    const accountKeys = [
      "syndik_prod_registered_users_v1",
      "syndik_prod_resident_accounts_v1",
      "syndik_prod_prestataire_accounts_v1",
    ];
    if (kind === "prestataires") {
      item.active = true;
      const canReenable =
        !item.email ||
        accountKeys.every((key) =>
          (transactionState[key] || []).every(
            (u: any) =>
              u.disabled ||
              u.email?.toLowerCase() !== item.email.toLowerCase() ||
              u.prestataireId === item.id ||
              u.profile?.prestataireId === item.id,
          ),
        );
      if (canReenable) {
        let restoredAcc = false;
        for (const key of accountKeys) {
          for (const a of transactionState[key] || []) {
            if (a.prestataireId === item.id || a.profile?.prestataireId === item.id) {
              delete a.disabled;
              restoredAcc = true;
            }
          }
        }
        if (restoredAcc) item.hasAccount = true;
      }
    }
    if (kind === "residents") {
      if (item.apartmentId) {
        const apt = b.apartments.find(
          (a: any) => a.id === item.apartmentId && !a.archivedAt,
        );
        const occupiedByOther =
          apt &&
          (item.isOwner
            ? apt.ownerId && apt.ownerId !== item.id
            : apt.tenantId && apt.tenantId !== item.id);
        if (!apt || occupiedByOther) {
          delete item.apartmentId;
        }
      }
      const canReenable =
        !item.email ||
        accountKeys.every((key) =>
          (transactionState[key] || []).every(
            (u: any) =>
              u.disabled ||
              u.email?.toLowerCase() !== item.email.toLowerCase() ||
              u.residentId === item.id ||
              u.profile?.residentId === item.id,
          ),
        );
      if (canReenable) {
        let restoredAcc = false;
        for (const key of accountKeys) {
          for (const a of transactionState[key] || []) {
            if (a.residentId === item.id || a.profile?.residentId === item.id) {
              delete a.disabled;
              restoredAcc = true;
            }
          }
        }
        if (restoredAcc) item.hasAccount = true;
      }
    }
    appendAudit(transactionState, actor, operation, b.id, { kind, id });
    return item;

}
function archiveBuilding(actor: Actor, b: any) {
  const openVotingAg = (transactionState.syndik_prod_ag_v1 || []).some(
    (ag: any) =>
      ag.buildingId === b.id &&
      ag.isVotingOpen === true &&
      !["completed", "closed"].includes(ag.status),
  );
  check(
    !openVotingAg,
    "Impossible d'archiver l'immeuble : une Assemblée Générale a un scrutin ouvert. Clôturez le vote avant d'archiver.",
    409,
  );
  const pendingProofs = (
    transactionState.syndik_prod_payment_proofs_v1 || []
  ).some((p: any) => p.buildingId === b.id && p.status === "pending");
  check(
    !pendingProofs,
    "Impossible d'archiver l'immeuble : des justificatifs de paiement sont en attente de validation.",
    409,
  );
  b.archivedAt = new Date().toISOString();
  const buildingResidentIds = new Set(
    (b.residents || []).map((r: any) => r.id),
  );
  const buildingPrestIds = new Set(
    (transactionState.syndik_prod_prestataires_v1 || [])
      .filter((p: any) => p.buildingId === b.id)
      .map((p: any) => p.id),
  );
  for (const user of transactionState.syndik_prod_registered_users_v1 || []) {
    const prof = user?.profile;
    if (!prof || !["resident", "provider"].includes(prof.role)) continue;
    const belongsToArchivedBuilding =
      prof.buildingId === b.id ||
      (prof.residentId && buildingResidentIds.has(prof.residentId)) ||
      (prof.prestataireId && buildingPrestIds.has(prof.prestataireId));
    if (belongsToArchivedBuilding) {
      (transactionState.__sessionVersions ??= {})[user.uid] =
        (transactionState.__sessionVersions?.[user.uid] || 0) + 1;
    }
  }
  appendAudit(transactionState, actor, "deleteBuilding", b.id);
  return true;
}
return {createCabinet, archiveCabinet, restoreCabinet, subscriptionPayment, voidSubscriptionPayment, submitSubscriptionBankTransfer, reviewSubscriptionBankTransfer, restoreArchived, archiveBuilding};
}

