import type {
Announcement,
Building,
ChatMessage,
CredentialAuditEntry,
Document,
MaintenanceRequest,
MaintenanceStepUpdate,
MarketplaceItem,
Notification,
Prestataire,
PrestataireReview,
Resident,
Syndic
} from '../../types';
import {
generateSecureRandomDigits,
hashPasswordSync
} from '../../utils/security';
import {
ResidentSchema,
SyndicSchema
} from '../../utils/validation';
import { hashPassword } from '../passwords';
import type { BackendMethods,DomainContext } from './context';
import { assertContext } from './context';
import type { PrestataireAccountRecord,ResidentAccountRecord } from './records';
import { DEFAULT_MAINTENANCE_REQUESTS,DEFAULT_NOTIFICATIONS,PRESTATAIRE_ACCOUNTS_KEY,RESIDENT_ACCOUNTS_KEY,STORAGE_KEYS } from './records';
import { transactionRecords } from './state';
export function createSupportingService(context: DomainContext, peers: BackendMethods) {
assertContext(context);
const {read: getLocalItem, write: setLocalItem, write} = transactionRecords(context.state);
const saveSyndic = async (syndic: Syndic): Promise<Syndic> => {

    const normalizedSyndic: Syndic = {
        ...syndic,
        logoUrl: syndic.logoUrl ?? '',
    };
    const validation = SyndicSchema.safeParse(normalizedSyndic);
    if (!validation.success) {
        console.warn('Syndic validation warning:', validation.error.message);
    }

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    const index = syndics.findIndex((s) => s.id === normalizedSyndic.id);
    let savedSyndic: Syndic;
    if (index >= 0) {
        savedSyndic = {
            ...syndics[index],
            ...normalizedSyndic,
            logoUrl: normalizedSyndic.logoUrl ?? syndics[index].logoUrl ?? '',
            buildings: Array.isArray(normalizedSyndic.buildings)
                ? normalizedSyndic.buildings
                : syndics[index].buildings || [],
        };
        syndics[index] = savedSyndic;
    }
    else {
        savedSyndic = {
            ...normalizedSyndic,
            logoUrl: normalizedSyndic.logoUrl ?? '',
            buildings: Array.isArray(normalizedSyndic.buildings) ? normalizedSyndic.buildings : [],
        };
        syndics.unshift(savedSyndic);
    }

    setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

    return savedSyndic;
};

const addResident = async (residentData: Omit<Resident, 'id'>, generateCredentials: boolean = true): Promise<Resident> => {

    const cleanedData = {
        ...residentData,
        apartmentId: residentData.apartmentId || undefined,
        cin: residentData.cin?.trim() || undefined,
    };
    const validation = ResidentSchema.safeParse(cleanedData);
    if (!validation.success) {
        throw new Error('Invalid Resident Data: ' + validation.error.message);
    }
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
        const bld = syndic.buildings.find((b) => b.id === cleanedData.buildingId);
        if (bld && syndic.id === cleanedData.syndicId) {
            if (cleanedData.apartmentId) {
                const apt = bld.apartments.find(a => a.id === cleanedData.apartmentId && !(a as any).archivedAt);
                if (!apt) throw new Error('Lot non lié.');
                if (cleanedData.isOwner ? apt.ownerId : apt.tenantId)
                    throw new Error('Lot déjà occupé. Utilisez une affectation explicite du lot.');
            }
            const nowIso = new Date().toISOString();
            const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
            const inviteToken = generateCredentials
                ? `inv-${generateSecureRandomDigits(32).toLowerCase()}`
                : undefined;
            const auditAction: CredentialAuditEntry['action'] = 'generated';
            const persistedResident: Resident = {
                id: crypto.randomUUID(),
                ...cleanedData,
                hasAccount: !!generateCredentials,
                invitationStatus: generateCredentials ? 'pending' : undefined,
                invitationToken: inviteToken,
                invitationCode: inviteToken,
                invitationExpiresAt: generateCredentials ? inviteExpiresAt : undefined,
                credentialsCreatedAt: generateCredentials ? nowIso : undefined,
                credentialsAuditLog: generateCredentials
                    ? [{ action: auditAction, timestamp: nowIso }]
                    : [],
                mustChangePassword: generateCredentials ? true : undefined,
            };
            delete (persistedResident as any).generatedPassword;
            bld.residents.push(persistedResident);
            if (persistedResident.apartmentId) {
                const apt = bld.apartments.find((a) => a.id === persistedResident.apartmentId);
                if (apt) {
                    if (persistedResident.isOwner) {
                        apt.ownerId = persistedResident.id;
                    }
                    else {
                        apt.tenantId = persistedResident.id;
                    }
                }
            }
            if (generateCredentials && inviteToken) {
                saveResidentCredentialAccount(persistedResident, inviteToken);
            }
            setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

            return persistedResident;
        }
    }
};

