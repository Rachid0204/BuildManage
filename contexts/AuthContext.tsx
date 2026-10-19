import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  updatePassword,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, OperationType, handleFirestoreError } from '../firebase/config';
import {
  getSyndics,
  saveSyndic,
  getPrestatairesForBuilding,
  STORAGE_KEYS,
  pushKeyToSharedServer,
  syncAllSharedStateFromServer,
  ResidentAccountRecord,
  PrestataireAccountRecord,
  sanitizeAccountRecordsInStorage,
} from '../firebase/services';
import type { UserProfile, UserRole, SubscriptionPlan, Syndic, Prestataire } from '../types';
import {
  hashPasswordSync,
  verifyPasswordSync,
  createSignedSessionEnvelope,
  verifySignedSessionEnvelope,
  setActiveAuthContext,
  computeSessionSignature,
} from '../utils/security';

export interface RegisterAccountInput {
  role: UserRole;
  name: string;
  email: string;
  password: string;
  phone: string;
  city?: string;
  // Syndic specific
  cabinetName?: string;
  ice?: string;
  rc?: string;
  plan?: SubscriptionPlan;
  // Resident specific
  cin?: string;
  buildingCode?: string;
  apartmentNumber?: string;
  isOwner?: boolean;
  // Provider specific
  companyName?: string;
  category?: Prestataire['category'];
}

interface AuthContextType {
  user: User | null;
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<UserProfile>;
  loginWithGoogle: () => Promise<UserProfile>;
  login: (email: string, pass?: string) => Promise<UserProfile>;
  loginWithEmail: (email: string, pass?: string) => Promise<UserProfile>;
  registerAccount: (input: RegisterAccountInput) => Promise<UserProfile>;
  register: (
    emailOrInput: string | RegisterAccountInput,
    password?: string,
    displayName?: string,
    role?: UserRole,
    options?: {
      phone?: string;
      companyName?: string;
      city?: string;
      subscriptionPlan?: SubscriptionPlan;
      initialBuildingName?: string;
      initialApartmentsCount?: number;
      initialBuildingFees?: number;
      buildingId?: string;
      apartmentId?: string;
    }
  ) => Promise<UserProfile>;
  completeMandatoryPasswordChange: (newPassword: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  registerOrUpdateUserCredentials: (
    email: string,
    passwordOrToken: string,
    profile: UserProfile
  ) => void;
  logout: () => Promise<void>;
}

export const getHomeRouteForRole = (role?: UserRole): string => {
  switch (role) {
    case 'admin':
      return '/admin-portal';
    case 'resident':
      return '/resident-portal';
    case 'provider':
      return '/provider-portal';
    case 'syndic':
    default:
      return '/dashboard';
  }
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'syndik_auth_session_v1';
const REGISTERED_USERS_KEY = STORAGE_KEYS.REGISTERED_USERS;
const TRIAL_DURATION_MS = 30 * 86400000; // Standardized 30-day trial (Audit Item 21)

interface StoredUserAccount {
  uid: string;
  email: string;
  passwordHash: string;
  profile: UserProfile;
  createdAt: string;
}

function getStoredRegisteredUsers(): StoredUserAccount[] {
  try {
    const raw = localStorage.getItem(REGISTERED_USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed)) return [];
    let migrated = false;
    const cleaned: StoredUserAccount[] = parsed
      .filter((item) => item && typeof item.email === 'string' && item.profile)
      .map((item) => {
        const emailNorm = item.email.trim().toLowerCase();
        const passwordHash =
          item.passwordHash ||
          (typeof item.password === 'string' ? hashPasswordSync(item.password, emailNorm) : '');
        if ('password' in item) {
          migrated = true;
        }
        return {
          uid: item.uid,
          email: emailNorm,
          passwordHash,
          profile: item.profile,
          createdAt: item.createdAt || new Date().toISOString(),
        };
      });
    if (migrated) {
      localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(cleaned));
    }
    return cleaned;
  } catch {
    return [];
  }
}

