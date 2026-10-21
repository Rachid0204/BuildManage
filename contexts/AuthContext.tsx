import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/config';
import { STORAGE_KEYS, pushKeyToSharedServer, syncAllSharedStateFromServer, sanitizeAccountRecordsInStorage, clearStateCache } from '../firebase/services';
import type { UserProfile, UserRole, SubscriptionPlan, Prestataire } from '../types';
import {
  hashPasswordSync,
  isAlreadyHashedPassword,
  createSignedSessionEnvelope,
  verifySignedSessionEnvelope,
  setActiveAuthContext,
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
  sessionError: boolean;
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

function createVerifiedIdentityAdapter(profile: UserProfile, apiToken: string): User {
  return {
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName || profile.email?.split('@')[0] || 'Utilisateur',
    photoURL: profile.photoURL || null,
    emailVerified: false,
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
      return apiToken;
    },
    getIdTokenResult: async () => ({
      token: apiToken,
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
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);

  const persistSession = (
    profile: UserProfile | null,
    firebaseUser?: User | null,
    serverToken?: string
  ) => {
    setSessionError(false);
    if (!profile || profile.uid !== userProfile?.uid) { clearStateCache(); queryClient.clear(); }
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
    setUser(firebaseUser || createVerifiedIdentityAdapter(profile, preservedServerToken || ''));
  };

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const cancel = () => { active = false; controller.abort(); };
    const restore = async () => {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY); if (!raw) return false;
      let cached: { serverToken?: string };
      try { cached = JSON.parse(raw); }
      catch { if (active) persistSession(null); return false; }
      if (!cached.serverToken) { if (active) persistSession(null); return false; }
      try {
        const response = await fetch('/api/auth/session', { signal: controller.signal, headers: { Authorization: `Bearer ${cached.serverToken}` } });
        if ([401, 403].includes(response.status)) { if (active) persistSession(null); return false; }
        if (!response.ok) throw new Error('Session service unavailable');
        const data = await response.json();
        if (!data.profile || !data.token) throw new Error('Incomplete session response');
        if (active) persistSession(data.profile,undefined,data.token);return true;
      } catch {
        // A timeout, interrupted navigation or server outage does not revoke a login.
        // Keep the token and block protected views until the user can retry verification.
        if (active && !controller.signal.aborted) setSessionError(true);
        return true;
      }
    };
    const restored = restore();
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      const hasSession = await restored;
      if (active && !hasSession && currentUser) try { await exchangeFirebaseSession(currentUser); } catch { persistSession(null); }
      if (active) setLoading(false);
    });
    return () => { cancel(); unsubscribe(); };
  }, []);

  const exchangeFirebaseSession = async (firebaseUser: User): Promise<UserProfile> => {
    const token = await firebaseUser.getIdToken();
    const response = await fetch('/api/auth/firebase-session', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    const data = await response.json();
    if (!response.ok || !data.profile || !data.token) throw new Error(data.error || 'Connexion au serveur impossible.');
    persistSession(data.profile, firebaseUser, data.token);
    await syncAllSharedStateFromServer(true);
    return data.profile;
  };

  const signInWithGoogle = async (): Promise<UserProfile> => {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    return exchangeFirebaseSession(result.user);
  };

  const login = async (email: string, pass?: string): Promise<UserProfile> => {
    setLoading(true);
    try {
      const identifier = email.trim().toLowerCase();
      const password = (pass || '').trim();
      if (!identifier || !password || isAlreadyHashedPassword(password)) throw new Error('Identifiants invalides.');
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }) });
      const data = await response.json();
      if (response.ok && data.profile && data.token) {
        persistSession(data.profile, undefined, data.token);
        await syncAllSharedStateFromServer(true);
        return data.profile;
      }
      if (response.status === 404 && identifier.includes('@')) {
        const credential = await signInWithEmailAndPassword(auth, identifier, password);
        return exchangeFirebaseSession(credential.user);
      }
      throw new Error(data.error || 'Identifiants incorrects.');
    } finally { setLoading(false); }
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
      const initialName = optionsArg?.initialBuildingName?.trim() || (input as any).initialBuildingName?.trim();
      const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email.trim().toLowerCase(), password: input.password,
          profile: { role: input.role, displayName: input.companyName || input.name, phone: input.phone },
          syndic: input.role === 'syndic' ? { name: input.cabinetName || input.name, city: input.city,
            subscriptionPlan: input.plan || 'professional',
            initialBuilding: initialName ? { name: initialName,
              apartmentsCount: Number(optionsArg?.initialApartmentsCount ?? (input as any).initialApartmentsCount ?? 0),
              monthlyFees: Number(optionsArg?.initialBuildingFees ?? (input as any).initialBuildingFees ?? 250) } : undefined,
          } : undefined }) });
      const data = await response.json();
      if (!response.ok || !data.profile || !data.token) throw new Error(data.error || 'Inscription impossible.');
      persistSession(data.profile, undefined, data.token);
      await syncAllSharedStateFromServer(true);
      return data.profile;
    } finally { setLoading(false); }
  };

  const completeMandatoryPasswordChange = async (newPassword: string) => {
    if (!userProfile) throw new Error('Authentification requise.');
    const password = newPassword.trim();
    if (password.length < 10 || isAlreadyHashedPassword(password)) throw new Error('Mot de passe invalide.');
    const response = await fetch('/api/auth/change-password', { method: 'POST',
      headers: getAuthenticatedRequestHeaders(), body: JSON.stringify({ newPassword: password }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Le mot de passe n’a pas été enregistré.');
    await syncAllSharedStateFromServer(true);
    persistSession(data.profile || { ...userProfile, mustChangePassword:false },undefined,data.token);
  };

  const logout = async () => {
    try { await fetch('/api/auth/logout',{method:'POST',headers:getAuthenticatedRequestHeaders()}); } finally { persistSession(null); }
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


  return (
    <AuthContext.Provider
      value={{
        user,
        currentUser: user,
        userProfile,
        loading,
        sessionError,
        signInWithGoogle,
        loginWithGoogle: signInWithGoogle,
        login,
        loginWithEmail: login,
        registerAccount,
        register: registerAccount,
        completeMandatoryPasswordChange,
        changePassword: completeMandatoryPasswordChange,
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
