import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { hashPassword } from '../server/passwords';

const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
assert.ok(emulator?.startsWith('127.0.0.1:'), 'Use the local demo Auth emulator only');
const projectId = 'demo-buildmanage';
const admin = getAuth(initializeApp({ projectId }, 'auth-test'));
const directory = mkdtempSync(join(tmpdir(), 'buildmanage-firebase-auth-'));
const password = 'Synthetic-Password-42!', replacement = 'Replacement-Password-43!';
const profiles = [
  { uid: 'legacy-owner', email: 'owner@example.test', role: 'syndic', syndicId: 'cabinet-a', emailVerified: true },
  { uid: 'user-res-res-a', email: 'resident@example.test', role: 'resident', syndicId: 'cabinet-a', buildingId: 'building-a', residentId: 'res-a', emailVerified: true },
  { uid: 'user-prest-prest-a', email: 'provider@example.test', role: 'provider', syndicId: 'cabinet-a', buildingId: 'building-a', prestataireId: 'prest-a', emailVerified: true },
  { uid: 'legacy-reset', email: 'recovery@example.test', role: 'syndic', syndicId: 'cabinet-reset', emailVerified: false },
  { uid: 'legacy-google', email: 'google@example.test', role: 'syndic', syndicId: 'cabinet-google', emailVerified: true },
  { uid: 'legacy-collision', email: 'collision@example.test', role: 'syndic', syndicId: 'cabinet-collision', emailVerified: true },
];
const seed = {
  syndik_prod_registered_users_v1: profiles.map(profile => ({ uid: profile.uid, email: profile.email, passwordHash: hashPassword(password), profile })),
  syndik_prod_syndics_v1: [{ id: 'cabinet-a', createdBy: 'legacy-owner', name: 'Cabinet A', email: profiles[0].email,
    subscriptionPlan: 'starter', subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [{
      id: 'building-a', syndicId: 'cabinet-a', name: 'Building A', address: 'Test address', city: 'Casablanca', monthlySyndicFees: 100,
      apartments: [{ id: 'apt-a', number: '1', ownerId: 'res-a', tantiemes: 1000, monthlyFees: 100 }],
      residents: [{ id: 'res-a', name: 'Resident A', email: profiles[1].email, phone: '0600000000', cin: 'CIN-TEST', isOwner: true,
        hasAccount: true, mustChangePassword: false, syndicId: 'cabinet-a', buildingId: 'building-a', apartmentId: 'apt-a' }],
      documents: [], financials: { balance: 0, transactions: [] },
    }] }],
  syndik_prod_resident_accounts_v1: [{ residentId: 'res-a', email: profiles[1].email, cin: 'CIN-TEST', syndicId: 'cabinet-a', buildingId: 'building-a', mustChangePassword: false, passwordHash: hashPassword(password) }],
  syndik_prod_prestataire_accounts_v1: [{ prestataireId: 'prest-a', email: profiles[2].email, syndicId: 'cabinet-a', buildingId: 'building-a', mustChangePassword: false, passwordHash: hashPassword(password) }],
  syndik_prod_prestataires_v1: [{ id: 'prest-a', name: 'Provider A', email: profiles[2].email, syndicId: 'cabinet-a', buildingId: 'building-a', mustChangePassword: false }],
};
const stateFile = join(directory, 'shared-state.json');
writeFileSync(stateFile, JSON.stringify(seed));
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as any).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const child = spawn(process.execPath, ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PORT: String(port), SYNDIK_AUTH_PROVIDER: 'firebase',
    GOOGLE_CLOUD_PROJECT: projectId, FIREBASE_API_KEY: 'demo-key', PUBLIC_APP_URL: `http://localhost:${port}`,
    SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: directory, SYNDIK_SERVER_SECRET: 'synthetic-stable-session-secret-1234567890',
    SENDGRID_API_KEY: '', SENDGRID_FROM_EMAIL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = ''; child.stdout.on('data', bytes => { logs += bytes; }); child.stderr.on('data', bytes => { logs += bytes; });
let checks = 0;
const check = (condition: any, message: string) => { assert.ok(condition, message); checks++; };
const api = async (path: string, body?: any, token?: string) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
};
const rest = async (action: string, body: any) => {
  const response = await fetch(`http://${emulator}/identitytoolkit.googleapis.com/v1/accounts:${action}?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
};
const codes = async () => (await (await fetch(`http://${emulator}/emulator/v1/projects/${projectId}/oobCodes`)).json()).oobCodes;
const persisted = () => JSON.parse(readFileSync(stateFile, 'utf8'));
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await api('/api/health')).status === 200) break; } catch {}
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const registered = await api('/api/auth/register', { email: 'new@example.test', password,
    profile: { role: 'syndic', displayName: 'New manager' }, syndic: { name: 'New cabinet', city: 'Tanger', subscriptionPlan: 'professional' } });
  check(registered.status === 200, JSON.stringify(registered));
  const { uid, syndicId } = registered.data.profile;
  check(registered.data.profile.emailVerified === false, 'Firebase verification is required even with SendGrid absent');
  check(registered.data.firebaseAuth === true, 'Browser is instructed to establish its Firebase session');
  check((await admin.getUser(uid)).email === 'new@example.test', 'New account exists in Firebase');
  check(!persisted().syndik_prod_registered_users_v1.find((a: any) => a.uid === uid).passwordHash, 'No duplicate local password hash');
  const verification = (await codes()).find((c: any) => c.email === 'new@example.test' && c.requestType === 'VERIFY_EMAIL');
  check(Boolean(verification), 'Firebase generated the verification email');
  await rest('update', { oobCode: verification.oobCode });
  const restored = await api('/api/auth/session', undefined, registered.data.token);
  check(restored.status === 200 && restored.data.profile.emailVerified === true, 'Refresh synchronizes verified status');
  check(restored.data.profile.syndicId === syndicId, 'Verification preserves the cabinet');
  const secondVerification = await api('/api/auth/verification/request', {}, restored.data.token);
  check(secondVerification.status === 200, 'An already verified account does not need another email');
  check((await api('/api/auth/register', { email: 'new@example.test', password, profile: { role: 'syndic' } })).status === 409, 'Duplicate registration is rejected');

  const logins = new Map<string, any>();
  for (const profile of profiles.slice(0, 3)) {
    const login = await api('/api/auth/login', { identifier: profile.role === 'resident' ? 'CIN-TEST' : profile.email, password });
    check(login.status === 200, `Legacy ${profile.role} login: ${JSON.stringify(login)}`);
    check(login.data.profile.uid === profile.uid && login.data.profile.role === profile.role && login.data.profile.syndicId === profile.syndicId, 'Migration preserves identity, role, and tenant');
    check((await admin.getUser(profile.uid)).email === profile.email, 'Legacy account migrated to Firebase');
    check(persisted().syndik_prod_registered_users_v1.find((a: any) => a.uid === profile.uid).firebaseUid === profile.uid, 'Binding was persisted');
    logins.set(profile.role, login.data);
  }
  check((await api('/api/auth/login', { identifier: profiles[0].email, password: 'Wrong-Password-42!' })).status === 401, 'Wrong password rejected after migration');
  const changed = await api('/api/auth/change-password', { newPassword: replacement }, logins.get('resident').token);
  check(changed.status === 200, `Firebase password change: ${JSON.stringify(changed)}`);
  check((await api('/api/auth/login', { identifier: 'CIN-TEST', password })).status === 401, 'Old resident password cannot bypass Firebase');
  check((await api('/api/auth/login', { identifier: 'CIN-TEST', password: replacement })).status === 200, 'CIN login accepts the new Firebase password');

  const regenerated = await api('/api/commands', { operation: 'regenerateResidentCredentials', args: ['res-a'], operationId: 'firebase-regenerate-resident-0001' }, logins.get('syndic').token);
  check(regenerated.status === 200, `Regenerate Firebase-linked resident: ${JSON.stringify(regenerated)}`);
  const temp = regenerated.data.result.invitationCode || regenerated.data.result.invitationToken;
  check(Boolean(temp), 'New invitation credential returned once');
  check((await api('/api/auth/login', { identifier: 'CIN-TEST', password: replacement })).status === 401, 'Regeneration revokes the previous Firebase password');
  const invited = await api('/api/auth/login', { identifier: 'CIN-TEST', password: temp });
  check(invited.status === 200 && invited.data.profile.mustChangePassword, `New invitation works and requires a password change: ${JSON.stringify({status:invited.status, error:invited.data.error, mustChangePassword:invited.data.profile?.mustChangePassword})}`);
  check(persisted().syndik_prod_resident_accounts_v1[0].firebaseUid === profiles[1].uid, 'Regeneration preserves Firebase binding');

  const recovery = await api('/api/auth/recovery/request', { email: profiles[3].email });
  check(recovery.status === 200, `Legacy recovery migration: ${JSON.stringify(recovery)}`);
  const reset = (await codes()).find((c: any) => c.email === profiles[3].email && c.requestType === 'PASSWORD_RESET');
  check(Boolean(reset), 'Firebase generated the password reset email');
  await rest('resetPassword', { oobCode: reset.oobCode, newPassword: replacement });
  const recovered = await api('/api/auth/login', { identifier: profiles[3].email, password: replacement });
  check(recovered.status === 200 && recovered.data.profile.uid === profiles[3].uid, 'Reset keeps the original app UID');
  check((await api('/api/auth/login', { identifier: profiles[3].email, password })).status === 401, 'Old legacy hash cannot authenticate after reset');
  check((await api('/api/auth/recovery/complete', { token: 'old-token', password })).status === 400, 'Legacy recovery cannot bypass Firebase');

  // Exercise an actual Firebase password reset, including app-session revocation.
  check((await api('/api/auth/recovery/request', { email: 'new@example.test' })).status === 200, 'Recovery works for a new Firebase account');
  const newReset = (await codes()).find((c: any) => c.email === 'new@example.test' && c.requestType === 'PASSWORD_RESET');
  await new Promise(resolve => setTimeout(resolve, 1100)); // Firebase timestamps have second precision.
  await rest('resetPassword', { oobCode: newReset.oobCode, newPassword: replacement });
  check((await api('/api/auth/session', undefined, registered.data.token)).status === 401, 'Firebase password reset invalidates old server sessions');
  check((await api('/api/auth/login', { identifier: 'new@example.test', password })).status === 401, 'Old Firebase password rejected after reset');
  const fresh = await api('/api/auth/login', { identifier: 'new@example.test', password: replacement });
  check(fresh.status === 200 && fresh.data.profile.syndicId === syndicId, 'Reset preserves the correct cabinet');
  await new Promise(resolve => setTimeout(resolve, 1100));
  await admin.revokeRefreshTokens(uid);
  check((await api('/api/auth/session', undefined, fresh.data.token)).status === 401, 'Firebase revocation invalidates server sessions');
  await admin.updateUser(profiles[2].uid, { disabled: true });
  check((await api('/api/auth/session', undefined, logins.get('provider').token)).status === 401, 'Firebase disabling invalidates server sessions');
  check((await api('/api/auth/login', { identifier: profiles[2].email, password })).status === 401, 'Disabled Firebase account cannot log in');

  const existing = await admin.createUser({ uid: 'existing-firebase-google', email: profiles[4].email, password: 'Existing-Firebase-45!', emailVerified: true });
  const linked = await api('/api/auth/login', { identifier: profiles[4].email, password: 'Existing-Firebase-45!' });
  check(linked.status === 200 && linked.data.profile.uid === profiles[4].uid && linked.data.profile.firebaseUid === existing.uid, 'Verified existing Firebase account retains the app UID');
  check((await api('/api/auth/session', undefined, linked.data.token)).status === 200, 'Different Firebase and app UIDs survive session restoration');

  const conflict = await admin.createUser({ uid: 'unverified-external', email: profiles[5].email, password: 'Unrelated-Password-44!', emailVerified: false });
  const collision = await api('/api/auth/recovery/request', { email: profiles[5].email });
  check(collision.status === 409, 'Unverified external Firebase identity cannot be bound to a legacy account');
  check(!(persisted().syndik_prod_registered_users_v1.find((a: any) => a.uid === profiles[5].uid).firebaseUid), 'No unsafe binding is persisted');
  const conflictCredential = await rest('signInWithPassword', { email: conflict.email, password: 'Unrelated-Password-44!', returnSecureToken: true });
  check((await api('/api/auth/firebase-session', {}, conflictCredential.idToken)).status === 401, 'Unverified unrelated identity cannot claim the cabinet');
  const before = (await codes()).length;
  const unknown = await api('/api/auth/recovery/request', { email: 'unknown@example.test' });
  check(unknown.status === 200 && unknown.data.message === recovery.data.message, 'Recovery response does not reveal missing accounts');
  check((await codes()).length === before, 'Unknown app accounts do not trigger email');
  check(!logs.includes(password) && !logs.includes(replacement), 'Passwords are absent from application logs');
  console.log(`Firebase Authentication integration passed (${checks} checks, real local Auth emulator).`);
} catch (error) {
  console.error(logs); throw error;
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
  rmSync(directory, { recursive: true, force: true });
}