function saveStoredRegisteredUser(account: StoredUserAccount) {
  const existing = getStoredRegisteredUsers();
  const sanitizedAccount: StoredUserAccount = {
    uid: account.uid,
    email: account.email.trim().toLowerCase(),
    passwordHash: account.passwordHash,
    profile: account.profile,
    createdAt: account.createdAt,
  };
  const idx = existing.findIndex(
    (u) => u.email.toLowerCase() === sanitizedAccount.email || u.uid === sanitizedAccount.uid
  );
  if (idx >= 0) {
    existing[idx] = sanitizedAccount;
  } else {
    existing.push(sanitizedAccount);
  }
  localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(existing));
  void pushKeyToSharedServer(REGISTERED_USERS_KEY, existing);
}

function createVerifiedIdentityAdapter(profile: UserProfile): User {
  const sig = computeSessionSignature(profile);
  return {
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName || profile.email?.split('@')[0] || 'Utilisateur',
    photoURL: profile.photoURL || null,
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: profile.syndicId || null,
    delete: async () => {},
    getIdToken: async () => {
      if (auth.currentUser) {
        return auth.currentUser.getIdToken();
      }
      return `syndik-sess-${profile.uid}-${sig}`;
    },
    getIdTokenResult: async () => ({
      token: `syndik-sess-${profile.uid}-${sig}`,
      expirationTime: new Date(Date.now() + 3600 * 1000).toISOString(),
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      signInProvider: 'password',
      signInSecondFactor: null,
      claims: {
        role: profile.role,
        syndicId: profile.syndicId,
        buildingId: profile.buildingId,
      },
    }),
    reload: async () => {},
    toJSON: () => ({ uid: profile.uid, email: profile.email }),
    phoneNumber: profile.phone || null,
    providerId: 'firebase',
  } as unknown as User;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const persistSession = (profile: UserProfile | null, firebaseUser?: User | null) => {
    if (!profile) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setActiveAuthContext(null, null);
      setUser(null);
      setUserProfile(null);
      return;
    }
    const envelope = createSignedSessionEnvelope(profile);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(envelope));
    setActiveAuthContext(profile, null);
    setUserProfile(profile);
    setUser(firebaseUser || auth.currentUser || createVerifiedIdentityAdapter(profile));
  };

  useEffect(() => {
    // Sanitize any legacy plaintext passwords in localStorage on boot (Audit Item 03)
    sanitizeAccountRecordsInStorage();
    void syncAllSharedStateFromServer();

    // 1. Check signed session envelope in localStorage (rejects unsigned/tampered JSON)
    const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        const verifiedProfile = verifySignedSessionEnvelope(parsed);
        if (verifiedProfile) {
          setActiveAuthContext(verifiedProfile, null);
          setUserProfile(verifiedProfile);
          setUser(createVerifiedIdentityAdapter(verifiedProfile));
          setLoading(false);
        } else {
          // Unsigned or tampered session JSON — purge immediately
          localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }

    // 2. Subscribe to real Firebase Auth state
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken();
          const userDocRef = doc(db, 'users', currentUser.uid);
          let docSnap;
          try {
            docSnap = await getDoc(userDocRef);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes('Missing or insufficient permissions')
            ) {
              handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
            }
            throw error;
          }

          if (docSnap && docSnap.exists()) {
            const profileData = docSnap.data() as UserProfile;
            setActiveAuthContext(profileData, token);
            persistSession(profileData, currentUser);
          } else {
            const storedUsers = getStoredRegisteredUsers();
            const foundLocal = storedUsers.find(
              (u) =>
                u.uid === currentUser.uid ||
                (currentUser.email &&
                  u.email.toLowerCase() === currentUser.email.toLowerCase())
            );

            if (foundLocal) {
              setActiveAuthContext(foundLocal.profile, token);
              persistSession(foundLocal.profile, currentUser);
            } else {
              // Authenticated via Firebase Auth (e.g. Google Sign-In)
              const isSuperAdminEmail =
                currentUser.email?.toLowerCase() === 'wahbi.rachid@gmail.com' &&
                currentUser.emailVerified;
              const syndicId = `syndic-${currentUser.uid.slice(0, 8)}`;
              const newProfile: UserProfile = {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName:
                  currentUser.displayName ||
                  currentUser.email?.split('@')[0] ||
                  'Syndic',
                photoURL: currentUser.photoURL,
                role: isSuperAdminEmail ? 'admin' : 'syndic',
                syndicId,
              };

              const existingSyndics = await getSyndics();
              if (!existingSyndics.some((s) => s.id === syndicId)) {
                await saveSyndic({
                  id: syndicId,
                  name: `Cabinet ${newProfile.displayName}`,
                  logoUrl: '',
                  createdBy: currentUser.uid,
                  subscriptionPlan: 'professional',
                  subscriptionStatus: 'trialing',
                  subscriptionExpiry: new Date(Date.now() + TRIAL_DURATION_MS).toISOString(),
                  email: currentUser.email || '',
                  city: 'Casablanca',
                  buildings: [],
                });
              }

              try {
                await setDoc(userDocRef, newProfile);
              } catch {
                // Firestore rules may require additional fields; local + server state will hold it
              }
              setActiveAuthContext(newProfile, token);
              persistSession(newProfile, currentUser);
            }
          }
        } catch (err) {
          console.warn('Error loading Firebase user profile:', err);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<UserProfile> => {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const currentUser = cred.user;
    const token = await currentUser.getIdToken();
    const userDocRef = doc(db, 'users', currentUser.uid);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      const profileData = docSnap.data() as UserProfile;
      setActiveAuthContext(profileData, token);
      persistSession(profileData, currentUser);
      return profileData;
    }
    const isSuperAdminEmail =
      currentUser.email?.toLowerCase() === 'wahbi.rachid@gmail.com' &&
      currentUser.emailVerified;
    const syndicId = `syndic-${currentUser.uid.slice(0, 8)}`;
    const newProfile: UserProfile = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Syndic',
      photoURL: currentUser.photoURL,
      role: isSuperAdminEmail ? 'admin' : 'syndic',
      syndicId,
    };
    setActiveAuthContext(newProfile, token);
    persistSession(newProfile, currentUser);
    return newProfile;
  };

  const login = async (email: string, pass?: string): Promise<UserProfile> => {
    setLoading(true);
    try {
      await syncAllSharedStateFromServer();
      sanitizeAccountRecordsInStorage();

      const normalizedEmail = email.trim().toLowerCase();
      const trimmedPass = (pass ?? '').trim();

      // Audit Item 01 (P0): Every email login MUST supply and verify a non-empty password.
      if (!normalizedEmail || !trimmedPass) {
        throw new Error(
          'Veuillez saisir votre adresse email et votre mot de passe.'
        );
      }

      // 1. Check Registered Accounts (Syndic / Resident / Provider / Admin) with password hash verification
      const registeredUsers = getStoredRegisteredUsers();
      const matchedRegistered = registeredUsers.find(
        (u) => u.email.toLowerCase() === normalizedEmail
      );

      if (matchedRegistered) {
        if (!verifyPasswordSync(trimmedPass, matchedRegistered.passwordHash, normalizedEmail)) {
          throw new Error(
            'Identifiants incorrects. Veuillez vérifier votre email et votre mot de passe.'
          );
        }
        persistSession(matchedRegistered.profile);
        return matchedRegistered.profile;
      }

      // 2. Check Resident Credential Accounts (Generated by Syndic) — strictly verifying password hash
      const rawResidentAccounts = localStorage.getItem(STORAGE_KEYS.RESIDENT_ACCOUNTS);
      const residentAccounts: ResidentAccountRecord[] = rawResidentAccounts
        ? JSON.parse(rawResidentAccounts)
        : [];
      const matchedResAccount = residentAccounts.find(
        (a) => a.email.trim().toLowerCase() === normalizedEmail
      );

      if (matchedResAccount) {
        const storedSecret = matchedResAccount.passwordHash || matchedResAccount.password;
        if (!verifyPasswordSync(trimmedPass, storedSecret, normalizedEmail)) {
          throw new Error(
            'Identifiants résident incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.'
          );
        }
        const syndics = await getSyndics();
        let buildingName = 'Résidence';
        let apartmentNumber = matchedResAccount.apartmentId || '';

        for (const s of syndics) {
          const bld = s.buildings.find((b) => b.id === matchedResAccount.buildingId);
          if (bld) {
            buildingName = bld.name;
            const apt = bld.apartments.find((a) => a.id === matchedResAccount.apartmentId);
            if (apt) apartmentNumber = apt.number;
            break;
          }
        }

        const resProfile: UserProfile = {
          uid: `user-res-${matchedResAccount.residentId}`,
          email: matchedResAccount.email,
          displayName: matchedResAccount.name,
          role: 'resident',
          syndicId: matchedResAccount.syndicId,
          buildingId: matchedResAccount.buildingId,
          buildingName,
          apartmentId: matchedResAccount.apartmentId,
          apartmentNumber,
          residentId: matchedResAccount.residentId,
          mustChangePassword: matchedResAccount.mustChangePassword ?? true,
        };
        persistSession(resProfile);
        return resProfile;
      }

      // 3. Check Prestataire Credential Accounts (Generated by Syndic) — strictly verifying password hash
      const rawPrestAccounts = localStorage.getItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS);
      const prestAccounts: PrestataireAccountRecord[] = rawPrestAccounts
        ? JSON.parse(rawPrestAccounts)
        : [];
      const matchedPrestAccount = prestAccounts.find(
        (a) => a.email.trim().toLowerCase() === normalizedEmail
      );

      if (matchedPrestAccount) {
        const storedSecret = matchedPrestAccount.passwordHash || matchedPrestAccount.password;
        if (!verifyPasswordSync(trimmedPass, storedSecret, normalizedEmail)) {
          throw new Error(
            'Identifiants prestataire incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.'
          );
        }
        const syndics = await getSyndics();
        let buildingName = 'Résidence';
        for (const s of syndics) {
          const bld = s.buildings.find((b) => b.id === matchedPrestAccount.buildingId);
          if (bld) {
            buildingName = bld.name;
            break;
          }
        }

        const prestProfile: UserProfile = {
          uid: `user-prest-${matchedPrestAccount.prestataireId}`,
          email: matchedPrestAccount.email,
          displayName: matchedPrestAccount.name,
          role: 'provider',
          syndicId: matchedPrestAccount.syndicId,
          buildingId: matchedPrestAccount.buildingId,
          buildingName,
          prestataireId: matchedPrestAccount.prestataireId,
          prestataireCategory: matchedPrestAccount.category,
          mustChangePassword: matchedPrestAccount.mustChangePassword ?? true,
        };
        persistSession(prestProfile);
        return prestProfile;
      }

      // 4. Authenticate with Firebase Authentication email/password flow (Audit Item 01)
      // Knowing an email alone NEVER creates a session without Firebase Auth or passwordHash verification.
      const cred = await signInWithEmailAndPassword(auth, normalizedEmail, trimmedPass);
      const token = await cred.user.getIdToken();
      const userDocRef = doc(db, 'users', cred.user.uid);
      const docSnap = await getDoc(userDocRef);

      if (docSnap.exists()) {
        const profileData = docSnap.data() as UserProfile;
        setActiveAuthContext(profileData, token);
        persistSession(profileData, cred.user);
        return profileData;
      } else {
        const isSuperAdminEmail =
          cred.user.email?.toLowerCase() === 'wahbi.rachid@gmail.com' &&
          cred.user.emailVerified;
        const fallbackProfile: UserProfile = {
          uid: cred.user.uid,
          email: cred.user.email || normalizedEmail,
          displayName: cred.user.displayName || normalizedEmail.split('@')[0],
          role: isSuperAdminEmail ? 'admin' : 'syndic',
        };
        setActiveAuthContext(fallbackProfile, token);
        persistSession(fallbackProfile, cred.user);
        return fallbackProfile;
      }
    } catch (error: any) {
      if (
        error?.code === 'auth/invalid-credential' ||
        error?.code === 'auth/user-not-found' ||
        error?.code === 'auth/wrong-password'
      ) {
        throw new Error(
          'Aucun compte trouvé avec ces identifiants ou mot de passe incorrect.'
        );
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const registerAccount = async (
    emailOrInput: string | RegisterAccountInput,
    passwordArg?: string,
    displayNameArg?: string,
    roleArg?: UserRole,
    optionsArg?: {
      phone?: string;
      companyName?: string;
      city?: string;
      subscriptionPlan?: SubscriptionPlan;
      initialBuildingName?: string;
      initialApartmentsCount?: number;
      initialBuildingFees?: number;
      buildingId?: string;
      apartmentId?: string;
    }
  ): Promise<UserProfile> => {
    const input: RegisterAccountInput =
      typeof emailOrInput === 'object' && emailOrInput !== null
        ? emailOrInput
        : {
            email: String(emailOrInput),
            password: passwordArg || '',
            name: displayNameArg || String(emailOrInput).split('@')[0],
            role: roleArg || 'syndic',
            phone: optionsArg?.phone || '',
            city: optionsArg?.city,
            cabinetName: optionsArg?.companyName,
            companyName: optionsArg?.companyName,
            plan: optionsArg?.subscriptionPlan,
            buildingCode: optionsArg?.buildingId,
            apartmentNumber: optionsArg?.apartmentId,
          };
    setLoading(true);
    try {
      await syncAllSharedStateFromServer();
      const normalizedEmail = input.email.trim().toLowerCase();
      const trimmedPass = input.password.trim();

      if (!normalizedEmail || trimmedPass.length < 6) {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
      }

      const existingUsers = getStoredRegisteredUsers();
      if (existingUsers.some((u) => u.email.toLowerCase() === normalizedEmail)) {
        throw new Error(
          'Un compte existe déjà avec cette adresse email. Veuillez vous connecter.'
        );
      }

      const uid = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let newProfile: UserProfile;

      if (input.role === 'syndic') {
        const syndicId = `syndic-${Date.now()}`;
        const cabinetName = input.cabinetName?.trim() || `Cabinet ${input.name.trim()}`;

        const newSyndic: Syndic = {
          id: syndicId,
          name: cabinetName,
          logoUrl: '',
          createdBy: uid,
          subscriptionPlan: input.plan || 'professional',
          subscriptionStatus: 'trialing',
          subscriptionExpiry: new Date(Date.now() + TRIAL_DURATION_MS).toISOString(),
          email: normalizedEmail,
          phone: input.phone.trim(),
          city: input.city?.trim() || 'Casablanca',
          ice: input.ice?.trim() || undefined,
          rc: input.rc?.trim() || undefined,
          buildings: [],
        };

        await saveSyndic(newSyndic);

        newProfile = {
          uid,
          email: normalizedEmail,
          displayName: input.name.trim(),
          role: 'syndic',
          syndicId,
          phone: input.phone.trim(),
        };
      } else if (input.role === 'resident') {
        // Audit Item 22: Match only against an explicit building code or verified resident invitation by email.
        // Never fall back to syndics[0].buildings[0] for an unassigned account!
        const syndics = await getSyndics();
        let targetSyndicId: string | undefined;
        let targetBuildingId: string | undefined;
        let targetBuildingName: string | undefined;
        let targetApartmentId: string | undefined;
        let targetResidentId: string | undefined;

        for (const s of syndics) {
          for (const b of s.buildings) {
            const matchedRes = b.residents.find(
              (r) => r.email && r.email.trim().toLowerCase() === normalizedEmail
            );
            if (
              matchedRes ||
              (input.buildingCode &&
                (b.id.toLowerCase() === input.buildingCode.trim().toLowerCase() ||
                  b.name.toLowerCase() === input.buildingCode.trim().toLowerCase()))
            ) {
              targetSyndicId = s.id;
              targetBuildingId = b.id;
              targetBuildingName = b.name;
              if (matchedRes) {
                targetResidentId = matchedRes.id;
                targetApartmentId = matchedRes.apartmentId;
              } else if (input.apartmentNumber) {
                const matchedApt = b.apartments.find(
                  (a) =>
                    a.number.toLowerCase() ===
                    input.apartmentNumber!.trim().toLowerCase()
                );
                if (matchedApt) targetApartmentId = matchedApt.id;
              }
              break;
            }
          }
          if (targetBuildingId) break;
        }

        newProfile = {
          uid,
          email: normalizedEmail,
          displayName: input.name.trim(),
          role: 'resident',
          syndicId: targetSyndicId,
          buildingId: targetBuildingId,
          buildingName: targetBuildingName,
          apartmentId: targetApartmentId,
          apartmentNumber: input.apartmentNumber?.trim() || undefined,
          residentId: targetResidentId,
          phone: input.phone.trim(),
          cin: input.cin?.trim(),
        };
      } else {
        // Provider registration: match only if invited by email, otherwise leave unassigned until linked
        const syndics = await getSyndics();
        let targetSyndicId: string | undefined;
        let targetBuildingId: string | undefined;
        let targetBuildingName: string | undefined;
        let targetPrestataireId: string | undefined;

        for (const s of syndics) {
          for (const b of s.buildings) {
            const prestList = await getPrestatairesForBuilding(b.id);
            const matchedPrest = prestList.find(
              (p) => p.email && p.email.trim().toLowerCase() === normalizedEmail
            );
            if (matchedPrest) {
              targetSyndicId = s.id;
              targetBuildingId = b.id;
              targetBuildingName = b.name;
              targetPrestataireId = matchedPrest.id;
              break;
            }
          }
          if (targetBuildingId) break;
        }

        newProfile = {
          uid,
          email: normalizedEmail,
          displayName: input.companyName?.trim() || input.name.trim(),
          role: 'provider',
          syndicId: targetSyndicId,
          buildingId: targetBuildingId,
          buildingName: targetBuildingName,
          prestataireId: targetPrestataireId,
          prestataireCategory: input.category || 'maintenance',
          phone: input.phone.trim(),
        };
      }

      // Save hashed credentials (NEVER store plaintext password in localStorage or shared server)
      saveStoredRegisteredUser({
        uid: newProfile.uid,
        email: normalizedEmail,
        passwordHash: hashPasswordSync(trimmedPass, normalizedEmail),
        profile: newProfile,
        createdAt: new Date().toISOString(),
      });

      // Attempt optional Firebase Auth creation in background
      try {
        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, trimmedPass);
        await updateProfile(cred.user, { displayName: newProfile.displayName });
        await setDoc(doc(db, 'users', cred.user.uid), {
          ...newProfile,
          uid: cred.user.uid,
        });
      } catch {
        // Continue with hashed credential account if Firebase email/password is offline
      }

      persistSession(newProfile);
      return newProfile;
    } finally {
      setLoading(false);
    }
  };

  const completeMandatoryPasswordChange = async (newPassword: string) => {
    if (!userProfile) return;
    const trimmed = newPassword.trim();
    if (trimmed.length < 6) {
      throw new Error('Le nouveau mot de passe doit contenir au moins 6 caractères.');
    }

    const normalizedEmail = (userProfile.email || '').trim().toLowerCase();
    const newPasswordHash = hashPasswordSync(trimmed, normalizedEmail);

    // 1. Update Resident Credential Account if resident
    if (userProfile.role === 'resident' && userProfile.residentId) {
      const rawResidentAccounts = localStorage.getItem(STORAGE_KEYS.RESIDENT_ACCOUNTS);
      const residentAccounts: ResidentAccountRecord[] = rawResidentAccounts
        ? JSON.parse(rawResidentAccounts)
        : [];
      const updatedAccounts = residentAccounts.map((a) => {
        if (
          a.residentId === userProfile.residentId ||
          (userProfile.email &&
            a.email.toLowerCase() === userProfile.email.toLowerCase())
        ) {
          const { password: _removed, ...rest } = a as any;
          return {
            ...rest,
            passwordHash: newPasswordHash,
            mustChangePassword: false,
          };
        }
        return a;
      });
      localStorage.setItem(STORAGE_KEYS.RESIDENT_ACCOUNTS, JSON.stringify(updatedAccounts));
      void pushKeyToSharedServer(STORAGE_KEYS.RESIDENT_ACCOUNTS, updatedAccounts);

      // Update Resident record in Syndic building and remove any ephemeral password field
      const rawSyndics = localStorage.getItem(STORAGE_KEYS.SYNDICS);
      if (rawSyndics) {
        const syndics: Syndic[] = JSON.parse(rawSyndics);
        for (const s of syndics) {
          for (const bld of s.buildings) {
            const rIdx = bld.residents.findIndex((r) => r.id === userProfile.residentId);
            if (rIdx >= 0) {
              const { generatedPassword: _gp, ...cleanRes } = bld.residents[rIdx] as any;
              bld.residents[rIdx] = {
                ...cleanRes,
                invitationStatus: 'accepted',
                mustChangePassword: false,
              };
            }
          }
        }
        localStorage.setItem(STORAGE_KEYS.SYNDICS, JSON.stringify(syndics));
        void pushKeyToSharedServer(STORAGE_KEYS.SYNDICS, syndics);
      }
    }

    // 2. Update Prestataire Credential Account if provider
    if (userProfile.role === 'provider' && userProfile.prestataireId) {
      const rawPrestAccounts = localStorage.getItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS);
      const prestAccounts: PrestataireAccountRecord[] = rawPrestAccounts
        ? JSON.parse(rawPrestAccounts)
        : [];
      const updatedAccounts = prestAccounts.map((a) => {
        if (
          a.prestataireId === userProfile.prestataireId ||
          (userProfile.email &&
            a.email.toLowerCase() === userProfile.email.toLowerCase())
        ) {
          const { password: _removed, ...rest } = a as any;
          return {
            ...rest,
            passwordHash: newPasswordHash,
            mustChangePassword: false,
          };
        }
        return a;
      });
      localStorage.setItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS, JSON.stringify(updatedAccounts));
      void pushKeyToSharedServer(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS, updatedAccounts);

      const rawPrestList = localStorage.getItem(STORAGE_KEYS.PRESTATAIRES);
      if (rawPrestList) {
        const list: Prestataire[] = JSON.parse(rawPrestList);
        const pIdx = list.findIndex((p) => p.id === userProfile.prestataireId);
        if (pIdx >= 0) {
          const { generatedPassword: _gp, ...cleanPrest } = list[pIdx] as any;
          list[pIdx] = {
            ...cleanPrest,
            invitationStatus: 'accepted',
            mustChangePassword: false,
          };
          localStorage.setItem(STORAGE_KEYS.PRESTATAIRES, JSON.stringify(list));
          void pushKeyToSharedServer(STORAGE_KEYS.PRESTATAIRES, list);
        }
      }
    }

    // 3. Update Registered Users if present
    const registered = getStoredRegisteredUsers();
    const regIdx = registered.findIndex(
      (u) =>
        u.uid === userProfile.uid ||
        (userProfile.email && u.email.toLowerCase() === normalizedEmail)
    );
    const updatedProfile: UserProfile = {
      ...userProfile,
      mustChangePassword: false,
    };
    if (regIdx >= 0) {
      registered[regIdx] = {
        ...registered[regIdx],
        passwordHash: newPasswordHash,
        profile: updatedProfile,
      };
      localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(registered));
      void pushKeyToSharedServer(REGISTERED_USERS_KEY, registered);
    }

    // 4. Update Firebase Auth password if signed into Firebase
    if (auth.currentUser) {
      try {
        await updatePassword(auth.currentUser, trimmed);
      } catch {
        // Ignore if session is local/custom
      }
    }

    persistSession(updatedProfile);
  };

  const logout = async () => {
    persistSession(null);
    if (typeof window !== 'undefined') {
      // Audit Item 22: Clear selected building and user-scoped cached state on logout
      localStorage.removeItem('syndik_selected_building_id');
      window.dispatchEvent(new CustomEvent('syndik-user-logout'));
    }
    try {
      await signOut(auth);
    } catch {
      // Ignore if not signed in via Firebase
    }
  };

  const registerOrUpdateUserCredentials = (
    email: string,
    passwordOrToken: string,
    profile: UserProfile
  ) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !passwordOrToken) return;
    // Audit Item 03: Only persist cryptographic passwordHash, never plaintext password
    const passwordHash = hashPasswordSync(passwordOrToken, normalizedEmail);
    const registered = getStoredRegisteredUsers();
    const existingIdx = registered.findIndex(
      (u) => u.email.toLowerCase() === normalizedEmail || u.uid === profile.uid
    );
    const entry: StoredUserAccount = {
      uid: profile.uid,
      email: normalizedEmail,
      passwordHash,
      profile,
      createdAt: new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      registered[existingIdx] = entry;
    } else {
      registered.push(entry);
    }
    localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(registered));
    void pushKeyToSharedServer(REGISTERED_USERS_KEY, registered);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        currentUser: user,
        userProfile,
        loading,
        signInWithGoogle,
        loginWithGoogle: signInWithGoogle,
        login,
        loginWithEmail: login,
        registerAccount,
        register: registerAccount,
        completeMandatoryPasswordChange,
        changePassword: completeMandatoryPasswordChange,
        registerOrUpdateUserCredentials,
        logout,
      }}
    >
      {children}
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