function saveResidentCredentialAccount(resident: Resident, rawPassword: string): ResidentAccountRecord {
    const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
    const emailNorm = resident.email.trim().toLowerCase();
    const passwordHash = ({ hashPassword })?.hashPassword(rawPassword) || hashPasswordSync(rawPassword, emailNorm);
    const record: ResidentAccountRecord = {
        residentId: resident.id,
        email: resident.email.trim(),
        cin: resident.cin?.trim() || undefined,
        phone: resident.phone?.trim() || undefined,
        passwordHash,
        name: resident.name,
        isOwner: resident.isOwner,
        syndicId: resident.syndicId,
        buildingId: resident.buildingId,
        apartmentId: resident.apartmentId,
        createdAt: resident.credentialsCreatedAt || new Date().toISOString(),
        mustChangePassword: resident.mustChangePassword ?? true,
        invitationExpiresAt: resident.invitationExpiresAt,
    };
    const existingIdx = accounts.findIndex((a) => a.residentId === resident.id || a.email.toLowerCase() === emailNorm);
    if (existingIdx >= 0) {
        accounts[existingIdx] = record;
    }
    else {
        accounts.push(record);
    }
    setLocalItem(RESIDENT_ACCOUNTS_KEY, accounts);
    // Also synchronize any matching entry in REGISTERED_USERS so all local registries carry the complete Resident UserProfile
    try {
        const regUsers = getLocalItem<any[]>(STORAGE_KEYS.REGISTERED_USERS, []);
        const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
        let buildingName = 'Résidence';
        let apartmentNumber = resident.apartmentId || '';
        for (const s of syndics) {
            const bld = s.buildings.find((b) => b.id === resident.buildingId);
            if (bld) {
                buildingName = bld.name;
                const apt = bld.apartments.find((a) => a.id === resident.apartmentId);
                if (apt)
                    apartmentNumber = apt.number;
                break;
            }
        }
        const canonicalUid = `user-res-${resident.id}`;
        const canonicalProfile = {
            uid: canonicalUid,
            email: emailNorm,
            displayName: resident.name,
            role: 'resident' as const,
            syndicId: resident.syndicId,
            buildingId: resident.buildingId,
            buildingName,
            apartmentId: resident.apartmentId,
            apartmentNumber,
            residentId: resident.id,
            cin: resident.cin?.trim() || undefined,
            phone: resident.phone?.trim() || undefined,
            isOwner: resident.isOwner,
            mustChangePassword: resident.mustChangePassword ?? true,
        };
        const regIdx = regUsers.findIndex((u) => u?.email?.toLowerCase() === emailNorm ||
            u?.uid === canonicalUid ||
            u?.uid === `res-${resident.id}` ||
            u?.profile?.residentId === resident.id);
        const regEntry = {
            uid: canonicalUid,
            email: emailNorm,
            passwordHash,
            profile: canonicalProfile,
            createdAt: record.createdAt,
        };
        if (regIdx >= 0) {
            regUsers[regIdx] = regEntry;
        }
        else {
            regUsers.push(regEntry);
        }
        setLocalItem(STORAGE_KEYS.REGISTERED_USERS, regUsers);
    }
    catch {
    }
    return record;
}

