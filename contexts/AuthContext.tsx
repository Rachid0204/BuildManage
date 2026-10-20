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
  syncAuthAccountsFromFirestore,
  syncPasswordChangeToFirestore,
  ResidentAccountRecord,
  PrestataireAccountRecord,
  sanitizeAccountRecordsInStorage,
} from '../firebase/services';
import type { UserProfile, UserRole, SubscriptionPlan, Syndic, Prestataire } from '../types';
import {
  hashPasswordSync,
  verifyPasswordSync,
  isAlreadyHashedPassword,
  createSignedSessionEnvelope,
  verifySignedSessionEnvelope,
  setActiveAuthContext,
  computeSessionSignature,
  getAuthenticatedRequestHeaders,
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
      .filter((item) => item && typeof item.email === 'string' && (item.profile || item.role))
      .map((item) => {
        const emailNorm = item.email.trim().toLowerCase();
        const passwordHash =
          item.passwordHash ||
          (typeof item.password === 'string' ? hashPasswordSync(item.password, emailNorm) : '');
        const profile: UserProfile = item.profile || {
          uid: item.uid || `usr-${Date.now()}`,
          email: emailNorm,
          displayName: item.displayName || emailNorm.split('@')[0],
          role: item.role || 'syndic',
          syndicId: item.syndicId,
          buildingId: item.buildingId,
          buildingName: item.buildingName,
          phone: item.phone,
        };
        if ('password' in item || !item.profile) {
          migrated = true;
        }
        return {
          uid: item.uid || profile.uid,
          email: emailNorm,
          passwordHash,
          profile,
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
      if (auth.currentUser && auth.currentUser.uid === profile.uid) {
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

  const persistSession = (
    profile: UserProfile | null,
    firebaseUser?: User | null,
    serverToken?: string
  ) => {
    if (!profile) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setActiveAuthContext(null, null);
      setUser(null);
      setUserProfile(null);
      return;
    }
    if (!firebaseUser && auth.currentUser && auth.currentUser.uid !== profile.uid) {
      void signOut(auth).catch(() => {});
    }
    const existingEnvelopeRaw = localStorage.getItem(SESSION_STORAGE_KEY);
    let preservedServerToken = serverToken;
    if (!preservedServerToken && existingEnvelopeRaw) {
      try {
        const parsedPrev = JSON.parse(existingEnvelopeRaw);
        if (parsedPrev?.profile?.uid === profile.uid && typeof parsedPrev.serverToken === 'string') {
          preservedServerToken = parsedPrev.serverToken;
        }
      } catch {
        // ignore
      }
    }
    const envelope = createSignedSessionEnvelope(profile, preservedServerToken);
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(envelope));
    setActiveAuthContext(profile, preservedServerToken || null);
    setUserProfile(profile);
    setUser(firebaseUser || createVerifiedIdentityAdapter(profile));
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
          setActiveAuthContext(
            verifiedProfile,
            typeof parsed.serverToken === 'string' ? parsed.serverToken : null
          );
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
        // Do not overwrite an active signed local session (e.g. Resident or Provider) belonging to a different UID
        const activeRaw = localStorage.getItem(SESSION_STORAGE_KEY);
        if (activeRaw) {
          try {
            const activeVerified = verifySignedSessionEnvelope(JSON.parse(activeRaw));
            if (activeVerified && activeVerified.uid !== currentUser.uid) {
              setLoading(false);
              return;
            }
          } catch {
            // continue
          }
        }
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

      // Reject raw hash strings supplied as a candidate password (hash-as-password bypass prevention)
      if (isAlreadyHashedPassword(trimmedPass)) {
        throw new Error('Identifiants ou format de mot de passe invalides.');
      }

      // 0. Server-side authentication (/api/auth/login) for cross-browser / incognito / mobile devices
      let serverAuthError: string | null = null;
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: normalizedEmail, password: trimmedPass }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          if (res.ok && data?.ok && data?.profile) {
            const serverProfile = data.profile as UserProfile;
            persistSession(
              serverProfile,
              undefined,
              typeof data.token === 'string' ? data.token : undefined
            );
            await syncAllSharedStateFromServer(true);
            return serverProfile;
          } else if (res.status === 401 && data?.error) {
            serverAuthError = String(data.error);
          }
        }
      } catch {
        // Server endpoint may be offline in isolated unit tests; fall through to local & Firebase Auth
      }

      // Pull latest Resident & Provider accounts and Syndic/Prestataire records from Firestore (for static/Vercel deployments)
      await syncAuthAccountsFromFirestore();
      const syndicsForResLookup = await getSyndics();

      // 1. Check Resident Credential Accounts (Generated by Syndic) — supports login by Email or Moroccan CIN
      const rawResidentAccounts = localStorage.getItem(STORAGE_KEYS.RESIDENT_ACCOUNTS);
      const residentAccounts: ResidentAccountRecord[] = rawResidentAccounts
        ? JSON.parse(rawResidentAccounts)
        : [];

      let matchedResFromBuilding: { syndic: Syndic; building: any; resident: any } | null = null;
      for (const s of syndicsForResLookup) {
        for (const b of s.buildings || []) {
          const r = (b.residents || []).find(
            (resItem) =>
              resItem.email?.trim().toLowerCase() === normalizedEmail ||
              (resItem.cin && resItem.cin.trim().toLowerCase() === normalizedEmail)
          );
          if (r) {
            matchedResFromBuilding = { syndic: s, building: b, resident: r };
            break;
          }
        }
        if (matchedResFromBuilding) break;
      }

      const matchedResAccount = residentAccounts.find((a) => {
        if (a.email.trim().toLowerCase() === normalizedEmail) return true;
        if (a.cin && a.cin.trim().toLowerCase() === normalizedEmail) return true;
        if (
          matchedResFromBuilding &&
          (a.residentId === matchedResFromBuilding.resident.id ||
            a.email.trim().toLowerCase() ===
              matchedResFromBuilding.resident.email?.trim().toLowerCase())
        ) {
          return true;
        }
        return false;
      });

      if (matchedResAccount || (matchedResFromBuilding && matchedResFromBuilding.resident.hasAccount)) {
        const resObj = matchedResFromBuilding?.resident;
        const accountEmail = (matchedResAccount?.email || resObj?.email || '').trim();
        const accountEmailSalt = accountEmail.toLowerCase();
        const storedSecret = matchedResAccount?.passwordHash || matchedResAccount?.password;
        const mustChange =
          matchedResAccount?.mustChangePassword ?? resObj?.mustChangePassword ?? true;
        const inviteExpiresAt =
          resObj?.invitationExpiresAt || matchedResAccount?.invitationExpiresAt;

        if (
          mustChange !== false &&
          inviteExpiresAt &&
          new Date(inviteExpiresAt).getTime() < Date.now()
        ) {
          throw new Error(
            'Cette invitation résident a expiré. Veuillez demander au syndic de régénérer vos identifiants.'
          );
        }

        let verified = verifyPasswordSync(trimmedPass, storedSecret, accountEmailSalt);
        if (
          !verified &&
          mustChange !== false &&
          resObj &&
          ((resObj.invitationCode && resObj.invitationCode.trim() === trimmedPass) ||
            (resObj.invitationToken && resObj.invitationToken.trim() === trimmedPass))
        ) {
          verified = true;
        }

        if (!verified) {
          throw new Error(
            'Identifiants résident incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.'
          );
        }

        const resolvedResId = matchedResAccount?.residentId || resObj?.id;
        let buildingName = matchedResFromBuilding?.building?.name || 'Résidence';
        let resolvedBuildingId =
          matchedResAccount?.buildingId || matchedResFromBuilding?.building?.id;
        let resolvedSyndicId =
          matchedResAccount?.syndicId ||
          matchedResFromBuilding?.syndic?.id ||
          resObj?.syndicId;
        const resolvedAptId = matchedResAccount?.apartmentId || resObj?.apartmentId;
        let apartmentNumber = resolvedAptId || '';

        for (const s of syndicsForResLookup) {
          const bld = s.buildings.find(
            (b) =>
              b.id === resolvedBuildingId ||
              b.residents.some((r) => r.id === resolvedResId)
          );
          if (bld) {
            buildingName = bld.name;
            resolvedBuildingId = bld.id;
            resolvedSyndicId = s.id;
            const apt = bld.apartments.find(
              (a) =>
                a.id === resolvedAptId ||
                a.ownerId === resolvedResId ||
                a.tenantId === resolvedResId
            );
            if (apt) apartmentNumber = apt.number;
            break;
          }
        }

        const resProfile: UserProfile = {
          uid: `user-res-${resolvedResId}`,
          email: accountEmail,
          displayName: matchedResAccount?.name || resObj?.name || 'Résident',
          role: 'resident',
          syndicId: resolvedSyndicId,
          buildingId: resolvedBuildingId,
          buildingName,
          apartmentId: resolvedAptId,
          apartmentNumber,
          residentId: resolvedResId,
          isOwner: matchedResAccount?.isOwner ?? resObj?.isOwner ?? true,
          cin: matchedResAccount?.cin || resObj?.cin,
          phone: matchedResAccount?.phone || resObj?.phone,
          mustChangePassword: mustChange,
        };
        persistSession(resProfile);
        await syncAllSharedStateFromServer(true);
        return resProfile;
      }

      // 2. Check Prestataire Credential Accounts (Generated by Syndic) — strictly verifying password hash
      const rawPrestAccounts = localStorage.getItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS);
      const prestAccounts: PrestataireAccountRecord[] = rawPrestAccounts
        ? JSON.parse(rawPrestAccounts)
        : [];
      const rawPrestataires = localStorage.getItem(STORAGE_KEYS.PRESTATAIRES);
      const prestatairesList: Prestataire[] = rawPrestataires
        ? JSON.parse(rawPrestataires)
        : [];
      const matchedPrestObj = prestatairesList.find(
        (p) => p.email?.trim().toLowerCase() === normalizedEmail
      );
      const matchedPrestAccount = prestAccounts.find(
        (a) =>
          a.email.trim().toLowerCase() === normalizedEmail ||
          (matchedPrestObj && a.prestataireId === matchedPrestObj.id)
      );

      if (
        matchedPrestAccount ||
        (matchedPrestObj &&
          (matchedPrestObj.hasAccount ||
            matchedPrestObj.invitationToken ||
            matchedPrestObj.invitationCode))
      ) {
        const accountEmail = (matchedPrestAccount?.email || matchedPrestObj?.email || '').trim();
        const accountEmailSalt = accountEmail.toLowerCase();
        const storedSecret = matchedPrestAccount?.passwordHash || matchedPrestAccount?.password;
        const mustChange =
          matchedPrestAccount?.mustChangePassword ?? matchedPrestObj?.mustChangePassword ?? true;
        const inviteExpiresAt =
          matchedPrestObj?.invitationExpiresAt || matchedPrestAccount?.invitationExpiresAt;

        if (
          mustChange !== false &&
          inviteExpiresAt &&
          new Date(inviteExpiresAt).getTime() < Date.now()
        ) {
          throw new Error(
            'Cette invitation prestataire a expiré. Veuillez demander au syndic de régénérer vos identifiants.'
          );
        }

        let verified = verifyPasswordSync(trimmedPass, storedSecret, accountEmailSalt);
        if (
          !verified &&
          mustChange !== false &&
          matchedPrestObj &&
          ((matchedPrestObj.invitationToken &&
            matchedPrestObj.invitationToken.trim() === trimmedPass) ||
            (matchedPrestObj.invitationCode &&
              matchedPrestObj.invitationCode.trim() === trimmedPass))
        ) {
          verified = true;
        }

        if (!verified) {
          throw new Error(
            'Identifiants prestataire incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.'
          );
        }

        const resolvedPrestId = matchedPrestAccount?.prestataireId || matchedPrestObj?.id || '';
        const resolvedBuildingId =
          matchedPrestAccount?.buildingId || matchedPrestObj?.buildingId;
        let resolvedSyndicId = matchedPrestAccount?.syndicId || matchedPrestObj?.syndicId;
        let buildingName = 'Résidence';
        for (const s of syndicsForResLookup) {
          const bld = s.buildings.find((b) => b.id === resolvedBuildingId);
          if (bld) {
            buildingName = bld.name;
            resolvedSyndicId = s.id;
            break;
          }
        }
        if (!resolvedSyndicId && syndicsForResLookup.length > 0) {
          resolvedSyndicId = syndicsForResLookup[0].id;
        }

        const category = matchedPrestAccount?.category || matchedPrestObj?.category || 'other';
        const prestProfile: UserProfile = {
          uid: `user-prest-${resolvedPrestId}`,
          email: accountEmail,
          displayName: matchedPrestAccount?.name || matchedPrestObj?.name || 'Prestataire',
          role: 'provider',
          syndicId: resolvedSyndicId,
          buildingId: resolvedBuildingId,
          buildingName,
          prestataireId: resolvedPrestId,
          prestataireCategory: category,
          providerCategory: category,
          phone: matchedPrestObj?.phone,
          mustChangePassword: mustChange,
        };
        persistSession(prestProfile);
        await syncAllSharedStateFromServer(true);
        return prestProfile;
      }

      // 3. Check Registered Accounts (Syndic / Resident / Provider / Admin) with password hash verification
      const registeredUsers = getStoredRegisteredUsers();
      const matchedRegistered = registeredUsers.find(
        (u) =>
          u.email.toLowerCase() === normalizedEmail ||
          (u.profile?.cin && u.profile.cin.trim().toLowerCase() === normalizedEmail)
      );

      if (matchedRegistered) {
        const regSalt = matchedRegistered.email.trim().toLowerCase();
        if (!verifyPasswordSync(trimmedPass, matchedRegistered.passwordHash, regSalt)) {
          throw new Error(
            'Identifiants incorrects. Veuillez vérifier votre email et votre mot de passe.'
          );
        }
        const enrichedProfile: UserProfile = { ...matchedRegistered.profile };
        if (enrichedProfile.role === 'resident') {
          const cleanResId =
            enrichedProfile.residentId ||
            enrichedProfile.uid.replace(/^(user-res-|res-)/, '');
          if (cleanResId) enrichedProfile.residentId = cleanResId;
          if (matchedResFromBuilding) {
            enrichedProfile.residentId =
              enrichedProfile.residentId || matchedResFromBuilding.resident.id;
            enrichedProfile.buildingId =
              enrichedProfile.buildingId || matchedResFromBuilding.building.id;
            enrichedProfile.buildingName =
              enrichedProfile.buildingName || matchedResFromBuilding.building.name;
            enrichedProfile.syndicId =
              enrichedProfile.syndicId || matchedResFromBuilding.syndic.id;
            enrichedProfile.apartmentId =
              enrichedProfile.apartmentId || matchedResFromBuilding.resident.apartmentId;
          }
        } else if (enrichedProfile.role === 'provider') {
          const cleanPrestId =
            enrichedProfile.prestataireId ||
            enrichedProfile.uid.replace(/^(user-prest-|prov-)/, '');
          if (cleanPrestId) enrichedProfile.prestataireId = cleanPrestId;
          if (matchedPrestObj) {
            enrichedProfile.prestataireId =
              enrichedProfile.prestataireId || matchedPrestObj.id;
            enrichedProfile.buildingId =
              enrichedProfile.buildingId || matchedPrestObj.buildingId;
            enrichedProfile.syndicId =
              enrichedProfile.syndicId || matchedPrestObj.syndicId;
            enrichedProfile.prestataireCategory =
              enrichedProfile.prestataireCategory ||
              enrichedProfile.providerCategory ||
              matchedPrestObj.category;
          }
        }
        persistSession(enrichedProfile);
        await syncAllSharedStateFromServer(true);
        return enrichedProfile;
      }

      if (serverAuthError) {
        throw new Error(serverAuthError);
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
      if (isAlreadyHashedPassword(trimmedPass)) {
        throw new Error('Format de mot de passe non valide.');
      }
      if (input.role === 'admin') {
        throw new Error('La création directe de compte administrateur n’est pas autorisée.');
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
        const cityVal = input.city?.trim() || 'Casablanca';
        const initBldName =
          optionsArg?.initialBuildingName?.trim() || (input as any).initialBuildingName?.trim();
        const initAptsCount = Math.max(
          0,
          Number(optionsArg?.initialApartmentsCount ?? (input as any).initialApartmentsCount ?? 0)
        );
        const initMonthlyFees = Math.max(
          0,
          Number(optionsArg?.initialBuildingFees ?? (input as any).initialBuildingFees ?? 250)
        );

        const initialBuildings = initBldName
          ? [
              {
                id: `bld-${Date.now()}`,
                syndicId,
                name: initBldName,
                address: `Quartier Principal, ${cityVal}`,
                city: cityVal,
                monthlySyndicFees: initMonthlyFees,
                reserveFundRate: 5,
                reserveFundPercentage: 5,
                managerName: input.name.trim(),
                managerPhone: input.phone.trim(),
                apartments: Array.from({ length: initAptsCount }, (_, idx) => {
                  const baseTant = initAptsCount > 0 ? Math.floor(1000 / initAptsCount) : 100;
                  return {
                    id: `apt-${Date.now()}-${idx + 1}`,
                    buildingId: `bld-${Date.now()}`,
                    number: `${Math.floor(idx / 4) + 1}0${(idx % 4) + 1}`,
                    floor: Math.floor(idx / 4) + 1,
                    area: 80,
                    tantiemes:
                      idx === 0 ? baseTant + (1000 - baseTant * initAptsCount) : baseTant,
                    coproType: 'apartment' as const,
                    ownerId: null,
                    tenantId: null,
                    monthlyFees: initMonthlyFees,
                  };
                }),
                residents: [],
                announcements: [],
                documents: [],
                financials: {
                  balance: 0,
                  reserveFundBalance: 0,
                  transactions: [],
                },
              },
            ]
          : [];

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
          city: cityVal,
          ice: input.ice?.trim() || undefined,
          rc: input.rc?.trim() || undefined,
          buildings: initialBuildings,
        };

        await saveSyndic(newSyndic);

        newProfile = {
          uid,
          email: normalizedEmail,
          displayName: input.name.trim(),
          role: 'syndic',
          syndicId,
          buildingId: initialBuildings[0]?.id,
          buildingName: initialBuildings[0]?.name,
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
    const resolvedResidentId =
      userProfile.residentId ||
      (userProfile.role === 'resident'
        ? userProfile.uid.replace(/^(user-res-|res-)/, '')
        : undefined);
    const resolvedPrestataireId =
      userProfile.prestataireId ||
      (userProfile.role === 'provider'
        ? userProfile.uid.replace(/^(user-prest-|prov-)/, '')
        : undefined);

    // 0. Atomically update shared server state if server is available
    try {
      const headers = getAuthenticatedRequestHeaders();
      if (headers['Authorization']) {
        await fetch('/api/auth/change-password', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            newPassword: trimmed,
            email: normalizedEmail,
            residentId: resolvedResidentId,
            prestataireId: resolvedPrestataireId,
          }),
        });
      }
    } catch {
      // Fall back to local + pushKeyToSharedServer
    }

    // 1. Update Resident Credential Account if resident
    if (userProfile.role === 'resident') {
      const rawResidentAccounts = localStorage.getItem(STORAGE_KEYS.RESIDENT_ACCOUNTS);
      const residentAccounts: ResidentAccountRecord[] = rawResidentAccounts
        ? JSON.parse(rawResidentAccounts)
        : [];
      const updatedAccounts = residentAccounts.map((a) => {
        if (
          (resolvedResidentId && a.residentId === resolvedResidentId) ||
          (normalizedEmail && a.email.trim().toLowerCase() === normalizedEmail)
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
            const rIdx = bld.residents.findIndex(
              (r) =>
                (resolvedResidentId && r.id === resolvedResidentId) ||
                (normalizedEmail && r.email?.trim().toLowerCase() === normalizedEmail)
            );
            if (rIdx >= 0) {
              const {
                generatedPassword: _gp,
                invitationToken: _it,
                invitationCode: _ic,
                ...cleanRes
              } = bld.residents[rIdx] as any;
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
    if (userProfile.role === 'provider') {
      const rawPrestAccounts = localStorage.getItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS);
      const prestAccounts: PrestataireAccountRecord[] = rawPrestAccounts
        ? JSON.parse(rawPrestAccounts)
        : [];
      const updatedAccounts = prestAccounts.map((a) => {
        if (
          (resolvedPrestataireId && a.prestataireId === resolvedPrestataireId) ||
          (normalizedEmail && a.email.trim().toLowerCase() === normalizedEmail)
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
        const pIdx = list.findIndex(
          (p) =>
            (resolvedPrestataireId && p.id === resolvedPrestataireId) ||
            (normalizedEmail && p.email?.trim().toLowerCase() === normalizedEmail)
        );
        if (pIdx >= 0) {
          const {
            generatedPassword: _gp,
            invitationToken: _it,
            invitationCode: _ic,
            ...cleanPrest
          } = list[pIdx] as any;
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
        (normalizedEmail && u.email.toLowerCase() === normalizedEmail)
    );
    const updatedProfile: UserProfile = {
      ...userProfile,
      ...(resolvedResidentId ? { residentId: resolvedResidentId } : {}),
      ...(resolvedPrestataireId ? { prestataireId: resolvedPrestataireId } : {}),
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

    // 4. Synchronize updated password hash to Firestore for cross-device / static deployments
    void syncPasswordChangeToFirestore({
      role: userProfile.role,
      residentId: resolvedResidentId,
      prestataireId: resolvedPrestataireId,
      passwordHash: newPasswordHash,
    });

    // 5. Update Firebase Auth password if signed into Firebase as this user
    if (auth.currentUser && auth.currentUser.uid === userProfile.uid) {
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
