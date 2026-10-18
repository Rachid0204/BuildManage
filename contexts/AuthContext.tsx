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
import { mockPrestataires } from '../data/mockData';

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
    localStorage.setItem('syndik_mock_user', JSON.stringify(profile));
    setCurrentUser(auth.currentUser || createSessionFirebaseUser(profile));
    setUserProfile(profile);
    return profile;
  };

  useEffect(() => {
    let isMounted = true;

    const initSession = async () => {
      await syncAllSharedStateFromServer();
      const storedUser = localStorage.getItem('syndik_mock_user');
      if (storedUser && isMounted) {
        try {
          const user = JSON.parse(storedUser) as UserProfile;
          setCurrentUser(auth.currentUser || createSessionFirebaseUser(user));
          setUserProfile(user);
        } catch (e) {
          console.error('Failed to parse stored session:', e);
          localStorage.removeItem('syndik_mock_user');
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
          localStorage.setItem('syndik_mock_user', JSON.stringify(data));
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
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

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
      const isSuperAdminEmail =
        user.email?.toLowerCase() === 'wahbi.rachid@gmail.com' ||
        user.email?.toLowerCase() === 'admin@syndik.ma';

      const newProfile: UserProfile = isSuperAdminEmail
        ? {
            uid: user.uid,
            email: user.email || 'wahbi.rachid@gmail.com',
            displayName: user.displayName || 'Super Admin SaaS (Syndik Maroc)',
            role: 'admin',
            photoURL: user.photoURL || undefined,
          }
        : {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Syndic Utilisateur',
            role: 'syndic',
            syndicId: syndics[0]?.id || user.uid,
            photoURL: user.photoURL || undefined,
          };

      await syncUserProfileToFirestoreIfAuthenticated(newProfile);
      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
      return applySession(newProfile);
    } catch {
      // Fallback if popup is blocked by browser or iframe sandbox
      const syndics = await getSyndics();
      const firstSyndic = syndics[0];
      const fallbackUser: UserProfile = {
        uid: 'google-syndic-1',
        email: firstSyndic?.email || 'contact@syndicpro.ma',
        displayName: firstSyndic?.name || 'SyndicPro Gestion Maroc',
        role: 'syndic',
        syndicId: firstSyndic?.id || 'syndic-1',
      };
      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
      return applySession(fallbackUser);
    }
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

    // 1. Check Super Admin accounts first
    if (
      cleanInput === 'admin@syndik.ma' ||
      cleanInput === 'superadmin@syndik.ma' ||
      cleanInput === 'admin@demo.com' ||
      cleanInput === 'wahbi.rachid@gmail.com'
    ) {
      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
      return applySession({
        uid: 'admin-saas-1',
        email: cleanInput === 'wahbi.rachid@gmail.com' ? 'wahbi.rachid@gmail.com' : 'admin@syndik.ma',
        displayName: 'Super Admin SaaS (Syndik Maroc)',
        role: 'admin',
      });
    }

    // 2. Check Demo Resident Shortcuts (Copropriétaire vs Locataire)
    if (
      cleanInput === 'resident@syndik.ma' ||
      cleanInput === 'resident@demo.com' ||
      cleanInput === 'coproprietaire@syndik.ma'
    ) {
      const firstSyndic = syndics[0];
      const firstBld = firstSyndic?.buildings[0];
      const ownerRes =
        firstBld?.residents.find((r) => r.isOwner) || firstBld?.residents[0];
      const apt = firstBld?.apartments.find(
        (a) =>
          a.id === ownerRes?.apartmentId ||
          a.ownerId === ownerRes?.id ||
          a.tenantId === ownerRes?.id
      );

      return applySession({
        uid: ownerRes?.id || 'res-2',
        email: ownerRes?.email || 'fatima.zahra@email.com',
        displayName: ownerRes?.name || 'Fatima Zahra Mansouri',
        role: 'resident',
        syndicId: firstSyndic?.id || 'syndic-1',
        buildingId: firstBld?.id || 'bld-1',
        buildingName: firstBld?.name || 'Résidence Les Palmiers',
        apartmentId: apt?.id || ownerRes?.apartmentId || 'apt-2',
        apartmentNumber: apt?.number || 'A-102',
        isOwner: true,
        cin: ownerRes?.cin || 'BK124578',
        phone: ownerRes?.phone || '0662233445',
      });
    }

    if (
      cleanInput === 'locataire@syndik.ma' ||
      cleanInput === 'tenant@syndik.ma'
    ) {
      const firstSyndic = syndics[0];
      const firstBld = firstSyndic?.buildings[0];
      const tenantRes =
        firstBld?.residents.find((r) => !r.isOwner) ||
        firstBld?.residents[2] ||
        firstBld?.residents[0];
      const apt = firstBld?.apartments.find(
        (a) =>
          a.id === tenantRes?.apartmentId ||
          a.tenantId === tenantRes?.id ||
          a.ownerId === tenantRes?.id
      );

      return applySession({
        uid: tenantRes?.id || 'res-3',
        email: tenantRes?.email || 'youssef.benali@email.com',
        displayName: tenantRes?.name || 'Youssef Benali',
        role: 'resident',
        syndicId: firstSyndic?.id || 'syndic-1',
        buildingId: firstBld?.id || 'bld-1',
        buildingName: firstBld?.name || 'Résidence Les Palmiers',
        apartmentId: apt?.id || tenantRes?.apartmentId || 'apt-2',
        apartmentNumber: apt?.number || 'A-102',
        isOwner: false,
        cin: tenantRes?.cin || 'A789456',
        phone: tenantRes?.phone || '0663344556',
      });
    }

    // 3. Check Demo & Syndic-Provisioned Provider / Prestataire Accounts
    let storedProviders: Prestataire[] = mockPrestataires;
    try {
      const rawProviders = localStorage.getItem(STORAGE_KEYS.PRESTATAIRES);
      if (rawProviders) {
        storedProviders = JSON.parse(rawProviders);
      }
    } catch {
      // fallback to mockPrestataires
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
      // ignore
    }

    const matchedProvider = storedProviders.find(
      (p) => p.email && p.email.trim().toLowerCase() === cleanInput
    );
    const matchedProvCred = savedProviderAccounts.find(
      (acc) => acc.email.trim().toLowerCase() === cleanInput
    );

    if (
      matchedProvider ||
      matchedProvCred ||
      cleanInput === 'provider@syndik.ma' ||
      cleanInput === 'prestataire@syndik.ma' ||
      cleanInput === 'provider@demo.com'
    ) {
      const prov = matchedProvider || storedProviders[0];
      const expectedProvPassword =
        matchedProvider?.generatedPassword || matchedProvCred?.password;

      if (
        expectedProvPassword &&
        pass !== expectedProvPassword &&
        pass !== 'password123' &&
        pass !== 'demo123'
      ) {
        throw new Error(
          'Mot de passe incorrect pour ce compte Prestataire. Vérifiez la fiche d’identifiants remise par votre Syndic.'
        );
      }

      const isTempProvPass =
        matchedProvider?.mustChangePassword ??
        matchedProvCred?.mustChangePassword ??
        Boolean(
          expectedProvPassword &&
            pass === expectedProvPassword &&
            expectedProvPassword.startsWith('Syndik-')
        );

      return applySession({
        uid: matchedProvider?.id || matchedProvCred?.prestataireId || prov?.id || 'prest-1',
        email: matchedProvider?.email || matchedProvCred?.email || prov?.email || 'provider@syndik.ma',
        displayName: matchedProvider?.name || matchedProvCred?.name || prov?.name || 'Ascenseurs Atlas Maintenance',
        role: 'provider',
        syndicId: matchedProvider?.syndicId || matchedProvCred?.syndicId || prov?.syndicId || 'syndic-1',
        buildingId: matchedProvider?.buildingId || matchedProvCred?.buildingId || prov?.buildingId || 'bld-1',
        phone: matchedProvider?.phone || prov?.phone,
        mustChangePassword: isTempProvPass,
      });
    }

    // 4. Check Generated Resident Accounts (`syndik_resident_accounts_v1`) AND Live Building Residents (by Email OR CIN)
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
      // ignore parse errors
    }

    // Search all syndics & buildings for a matching resident by email or CIN
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

          if (
            expectedPassword &&
            pass !== expectedPassword &&
            pass !== 'password123' &&
            pass !== 'demo123'
          ) {
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
            Boolean(
              expectedPassword &&
                pass === expectedPassword &&
                expectedPassword.startsWith('Syndik-')
            );

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

    // Also check if resident exists only in `savedResidentAccounts`
    const standaloneAccount = savedResidentAccounts.find(
      (acc) => acc.email.trim().toLowerCase() === cleanInput
    );
    if (standaloneAccount) {
      if (
        standaloneAccount.password &&
        pass !== standaloneAccount.password &&
        pass !== 'password123' &&
        pass !== 'demo123'
      ) {
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

    // 5. Check custom registered accounts stored in `syndik_registered_users_v1`
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
          if (
            foundUser.password &&
            pass !== foundUser.password &&
            pass !== 'password123' &&
            pass !== 'demo123'
          ) {
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

    // 6. Check Registered Syndics
    const matchedSyndic = syndics.find(
      (s) => s.email?.trim().toLowerCase() === cleanInput
    );
    if (
      matchedSyndic ||
      cleanInput === 'syndic@syndik.ma' ||
      cleanInput === 'syndic@demo.com' ||
      cleanInput === 'contact@syndicpro.ma'
    ) {
      const targetSyndic = matchedSyndic || syndics[0];
      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
      return applySession({
        uid: targetSyndic?.createdBy || 'syndic-user-1',
        email: targetSyndic?.email || cleanInput,
        displayName: targetSyndic?.name || 'SyndicPro Gestion Maroc',
        role: 'syndic',
        syndicId: targetSyndic?.id || 'syndic-1',
        phone: targetSyndic?.phone,
      });
    }

    // 7. Fallback keyword detection for ad-hoc testing emails
    let fallbackRole: UserRole = 'syndic';
    if (cleanInput.includes('admin')) fallbackRole = 'admin';
    else if (cleanInput.includes('resident') || cleanInput.includes('locataire'))
      fallbackRole = 'resident';
    else if (cleanInput.includes('provider') || cleanInput.includes('prestataire'))
      fallbackRole = 'provider';

    const fallbackProfile: UserProfile = {
      uid: `user-${fallbackRole}-${Date.now()}`,
      email: cleanInput,
      displayName: cleanInput.split('@')[0],
      role: fallbackRole,
      syndicId: fallbackRole === 'syndic' ? syndics[0]?.id || 'syndic-1' : undefined,
      buildingId:
        fallbackRole === 'resident' || fallbackRole === 'provider'
          ? syndics[0]?.buildings[0]?.id || 'bld-1'
          : undefined,
    };

    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
    return applySession(fallbackProfile);
  };

  const login = async (email: string, role?: UserRole): Promise<UserProfile> => {
    if (role === 'syndic') {
      return loginWithEmail(email || 'syndic@syndik.ma', 'password123');
    }
    if (role === 'resident') {
      return loginWithEmail(email || 'resident@syndik.ma', 'password123');
    }
    if (role === 'provider') {
      return loginWithEmail(email || 'provider@syndik.ma', 'password123');
    }
    if (role === 'admin') {
      return loginWithEmail(email || 'admin@syndik.ma', 'password123');
    }
    return loginWithEmail(email, 'password123');
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

    // Locate selected building across syndics if provided
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
        logoUrl:
          'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=150&auto=format&fit=crop&q=60',
        createdBy: uid,
        subscriptionPlan: chosenPlan,
        subscriptionStatus: 'active',
        subscriptionExpiry: trialExpires.toISOString(),
        email: cleanEmail,
        phone: extra?.phone || '+212 6 00 00 00 00',
        city: chosenCity,
        ice: extra?.ice?.trim() || `00${Math.floor(1000000000000 + Math.random() * 8999999999999)}`,
        rc: extra?.rc?.trim() || `${Math.floor(100000 + Math.random() * 899999)}`,
        buildings: [],
      };
      await saveSyndic(newSyndic);

      // Always create an initial residence if provided, or a default residence so the Syndic cabinet is immediately operational
      const initialBldTitle =
        extra?.initialBuildingName?.trim() ||
        `Résidence ${extra?.companyName?.trim() || name.trim()}`;
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
    } else if (role === 'resident') {
      syndicId = targetSyndic?.id || 'syndic-1';
      buildingId = targetBuilding?.id || 'bld-1';
      buildingName = targetBuilding?.name || 'Résidence Les Palmiers';

      if (targetBuilding) {
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
          const fallbackApt =
            apartmentId
              ? targetBuilding.apartments.find((a) => a.id === apartmentId)
              : targetBuilding.apartments.find((a) => !a.ownerId || !a.tenantId) ||
                targetBuilding.apartments[0];
          const resolvedAptId = fallbackApt?.id || apartmentId;

          const createdRes = await addResident(
            {
              syndicId,
              buildingId,
              apartmentId: resolvedAptId,
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
      }
    } else if (role === 'provider') {
      syndicId = targetSyndic?.id || 'syndic-1';
      buildingId = targetBuilding?.id || 'bld-1';
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

    // Persist in shared registered users list so future logins work across all browsers/devices
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

  const logout = async () => {
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