const updateResident = async (resident: Resident): Promise<Resident> => {

    const { generatedPassword: ephemeralPassword, ...residentWithoutPassword } = resident;
    const cleanedResident: Resident = {
        ...residentWithoutPassword,
        apartmentId: resident.apartmentId || undefined,
        cin: resident.cin?.trim() || undefined,
    };
    const validation = ResidentSchema.safeParse(cleanedResident);
    if (!validation.success) {
        throw new Error('Invalid Resident Data: ' + validation.error.message);
    }
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
        const bld = syndic.buildings.find((b) => b.id === cleanedResident.buildingId);
        if (bld && syndic.id === cleanedResident.syndicId) {
            const idx = bld.residents.findIndex((r) => r.id === cleanedResident.id);
            if (idx >= 0) {
                const prevResident = bld.residents[idx];
                if (cleanedResident.isOwner !== prevResident.isOwner ||
                    (resident.apartmentId !== undefined && (cleanedResident.apartmentId || undefined) !== prevResident.apartmentId))
                    throw new Error('Utilisez une affectation explicite du lot pour modifier les associations.');
                // Apartment ownerId/tenantId associations are authoritative and nonexclusive.
                const mergedResident: Resident = {
                    ...prevResident,
                    ...cleanedResident,
                    apartmentId: prevResident.apartmentId,
                    isOwner: prevResident.isOwner,
                };
                bld.residents[idx] = mergedResident;
                if (mergedResident.hasAccount && ephemeralPassword) {
                    saveResidentCredentialAccount(mergedResident, ephemeralPassword);
                }
                else if (mergedResident.hasAccount) {
                    const activeTempPass = mergedResident.mustChangePassword !== false
                        ? mergedResident.invitationCode || mergedResident.invitationToken
                        : undefined;
                    if (activeTempPass) {
                        saveResidentCredentialAccount(mergedResident, activeTempPass);
                    }
                    else {
                        const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
                        const accIdx = accounts.findIndex((a) => a.residentId === mergedResident.id);
                        if (accIdx >= 0) {
                            accounts[accIdx] = {
                                ...accounts[accIdx],
                                email: mergedResident.email.trim(),
                                cin: mergedResident.cin?.trim() || undefined,
                                phone: mergedResident.phone?.trim() || undefined,
                                name: mergedResident.name,
                                isOwner: mergedResident.isOwner,
                                apartmentId: mergedResident.apartmentId,
                                invitationExpiresAt: mergedResident.invitationExpiresAt,
                            };
                            setLocalItem(RESIDENT_ACCOUNTS_KEY, accounts);
                        }
                    }
                }
                setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

                return mergedResident;
            }
        }
    }
};

const regenerateResidentCredentials = async (residentId: string): Promise<Resident> => {

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
        for (const bld of syndic.buildings) {
            const idx = bld.residents.findIndex((r) => r.id === residentId);
            if (idx >= 0) {
                const res = bld.residents[idx];
                const nowIso = new Date().toISOString();
                const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
                const inviteToken = `inv-${generateSecureRandomDigits(32).toLowerCase()}`;
                const prevLog = Array.isArray(res.credentialsAuditLog) ? res.credentialsAuditLog : [];
                const actionType: CredentialAuditEntry['action'] = res.hasAccount
                    ? 'regenerated'
                    : 'generated';
                const updated: Resident = {
                    ...res,
                    hasAccount: true,
                    invitationStatus: 'pending',
                    invitationToken: inviteToken,
                    invitationCode: inviteToken,
                    invitationExpiresAt: inviteExpiresAt,
                    credentialsCreatedAt: nowIso,
                    credentialsAuditLog: [
                        { action: actionType, timestamp: nowIso },
                        ...prevLog,
                    ].slice(0, 20),
                    mustChangePassword: true,
                };
                delete (updated as any).generatedPassword;
                bld.residents[idx] = updated;
                saveResidentCredentialAccount(updated, inviteToken);
                setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

                return updated;
            }
        }
    }
};

const recordResidentCredentialShare = async (residentId: string, method: 'pdf' | 'copy'): Promise<Resident | null> => {

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
        for (const bld of syndic.buildings) {
            const idx = bld.residents.findIndex((r) => r.id === residentId);
            if (idx >= 0) {
                const res = bld.residents[idx];
                const nowIso = new Date().toISOString();
                const prevLog = Array.isArray(res.credentialsAuditLog) ? res.credentialsAuditLog : [];
                const actionType: CredentialAuditEntry['action'] = method === 'pdf' ? 'shared_pdf' : 'shared_copy';
                const updated: Resident = {
                    ...res,
                    credentialsSharedAt: nowIso,
                    credentialsLastSharedMethod: method,
                    credentialsAuditLog: [
                        { action: actionType, timestamp: nowIso },
                        ...prevLog,
                    ].slice(0, 20),
                };
                bld.residents[idx] = updated;
                setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

                return updated;
            }
        }
    }
    return null;
};

