
import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

// Helper to get environment variables compatibly (Vite vs CRA/Webpack)
const getEnv = (key: string): string => {
  // Check import.meta.env (Vite standard)
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    // @ts-ignore
    const val = import.meta.env[`VITE_${key}`] || import.meta.env[`REACT_APP_${key}`];
    if (val) return val;
  }
  
  // Check process.env (Standard/CRA) - Ensure process exists before accessing
  // @ts-ignore
  if (typeof process !== 'undefined' && process.env) {
    // @ts-ignore
    return process.env[`VITE_${key}`] || process.env[`REACT_APP_${key}`] || '';
  }
  
  return '';
};

const firebaseConfig = {
  apiKey: getEnv('FIREBASE_API_KEY') || "mock-key",
  authDomain: getEnv('FIREBASE_AUTH_DOMAIN') || "mock-project.firebaseapp.com",
  projectId: getEnv('FIREBASE_PROJECT_ID') || "mock-project",
  storageBucket: getEnv('FIREBASE_STORAGE_BUCKET') || "mock-project.appspot.com",
  messagingSenderId: getEnv('FIREBASE_SENDER_ID') || "123456789",
  appId: getEnv('FIREBASE_APP_ID') || "1:123456789:web:abcdef"
};

// Determine if we are in mock mode
export const isMock = firebaseConfig.apiKey === "mock-key" || !firebaseConfig.apiKey;

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Connect to emulators if in local dev environment and not using mock mode
// @ts-ignore
if (!isMock && typeof location !== 'undefined' && (location.hostname === "localhost" || location.hostname === "127.0.0.1") && getEnv('USE_EMULATORS') === 'true') {
    // Note: Uncomment these lines to use local emulators
    // connectAuthEmulator(auth, "http://127.0.0.1:9099");
    // connectFirestoreEmulator(db, '127.0.0.1', 8080);
    // connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    // connectStorageEmulator(storage, '127.0.0.1', 9199);
}

export default app;
