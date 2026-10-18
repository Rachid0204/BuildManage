import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { auth, db, OperationType, handleFirestoreError } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { UserProfile, UserRole, Syndic, Prestataire, SubscriptionPlan, Apartment } from '../types';
import {
  getSyndics,
  saveSyndic,
  addBuilding,
  addResident,
  updateResident,
  savePrestataire,
  STORAGE_KEYS,
  syncAllSharedStateFromServer,
  pushKeyToSharedServer,
} from '../firebase/services';

const SESSION_USER_KEY = 'syndik_prod_user_session_v1';

export const getHomeRouteForRole = (role?: UserRole): string => {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'resident':
      return '/resident';
    case 'provider':
      return '/provider';
    case 'syndic':
    default:
      return '/';
  }
};

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  loginWithGoogle: () => Promise<UserProfile>;
  loginWithEmail: (identifier: string, pass: string) => Promise<UserProfile>;
  login: (email: string, role?: UserRole) => Promise<UserProfile>;
  register: (
    email: string,
    pass: string,
    name: string,
    role: UserRole,
    extra?: {
      phone?: string;
      cin?: string;
      companyName?: string;
      city?: string;
      subscriptionPlan?: SubscriptionPlan;
      initialBuildingName?: string;
      initialBuildingAddress?: string;
      initialBuildingFees?: number;
      initialApartmentsCount?: number;
      buildingId?: string;
      apartmentId?: string;
      isOwner?: boolean;
      category?: Prestataire['category'];
      ice?: string;
      rc?: string;
      hourlyRate?: string;
    }
  ) => Promise<UserProfile>;
  changePassword: (newPassword: string) => Promise<void>;
  registerOrUpdateUserCredentials: (
    email: string,
    password: string,
    profile: UserProfile
  ) => void;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isSyndic: boolean;
  isResident: boolean;
  isProvider: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const createSessionFirebaseUser = (profile: UserProfile): User =>
  ({
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName,
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => 'session-token',
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: profile.phone || null,
    photoURL: profile.photoURL || null,
  } as unknown as User);

