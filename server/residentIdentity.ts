import type { State } from './repository';

export const LINKED_RESIDENT_EMAIL_CODE = 'FIREBASE_EMAIL_CHANGE_REQUIRES_VERIFICATION';
export const LINKED_RESIDENT_EMAIL_MESSAGE =
  'L’adresse liée à Firebase doit être modifiée par une procédure de vérification email sécurisée du compte.';

/** Resolve durable bindings, including legacy resident-account and registered-profile layouts. */
export function firebaseLinkedResidentIds(state: State): Set<string> {
  const ids = new Set<string>();
  for (const account of [
    ...(state.syndik_prod_registered_users_v1 || []),
    ...(state.syndik_prod_resident_accounts_v1 || []),
  ]) {
    if (!account.firebaseUid) continue;
    const uid = account.uid || account.profile?.uid || '';
    const id = account.residentId || account.profile?.residentId ||
      (uid.startsWith('user-res-') ? uid.slice('user-res-'.length) : undefined);
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}