const deleteResident = async (residentId: string) => {

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const syndic of syndics) {
        for (const bld of syndic.buildings) {
            const idx = bld.residents.findIndex((r) => r.id === residentId);
            if (idx >= 0) {
                bld.residents.splice(idx, 1);
                bld.apartments.forEach((apt) => {
                    if (apt.ownerId === residentId)
                        apt.ownerId = null;
                    if (apt.tenantId === residentId)
                        apt.tenantId = null;
                });
                setLocalItem(STORAGE_KEYS.SYNDICS, syndics, residentId);
                const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
                setLocalItem(RESIDENT_ACCOUNTS_KEY, accounts.filter((a) => a.residentId !== residentId), residentId);
                return true;
            }
        }
    }
    return true;
};

const savePrestataire = async (prestataire: Prestataire, generateCredentials?: boolean): Promise<Prestataire> => {

    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, []);
    const index = list.findIndex((p) => p.id === prestataire.id);
    const prev = index >= 0 ? list[index] : undefined;
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    let resolvedSyndicId = prestataire.syndicId || prev?.syndicId;
    if (!resolvedSyndicId) {
        const ownerSyndic = syndics.find((s) => s.buildings.some((b) => b.id === prestataire.buildingId));
        resolvedSyndicId = ownerSyndic?.id || syndics[0]?.id || '';
    }
    let finalPrestataire: Prestataire = {
        ...prev,
        ...prestataire,
        syndicId: resolvedSyndicId,
    };
    let ephemeralPassword: string | undefined;
    if (generateCredentials && finalPrestataire.email) {
        const nowIso = new Date().toISOString();
        const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        ephemeralPassword =
            finalPrestataire.generatedPassword || generateTempPassword(finalPrestataire.name);
        const prevLog = Array.isArray(finalPrestataire.credentialsAuditLog)
            ? finalPrestataire.credentialsAuditLog
            : [];
        const actionType: CredentialAuditEntry['action'] = prev?.hasAccount
            ? 'regenerated'
            : 'generated';
        finalPrestataire = {
            ...finalPrestataire,
            hasAccount: true,
            invitationStatus: 'pending',
            invitationToken: ephemeralPassword,
            invitationCode: ephemeralPassword,
            invitationExpiresAt: finalPrestataire.invitationExpiresAt || inviteExpiresAt,
            credentialsCreatedAt: nowIso,
            credentialsAuditLog: [
                { action: actionType, timestamp: nowIso },
                ...prevLog,
            ].slice(0, 20),
            mustChangePassword: finalPrestataire.mustChangePassword ?? true,
        };
        delete (finalPrestataire as any).generatedPassword;
        savePrestataireCredentialAccount(finalPrestataire, ephemeralPassword);
    }
    else if (finalPrestataire.hasAccount && finalPrestataire.generatedPassword && finalPrestataire.email) {
        ephemeralPassword = finalPrestataire.generatedPassword;
        finalPrestataire.invitationToken = finalPrestataire.invitationToken || ephemeralPassword;
        finalPrestataire.invitationCode = finalPrestataire.invitationCode || ephemeralPassword;
        finalPrestataire.invitationExpiresAt =
            finalPrestataire.invitationExpiresAt || new Date(Date.now() + 7 * 86400000).toISOString();
        delete (finalPrestataire as any).generatedPassword;
        savePrestataireCredentialAccount(finalPrestataire, ephemeralPassword);
    }
    else if (finalPrestataire.hasAccount && finalPrestataire.email) {
        const activeTempPass = finalPrestataire.mustChangePassword !== false
            ? finalPrestataire.invitationToken || finalPrestataire.invitationCode
            : undefined;
        if (activeTempPass) {
            savePrestataireCredentialAccount(finalPrestataire, activeTempPass);
        }
        else {
            const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
            const accIdx = accounts.findIndex((a) => a.prestataireId === finalPrestataire.id);
            if (accIdx >= 0) {
                accounts[accIdx] = {
                    ...accounts[accIdx],
                    email: finalPrestataire.email.trim(),
                    name: finalPrestataire.name,
                    contactPerson: finalPrestataire.contactPerson,
                    category: finalPrestataire.category,
                    syndicId: finalPrestataire.syndicId,
                    buildingId: finalPrestataire.buildingId,
                    invitationExpiresAt: finalPrestataire.invitationExpiresAt,
                };
                setLocalItem(PRESTATAIRE_ACCOUNTS_KEY, accounts);
            }
        }
    }
    if (index >= 0) {
        list[index] = finalPrestataire;
    }
    else {
        list.unshift(finalPrestataire);
    }
    setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);

    return {
        ...finalPrestataire,
        ...(ephemeralPassword ? { generatedPassword: ephemeralPassword } : {}),
    };
};

