// Compatibility-only SDK access. Production browser operations use authenticated
// server commands, so this module must never be part of their initial graph.
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { app, FIRESTORE_DATABASE_ID } from '../../../firebase/config';
export * from 'firebase/firestore';
export { httpsCallable } from 'firebase/functions';
export const db = getFirestore(app, FIRESTORE_DATABASE_ID);
export const functions = getFunctions(app);

