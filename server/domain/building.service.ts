import type { AddBuildingCommand } from '../../shared/domain/commands';
import { getBuildingReserveRate } from '../../shared/domain/money';
import { getBuildingCapacity } from '../../shared/domain/subscription';
import type { Apartment, Building, Syndic } from '../../types';
import { ApartmentSchema, BuildingSchema } from '../../utils/validation';
import { hashPassword } from '../passwords';
import type { DomainContext } from './context';
import { assertContext } from './context';
import { STORAGE_KEYS } from './records';
import { transactionRecords } from './state';
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
      throw new Error('Invalid Building Data: ' + validation.error.message);
    }

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    const syndic = syndics.find((s) => s.id === syndicId);
    if (!syndic) throw new Error('Syndic introuvable ou non autorisé');
    // Audit Item 21: Enforce subscription status & building limits
    const isExpired =
      syndic.subscriptionStatus === 'expired' ||
      syndic.subscriptionStatus === 'cancelled' ||
      (syndic.subscriptionExpiry &&
        new Date(syndic.subscriptionExpiry).getTime() < Date.now());
    if (isExpired) {
      throw new Error(
        'Abonnement expiré. Veuillez renouveler votre abonnement pour ajouter un nouvel immeuble.',
      );
    }
    const { limit: maxBuildings, canAdd } = getBuildingCapacity(syndic);
    if (!canAdd) {
      throw new Error(
        `Limite atteinte pour le forfait ${syndic.subscriptionPlan} (${maxBuildings} immeuble(s) max).`,
      );
    }
    const newBuildingId = crypto.randomUUID();
    const totalLots = apartments?.length || 0;
    const baseTantiemes = totalLots > 0 ? Math.floor(1000 / totalLots) : 100;
    const remainderTantiemes =
      totalLots > 0 ? 1000 - baseTantiemes * totalLots : 0;
    const generatedApts: Apartment[] = (apartments || []).map((apt, idx) => ({
      id: `apt-${crypto.randomUUID()}`,
      buildingId: newBuildingId,
      number: apt.number,
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
      monthlySyndicFees: coreBuilding.monthlySyndicFees,
      totalTantiemes: 1000,
      reserveFundRate: validation.data.reserveFundRate,
      bankName: coreBuilding.bankName,
      bankRib: coreBuilding.bankRib,
      managerName: coreBuilding.managerName,
      managerPhone: coreBuilding.managerPhone,
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
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const idx = syndic.buildings.findIndex((b) => b.id === buildingId);
      if (idx >= 0) {
        const bld = syndic.buildings[idx];
        const updatedBuilding: Building = {
          ...bld,
          ...buildingUpdates,
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
      throw new Error('Invalid Apartment Data: ' + validation.error.message);
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
          monthlyFees: apartmentData.monthlyFees ?? bld.monthlySyndicFees,
          tantiemes: apartmentData.tantiemes ?? 100,
          coproType: apartmentData.coproType ?? 'apartment',
        };
        bld.apartments.push(newApt);
        if (newApt.ownerId) {
          const owner = bld.residents.find((r) => r.id === newApt.ownerId);
          if (owner) owner.apartmentId = newApt.id;
        }
        if (newApt.tenantId) {
          const tenant = bld.residents.find((r) => r.id === newApt.tenantId);
          if (tenant) tenant.apartmentId = newApt.id;
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
          bld.apartments.map((a) => a.number.trim().toLowerCase()),
        );
        const createdApartments: Apartment[] = [];
        const baseTimestamp = Date.now();
        apartmentsList.forEach((aptData, idx) => {
          const normalizedNum = aptData.number.trim().toLowerCase();
          if (existingNumbers.has(normalizedNum)) return;
          existingNumbers.add(normalizedNum);
          const newApt: Apartment = {
            id: `apt-${baseTimestamp}-${idx}`,
            buildingId,
            number: aptData.number.trim(),
            floor: Number(aptData.floor) || 0,
            area: Number(aptData.area) || 60,
            monthlyFees:
              aptData.monthlyFees !== undefined && aptData.monthlyFees !== null
                ? Number(aptData.monthlyFees)
                : bld.monthlySyndicFees,
            tantiemes: Number(aptData.tantiemes) || 100,
            coproType: aptData.coproType || 'apartment',
            ownerId: aptData.ownerId || null,
            tenantId: aptData.tenantId || null,
          };
          bld.apartments.push(newApt);
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
        const totalArea = bld.apartments.reduce(
          (sum, a) => sum + (Number(a.area) || 1),
          0,
        );
        let allocated = 0;
        bld.apartments = bld.apartments.map((apt, idx) => {
          if (idx === bld.apartments.length - 1) {
            return { ...apt, tantiemes: Math.max(1, 1000 - allocated) };
          }
          const share = Math.max(
            1,
            Math.round(((Number(apt.area) || 1) / totalArea) * 1000),
          );
          allocated += share;
          return { ...apt, tantiemes: share };
        });
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

        return bld.apartments;
      }
    }
  };

  const updateApartment = async (apartment: Apartment) => {
    const validation = ApartmentSchema.safeParse(apartment);
    if (!validation.success) {
      throw new Error('Invalid Apartment Data: ' + validation.error.message);
    }
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === apartment.buildingId);
      if (bld) {
        const idx = bld.apartments.findIndex((a) => a.id === apartment.id);
        if (idx >= 0) {
          const prevApt = bld.apartments[idx];
          bld.apartments[idx] = { ...prevApt, ...apartment };
          if (prevApt.ownerId && prevApt.ownerId !== apartment.ownerId) {
            const oldOwner = bld.residents.find(
              (r) => r.id === prevApt.ownerId,
            );
            if (oldOwner && oldOwner.apartmentId === apartment.id) {
              const otherOwned = bld.apartments.find(
                (a) =>
                  a.id !== apartment.id &&
                  (a.ownerId === oldOwner.id || a.tenantId === oldOwner.id),
              );
              oldOwner.apartmentId = otherOwned?.id || undefined;
            }
          }
          if (prevApt.tenantId && prevApt.tenantId !== apartment.tenantId) {
            const oldTenant = bld.residents.find(
              (r) => r.id === prevApt.tenantId,
            );
            if (oldTenant && oldTenant.apartmentId === apartment.id) {
              const otherRented = bld.apartments.find(
                (a) =>
                  a.id !== apartment.id &&
                  (a.ownerId === oldTenant.id || a.tenantId === oldTenant.id),
              );
              oldTenant.apartmentId = otherRented?.id || undefined;
            }
          }
          if (apartment.ownerId) {
            const newOwner = bld.residents.find(
              (r) => r.id === apartment.ownerId,
            );
            if (newOwner) newOwner.apartmentId = apartment.id;
          }
          if (apartment.tenantId) {
            const newTenant = bld.residents.find(
              (r) => r.id === apartment.tenantId,
            );
            if (newTenant) newTenant.apartmentId = apartment.id;
          }
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

          return apartment;
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
                (a) => a.ownerId === res.id || a.tenantId === res.id,
              );
              res.apartmentId = fallbackApt?.id || undefined;
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
import { PLANS } from '../../shared/domain/subscription';
import { subscriptionCanWrite } from '../../utils/subscriptionPolicy';
import type { State } from '../repository';
import type { CommandDependencies } from './dependencies';
import type { Actor } from './errors';


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
  check(
    !(transactionState.syndik_prod_registered_users_v1 || []).some(
      (u: any) => u.email === email,
    ),
    "Compte déjà existant.",
    409,
  );
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
  const state = transactionState,
    data = object(input),
    s = cabinetFor(actor, str(data.syndicId)),
    plan = z.enum(["starter", "professional", "enterprise"]).parse(data.plan),
    months = z.number().int().min(1).max(12).parse(data.months),
    reference = str(data.reference, 200),
    amount = cents(data.amount);
  check(
    amount === PLANS[plan].price * months * 100,
    "Montant incompatible avec le forfait.",
    400,
  );
  check(
    !(transactionState.syndik_prod_subscription_payments_v1 || []).some(
      (p: any) => p.reference === reference,
    ),
    "Référence déjà utilisée.",
    409,
  );
  const expiry = new Date(
    Math.max(Date.now(), Date.parse(s.subscriptionExpiry) || 0),
  );
  const originalDay = expiry.getUTCDate();
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  expiry.setUTCDate(
    Math.min(
      originalDay,
      new Date(
        Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  Object.assign(s, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionExpiry: expiry.toISOString(),
  });
  const payment = {
    id: randomUUID(),
    syndicId: s.id,
    plan,
    months,
    reference,
    amount: amount / 100,
    recordedBy: actor.uid,
    createdAt: new Date().toISOString(),
  };
  (transactionState.syndik_prod_subscription_payments_v1 ??= []).push(payment);
  appendAudit(transactionState, actor, "recordSubscriptionPayment", undefined, {
    paymentId: payment.id,
    syndicId: s.id,
  });
  return payment;
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
        subscriptionCanWrite(s),
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
    appendAudit(transactionState, actor, operation, b.id, { kind, id });
    return item;

}
function archiveBuilding(actor: Actor,b:any) { b.archivedAt=new Date().toISOString(); appendAudit(transactionState,actor,'deleteBuilding',b.id); return true; }
return {createCabinet, subscriptionPayment, restoreArchived, archiveBuilding};
}

