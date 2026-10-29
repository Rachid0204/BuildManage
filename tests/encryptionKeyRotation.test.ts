import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { decrypt, encrypt, reencryptDurableState } from '../server/mailer';

const serverKey = 'legacy-server-key-material-0123456789abcdef';
const keyV1 = 'encryption-key-v1-material-0123456789abcdef';
const keyV2 = 'encryption-key-v2-material-0123456789abcdef';
const sessionV1 = 'session-secret-v1-material-0123456789abcdef';
const sessionV2 = 'session-secret-v2-material-0123456789abcdef';
const oldEnv = {
  server: process.env.SYNDIK_SERVER_SECRET,
  session: process.env.SYNDIK_SESSION_SECRET,
  keys: process.env.SYNDIK_ENCRYPTION_KEYS,
};
const keyring = (primary: string, key: string, retired: Array<{ kid: string; key: string }> = []) =>
  JSON.stringify({ primary: { kid: primary, key }, retired });
function legacyV1(text: string) {
  const iv = randomBytes(12), key = createHash('sha256').update(serverKey).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = cipher.update(text, 'utf8', 'base64') + cipher.final('base64');
  return 'v1:' + [iv.toString('base64'), body, cipher.getAuthTag().toString('base64')].join('.');
}
function restore() {
  if (oldEnv.server === undefined) delete process.env.SYNDIK_SERVER_SECRET;
  else process.env.SYNDIK_SERVER_SECRET = oldEnv.server;
  if (oldEnv.session === undefined) delete process.env.SYNDIK_SESSION_SECRET;
  else process.env.SYNDIK_SESSION_SECRET = oldEnv.session;
  if (oldEnv.keys === undefined) delete process.env.SYNDIK_ENCRYPTION_KEYS;
  else process.env.SYNDIK_ENCRYPTION_KEYS = oldEnv.keys;
}

test('V1 durable ciphertext remains readable with V2 primary and a rotated session secret', () => {
  try {
    process.env.SYNDIK_SERVER_SECRET = serverKey;
    process.env.SYNDIK_SESSION_SECRET = sessionV1;
    process.env.SYNDIK_ENCRYPTION_KEYS = keyring('key-v1', keyV1);
    const ciphertext = encrypt('durable receipt');
    assert.match(ciphertext, /^v2:key-v1:/);

    process.env.SYNDIK_SESSION_SECRET = sessionV2;
    process.env.SYNDIK_ENCRYPTION_KEYS = keyring('key-v2', keyV2, [{ kid: 'key-v1', key: keyV1 }]);
    assert.equal(decrypt(ciphertext), 'durable receipt');
  } finally { restore(); }
});

test('legacy v1 ciphertext uses the server compatibility key, independent of session secret rotation', () => {
  try {
    process.env.SYNDIK_SERVER_SECRET = serverKey;
    process.env.SYNDIK_SESSION_SECRET = sessionV1;
    delete process.env.SYNDIK_ENCRYPTION_KEYS;
    const ciphertext = legacyV1('legacy identity response');
    process.env.SYNDIK_SESSION_SECRET = sessionV2;
    assert.equal(decrypt(ciphertext), 'legacy identity response');
  } finally { restore(); }
});

test('durable identity intents, retry receipts, and queued mail can be re-encrypted to the active key', () => {
  try {
    process.env.SYNDIK_SERVER_SECRET = serverKey;
    process.env.SYNDIK_SESSION_SECRET = sessionV1;
    process.env.SYNDIK_ENCRYPTION_KEYS = keyring('key-v1', keyV1);
    const state: any = {
      __firebaseMutations_v1: {
        pending: { status: 'pending', encryptedPlan: encrypt('plan'), encryptedResponse: encrypt('identity response') },
      },
      __operations: { 'owner:op': { encryptedResponse: encrypt('retry response'), createdAt: new Date().toISOString() } },
      __outbox: {
        queued: { status: 'queued', encryptedText: encrypt('queued email') },
        sent: { status: 'sent', encryptedText: encrypt('already sent') },
      },
    };
    process.env.SYNDIK_SESSION_SECRET = sessionV2;
    process.env.SYNDIK_ENCRYPTION_KEYS = keyring('key-v2', keyV2, [{ kid: 'key-v1', key: keyV1 }]);
    assert.deepEqual(reencryptDurableState(state), {
      identityPlans: 1, identityResponses: 1, operationReceipts: 1, queuedMail: 1,
    });
    assert.equal(decrypt(state.__firebaseMutations_v1.pending.encryptedPlan), 'plan');
    assert.equal(decrypt(state.__firebaseMutations_v1.pending.encryptedResponse), 'identity response');
    assert.equal(decrypt(state.__operations['owner:op'].encryptedResponse), 'retry response');
    assert.equal(decrypt(state.__outbox.queued.encryptedText), 'queued email');
    assert.equal(state.__outbox.sent.encryptedText.startsWith('v2:key-v1:'), true);
    for (const value of [
      state.__firebaseMutations_v1.pending.encryptedPlan,
      state.__firebaseMutations_v1.pending.encryptedResponse,
      state.__operations['owner:op'].encryptedResponse,
      state.__outbox.queued.encryptedText,
    ]) assert.match(value, /^v2:key-v2:/);
  } finally { restore(); }
});
