import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth, db, isMock } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { UserProfile, UserRole, Syndic, Prestataire } from '../types';
import { getSyndics, saveSyndic, updateResident } from '../firebase/services';
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
    extra?: { phone?: string; cin?: string; companyName?: string }
  ) => Promise<UserProfile>;
  changePassword: (newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isSyndic: boolean;
  isResident: boolean;
  isProvider: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const createMockFirebaseUser = (profile: UserProfile): User =>
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
    getIdToken: async () => 'mock-token',
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    phoneNumber: profile.phone || null,
    photoURL: profile.photoURL || null,
  } as unknown as User);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const applyMockSession = (profile: UserProfile): UserProfile => {
    localStorage.setItem('syndik_mock_user', JSON.stringify(profile));
    setCurrentUser(createMockFirebaseUser(profile));
    setUserProfile(profile);
    return profile;
  };

  useEffect(() => {
    if (isMock) {
      const storedUser = localStorage.getItem('syndik_mock_user');
      if (storedUser) {
        try {
          const user = JSON.parse(storedUser) as UserProfile;
          setCurrentUser(createMockFirebaseUser(user));
          setUserProfile(user);
        } catch (e) {
          console.error('Failed to parse stored session:', e);
          localStorage.removeItem('syndik_mock_user');
        }
      }
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            setUserProfile(userDoc.data() as UserProfile);
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const loginWithGoogle = async (): Promise<UserProfile> => {
    if (isMock) {
      const syndics = await getSyndics();
      const firstSyndic = syndics[0];
      const mockUser: UserProfile = {
        uid: 'mock-google-syndic',
        email: firstSyndic?.email || 'contact@syndicpro.ma',
        displayName: firstSyndic?.name || 'SyndicPro Gestion Maroc',
        role: 'syndic',
        syndicId: firstSyndic?.id || 'syndic-1',
      };
      return applyMockSession(mockUser);
    }

    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      const existing = userDoc.data() as UserProfile;
      setUserProfile(existing);
      return existing;
    }

    const newProfile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || 'Syndic Utilisateur',
      role: 'syndic',
      syndicId: user.uid,
      photoURL: user.photoURL || undefined,
    };
    await setDoc(userDocRef, newProfile);
    setUserProfile(newProfile);
    return newProfile;
  };

  const loginWithEmail = async (
    identifier: string,
    pass: string
  ): Promise<UserProfile> => {
    const cleanInput = identifier.trim().toLowerCase();
    if (!cleanInput) {
      throw new Error('Veuillez saisir votre adresse e-mail ou numéro CIN.');
    }

    if (isMock) {
      const syndics = await getSyndics();

      // 1. Check Super Admin accounts first
      if (
        cleanInput === 'admin@syndik.ma' ||
        cleanInput === 'superadmin@syndik.ma' ||
        cleanInput === 'admin@demo.com'
      ) {
        return applyMockSession({
          uid: 'admin-saas-1',
          email: 'admin@syndik.ma',
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

        return applyMockSession({
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

        return applyMockSession({
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

      // 3. Check Demo Provider / Prestataire Accounts
      let storedProviders: Prestataire[] = mockPrestataires;
      try {
        const rawProviders = localStorage.getItem('syndik_reactive_prestataires_v2');
        if (rawProviders) {
          storedProviders = JSON.parse(rawProviders);
        }
      } catch {
        // fallback to mockPrestataires
      }

      const matchedProvider = storedProviders.find(
        (p) => p.email.trim().toLowerCase() === cleanInput
      );

      if (
        matchedProvider ||
        cleanInput === 'provider@syndik.ma' ||
        cleanInput === 'prestataire@syndik.ma' ||
        cleanInput === 'provider@demo.com'
      ) {
        const prov = matchedProvider || storedProviders[0];
        return applyMockSession({
          uid: prov?.id || 'prest-1',
          email: prov?.email || 'provider@syndik.ma',
          displayName: prov?.name || 'Ascenseurs Atlas Maintenance',
          role: 'provider',
          syndicId: prov?.syndicId || 'syndic-1',
          buildingId: prov?.buildingId || 'bld-1',
          phone: prov?.phone,
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
      }> = [];

      try {
        const rawAccounts = localStorage.getItem('syndik_resident_accounts_v1');
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

            const isTempPasswordUsed = Boolean(
              expectedPassword &&
                pass === expectedPassword &&
                expectedPassword.startsWith('Syndik-')
            );

            return applyMockSession({
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
        return applyMockSession({
          uid: standaloneAccount.residentId,
          email: standaloneAccount.email,
          displayName: standaloneAccount.name,
          role: 'resident',
          syndicId: standaloneAccount.syndicId,
          buildingId: standaloneAccount.buildingId,
          apartmentId: standaloneAccount.apartmentId,
          isOwner: standaloneAccount.isOwner ?? true,
          mustChangePassword: standaloneAccount.password?.startsWith('Syndik-'),
        });
      }

      // 5. Check Registered Syndics
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
        return applyMockSession({
          uid: targetSyndic?.createdBy || 'syndic-user-1',
          email: targetSyndic?.email || cleanInput,
          displayName: targetSyndic?.name || 'SyndicPro Gestion Maroc',
          role: 'syndic',
          syndicId: targetSyndic?.id || 'syndic-1',
          phone: targetSyndic?.phone,
        });
      }

      // 6. Check custom registered accounts stored in `syndik_registered_users_v1`
      try {
        const rawCustomUsers = localStorage.getItem('syndik_registered_users_v1');
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
            return applyMockSession(cleanProfile);
          }
        }
      } catch (e: any) {
        if (e?.message === 'Mot de passe incorrect.') throw e;
      }

      // 7. Fallback keyword detection for ad-hoc testing emails
      let fallbackRole: UserRole = 'syndic';
      if (cleanInput.includes('admin')) fallbackRole = 'admin';
      else if (cleanInput.includes('resident') || cleanInput.includes('locataire'))
        fallbackRole = 'resident';
      else if (cleanInput.includes('provider') || cleanInput.includes('prestataire'))
        fallbackRole = 'provider';

      const fallbackProfile: UserProfile = {
        uid: `mock-${fallbackRole}-${Date.now()}`,
        email: cleanInput,
        displayName: cleanInput.split('@')[0],
        role: fallbackRole,
        syndicId: fallbackRole === 'syndic' ? syndics[0]?.id || 'syndic-1' : undefined,
        buildingId:
          fallbackRole === 'resident' || fallbackRole === 'provider'
            ? syndics[0]?.buildings[0]?.id || 'bld-1'
            : undefined,
      };

      return applyMockSession(fallbackProfile);
    }

    const cred = await signInWithEmailAndPassword(auth, identifier, pass);
    const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
    const profile = (userDoc.data() as UserProfile) || {
      uid: cred.user.uid,
      email: cred.user.email || identifier,
      displayName: cred.user.displayName || identifier.split('@')[0],
      role: 'syndic',
    };
    setUserProfile(profile);
    return profile;
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
    extra?: { phone?: string; cin?: string; companyName?: string }
  ): Promise<UserProfile> => {
    const cleanEmail = email.trim().toLowerCase();

    if (isMock) {
      const uid = `user-${role}-${Date.now()}`;
      const syndics = await getSyndics();
      const defaultSyndic = syndics[0];
      const defaultBuilding = defaultSyndic?.buildings[0];

      let syndicId: string | undefined = undefined;
      let buildingId: string | undefined = undefined;

      if (role === 'syndic') {
        syndicId = `syndic-${Date.now()}`;
        const trialExpires = new Date();
        trialExpires.setDate(trialExpires.getDate() + 30);

        const newSyndic: Syndic = {
          id: syndicId,
          name: extra?.companyName?.trim() || name.trim(),
          logoUrl:
            'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=150&auto=format&fit=crop&q=60',
          createdBy: uid,
          subscriptionPlan: 'professional',
          subscriptionStatus: 'active',
          subscriptionExpiry: trialExpires.toISOString(),
          email: cleanEmail,
          phone: extra?.phone || '+212 6 00 00 00 00',
          city: 'Casablanca',
          buildings: [],
        };
        await saveSyndic(newSyndic);
      } else if (role === 'resident' || role === 'provider') {
        syndicId = defaultSyndic?.id || 'syndic-1';
        buildingId = defaultBuilding?.id || 'bld-1';
      }

      const newProfile: UserProfile = {
        uid,
        email: cleanEmail,
        displayName: name.trim(),
        role,
        syndicId,
        buildingId,
        buildingName: role === 'resident' ? defaultBuilding?.name : undefined,
        isOwner: role === 'resident' ? true : undefined,
        cin: extra?.cin,
        phone: extra?.phone,
      };

      // Persist in custom registered users list so future logins work with this email & password
      try {
        const rawCustomUsers = localStorage.getItem('syndik_registered_users_v1');
        const customUsers = rawCustomUsers ? JSON.parse(rawCustomUsers) : [];
        customUsers.push({ ...newProfile, password: pass });
        localStorage.setItem(
          'syndik_registered_users_v1',
          JSON.stringify(customUsers)
        );
      } catch {
        // ignore storage error
      }

      return applyMockSession(newProfile);
    }

    const result = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
    const user = result.user;

    const newProfile: UserProfile = {
      uid: user.uid,
      email: user.email || cleanEmail,
      displayName: name,
      role,
      syndicId: role === 'syndic' ? user.uid : undefined,
    };

    await setDoc(doc(db, 'users', user.uid), newProfile);
    setUserProfile(newProfile);
    return newProfile;
  };

  const changePassword = async (newPassword: string): Promise<void> => {
    if (!userProfile) return;
    const trimmed = newPassword.trim();
    if (trimmed.length < 6) {
      throw new Error('Le nouveau mot de passe doit contenir au moins 6 caractères.');
    }

    if (isMock) {
      // Update resident account record if resident
      try {
        const rawAccounts = localStorage.getItem('syndik_resident_accounts_v1');
        if (rawAccounts) {
          const accounts = JSON.parse(rawAccounts) as Array<{
            residentId: string;
            email: string;
            password: string;
          }>;
          const updated = accounts.map((acc) =>
            acc.residentId === userProfile.uid ||
            acc.email.toLowerCase() === userProfile.email.toLowerCase()
              ? { ...acc, password: trimmed }
              : acc
          );
          localStorage.setItem(
            'syndik_resident_accounts_v1',
            JSON.stringify(updated)
          );
        }
      } catch {
        // ignore
      }

      // Also update resident in building if matched
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
              });
            }
          }
        }
      }

      const updatedProfile: UserProfile = {
        ...userProfile,
        mustChangePassword: false,
      };
      applyMockSession(updatedProfile);
    }
  };

  const logout = async () => {
    if (isMock) {
      localStorage.removeItem('syndik_mock_user');
      setCurrentUser(null);
      setUserProfile(null);
      return;
    }
    await signOut(auth);
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