function generateTempPassword(name: string): string {
    const cleanPrefix = name
        .replace(/[^a-zA-Z]/g, '')
        .slice(0, 4)
        .toUpperCase() || 'RES';
    const digits = generateSecureRandomDigits(32);
    return `Syndik-${cleanPrefix}${digits}!`;
}

function savePrestataireCredentialAccount(prestataire: Prestataire, rawPassword: string): PrestataireAccountRecord {
    const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
    const emailNorm = prestataire.email.trim().toLowerCase();
    const passwordHash = hashPasswordSync(rawPassword, emailNorm);
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    let resolvedSyndicId = prestataire.syndicId;
    let buildingName = 'Résidence';
    for (const s of syndics) {
        const bld = s.buildings.find((b) => b.id === prestataire.buildingId);
        if (bld) {
            buildingName = bld.name;
            resolvedSyndicId = s.id;
            break;
        }
    }
    if (!resolvedSyndicId && syndics.length > 0) {
        resolvedSyndicId = syndics[0].id;
    }
    const record: PrestataireAccountRecord = {
        prestataireId: prestataire.id,
        email: prestataire.email.trim(),
        passwordHash,
        name: prestataire.name,
        contactPerson: prestataire.contactPerson,
        category: prestataire.category,
        syndicId: resolvedSyndicId || prestataire.syndicId,
        buildingId: prestataire.buildingId,
        createdAt: prestataire.credentialsCreatedAt || new Date().toISOString(),
        mustChangePassword: prestataire.mustChangePassword ?? true,
        invitationExpiresAt: prestataire.invitationExpiresAt,
    };
    const existingIdx = accounts.findIndex((a) => a.prestataireId === prestataire.id ||
        (prestataire.email && a.email.toLowerCase() === emailNorm));
    if (existingIdx >= 0) {
        accounts[existingIdx] = record;
    }
    else {
        accounts.push(record);
    }
    setLocalItem(PRESTATAIRE_ACCOUNTS_KEY, accounts);
    // Synchronize REGISTERED_USERS so all local registries carry the complete Provider UserProfile
    try {
        const regUsers = getLocalItem<any[]>(STORAGE_KEYS.REGISTERED_USERS, []);
        const canonicalUid = `user-prest-${prestataire.id}`;
        const canonicalProfile = {
            uid: canonicalUid,
            email: emailNorm,
            displayName: prestataire.name,
            role: 'provider' as const,
            syndicId: record.syndicId,
            buildingId: prestataire.buildingId,
            buildingName,
            prestataireId: prestataire.id,
            prestataireCategory: prestataire.category,
            providerCategory: prestataire.category,
            phone: prestataire.phone?.trim() || undefined,
            mustChangePassword: prestataire.mustChangePassword ?? true,
        };
        const regIdx = regUsers.findIndex((u) => u?.email?.toLowerCase() === emailNorm ||
            u?.uid === canonicalUid ||
            u?.uid === `prov-${prestataire.id}` ||
            u?.profile?.prestataireId === prestataire.id);
        const regEntry = {
            uid: canonicalUid,
            email: emailNorm,
            passwordHash,
            profile: canonicalProfile,
            createdAt: record.createdAt,
        };
        if (regIdx >= 0) {
            regUsers[regIdx] = regEntry;
        }
        else {
            regUsers.push(regEntry);
        }
        setLocalItem(STORAGE_KEYS.REGISTERED_USERS, regUsers);
    }
    catch {
    }
    return record;
}

const regeneratePrestataireCredentials = async (prestataireId: string): Promise<Prestataire> => {

    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, []);
    const idx = list.findIndex((p) => p.id === prestataireId);
    if (idx >= 0) {
        const prest = list[idx];
        const nowIso = new Date().toISOString();
        const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        const fallbackEmail = prest.email?.trim() ||
            `contact@${prest.name
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .slice(0, 12) || 'prestataire'}.ma`;
        const newPassword = generateTempPassword(prest.name);
        const prevLog = Array.isArray(prest.credentialsAuditLog) ? prest.credentialsAuditLog : [];
        const actionType: CredentialAuditEntry['action'] = prest.hasAccount
            ? 'regenerated'
            : 'generated';
        const updated: Prestataire = {
            ...prest,
            email: fallbackEmail,
            hasAccount: true,
            invitationStatus: 'pending',
            invitationToken: newPassword,
            invitationCode: newPassword,
            invitationExpiresAt: inviteExpiresAt,
            credentialsCreatedAt: nowIso,
            credentialsAuditLog: [
                { action: actionType, timestamp: nowIso },
                ...prevLog,
            ].slice(0, 20),
            mustChangePassword: true,
        };
        delete (updated as any).generatedPassword;
        list[idx] = updated;
        savePrestataireCredentialAccount(updated, newPassword);
        setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);

        return { ...updated, generatedPassword: newPassword };
    }
};

