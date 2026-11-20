import { randomUUID } from 'node:crypto';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import config from '../firebase-applet-config.json' with { type: 'json' };
import type { State, StateRepository } from './repository';

export type PushPlatform = 'android' | 'ios';

export interface DevicePushTokenRecord {
  uid: string;
  token: string;
  platform: PushPlatform;
  deviceLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QueuedPushItem {
  id: string;
  uid: string;
  title: string;
  body: string;
  type: string;
  link: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  attempts: number;
  leaseUntil?: number;
  nextAttemptAt?: number;
  createdAt: string;
  sentAt?: string;
  deliveredCount?: number;
}

export interface PushDispatchResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

export type PushMulticastSender = (payload: {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}) => Promise<PushDispatchResult>;

const MAX_TOKENS_PER_USER = 8;
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export function sanitizePushToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed.length < 10 || trimmed.length > 512) return '';
  if (/\s/.test(trimmed)) return '';
  return trimmed;
}

export function sanitizePushPlatform(raw: unknown): PushPlatform | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (normalized === 'android' || normalized === 'ios') return normalized;
  return null;
}

function getTokenList(state: State): DevicePushTokenRecord[] {
  if (!Array.isArray(state.__deviceTokens_v1)) {
    state.__deviceTokens_v1 = [];
  }
  return state.__deviceTokens_v1 as DevicePushTokenRecord[];
}

export function listUserDeviceTokens(
  state: State,
  uid: string,
): DevicePushTokenRecord[] {
  return getTokenList(state).filter((entry) => entry && entry.uid === uid);
}

export function registerDeviceToken(
  state: State,
  input: {
    uid: string;
    token: string;
    platform: PushPlatform;
    deviceLabel?: string;
  },
): DevicePushTokenRecord {
  const token = sanitizePushToken(input.token);
  const platform = sanitizePushPlatform(input.platform);
  if (!input.uid || !token || !platform) {
    throw new Error('Paramètres de notification push invalides.');
  }

  const nowIso = new Date().toISOString();
  const label =
    typeof input.deviceLabel === 'string'
      ? input.deviceLabel.trim().slice(0, 80)
      : undefined;

  const list = getTokenList(state);
  // Deduplicate token globally: if a physical device switched user accounts,
  // detach the token from the previous owner so no cross-account push leaks occur.
  const existingForSameUser = list.find(
    (entry) => entry.token === token && entry.uid === input.uid,
  );
  const filtered = list.filter((entry) => entry.token !== token);

  const record: DevicePushTokenRecord = {
    uid: input.uid,
    token,
    platform,
    deviceLabel: label || existingForSameUser?.deviceLabel,
    createdAt: existingForSameUser?.createdAt || nowIso,
    updatedAt: nowIso,
  };
  filtered.push(record);

  // Enforce per-user device cap (evict oldest updated tokens for this user)
  const userRecords = filtered
    .filter((entry) => entry.uid === input.uid)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (userRecords.length > MAX_TOKENS_PER_USER) {
    const keepTokens = new Set(
      userRecords.slice(0, MAX_TOKENS_PER_USER).map((entry) => entry.token),
    );
    state.__deviceTokens_v1 = filtered.filter(
      (entry) => entry.uid !== input.uid || keepTokens.has(entry.token),
    );
  } else {
    state.__deviceTokens_v1 = filtered;
  }

  return record;
}

export function unregisterDeviceToken(
  state: State,
  input: { uid: string; token?: string },
): number {
  const list = getTokenList(state);
  const before = list.length;
  if (!input.token || input.token === '*') {
    state.__deviceTokens_v1 = list.filter((entry) => entry.uid !== input.uid);
  } else {
    const target = input.token.trim();
    state.__deviceTokens_v1 = list.filter(
      (entry) => !(entry.uid === input.uid && entry.token === target),
    );
  }
  return before - (state.__deviceTokens_v1 as DevicePushTokenRecord[]).length;
}

