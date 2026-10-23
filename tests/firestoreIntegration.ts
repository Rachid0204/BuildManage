import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { FirestoreRepository } from "../server/repository";
if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:"))
  throw new Error("Requires local demo Firestore emulator");
const projectId = "demo-buildmanage",
  app = initializeApp({ projectId }),
  [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":"),
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
try {
  await env.clearFirestore();
  const first = new FirestoreRepository("(default)"),
    second = new FirestoreRepository("(default)");
  await first.transaction(async (state) => {
    state.syndik_prod_syndics_v1 = [
      {
        id: "cabinet",
        buildings: [
          {
            id: "building",
            residents: [],
            apartments: [],
            financials: { balance: 0, transactions: [] },
          },
        ],
      },
    ];
    state.syndik_prod_charges_v1 = Array.from({ length: 650 }, (_, i) => ({
      id: `charge-${i}`,
      amount: 100,
      paidAmount: 0,
      buildingId: "building",
    }));
    state.__counter = { value: 0 };
    state.__historyProbe = { entries: Array.from({ length: 12 }, (_, index) => ({ residentId: 'same-resident', note: `Repeated history entry ${index}` })) };
    state.__unicodeProbe = { text: '🧾'.repeat(65000) + ' محفوظ بالفرنسية والعربية' };
  });
  await second.transaction(async (state) => {
    assert.equal(state.syndik_prod_charges_v1.length, 650);
    assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].id, "building");
    assert.equal(state.__historyProbe.entries.length, 12);
    assert.equal(state.__historyProbe.entries[11].note, 'Repeated history entry 11');
    assert.equal(state.__unicodeProbe.text, '🧾'.repeat(65000) + ' محفوظ بالفرنسية والعربية');
  });
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? first : second).transaction(async (state) => {
        state.__counter.value++;
        state.syndik_prod_charges_v1[i].paidAmount++;
      }),
    ),
  );
  await first.transaction(async (state) => {
    assert.equal(state.__counter.value, 8);
    assert.equal(
      state.syndik_prod_charges_v1.reduce(
        (s: number, c: any) => s + c.paidAmount,
        0,
      ),
      8,
    );
  });
  await assert.rejects(
    first.transaction(async (state) => {
      state.__counter.value = 999;
      throw new Error("Synthetic failure");
    }),
  );
  await second.transaction(async (state) =>
    assert.equal(state.__counter.value, 8),
  );
  const revisions: number[] = [];
  let watchError: Error | undefined;
  const unwatch = first.watchRevision(revision => revisions.push(revision), error => { watchError = error; });
  try {
    const waitUntil = async (predicate: () => boolean) => {
      const deadline = Date.now() + 10_000;
      while (!predicate()) {
        if (watchError) throw watchError;
        assert.ok(Date.now() < deadline, 'Committed Firestore revision did not reach the other repository listener');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    await waitUntil(() => revisions.length > 0);
    const initialRevision = revisions.at(-1)!;
    await second.transaction(async state => { state.__liveProbe = { value: 'committed by another instance' }; });
    await waitUntil(() => revisions.some(revision => revision > initialRevision));
    console.log('PASS: live revision listener observes commits from another Firestore repository.');
  } finally { unwatch(); }
  for (const c of [
    env.unauthenticatedContext(),
    env.authenticatedContext("resident", { role: "resident" }),
    env.authenticatedContext("admin", { role: "admin" }),
  ]) {
    await assertFails(
      getDoc(doc(c.firestore(), "platform_internal", "state_revision")),
    );
    await assertFails(
      setDoc(doc(c.firestore(), "platform_state", "forged"), { amount: 999 }),
    );
    await assertFails(
      setDoc(doc(c.firestore(), "users", "forged"), { role: "admin" }),
    );
  }
  console.log(
    "PASS: Firestore staged bulk writes, repeated history identities, Unicode chunks, cross-repository concurrency, rollback and denied browser reads/writes.",
  );
  await first.transaction(async state => {
    // Replacing an already staged generation used to deadlock its own bulk writes.
    for (const key of Object.keys(state)) delete state[key];
    state.__replacement = { complete: true };
  });
  await second.transaction(async state => {
    assert.equal(state.__replacement.complete, true);
    assert.equal(state.syndik_prod_charges_v1, undefined);
    assert.ok(Number.isFinite(state.__revision) && state.__revision > 8);
  });
  console.log('PASS: large generation replacement commits without read locks or revision resets.');
} finally {
  await env.cleanup();
  await deleteApp(app);
}