const recordPrestataireCredentialShare = async (prestataireId: string, method: 'pdf' | 'copy'): Promise<Prestataire | null> => {

    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, []);
    const idx = list.findIndex((p) => p.id === prestataireId);
    if (idx >= 0) {
        const prest = list[idx];
        const nowIso = new Date().toISOString();
        const prevLog = Array.isArray(prest.credentialsAuditLog) ? prest.credentialsAuditLog : [];
        const actionType: CredentialAuditEntry['action'] = method === 'pdf' ? 'shared_pdf' : 'shared_copy';
        const updated: Prestataire = {
            ...prest,
            credentialsSharedAt: nowIso,
            credentialsLastSharedMethod: method,
            credentialsAuditLog: [
                { action: actionType, timestamp: nowIso },
                ...prevLog,
            ].slice(0, 20),
        };
        list[idx] = updated;
        setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
        return updated;
    }
    return null;
};

const deletePrestataire = async (prestataireId: string): Promise<boolean> => {

    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, []);
    const filtered = list.filter((p) => p.id !== prestataireId);
    setLocalItem(STORAGE_KEYS.PRESTATAIRES, filtered, prestataireId);
    const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
    setLocalItem(PRESTATAIRE_ACCOUNTS_KEY, accounts.filter((a) => a.prestataireId !== prestataireId), prestataireId);
    return true;
};

const addPrestataireReview = async (prestataireId: string, review: Omit<PrestataireReview, 'id' | 'date'>): Promise<Prestataire | null> => {

    const newRev: PrestataireReview = {
        id: `rev-${crypto.randomUUID()}`,
        date: new Date().toISOString().split('T')[0],
        ...review,
    };
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, []);
    const prest = list.find((p) => p.id === prestataireId);
    if (prest) {
        prest.reviews = prest.reviews || [];
        prest.reviews.unshift(newRev);
        prest.reviewsCount = prest.reviews.length;
        const total = prest.reviews.reduce((sum, r) => sum + r.rating, 0);
        prest.rating = Math.round((total / prest.reviews.length) * 10) / 10;
        setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
        return prest;
    }
    return null;
};

const addMaintenanceRequest = async (request: Omit<MaintenanceRequest, 'id'>) => {

    const normalizedDraft = normalizeMaintenanceRequestApartment({
        id: crypto.randomUUID(),
        ...request,
    });
    const initialUpdate: MaintenanceStepUpdate = {
        id: `upd-${crypto.randomUUID()}`,
        status: normalizedDraft.status || 'pending',
        title: 'Signalement créé et transmis au Syndic',
        note: normalizedDraft.description,
        updatedBy: normalizedDraft.residentName
            ? `${normalizedDraft.residentName}${normalizedDraft.apartmentNumber ? ` (${normalizedDraft.apartmentNumber})` : ''}`
            : 'Copropriétaire',
        updatedByRole: 'resident',
        timestamp: normalizedDraft.createdAt || new Date().toISOString(),
        photos: normalizedDraft.photos ||
            (normalizedDraft.photoUrl ? [normalizedDraft.photoUrl] : undefined),
    };
    const newReq: MaintenanceRequest = {
        ...normalizedDraft,
        updates: normalizedDraft.updates && normalizedDraft.updates.length > 0
            ? normalizedDraft.updates
            : [initialUpdate],
    };
    const list = getLocalItem<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, DEFAULT_MAINTENANCE_REQUESTS);
    list.unshift(newReq);
    setLocalItem(STORAGE_KEYS.MAINTENANCE, list);
    return newReq;
};