export function queuePushNotification(
  state: State,
  input: {
    uid: string;
    title: string;
    body: string;
    type: string;
    link: string;
  },
): QueuedPushItem | null {
  if (!input.uid || !input.title) return null;
  if (listUserDeviceTokens(state, input.uid).length === 0) {
    return null;
  }
  const id = randomUUID();
  const item: QueuedPushItem = {
    id,
    uid: input.uid,
    title: String(input.title).slice(0, 140),
    body: String(input.body || '').slice(0, 400),
    type: String(input.type || 'info').slice(0, 48),
    link: String(input.link || '/').slice(0, 160),
    status: 'queued',
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  (state.__pushOutbox ??= {})[id] = item;
  return item;
}

export function pushMessagingIsAvailable(): boolean {
  if (process.env.SYNDIK_PUSH_ENABLED === 'false') return false;
  if (process.env.NODE_ENV === 'test') return false;
  return Boolean(
    process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.K_SERVICE,
  );
}

const defaultFcmSender: PushMulticastSender = async ({
  tokens,
  title,
  body,
  data,
}) => {
  const app =
    getApps().find((a) => a.name === 'buildmanage-server') ||
    initializeApp(
      {
        projectId:
          process.env.GOOGLE_CLOUD_PROJECT ||
          process.env.FIREBASE_PROJECT_ID ||
          config.projectId,
      },
      'buildmanage-server',
    );
  const messaging = getMessaging(app);
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
    android: {
      priority: 'high',
      notification: {
        channelId: 'syndik_alerts',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
  });

  const invalidTokens: string[] = [];
  response.responses.forEach((res, idx) => {
    if (!res.success && res.error?.code && INVALID_TOKEN_CODES.has(res.error.code)) {
      invalidTokens.push(tokens[idx]);
    }
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
};

export async function deliverPushOutbox(
  repo: StateRepository,
  limit = 10,
  sender?: PushMulticastSender,
): Promise<{ processed: number; delivered: number; prunedTokens: number }> {
  const activeSender = sender || (pushMessagingIsAvailable() ? defaultFcmSender : null);
  if (!activeSender) {
    return { processed: 0, delivered: 0, prunedTokens: 0 };
  }

  let processed = 0;
  let delivered = 0;
  let prunedTokens = 0;

  for (let i = 0; i < limit; i++) {
    const claimed = await repo.transaction(async (s) => {
      const outbox = (s.__pushOutbox ??= {}) as Record<string, QueuedPushItem>;
      const nextItem = Object.values(outbox).find(
        (item) =>
          item &&
          item.status !== 'sent' &&
          item.attempts < 5 &&
          (item.nextAttemptAt || 0) <= Date.now() &&
          (item.leaseUntil || 0) < Date.now(),
      );
      if (!nextItem) return null;
      const tokens = listUserDeviceTokens(s, nextItem.uid).map((t) => t.token);
      if (tokens.length === 0) {
        nextItem.status = 'sent';
        nextItem.sentAt = new Date().toISOString();
        nextItem.deliveredCount = 0;
        return null;
      }
      nextItem.status = 'sending';
      nextItem.leaseUntil = Date.now() + 60_000;
      nextItem.attempts += 1;
      return {
        item: JSON.parse(JSON.stringify(nextItem)) as QueuedPushItem,
        tokens,
      };
    });

    if (!claimed) break;
    processed += 1;

    let result: PushDispatchResult = {
      successCount: 0,
      failureCount: claimed.tokens.length,
      invalidTokens: [],
    };
    try {
      result = await activeSender({
        tokens: claimed.tokens,
        title: claimed.item.title,
        body: claimed.item.body,
        data: {
          type: claimed.item.type,
          link: claimed.item.link,
        },
      });
    } catch {
      // Transient FCM failure handled by retry backoff below
    }

    const succeeded =
      result.successCount > 0 ||
      (result.invalidTokens.length > 0 &&
        result.invalidTokens.length === claimed.tokens.length);
    delivered += result.successCount;
    prunedTokens += result.invalidTokens.length;

    await repo.transaction(async (s) => {
      const entry = s.__pushOutbox?.[claimed.item.id] as QueuedPushItem | undefined;
      if (entry) {
        entry.status = succeeded ? 'sent' : 'failed';
        entry.leaseUntil = 0;
        entry.nextAttemptAt =
          Date.now() + Math.min(3_600_000, 30_000 * 2 ** entry.attempts);
        if (succeeded) {
          entry.sentAt = new Date().toISOString();
          entry.deliveredCount = result.successCount;
        }
      }
      if (result.invalidTokens.length > 0) {
        const invalidSet = new Set(result.invalidTokens);
        const list = getTokenList(s);
        s.__deviceTokens_v1 = list.filter((t) => !invalidSet.has(t.token));
      }
    });
  }

  return { processed, delivered, prunedTokens };
}
