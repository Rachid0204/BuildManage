import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
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
  sessionRetrying: boolean;
  retrySession: () => Promise<void>;
  resetSession: () => void;
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
    emailVerified: profile.emailVerified === true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: profile.syndicId || null,
    delete: async () => {},
    getIdToken: async () => {
      if (auth.currentUser && auth.currentUser.uid === (profile.firebaseUid || profile.uid)) {
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
  const [sessionRetrying, setSessionRetrying] = useState(false);
  const profileRef = useRef<UserProfile | null>(null);
  const epochRef = useRef(0);
  const requestIdRef = useRef(0);
  const sessionRequestRef = useRef<Promise<'authenticated' | 'empty' | 'invalid' | 'unavailable'> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const cancelSessionRequest = useCallback(() => {
    epochRef.current++;
    requestIdRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    sessionRequestRef.current = null;
    setSessionRetrying(false);
  }, []);

  const persistSession = useCallback((
    profile: UserProfile | null,
    firebaseUser?: User | null,
    serverToken?: string
  ) => {
    epochRef.current++;
    setSessionError(false);
    const scope = (p: UserProfile | null) => p && [p.uid, p.role, p.syndicId, p.buildingId, p.residentId, p.prestataireId].join(':');
    if (!profile || scope(profile) !== scope(profileRef.current)) { clearStateCache(); queryClient.clear(); }
    profileRef.current = profile;
    if (!profile) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      setActiveAuthContext(null, null);
      setUser(null);
      setUserProfile(null);
      return;
    }
    if (!firebaseUser && auth.currentUser && auth.currentUser.uid !== (profile.firebaseUid || profile.uid)) {
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
  }, [queryClient]);

  const resetSession = useCallback(() => {
    cancelSessionRequest();
    persistSession(null);
    setLoading(false);
    localStorage.removeItem('syndik_selected_building_id');
    window.dispatchEvent(new CustomEvent('syndik-user-logout'));
    // This is a local recovery action, not an API logout/revocation of other devices.
    void signOut(auth).catch(() => {});
  }, [cancelSessionRequest, persistSession]);

  const exchangeFirebaseSession = useCallback(async (firebaseUser: User): Promise<UserProfile> => {
    const epoch = epochRef.current;
    const token = await firebaseUser.getIdToken();
    const response = await fetch('/api/auth/firebase-session', { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (epoch !== epochRef.current) throw new Error('La session a changé.');
    if (!response.ok || !data.profile || !data.token)
      throw Object.assign(new Error(data.error || 'Connexion au serveur impossible.'), { status: response.status });
    persistSession(data.profile, firebaseUser, data.token);
    await syncAllSharedStateFromServer(true);
    return data.profile;
  }, [persistSession]);

  const restoreSession = useCallback(() => {
    if (sessionRequestRef.current) return sessionRequestRef.current;
    const id = ++requestIdRef.current, epoch = epochRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    const current = () => id === requestIdRef.current && epoch === epochRef.current;
    setSessionRetrying(true);
    const task = (async (): Promise<'authenticated' | 'empty' | 'invalid' | 'unavailable'> => {
      try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return 'empty';
        let cached: { serverToken?: string };
        try { cached = JSON.parse(raw); } catch { if (current()) persistSession(null); return 'invalid'; }
        if (!cached || typeof cached !== 'object' || Array.isArray(cached) ||
            typeof cached.serverToken !== 'string' || !cached.serverToken.trim()) {
          if (current()) persistSession(null);
          return 'invalid';
        }
        const response = await fetch('/api/auth/session', { signal: controller.signal,
          cache: 'no-store', headers: { Authorization: `Bearer ${cached.serverToken}` } });
        if ([401, 403].includes(response.status)) {
          if (current()) { persistSession(null); void signOut(auth).catch(() => {}); }
          return 'invalid';
        }
        if (!response.ok) throw new Error('Session service unavailable');
        const data = await response.json();
        if (!data.profile || !data.token) throw new Error('Incomplete session response');
        if (current()) persistSession(data.profile, undefined, data.token);
        return 'authenticated';
      } catch {
        if (current()) setSessionError(true);
        return 'unavailable';
      } finally {
        clearTimeout(timeout);
        if (id === requestIdRef.current) {
          controllerRef.current = null;
          sessionRequestRef.current = null;
          setSessionRetrying(false);
        }
      }
    })();
    sessionRequestRef.current = task;
    // Empty/malformed sessions can resolve before the promise is assigned.
    void task.finally(() => { if (sessionRequestRef.current === task) sessionRequestRef.current = null; });
    return task;
  }, [persistSession]);

  const sessionRecoveryFailed = useCallback((error: any, epoch: number) => {
    if (epoch !== epochRef.current) return;
    if ([401, 403].includes(error?.status) ||
        ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token'].includes(error?.code)) {
      persistSession(null);
      void signOut(auth).catch(() => {});
    } else setSessionError(true);
  }, [persistSession]);

  const retrySession = useCallback(async () => {
    const epoch = epochRef.current;
    const result = await restoreSession();
    if (result !== 'empty' || epoch !== epochRef.current) return;
    if (auth.currentUser) {
      const requestId = requestIdRef.current;
      setSessionRetrying(true);
      try { await exchangeFirebaseSession(auth.currentUser); }
      catch (error) { sessionRecoveryFailed(error, epoch); }
      finally { if (requestId === requestIdRef.current) setSessionRetrying(false); }
    } else persistSession(null);
  }, [restoreSession, exchangeFirebaseSession, sessionRecoveryFailed, persistSession]);

  useEffect(() => {
    let active = true, initialAuthHandled = false;
    const restored = restoreSession();
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      if (initialAuthHandled) return;
      initialAuthHandled = true;
      const result = await restored;
      if (active && result === 'empty' && currentUser) {
        const epoch = epochRef.current;
        try { await exchangeFirebaseSession(currentUser); }
        catch (error) { if (active) sessionRecoveryFailed(error, epoch); }
      }
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      epochRef.current++;
      requestIdRef.current++;
      controllerRef.current?.abort();
      controllerRef.current = null;
      sessionRequestRef.current = null;
      unsubscribe();
    };
  }, [restoreSession, exchangeFirebaseSession, sessionRecoveryFailed]);

  useEffect(() => {
    if (!sessionError) return;
    let active = true, attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (!active) return;
      if (navigator.onLine !== false) await retrySession();
      if (active) timer = setTimeout(run, Math.min(1000 * 2 ** ++attempt, 30000));
    };
    const wake = () => { clearTimeout(timer); void run(); };
    timer = setTimeout(run, 1000);
    window.addEventListener('online', wake);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('online', wake); };
  }, [sessionError, retrySession]);

  const signInWithGoogle = async (): Promise<UserProfile> => {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    return exchangeFirebaseSession(result.user);
  };

  const login = async (email: string, pass?: string): Promise<UserProfile> => {
    cancelSessionRequest();
    setLoading(true);
    try {
      const identifier = email.trim().toLowerCase();
      const password = (pass || '').trim();
      if (!identifier || !password || isAlreadyHashedPassword(password)) throw new Error('Identifiants invalides.');
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }) });
      const data = await response.json();
      if (response.ok && data.profile && data.token) {
        const firebaseUser = data.firebaseAuth
          ? (await signInWithEmailAndPassword(auth, data.profile.email, password)).user : undefined;
        persistSession(data.profile, firebaseUser, data.token);
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
      const firebaseUser = data.firebaseAuth
        ? (await signInWithEmailAndPassword(auth, input.email.trim().toLowerCase(), input.password)).user : undefined;
      persistSession(data.profile, firebaseUser, data.token);
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
    const firebaseUser = data.firebaseAuth
      ? (await signInWithEmailAndPassword(auth, userProfile.email, password)).user : undefined;
    persistSession(data.profile || { ...userProfile, mustChangePassword:false },firebaseUser,data.token);
    await syncAllSharedStateFromServer(true);
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
        sessionRetrying,
        retrySession,
        resetSession,
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
