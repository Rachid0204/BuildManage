import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashPasswordSync } from '../utils/security';

const directory = mkdtempSync(join(tmpdir(), 'buildmanage-assembly-privacy-'));
const stateFile = join(directory, 'shared-state.json');
const password = 'Synthetic-Assembly-Password-42!';
const owner = {
  uid: 'assembly-owner', email: 'manager@assembly.invalid', displayName: 'Manager',
  role: 'syndic', syndicId: 's-assembly', emailVerified: true,
};
const residents = ['one', 'peer'].map((name, index) => ({
  id: `r-${name}`, name: `Owner ${name}`, email: `${name}@assembly.invalid`,
  phone: `060000000${index}`, cin: `SYNTHETIC-CIN-${name}`,
  privateContact: { alternateEmail: `private-${name}@assembly.invalid`, mobile: `070000000${index}` },
  isOwner: true, hasAccount: true, mustChangePassword: false,
  buildingId: 'b-assembly', syndicId: 's-assembly', apartmentId: `lot-${name}`,
}));
const provider = {
  uid: 'user-prest-p-assembly', email: 'provider@assembly.invalid', displayName: 'Provider',
  role: 'provider', syndicId: 's-assembly', buildingId: 'b-assembly',
  prestataireId: 'p-assembly', emailVerified: true,
};
const residentProfiles = residents.map(resident => ({
  uid: `user-res-${resident.id}`, email: resident.email, displayName: resident.name,
  role: 'resident', residentId: resident.id, syndicId: resident.syndicId,
  buildingId: resident.buildingId, emailVerified: true,
}));
const apartments = residents.map((resident, index) => ({
  id: resident.apartmentId, number: String(index + 1), buildingId: resident.buildingId,
  ownerId: resident.id, tenantId: null, floor: 1, area: 80, monthlyFees: 100,
  tantiemes: index === 0 ? 600 : 400,
}));
const financials = {
  balance: 1000, reserveFundBalance: 500, openingReserveBalance: 500,
  transactions: [{ id: 'historical-ledger-entry', type: 'income', amount: 1000, fundType: 'courant' }],
};
const historicalSnapshot = {
  id: 'b-assembly', syndicId: 's-assembly', managerPhone: 'PRIVATE-SNAPSHOT-PHONE',
  residents: structuredClone(residents),
  apartments: apartments.map((lot, index) => ({
    ...lot, tantiemes: index === 0 ? 300 : 700,
    privateContact: { email: `lot-private-${index}@assembly.invalid` },
  })),
};
const attendees = residents.map((resident, index) => ({
  residentId: resident.id, residentName: resident.name, apartmentNumber: String(index + 1),
  tantiemes: index === 0 ? 300 : 700, status: 'present',
}));
const previousVote = {
  residentId: residents[1].id, residentName: residents[1].name,
  apartmentId: apartments[1].id, apartmentNumber: apartments[1].number,
  tantiemes: 700, choice: 'against', vote: 'against',
  castAt: '2026-01-01T12:00:00.000Z', votedAt: '2026-01-01T12:00:00.000Z',
};
const legacyAssemblies = ['in_progress', 'closed', 'completed'].map(status => ({
  id: `ag-${status}`, syndicId: 's-assembly', buildingId: 'b-assembly',
  title: `Historical ${status}`, type: 'ordinaire', date: '2026-01-01', time: '12:00',
  location: 'Synthetic meeting room', status, isVotingOpen: status === 'in_progress',
  totalTantiemes: 1000, presentTantiemes: 1000, quorumRequired: 501, quorumReached: true,
  attendees: structuredClone(attendees), votingSnapshot: structuredClone(historicalSnapshot),
  resolutions: [{
    id: 'resolution', number: 1, title: 'Historical resolution', description: '',
    majorityType: 'simple', votesFor: 0, votesAgainst: 700, votesAbstain: 0,
    status: 'rejected', voterChoices: [structuredClone(previousVote)], voters: [structuredClone(previousVote)],
  }],
}));
const seed = {
  syndik_prod_registered_users_v1: [owner, provider, ...residentProfiles].map(profile => ({
    uid: profile.uid, email: profile.email,
    passwordHash: hashPasswordSync(password, profile.email), profile,
  })),
  syndik_prod_syndics_v1: [{
    id: 's-assembly', name: 'Assembly cabinet', createdBy: owner.uid,
    subscriptionPlan: 'starter', subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01',
    buildings: [{
      id: 'b-assembly', syndicId: 's-assembly', name: 'Assembly building',
      address: 'Synthetic address', city: 'Casablanca', monthlySyndicFees: 100,
      totalTantiemes: 1000, residents, apartments, financials, documents: [], announcements: [],
    }],
  }],
  syndik_prod_prestataires_v1: [{
    id: provider.prestataireId, name: provider.displayName, email: provider.email,
    syndicId: provider.syndicId, buildingId: provider.buildingId, hasAccount: true,
  }],
  syndik_prod_ag_v1: [...legacyAssemblies, {
    ...structuredClone(legacyAssemblies[0]), id: 'ag-without-snapshot', status: 'planned',
    isVotingOpen: false, votingSnapshot: undefined,
  }],
};
writeFileSync(stateFile, JSON.stringify(seed));
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const child = spawn(process.execPath, [
  '--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts',
], {
  env: {
    ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_AUTH_PROVIDER: 'legacy',
    SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: directory,
    SYNDIK_SERVER_SECRET: 'synthetic-assembly-secret-12345678901234567890',
    GEMINI_API_KEY: '', API_KEY: '', SENDGRID_API_KEY: '', FIREBASE_AUTH_EMULATOR_HOST: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
const timeout = setTimeout(() => child.kill(), 90000);
const disk = () => JSON.parse(readFileSync(stateFile, 'utf8'));
async function call(route: string, token?: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() as any };
}
const command = (token: string, operation: string, args: unknown[]) =>
  call('/api/commands', token, { operation, args, operationId: crypto.randomUUID() });

function assertPrivateSnapshotAbsent(assembly: any) {
  const snapshot = assembly.votingSnapshot;
  assert.ok(snapshot, 'The voting snapshot remains available');
  assert.deepEqual(Object.keys(snapshot).sort(), ['apartments', 'id', 'residents', 'syndicId']);
  for (const resident of snapshot.residents) {
    assert.deepEqual(Object.keys(resident).sort(), ['id', 'isOwner', 'name'],
      'Only voter identity and ownership flags may leave the API');
  }
  for (const lot of snapshot.apartments) {
    assert.deepEqual(Object.keys(lot).sort(), ['id', 'number', 'ownerId', 'tantiemes'],
      'Only lot identity, ownership and voting shares may leave the API');
  }
  for (const resident of residents) {
    for (const value of [resident.email, resident.phone, resident.cin, ...Object.values(resident.privateContact)]) {
      assert.ok(!JSON.stringify(assembly).includes(value), `Assembly must not expose ${value}`);
    }
  }
}

try {
  for (let attempt = 0; attempt < 200 && !logs.includes('Server running'); attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(logs.includes('Server running'), logs);
  const tokens = new Map<string, string>();
  for (const profile of [owner, provider, ...residentProfiles]) {
    const result = await call('/api/auth/login', undefined, { identifier: profile.email, password });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    tokens.set(profile.role === 'resident' ? profile.email : profile.role, result.data.token);
  }
  const managerToken = tokens.get('syndic')!;
  const persistedBeforeReads = disk();
  for (const [role, token] of tokens) {
    if (role === 'syndic') continue;
    for (const historical of legacyAssemblies) {
      await test(`${role}: ${historical.status} legacy assembly hides all owner contacts and preserves voting history`, async () => {
        const response = await call('/api/shared-state', token);
        assert.equal(response.status, 200);
        const assembly = response.data.store.syndik_prod_ag_v1.find((ag: any) => ag.id === historical.id);
        assertPrivateSnapshotAbsent(assembly);
        for (const key of ['attendees', 'resolutions', 'totalTantiemes', 'presentTantiemes', 'quorumRequired', 'quorumReached']) {
          assert.deepEqual(assembly[key], (historical as any)[key], `Preserve ${key}`);
        }
        assert.deepEqual(assembly.votingSnapshot.apartments.map((lot: any) => lot.tantiemes), [300, 700]);
        assert.equal(response.data.store.syndik_prod_ag_v1.find((ag: any) => ag.id === 'ag-without-snapshot').votingSnapshot, undefined);
      });
    }
  }
  await test('Syndic retains historical snapshot and current management contacts; reads never migrate stored history', async () => {
    const response = await call('/api/shared-state', managerToken);
    assert.equal(response.status, 200);
    const building = response.data.store.syndik_prod_syndics_v1[0].buildings[0];
    assert.equal(building.residents[1].email, residents[1].email);
    assert.equal(building.residents[1].cin, residents[1].cin);
    for (const historical of legacyAssemblies) {
      const assembly = response.data.store.syndik_prod_ag_v1.find((ag: any) => ag.id === historical.id);
      assert.deepEqual(assembly.votingSnapshot, historical.votingSnapshot);
    }
    assert.deepEqual(disk().syndik_prod_ag_v1, persistedBeforeReads.syndik_prod_ag_v1);
    assert.deepEqual(disk().syndik_prod_syndics_v1[0].buildings[0].financials, financials);
  });
  await test('Resident vote response is private and uses frozen 300/700 shares instead of current 600/400 shares', async () => {
    const response = await call('/api/ag/vote', tokens.get(residents[0].email), {
      agId: 'ag-in_progress', resolutionId: 'resolution', choice: 'for', apartmentId: apartments[0].id,
      tantiemes: 99999,
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const assembly = response.data.ag;
    assert.equal(assembly.resolutions[0].votesFor, 300);
    assert.equal(assembly.resolutions[0].votesAgainst, 700);
    assert.equal(assembly.presentTantiemes, 1000);
    assert.equal(assembly.quorumRequired, 501);
    assert.equal(assembly.quorumReached, true);
    assert.deepEqual(assembly.resolutions[0].voterChoices.find((vote: any) => vote.residentId === residents[1].id), previousVote);
    assertPrivateSnapshotAbsent(assembly);
    assert.deepEqual(disk().syndik_prod_ag_v1.find((ag: any) => ag.id === 'ag-in_progress').votingSnapshot, historicalSnapshot);
  });
  await test('Provider cannot cast an owner vote; closed legacy assemblies remain immutable', async () => {
    const denied = await call('/api/ag/vote', tokens.get('provider'), {
      agId: 'ag-in_progress', resolutionId: 'resolution', residentId: residents[0].id, choice: 'for',
    });
    assert.equal(denied.status, 403);
    for (const historical of legacyAssemblies.filter(ag => ag.status !== 'in_progress')) {
      const response = await call('/api/ag/vote', tokens.get(residents[0].email), {
        agId: historical.id, resolutionId: 'resolution', choice: 'for',
      });
      assert.equal(response.status, 400);
      assert.deepEqual(disk().syndik_prod_ag_v1.find((ag: any) => ag.id === historical.id), historical);
    }
  });
  await test('New voting snapshots persist only the voting allowlist; voting and closing remain functional', async () => {
    const created = await command(managerToken, 'createAssembleeGenerale', [{
      buildingId: 'b-assembly', title: 'New private snapshot', type: 'ordinaire',
      date: '2026-11-01', time: '12:00', location: 'Synthetic room',
      resolutions: [{ title: 'New resolution', majorityType: 'absolute' }],
    }]);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = created.data.result.id;
    const opened = await command(managerToken, 'toggleAGVoting', [id, true]);
    assert.equal(opened.status, 200, JSON.stringify(opened.data));
    assertPrivateSnapshotAbsent(opened.data.result);
    assertPrivateSnapshotAbsent(disk().syndik_prod_ag_v1.find((ag: any) => ag.id === id));
    const voted = await call('/api/ag/vote', tokens.get(residents[0].email), {
      agId: id, resolutionId: opened.data.result.resolutions[0].id, choice: 'for', apartmentId: apartments[0].id,
    });
    assert.equal(voted.status, 200, JSON.stringify(voted.data));
    assert.equal(voted.data.ag.resolutions[0].votesFor, 600);
    assert.equal(voted.data.ag.quorumReached, true);
    assertPrivateSnapshotAbsent(voted.data.ag);
    const closed = await command(managerToken, 'saveAssembleeGenerale', [{ ...voted.data.ag, status: 'completed' }]);
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(closed.data.result.resolutions[0].votesFor, 600);
    assert.equal(closed.data.result.resolutions[0].status, 'approved');
    assert.equal(closed.data.result.isVotingOpen, false);
    for (const token of [tokens.get(residents[0].email)!, tokens.get('provider')!]) {
      const response = await call('/api/shared-state', token);
      assertPrivateSnapshotAbsent(response.data.store.syndik_prod_ag_v1.find((ag: any) => ag.id === id));
    }
    const manager = await call('/api/shared-state', managerToken);
    assert.equal(manager.data.store.syndik_prod_syndics_v1[0].buildings[0].residents[1].phone, residents[1].phone);
    assert.deepEqual(disk().syndik_prod_syndics_v1[0].buildings[0].financials, financials);
  });
} finally {
  clearTimeout(timeout);
  child.kill();
  await exited;
  rmSync(directory, { recursive: true, force: true });
}