function normalizeMaintenanceRequestApartment(req: MaintenanceRequest): MaintenanceRequest {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    let targetBld: Building | undefined;
    for (const s of syndics) {
        const found = s.buildings.find((b) => b.id === req.buildingId);
        if (found) {
            targetBld = found;
            break;
        }
    }
    if (!targetBld)
        return req;
    const apartments = targetBld.apartments || [];
    const residents = targetBld.residents || [];
    const resObj = residents.find((r) => r.id === req.residentId ||
        `res-${r.id}` === req.residentId ||
        (req.residentName && r.name.trim().toLowerCase() === req.residentName.trim().toLowerCase()));
    const resolveAptNum = (aptId?: string): string | undefined => {
        if (!aptId)
            return undefined;
        const direct = apartments.find((a) => a.id === aptId);
        if (direct?.number && !direct.number.startsWith('apt-')) {
            return direct.number.replace(/^(Lot|شقة)\s+/i, '').trim();
        }
        const idxMatch = aptId.match(/apt-\d+-(\d+)/);
        if (idxMatch) {
            const idx = parseInt(idxMatch[1], 10);
            const byIdx = apartments[idx];
            if (byIdx?.number && !byIdx.number.startsWith('apt-')) {
                return byIdx.number.replace(/^(Lot|شقة)\s+/i, '').trim();
            }
            return String(idx + 1);
        }
        return undefined;
    };
    let resolvedNumber = req.apartmentNumber;
    const linkedApt = (resObj?.apartmentId && apartments.find((a) => a.id === resObj.apartmentId)) ||
        apartments.find((a) => a.ownerId === req.residentId ||
            a.tenantId === req.residentId ||
            (resObj && (a.ownerId === resObj.id || a.tenantId === resObj.id)));
    if (linkedApt?.number && !linkedApt.number.startsWith('apt-')) {
        resolvedNumber = `Lot ${linkedApt.number.replace(/^(Lot|شقة)\s+/i, '').trim()}`;
    }
    else if (req.apartmentNumber && /apt-[\w-]+/.test(req.apartmentNumber)) {
        const idMatch = req.apartmentNumber.match(/apt-[\w-]+/);
        const num = resolveAptNum(idMatch?.[0]) || resolveAptNum(resObj?.apartmentId);
        if (num)
            resolvedNumber = `Lot ${num}`;
    }
    else if (!req.apartmentNumber && resObj?.apartmentId) {
        const num = resolveAptNum(resObj.apartmentId);
        if (num)
            resolvedNumber = `Lot ${num}`;
    }
    return {
        ...req,
        residentName: req.residentName || resObj?.name,
        apartmentNumber: resolvedNumber,
    };
}

const updateMaintenanceRequest = async (id: string, updates: Partial<MaintenanceRequest>, stepInfo?: {
    title?: string;
    note?: string;
    updatedBy?: string;
    updatedByRole?: 'syndic' | 'resident' | 'provider';
    stepPhotos?: string[];
}) => {

    const list = getLocalItem<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, DEFAULT_MAINTENANCE_REQUESTS);
    const idx = list.findIndex((m) => m.id === id);
    if (idx >= 0) {
        const existing = list[idx];
        const mergedPhotos = stepInfo?.stepPhotos?.length
            ? [
                ...(existing.photos || (existing.photoUrl ? [existing.photoUrl] : [])),
                ...stepInfo.stepPhotos,
            ]
            : updates.photos || existing.photos;
        const existingUpdates = existing.updates || [];
        const nextUpdates = [...existingUpdates];
        if (stepInfo &&
            (stepInfo.note ||
                stepInfo.title ||
                updates.status !== existing.status ||
                stepInfo.stepPhotos?.length)) {
            const statusLabel = (updates.status || existing.status) === 'completed'
                ? 'Intervention clôturée et vérifiée'
                : (updates.status || existing.status) === 'in_progress'
                    ? 'Intervention en cours / Mise à jour de suivi'
                    : 'Mise à jour du dossier';
            const newStep: MaintenanceStepUpdate = {
                id: `upd-${crypto.randomUUID()}`,
                status: updates.status || existing.status,
                title: stepInfo.title || statusLabel,
                note: stepInfo.note ||
                    updates.syndicNotes ||
                    `Statut mis à jour vers : ${updates.status || existing.status}`,
                updatedBy: stepInfo.updatedBy || 'SyndicPro Gestion (Bureau Syndic)',
                updatedByRole: stepInfo.updatedByRole || 'syndic',
                timestamp: new Date().toISOString(),
                photos: stepInfo.stepPhotos?.length ? stepInfo.stepPhotos : undefined,
                assignedTo: updates.assignedTo || existing.assignedTo,
                cost: updates.cost !== undefined ? updates.cost : existing.cost,
            };
            nextUpdates.push(newStep);
        }
        list[idx] = {
            ...existing,
            ...updates,
            photos: mergedPhotos,
            photoUrl: mergedPhotos && mergedPhotos.length > 0 ? mergedPhotos[0] : existing.photoUrl,
            updates: nextUpdates,
        };
        setLocalItem(STORAGE_KEYS.MAINTENANCE, list);
        return list[idx];
    }
    return { id, ...updates };
};

