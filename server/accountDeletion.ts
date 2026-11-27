import { randomUUID } from 'node:crypto';
import type { State } from './repository';
import { mailIsConfigured, queueMail } from './mailer';
import { unregisterDeviceToken } from './pushNotifications';
import { resolveLegalFramework } from '../shared/legalFramework';

export interface AccountDeletionRequestRecord {
  id: string;
  uid: string;
  email: string;
  role: string;
  displayName?: string;
  syndicId?: string;
  reason?: string;
  status: 'pending' | 'cancelled' | 'completed';
  requestedAt: string;
  updatedAt: string;
  revokedPushTokens: number;
}

const MAX_REASON_LENGTH = 500;

function getDeletionList(state: State): AccountDeletionRequestRecord[] {
  if (!Array.isArray(state.__accountDeletionRequests_v1)) {
    state.__accountDeletionRequests_v1 = [];
  }
  return state.__accountDeletionRequests_v1 as AccountDeletionRequestRecord[];
}

export function getActiveAccountDeletionRequest(
  state: State,
  uid: string,
): AccountDeletionRequestRecord | null {
  if (!uid) return null;
  const list = getDeletionList(state);
  return (
    list.find((entry) => entry && entry.uid === uid && entry.status === 'pending') ||
    null
  );
}

export function submitAccountDeletionRequest(
  state: State,
  input: {
    uid: string;
    email: string;
    role: string;
    displayName?: string;
    syndicId?: string;
    confirmEmail: string;
    reason?: string;
  },
): { ok: true; request: AccountDeletionRequestRecord; alreadyPending: boolean } | { ok: false; status: number; error: string } {
  const normalizedAccountEmail = String(input.email || '').trim().toLowerCase();
  const normalizedConfirm = String(input.confirmEmail || '').trim().toLowerCase();

  if (!input.uid || !normalizedAccountEmail) {
    return { ok: false, status: 400, error: 'Compte utilisateur invalide.' };
  }

  if (!normalizedConfirm || normalizedConfirm !== normalizedAccountEmail) {
    return {
      ok: false,
      status: 400,
      error: "L'adresse email de confirmation ne correspond pas à votre compte.",
    };
  }

  if (input.role === 'admin') {
    return {
      ok: false,
      status: 403,
      error:
        "Les comptes Super-Administrateur doivent être transférés avant suppression pour préserver la continuité de la plateforme.",
    };
  }

  const existing = getActiveAccountDeletionRequest(state, input.uid);
  if (existing) {
    return { ok: true, request: existing, alreadyPending: true };
  }

  const nowIso = new Date().toISOString();
  const cleanReason =
    typeof input.reason === 'string'
      ? input.reason.trim().slice(0, MAX_REASON_LENGTH) || undefined
      : undefined;

  // Immediately revoke all mobile push notification tokens for this account
  const revokedPushTokens = unregisterDeviceToken(state, {
    uid: input.uid,
    token: '*',
  });

  const record: AccountDeletionRequestRecord = {
    id: `del_${randomUUID().slice(0, 12)}`,
    uid: input.uid,
    email: normalizedAccountEmail,
    role: input.role,
    displayName: input.displayName?.trim().slice(0, 120) || undefined,
    syndicId: input.syndicId,
    reason: cleanReason,
    status: 'pending',
    requestedAt: nowIso,
    updatedAt: nowIso,
    revokedPushTokens,
  };

  getDeletionList(state).push(record);

  if (mailIsConfigured()) {
    try {
      queueMail(
        state,
        normalizedAccountEmail,
        'SyndicUnion — Confirmation de votre demande de suppression de compte',
        [
          `Bonjour${record.displayName ? ` ${record.displayName}` : ''},`,
          '',
          `Votre demande de suppression de compte (${record.id}) a bien été enregistrée le ${nowIso}.`,
          'Vos notifications push mobiles ont été immédiatement désactivées.',
          `Conformément à ${resolveLegalFramework(state.__legalFrameworkConfig).citations.dataPrivacyLawFr} et à la réglementation sur la copropriété (${resolveLegalFramework(state.__legalFrameworkConfig).citations.statuteShortFr}), vos accès personnels et coordonnées seront supprimés sous 30 jours maximum, tandis que les pièces comptables et PV légaux de copropriété sont conservés sous forme archivée réglementaire.`,
          '',
          "Si vous n'êtes pas à l'origine de cette demande, reconnectez-vous immédiatement pour l'annuler depuis /account-deletion.",
        ].join('\n'),
      );
    } catch {
      // Non-blocking if mail service is temporarily unavailable
    }
  }

  return { ok: true, request: record, alreadyPending: false };
}

export function cancelAccountDeletionRequest(
  state: State,
  uid: string,
): { cancelled: boolean } {
  const existing = getActiveAccountDeletionRequest(state, uid);
  if (!existing) return { cancelled: false };
  existing.status = 'cancelled';
  existing.updatedAt = new Date().toISOString();
  return { cancelled: true };
}