async function syncUserProfileToFirestoreIfAuthenticated(profile: UserProfile): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified || fbUser.uid !== profile.uid) return;

  const cleanProfile: Record<string, any> = {
    uid: String(profile.uid).slice(0, 128),
    email: String(profile.email || fbUser.email || 'user@syndik.ma').slice(0, 254),
    displayName: String(profile.displayName || 'Utilisateur Syndik').slice(0, 150),
    role: ['admin', 'syndic', 'resident', 'provider'].includes(profile.role)
      ? profile.role
      : 'syndic',
  };
  if (profile.syndicId) cleanProfile.syndicId = String(profile.syndicId).slice(0, 128);
  if (profile.buildingId) cleanProfile.buildingId = String(profile.buildingId).slice(0, 128);
  if (profile.buildingName) cleanProfile.buildingName = String(profile.buildingName).slice(0, 200);
  if (profile.apartmentId) cleanProfile.apartmentId = String(profile.apartmentId).slice(0, 128);
  if (profile.apartmentNumber) cleanProfile.apartmentNumber = String(profile.apartmentNumber).slice(0, 64);
  if (typeof profile.isOwner === 'boolean') cleanProfile.isOwner = profile.isOwner;
  if (profile.cin) cleanProfile.cin = String(profile.cin).slice(0, 32);
  if (profile.phone) cleanProfile.phone = String(profile.phone).slice(0, 40);
  if (profile.photoURL) cleanProfile.photoURL = String(profile.photoURL).slice(0, 500);
  if (typeof profile.mustChangePassword === 'boolean') {
    cleanProfile.mustChangePassword = profile.mustChangePassword;
  }

  try {
    await setDoc(doc(db, 'users', cleanProfile.uid), cleanProfile);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `users/${cleanProfile.uid}`);
      } catch {
        // Logged structured FirestoreErrorInfo
      }
    }
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const applySession = (profile: UserProfile): UserProfile => {
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(profile));
    setCurrentUser(auth.currentUser || createSessionFirebaseUser(profile));
    setUserProfile(profile);
    return profile;
  };

  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      // Remove legacy mock session key
      localStorage.removeItem('syndik_mock_user');
      await syncAllSharedStateFromServer();
      const storedUser = localStorage.getItem(SESSION_USER_KEY);
      if (storedUser && isMounted) {
        try {
          const user = JSON.parse(storedUser) as UserProfile;
          setCurrentUser(auth.currentUser || createSessionFirebaseUser(user));
          setUserProfile(user);
        } catch (e) {
          console.error('Failed to parse stored session:', e);
          localStorage.removeItem(SESSION_USER_KEY);
        }
      }
      if (isMounted) {
        setLoading(false);
      }
    };

    void initSession();

    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser || !isMounted) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
        if (userDoc.exists() && isMounted) {
          const data = userDoc.data() as UserProfile;
          localStorage.setItem(SESSION_USER_KEY, JSON.stringify(data));
          setCurrentUser(fbUser);
          setUserProfile(data);
        }
      } catch {
        // Ignore if user doc not created yet
      }
    });

    const handleStateUpdated = () => {
      void queryClient.invalidateQueries({ queryKey: ['syndics'] });
      void queryClient.invalidateQueries({ queryKey: ['prestataires'] });
    };

    window.addEventListener('syndik-state-updated', handleStateUpdated);
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('syndik_realtime_sync');
      bc.onmessage = () => {
        void syncAllSharedStateFromServer().then(() => {
          void queryClient.invalidateQueries({ queryKey: ['syndics'] });
          void queryClient.invalidateQueries({ queryKey: ['prestataires'] });
        });
      };
    }

    return () => {
      isMounted = false;
      unsubscribeAuth();
      window.removeEventListener('syndik-state-updated', handleStateUpdated);
      bc?.close();
    };
  }, [queryClient]);

  const loginWithGoogle = async (): Promise<UserProfile> => {
    await syncAllSharedStateFromServer();
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const isSuperAdminEmail =
      user.email?.toLowerCase() === 'wahbi.rachid@gmail.com' ||
      user.email?.toLowerCase() === 'admin@syndik.ma';

    if (isSuperAdminEmail) {
      const adminProfile: UserProfile = {
        uid: user.uid,
        email: user.email || 'wahbi.rachid@gmail.com',
        displayName: user.displayName || 'Super Admin SaaS (Syndik Maroc)',
        role: 'admin',
        photoURL: user.photoURL || undefined,
      };
      await syncUserProfileToFirestoreIfAuthenticated(adminProfile);
      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
      return applySession(adminProfile);
    }

    const userDocRef = doc(db, 'users', user.uid);
    try {
      const userDoc = await getDoc(userDocRef);
      if (userDoc.exists()) {
        const existing = userDoc.data() as UserProfile;
        await queryClient.invalidateQueries({ queryKey: ['syndics'] });
        return applySession(existing);
      }
    } catch {
      // Proceed to create profile
    }

    const syndics = await getSyndics();
    const cleanEmail = (user.email || '').trim().toLowerCase();
    let matchedSyndic = syndics.find(
      (s) => s.email?.trim().toLowerCase() === cleanEmail || s.createdBy === user.uid
    );

    if (!matchedSyndic) {
      const newSyndicId = `syndic-${Date.now()}`;
      const trialExpires = new Date();
      trialExpires.setDate(trialExpires.getDate() + 365);
      matchedSyndic = await saveSyndic({
        id: newSyndicId,
        name: user.displayName ? `Cabinet ${user.displayName}` : 'Cabinet Syndic',
        createdBy: user.uid,
        subscriptionPlan: 'professional',
        subscriptionStatus: 'active',
        subscriptionExpiry: trialExpires.toISOString(),
        email: cleanEmail,
        city: 'Casablanca',
        buildings: [],
      });
    }

    const newProfile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || matchedSyndic.name,
      role: 'syndic',
      syndicId: matchedSyndic.id,
      photoURL: user.photoURL || undefined,
    };

    await syncUserProfileToFirestoreIfAuthenticated(newProfile);
    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
    return applySession(newProfile);
  };

  const loginWithEmail = async (
    identifier: string,
    pass: string
  ): Promise<UserProfile> => {
    const cleanInput = identifier.trim().toLowerCase();
    if (!cleanInput) {
      throw new Error('Veuillez saisir votre adresse e-mail ou numéro CIN.');
    }

    await syncAllSharedStateFromServer();
    const syndics = await getSyndics();

    // 1. Check SaaS Super Admin account
    if (
      cleanInput === 'wahbi.rachid@gmail.com' ||
      cleanInput === 'admin@syndik.ma' ||
      cleanInput === 'superadmin@syndik.ma'
    ) {
      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
      return applySession({
        uid: 'admin-saas-1',
        email: cleanInput,
        displayName: 'Super Admin SaaS (Syndik Maroc)',
        role: 'admin',
      });
    }

    // 2. Check Syndic-Provisioned Provider / Prestataire Accounts
    let storedProviders: Prestataire[] = [];
    try {
      const rawProviders = localStorage.getItem(STORAGE_KEYS.PRESTATAIRES);
      if (rawProviders) {
        storedProviders = JSON.parse(rawProviders);
      }
    } catch {
      storedProviders = [];
    }

    let savedProviderAccounts: Array<{
      prestataireId: string;
      email: string;
      password: string;
      name: string;
      syndicId: string;
      buildingId: string;
      mustChangePassword?: boolean;
    }> = [];

    try {
      const rawProvAccounts = localStorage.getItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS);
      if (rawProvAccounts) {
        savedProviderAccounts = JSON.parse(rawProvAccounts);
      }
    } catch {
      savedProviderAccounts = [];
    }

    const matchedProvider = storedProviders.find(
      (p) => p.email && p.email.trim().toLowerCase() === cleanInput
    );
    const matchedProvCred = savedProviderAccounts.find(
      (acc) => acc.email.trim().toLowerCase() === cleanInput
    );

    if (matchedProvider || matchedProvCred) {
      const expectedProvPassword =
        matchedProvider?.generatedPassword || matchedProvCred?.password;

      if (!expectedProvPassword || pass !== expectedProvPassword) {
        throw new Error(
          'Mot de passe incorrect pour ce compte Prestataire. Vérifiez la fiche d’identifiants remise par votre Syndic.'
        );
      }

      const isTempProvPass =
        matchedProvider?.mustChangePassword ??
        matchedProvCred?.mustChangePassword ??
        Boolean(expectedProvPassword.startsWith('Syndik-'));

      return applySession({
        uid: matchedProvider?.id || matchedProvCred!.prestataireId,
        email: matchedProvider?.email || matchedProvCred!.email,
        displayName: matchedProvider?.name || matchedProvCred!.name,
        role: 'provider',
        syndicId: matchedProvider?.syndicId || matchedProvCred!.syndicId,
        buildingId: matchedProvider?.buildingId || matchedProvCred!.buildingId,
        phone: matchedProvider?.phone,
        mustChangePassword: isTempProvPass,
      });
    }

    // 3. Check Syndic-Generated Resident Accounts (by Email OR CIN)
    let savedResidentAccounts: Array<{
      residentId: string;
      email: string;
      password: string;
      name: string;
      isOwner?: boolean;
      syndicId: string;
      buildingId: string;
      apartmentId?: string;
      mustChangePassword?: boolean;
    }> = [];

    try {
      const rawAccounts = localStorage.getItem(STORAGE_KEYS.RESIDENT_ACCOUNTS);
      if (rawAccounts) {
        savedResidentAccounts = JSON.parse(rawAccounts);
      }
    } catch {
      savedResidentAccounts = [];
    }

    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const matchedRes = bld.residents.find(
          (r) =>
            r.email.trim().toLowerCase() === cleanInput ||
            (r.cin && r.cin.trim().toLowerCase() === cleanInput)
        );

        if (matchedRes) {
          const credRecord = savedResidentAccounts.find(
            (acc) =>
              acc.residentId === matchedRes.id ||
              acc.email.trim().toLowerCase() === matchedRes.email.trim().toLowerCase()
          );

          const expectedPassword =
            matchedRes.generatedPassword || credRecord?.password;

          if (!expectedPassword || pass !== expectedPassword) {
            throw new Error(
              'Mot de passe incorrect pour ce compte résident. Vérifiez la fiche d’identifiants générée par votre Syndic.'
            );
          }

          const assignedApt = bld.apartments.find(
            (a) =>
              a.id === matchedRes.apartmentId ||
              a.ownerId === matchedRes.id ||
              a.tenantId === matchedRes.id
          );

          const isTempPasswordUsed =
            matchedRes.mustChangePassword ??
            credRecord?.mustChangePassword ??
            Boolean(expectedPassword.startsWith('Syndik-'));

          return applySession({
            uid: matchedRes.id,
            email: matchedRes.email,
            displayName: matchedRes.name,
            role: 'resident',
            syndicId: syndic.id,
            buildingId: bld.id,
            buildingName: bld.name,
            apartmentId: assignedApt?.id || matchedRes.apartmentId,
            apartmentNumber: assignedApt?.number,
            isOwner: matchedRes.isOwner,
            cin: matchedRes.cin,
            phone: matchedRes.phone,
            mustChangePassword: isTempPasswordUsed,
          });
        }
      }
    }

    const standaloneAccount = savedResidentAccounts.find(
      (acc) => acc.email.trim().toLowerCase() === cleanInput
    );
    if (standaloneAccount) {
      if (!standaloneAccount.password || pass !== standaloneAccount.password) {
        throw new Error('Mot de passe incorrect pour ce compte résident.');
      }
      return applySession({
        uid: standaloneAccount.residentId,
        email: standaloneAccount.email,
        displayName: standaloneAccount.name,
        role: 'resident',
        syndicId: standaloneAccount.syndicId,
        buildingId: standaloneAccount.buildingId,
        apartmentId: standaloneAccount.apartmentId,
        isOwner: standaloneAccount.isOwner ?? true,
        mustChangePassword:
          standaloneAccount.mustChangePassword ??
          standaloneAccount.password?.startsWith('Syndik-'),
      });
    }

    // 4. Check registered user accounts stored in `STORAGE_KEYS.REGISTERED_USERS`
    try {
      const rawCustomUsers = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      if (rawCustomUsers) {
        const customUsers = JSON.parse(rawCustomUsers) as Array<
          UserProfile & { password?: string }
        >;
        const foundUser = customUsers.find(
          (u) => u.email.trim().toLowerCase() === cleanInput
        );
        if (foundUser) {
          if (foundUser.password && pass !== foundUser.password) {
            throw new Error('Mot de passe incorrect.');
          }
          const { password: _p, ...cleanProfile } = foundUser;
          await queryClient.invalidateQueries({ queryKey: ['syndics'] });
          return applySession(cleanProfile);
        }
      }
    } catch (e: any) {
      if (e?.message === 'Mot de passe incorrect.') throw e;
    }

    // 5. Check Registered Syndic Cabinets in `syndics`
    const matchedSyndic = syndics.find(
      (s) => s.email?.trim().toLowerCase() === cleanInput
    );
    if (matchedSyndic) {
      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
      return applySession({
        uid: matchedSyndic.createdBy || `syndic-user-${matchedSyndic.id}`,
        email: matchedSyndic.email || cleanInput,
        displayName: matchedSyndic.name,
        role: 'syndic',
        syndicId: matchedSyndic.id,
        phone: matchedSyndic.phone,
      });
    }

    throw new Error(
      "Aucun compte trouvé avec cet identifiant. Si vous êtes un nouveau Syndic, veuillez choisir un forfait sur la page d'accueil pour créer votre cabinet."
    );
  };

  const login = async (email: string): Promise<UserProfile> => {
    return loginWithEmail(email, '');
  };

  const register = async (
    email: string,
    pass: string,
    name: string,
    role: UserRole,
    extra?: {
      phone?: string;
      cin?: string;
      companyName?: string;
      city?: string;
      subscriptionPlan?: SubscriptionPlan;
      initialBuildingName?: string;
      initialBuildingAddress?: string;
      initialBuildingFees?: number;
      initialApartmentsCount?: number;
      buildingId?: string;
      apartmentId?: string;
      isOwner?: boolean;
      category?: Prestataire['category'];
      ice?: string;
      rc?: string;
      hourlyRate?: string;
    }
  ): Promise<UserProfile> => {
    const cleanEmail = email.trim().toLowerCase();
    await syncAllSharedStateFromServer();

    let uid = auth.currentUser?.uid || `user-${role}-${Date.now()}`;
    const syndics = await getSyndics();
    const defaultSyndic = syndics[0];
    const defaultBuilding = defaultSyndic?.buildings[0];

    let targetSyndic = defaultSyndic;
    let targetBuilding = defaultBuilding;
    if (extra?.buildingId) {
      for (const s of syndics) {
        const foundBld = s.buildings.find((b) => b.id === extra.buildingId);
        if (foundBld) {
          targetSyndic = s;
          targetBuilding = foundBld;
          break;
        }
      }
    }

    let syndicId: string | undefined = undefined;
    let buildingId: string | undefined = undefined;
    let buildingName: string | undefined = undefined;
    let apartmentId: string | undefined = extra?.apartmentId || undefined;
    let apartmentNumber: string | undefined = undefined;
    let isOwner: boolean | undefined = extra?.isOwner ?? (role === 'resident' ? true : undefined);
    let displayName = name.trim();

    if (role === 'syndic') {
      syndicId = `syndic-${Date.now()}`;
      const trialExpires = new Date();
      trialExpires.setDate(trialExpires.getDate() + 365);

      const chosenPlan: SubscriptionPlan = extra?.subscriptionPlan || 'professional';
      const chosenCity = extra?.city?.trim() || 'Casablanca';

      const newSyndic: Syndic = {
        id: syndicId,
        name: extra?.companyName?.trim() || name.trim(),
        createdBy: uid,
        subscriptionPlan: chosenPlan,
        subscriptionStatus: 'active',
        subscriptionExpiry: trialExpires.toISOString(),
        email: cleanEmail,
        phone: extra?.phone || '+212 6 00 00 00 00',
        city: chosenCity,
        ice: extra?.ice?.trim() || undefined,
        rc: extra?.rc?.trim() || undefined,
        buildings: [],
      };
      await saveSyndic(newSyndic);

      // Only create an initial building if the Syndic explicitly entered a building name during signup
      if (extra?.initialBuildingName?.trim()) {
        const initialBldTitle = extra.initialBuildingName.trim();
        const numApts = Math.max(1, Number(extra?.initialApartmentsCount) || 8);
        const monthlyFee = Math.max(50, Number(extra?.initialBuildingFees) || 250);
        const baseTantieme = Math.floor(1000 / numApts);
        const initialApts: Omit<Apartment, 'id' | 'buildingId'>[] = [];
        for (let i = 1; i <= numApts; i++) {
          const floorIdx = Math.ceil(i / 2);
          const unitNum = `${floorIdx}0${((i - 1) % 2) + 1}`;
          initialApts.push({
            number: unitNum,
            floor: floorIdx,
            area: 85,
            monthlyFees: monthlyFee,
            tantiemes:
              i === 1 ? baseTantieme + (1000 - baseTantieme * numApts) : baseTantieme,
            coproType: 'apartment',
            ownerId: null,
            tenantId: null,
          });
        }
        const createdBld = await addBuilding(syndicId, {
          name: initialBldTitle,
          address: extra?.initialBuildingAddress?.trim() || `Boulevard Principal, ${chosenCity}`,
          city: chosenCity,
          monthlySyndicFees: monthlyFee,
          reserveFundRate: 5,
          managerName: name.trim(),
          managerPhone: extra?.phone || '+212 6 00 00 00 00',
          apartments: initialApts,
        });
        buildingId = createdBld.id;
        buildingName = createdBld.name;
      }
    } else if (role === 'resident' && targetBuilding && targetSyndic) {
      syndicId = targetSyndic.id;
      buildingId = targetBuilding.id;
      buildingName = targetBuilding.name;

      const cleanCin = extra?.cin?.trim().toLowerCase();
      const existingRes = targetBuilding.residents.find(
        (r) =>
          r.email.trim().toLowerCase() === cleanEmail ||
          (cleanCin && r.cin && r.cin.trim().toLowerCase() === cleanCin)
      );

      if (existingRes) {
        uid = existingRes.id;
        const resolvedAptId = apartmentId || existingRes.apartmentId;
        const updatedRes = await updateResident({
          ...existingRes,
          name: name.trim() || existingRes.name,
          email: cleanEmail,
          phone: extra?.phone || existingRes.phone,
          cin: extra?.cin?.trim().toUpperCase() || existingRes.cin,
          isOwner: extra?.isOwner ?? existingRes.isOwner,
          apartmentId: resolvedAptId,
          hasAccount: true,
          generatedPassword: pass,
          credentialsCreatedAt: new Date().toISOString(),
        });
        apartmentId = updatedRes.apartmentId;
        isOwner = updatedRes.isOwner;
      } else {
        const createdRes = await addResident(
          {
            syndicId,
            buildingId,
            apartmentId,
            name: name.trim(),
            email: cleanEmail,
            phone: extra?.phone || '0661000000',
            cin: extra?.cin?.trim().toUpperCase() || undefined,
            isOwner: isOwner ?? true,
          },
          true
        );
        await updateResident({
          ...createdRes,
          hasAccount: true,
          generatedPassword: pass,
          credentialsCreatedAt: new Date().toISOString(),
        });
        uid = createdRes.id;
        apartmentId = createdRes.apartmentId;
      }

      const linkedApt = targetBuilding.apartments.find((a) => a.id === apartmentId);
      apartmentNumber = linkedApt?.number;
    } else if (role === 'provider' && targetSyndic && targetBuilding) {
      syndicId = targetSyndic.id;
      buildingId = targetBuilding.id;
      const companyLabel = extra?.companyName?.trim() || name.trim();
      displayName = companyLabel;
      uid = `prest-${Date.now()}`;

      await savePrestataire({
        id: uid,
        buildingId,
        syndicId,
        name: companyLabel,
        category: extra?.category || 'plumbing',
        contactPerson: name.trim(),
        phone: extra?.phone || '0661000000',
        whatsapp: (extra?.phone || '0661000000').replace(/\s+/g, ''),
        email: cleanEmail,
        ice: extra?.ice?.trim() || undefined,
        rc: extra?.rc?.trim() || undefined,
        hourlyRate: extra?.hourlyRate?.trim() || '150 DH / intervention',
        active: true,
        isVerifiedBySyndic: true,
        isEmergency247: true,
        rating: 5.0,
        reviewsCount: 1,
        reviews: [],
        notes: 'Prestataire inscrit via le portail Syndik.',
      });
    }

    const newProfile: UserProfile = {
      uid,
      email: cleanEmail,
      displayName,
      role,
      syndicId,
      buildingId,
      buildingName,
      apartmentId,
      apartmentNumber,
      isOwner,
      cin: extra?.cin?.trim().toUpperCase(),
      phone: extra?.phone,
    };

    try {
      const rawCustomUsers = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      const customUsers = rawCustomUsers ? JSON.parse(rawCustomUsers) : [];
      const filtered = customUsers.filter(
        (u: any) => u.email?.trim().toLowerCase() !== cleanEmail
      );
      filtered.push({ ...newProfile, password: pass });
      localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(filtered));
      await pushKeyToSharedServer(STORAGE_KEYS.REGISTERED_USERS, filtered);
    } catch {
      // ignore storage error
    }

    await syncUserProfileToFirestoreIfAuthenticated(newProfile);
    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
    await queryClient.invalidateQueries();

    return applySession(newProfile);
  };

  const changePassword = async (newPassword: string): Promise<void> => {
    if (!userProfile) return;
    const trimmed = newPassword.trim();
    if (trimmed.length < 6) {
      throw new Error('Le nouveau mot de passe doit contenir au moins 6 caractères.');
    }

    await syncAllSharedStateFromServer();

    // 1. Update resident account record if resident
    try {
      const rawAccounts = localStorage.getItem(STORAGE_KEYS.RESIDENT_ACCOUNTS);
      if (rawAccounts) {
        const accounts = JSON.parse(rawAccounts) as Array<{
          residentId: string;
          email: string;
          password: string;
          mustChangePassword?: boolean;
        }>;
        const updated = accounts.map((acc) =>
          acc.residentId === userProfile.uid ||
          acc.email.toLowerCase() === userProfile.email.toLowerCase()
            ? { ...acc, password: trimmed, mustChangePassword: false }
            : acc
        );
        localStorage.setItem(STORAGE_KEYS.RESIDENT_ACCOUNTS, JSON.stringify(updated));
        await pushKeyToSharedServer(STORAGE_KEYS.RESIDENT_ACCOUNTS, updated);
      }
    } catch {
      // ignore
    }

    // 2. Update prestataire account record if provider
    try {
      const rawProvAccounts = localStorage.getItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS);
      if (rawProvAccounts) {
        const provAccounts = JSON.parse(rawProvAccounts) as Array<{
          prestataireId: string;
          email: string;
          password: string;
          mustChangePassword?: boolean;
        }>;
        const updatedProv = provAccounts.map((acc) =>
          acc.prestataireId === userProfile.uid ||
          acc.email.toLowerCase() === userProfile.email.toLowerCase()
            ? { ...acc, password: trimmed, mustChangePassword: false }
            : acc
        );
        localStorage.setItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS, JSON.stringify(updatedProv));
        await pushKeyToSharedServer(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS, updatedProv);
      }
    } catch {
      // ignore
    }

    // 3. Update custom registered users store
    try {
      const rawCustom = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      if (rawCustom) {
        const customUsers = JSON.parse(rawCustom) as Array<any>;
        const updatedCustom = customUsers.map((u) =>
          u.uid === userProfile.uid ||
          u.email?.toLowerCase() === userProfile.email.toLowerCase()
            ? { ...u, password: trimmed, mustChangePassword: false }
            : u
        );
        localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(updatedCustom));
        await pushKeyToSharedServer(STORAGE_KEYS.REGISTERED_USERS, updatedCustom);
      }
    } catch {
      // ignore
    }

    // 4. Update resident in building if matched
    if (userProfile.role === 'resident') {
      const syndics = await getSyndics();
      for (const s of syndics) {
        for (const b of s.buildings) {
          const res = b.residents.find((r) => r.id === userProfile.uid);
          if (res) {
            await updateResident({
              ...res,
              generatedPassword: trimmed,
              hasAccount: true,
              mustChangePassword: false,
            });
          }
        }
      }
    }

    // 5. Update prestataire in directory if matched
    if (userProfile.role === 'provider') {
      try {
        const rawProviders = localStorage.getItem(STORAGE_KEYS.PRESTATAIRES);
        if (rawProviders) {
          const providers = JSON.parse(rawProviders) as Prestataire[];
          const target = providers.find(
            (p) =>
              p.id === userProfile.uid ||
              p.email?.toLowerCase() === userProfile.email.toLowerCase()
          );
          if (target) {
            await savePrestataire({
              ...target,
              generatedPassword: trimmed,
              hasAccount: true,
              mustChangePassword: false,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    const updatedProfile: UserProfile = {
      ...userProfile,
      mustChangePassword: false,
    };
    await syncUserProfileToFirestoreIfAuthenticated(updatedProfile);
    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
    await queryClient.invalidateQueries({ queryKey: ['prestataires'] });
    applySession(updatedProfile);
  };

  const registerOrUpdateUserCredentials = (
    email: string,
    password: string,
    profile: UserProfile
  ) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      const rawCustomUsers = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      const customUsers = rawCustomUsers ? JSON.parse(rawCustomUsers) : [];
      const filtered = customUsers.filter(
        (u: any) =>
          u.email?.trim().toLowerCase() !== cleanEmail && u.uid !== profile.uid
      );
      filtered.push({ ...profile, email: cleanEmail, password });
      localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(filtered));
      void pushKeyToSharedServer(STORAGE_KEYS.REGISTERED_USERS, filtered);
    } catch {
      // ignore
    }
  };

  const logout = async () => {
    localStorage.removeItem(SESSION_USER_KEY);
    localStorage.removeItem('syndik_mock_user');
    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
    } catch {
      // ignore
    }
    setCurrentUser(null);
    setUserProfile(null);
  };

  const isAdmin = userProfile?.role === 'admin';
  const isSyndic = userProfile?.role === 'syndic';
  const isResident = userProfile?.role === 'resident';
  const isProvider = userProfile?.role === 'provider';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        loginWithGoogle,
        loginWithEmail,
        login,
        register,
        changePassword,
        registerOrUpdateUserCredentials,
        logout,
        isAdmin,
        isSyndic,
        isResident,
        isProvider,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