const addAnnouncement = async (buildingId: string, announcementData: {
    title: string;
    content: string;
    priority?: 'normal' | 'urgent';
}): Promise<Announcement> => {

    const newAnn: Announcement = {
        id: crypto.randomUUID(),
        title: announcementData.title,
        content: announcementData.content,
        date: new Date().toISOString(),
        priority: announcementData.priority || 'normal',
    };
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const s of syndics) {
        const bld = s.buildings.find((b) => b.id === buildingId);
        if (bld) {
            bld.announcements = bld.announcements || [];
            bld.announcements.unshift(newAnn);
            setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

            return newAnn;
        }
    }
};

const deleteDocument = async (docToDelete: Document): Promise<boolean> => {

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    for (const s of syndics) {
        for (const bld of s.buildings) {
            if (bld.documents) {
                bld.documents = bld.documents.filter((d) => d.id !== docToDelete.id);
            }
        }
    }
    setLocalItem(STORAGE_KEYS.SYNDICS, syndics, docToDelete.id);
    return true;
};

const markNotificationAsRead = async (notificationId: string) => {

    const list = getLocalItem<Notification[]>(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
    const updated = list.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
    setLocalItem(STORAGE_KEYS.NOTIFICATIONS, updated);
    return true;
};

const sendChatMessage = async (message: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> => {

    const newMsg: ChatMessage = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...message,
    };
    const list = getLocalItem<ChatMessage[]>(STORAGE_KEYS.CHAT, []);
    list.push(newMsg);
    setLocalItem(STORAGE_KEYS.CHAT, list);
    return newMsg;
};

const toggleChatMessageLike = async (messageId: string, userId: string): Promise<ChatMessage | null> => {

    const list = getLocalItem<ChatMessage[]>(STORAGE_KEYS.CHAT, []);
    const msg = list.find((m) => m.id === messageId);
    if (msg) {
        msg.likes = msg.likes || [];
        if (msg.likes.includes(userId)) {
            msg.likes = msg.likes.filter((id) => id !== userId);
        }
        else {
            msg.likes.push(userId);
        }
        setLocalItem(STORAGE_KEYS.CHAT, list);
        return msg;
    }
};

const addMarketplaceItem = async (item: Omit<MarketplaceItem, 'id' | 'createdAt'>): Promise<MarketplaceItem> => {

    const newItem: MarketplaceItem = {
        id: `item-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        ...item,
    };
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, []);
    list.unshift(newItem);
    setLocalItem(STORAGE_KEYS.MARKETPLACE, list);
    return newItem;
};

const updateMarketplaceItemStatus = async (itemId: string, status: MarketplaceItem['status']): Promise<boolean> => {

    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, []);
    const it = list.find((i) => i.id === itemId);
    if (it) {
        it.status = status;
        setLocalItem(STORAGE_KEYS.MARKETPLACE, list);
        return true;
    }
    return false;
};

const deleteMarketplaceItem = async (itemId: string): Promise<boolean> => {

    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, []);
    const filtered = list.filter((i) => i.id !== itemId);
    setLocalItem(STORAGE_KEYS.MARKETPLACE, filtered, itemId);
    return true;
};
return {saveSyndic, addResident, saveResidentCredentialAccount, updateResident, regenerateResidentCredentials, recordResidentCredentialShare, deleteResident, savePrestataire, generateTempPassword, savePrestataireCredentialAccount, regeneratePrestataireCredentials, recordPrestataireCredentialShare, deletePrestataire, addPrestataireReview, addMaintenanceRequest, normalizeMaintenanceRequestApartment, updateMaintenanceRequest, addAnnouncement, deleteDocument, markNotificationAsRead, sendChatMessage, toggleChatMessageLike, addMarketplaceItem, updateMarketplaceItemStatus, deleteMarketplaceItem};
}

