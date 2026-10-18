
import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
    User, 
    onAuthStateChanged, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut, 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword
} from 'firebase/auth';
import { auth, db, isMock } from '../firebase/config';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { UserProfile, UserRole, Syndic } from '../types';

interface AuthContextType {
    currentUser: User | null;
    userProfile: UserProfile | null;
    loading: boolean;
    loginWithGoogle: () => Promise<void>;
    loginWithEmail: (email: string, pass: string) => Promise<void>;
    register: (email: string, pass: string, name: string, role: UserRole) => Promise<void>;
    logout: () => Promise<void>;
    isAdmin: boolean;
    isSyndic: boolean;
    isResident: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isMock) {
            console.log("Running in Mock Auth Mode");
            const storedUser = localStorage.getItem('syndik_mock_user');
            if (storedUser) {
                const user = JSON.parse(storedUser);
                // Create a mock Firebase User object
                setCurrentUser({
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
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
                    phoneNumber: null,
                    photoURL: null
                } as unknown as User);

                setUserProfile(user);
            }
            setLoading(false);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            if (user) {
                // Fetch extended user profile from Firestore
                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid));
                    if (userDoc.exists()) {
                        setUserProfile(userDoc.data() as UserProfile);
                    } else {
                        // For existing auth users without a profile (shouldn't happen in new flow)
                        console.log("User profile not found in Firestore");
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                }
            } else {
                setUserProfile(null);
            }
            setLoading(false);
        });

        return unsubscribe;
    }, []);

    const loginWithGoogle = async () => {
        if (isMock) {
            const mockUser = {
                uid: 'mock-google-user',
                email: 'demo@syndik.ma',
                displayName: 'Demo Syndic',
                role: 'syndic' as UserRole,
                syndicId: 'syndic-1'
            };
            localStorage.setItem('syndik_mock_user', JSON.stringify(mockUser));
            window.location.reload(); // Simple reload to trigger useEffect
            return;
        }

        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            
            // Check if profile exists, if not create default (Syndic for Google Sign-in demo)
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (!userDoc.exists()) {
                const newProfile: UserProfile = {
                    uid: user.uid,
                    email: user.email || '',
                    displayName: user.displayName || 'User',
                    role: 'syndic', // Default for Google Sign in
                    photoURL: user.photoURL || undefined
                };
                await setDoc(userDocRef, newProfile);
                setUserProfile(newProfile);
            }
        } catch (error) {
            console.error("Google login error", error);
            throw error;
        }
    };

    const loginWithEmail = async (email: string, pass: string) => {
        if (isMock) {
            // Simple mock login - allows any email/pass for demo
            // Assign role based on email for testing convenience
            let role: UserRole = 'syndic';
            let syndicId = 'syndic-1'; // Default to the mock data syndic
            
            if (email.includes('admin')) role = 'admin';
            if (email.includes('resident')) role = 'resident';
            if (email.includes('provider')) role = 'provider';

            const mockUser: UserProfile = {
                uid: `mock-${role}-${Date.now()}`,
                email: email,
                displayName: email.split('@')[0],
                role: role,
                syndicId: role === 'syndic' ? syndicId : undefined
            };

            localStorage.setItem('syndik_mock_user', JSON.stringify(mockUser));
            
            // Update state immediately
            setCurrentUser({ uid: mockUser.uid, email: mockUser.email } as any);
            setUserProfile(mockUser);
            return;
        }
        await signInWithEmailAndPassword(auth, email, pass);
    };

    const register = async (email: string, pass: string, name: string, role: UserRole) => {
        if (isMock) {
            const uid = `mock-${Date.now()}`;
            const mockUser: UserProfile = {
                uid: uid,
                email: email,
                displayName: name,
                role: role,
                syndicId: role === 'syndic' ? uid : undefined
            };
            localStorage.setItem('syndik_mock_user', JSON.stringify(mockUser));
            setCurrentUser({ uid: mockUser.uid, email: mockUser.email } as any);
            setUserProfile(mockUser);
            
            // Special Mock Logic: If Syndic, create the "Syndic" entity in "Database" with trial
            if (role === 'syndic') {
                // Calculate 30 days from now
                const trialExpires = new Date();
                trialExpires.setDate(trialExpires.getDate() + 30);

                const newSyndic: Syndic = {
                    id: uid,
                    name: name,
                    logoUrl: 'https://via.placeholder.com/150',
                    createdBy: uid,
                    subscriptionPlan: 'starter',
                    subscriptionStatus: 'active',
                    subscriptionExpiry: trialExpires.toISOString(),
                    buildings: []
                };
                // In a real mock scenario, we'd push this to mockSyndics array, 
                // but since services.ts imports mockSyndics statically, we can't easily push to it at runtime for this demo context.
                // However, typical "Mock Mode" implies the service layer would handle this if we had a mutable store.
                // For now, we trust that login succeeds and App.tsx handles the UI.
            }

            return;
        }

        const result = await createUserWithEmailAndPassword(auth, email, pass);
        const user = result.user;

        // Simulate onUserCreate Cloud Function: Create Firestore Profile
        // The Cloud Function onUserCreate (in functions/index.ts) will actually create the Profile
        // and the Syndic entity (if role is syndic).
        // But we set the profile locally to ensure immediate UI feedback if needed.
        
        const newProfile: UserProfile = {
            uid: user.uid,
            email: user.email || email,
            displayName: name,
            role: role,
        };

        if (role === 'syndic') {
            newProfile.syndicId = user.uid; // In onUserCreate we use uid as syndicId
        }

        await setDoc(doc(db, 'users', user.uid), newProfile);
        setUserProfile(newProfile);
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

    return (
        <AuthContext.Provider value={{ 
            currentUser, 
            userProfile, 
            loading, 
            loginWithGoogle, 
            loginWithEmail,
            register,
            logout, 
            isAdmin, 
            isSyndic,
            isResident
        }}>
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
