import firebaseConfig from "../firebase-applet-config.json";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
export type State = Record<string, any>;
const context = new AsyncLocalStorage<State>();
export function currentState(): State {
  const state = context.getStore();
  if (!state) throw new Error("No database transaction");
  return state;
}
export const sharedState = new Proxy({} as State, {
  get: (_, key: string) => currentState()[key],
  set: (_, key: string, value) => {
    currentState()[key] = value;
    return true;
  },
  ownKeys: () => Reflect.ownKeys(currentState()),
  getOwnPropertyDescriptor: (_, key) => ({
    enumerable: true,
    configurable: true,
    writable: true,
    value: currentState()[String(key)],
  }),
});
export interface StateRepository {
  transaction<T>(run: (state: State) => Promise<T>): Promise<T>;
}
export class FileRepository implements StateRepository {
  constructor(public directory: string) {}
  async transaction<T>(run: (state: State) => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true });
    const lock = path.join(this.directory, ".state-lock");
    let acquired = false;
    for (let i = 0; i < 300; i++) {
      try {
        await mkdir(lock);
        acquired = true;
        break;
      } catch (error: any) {
        if (error.code !== "EEXIST") throw error;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    if (!acquired) throw new Error("Database busy; retry");
    try {
      const file = path.join(this.directory, "shared-state.json");
      let state: State = {};
      try {
        state = JSON.parse(await readFile(file, "utf8"));
      } catch (error: any) {
        if (error.code !== "ENOENT")
          throw new Error("Unreadable database; restore a verified backup");
      }
      const before = JSON.stringify(state),
        result = await context.run(state, () => run(state));
      if (JSON.stringify(state) !== before) {
        state.__revision = (Number(state.__revision) || 0) + 1;
        const temporary = `${file}.${randomUUID()}.tmp`,
          handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(state));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, file);
        const dir = await open(this.directory, "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
      return result;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
// Independent, bounded JSON records avoid Firestore document limits, even for
// nested building ledgers. A revision document serializes cross-instance writers.
function encode(state: State) {
  const rows = new Map<string, any>();
  function put(group: string, id: string, value: any) {
    const hash = createHash("sha256").update(`${group}\0${id}`).digest("hex");
    const json = JSON.stringify(value),
      parts = Math.max(1, Math.ceil(json.length / 60000));
    for (let part = 0; part < parts; part++)
      rows.set(`${hash}_${part}`, {
        group,
        id,
        part,
        parts,
        json: json.slice(part * 60000, (part + 1) * 60000),
      });
  }
  function walk(value: any, location: string): any {
    if (Array.isArray(value)) {
      if (
        value.length <= 8 ||
        !value.every((v) => v && typeof v === "object" && !Array.isArray(v))
      )
        return value.map((v, i) => walk(v, `${location}/${i}`));
      const order: string[] = [],
        group = `list:${location}`;
      for (const [index, item] of value.entries()) {
        const id = String(
          item.id ||
            item.uid ||
            item.apartmentId ||
            (item.residentId
              ? `${item.residentId}:${item.apartmentNumber || ""}`
              : index),
        );
        if (order.includes(id)) throw new Error("Duplicate record identity");
        order.push(id);
        put(group, id, walk(item, `${location}/${id}`));
      }
      return { __list: group, order };
    }
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v, `${location}/${k}`)]),
      );
    return value;
  }
  for (const [key, value] of Object.entries(
    JSON.parse(JSON.stringify(state)),
  )) {
    if (key === "__revision") continue;
    if (
      key.startsWith("__") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      for (const [id, item] of Object.entries(value))
        put(`map:${key}`, id, walk(item, `${key}/${id}`));
      put("root", key, { __map: `map:${key}`, order: Object.keys(value) });
    } else put("root", key, walk(value, key));
  }
  return rows;
}
function decode(rows: any[], revision: number): State {
  const chunks = new Map<string, any[]>(),
    groups = new Map<string, Map<string, any>>();
  for (const row of rows) {
    const key = `${row.group}\0${row.id}`;
    chunks.set(key, [...(chunks.get(key) || []), row]);
  }
  for (const parts of chunks.values()) {
    parts.sort((a, b) => a.part - b.part);
    if (parts.length !== parts[0].parts)
      throw new Error("Incomplete database record");
    const group = groups.get(parts[0].group) || new Map();
    groups.set(parts[0].group, group);
    group.set(parts[0].id, JSON.parse(parts.map((p) => p.json).join("")));
  }
  function resolve(value: any): any {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") {
      if (value.__list || value.__map) {
        const group = groups.get(value.__list || value.__map) || new Map();
        const pairs = value.order.map((id: string) => {
          if (!group.has(id)) throw new Error("Missing database record");
          return [id, resolve(group.get(id))];
        });
        return value.__map
          ? Object.fromEntries(pairs)
          : pairs.map((p: any[]) => p[1]);
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolve(v)]),
      );
    }
    return value;
  }
  return {
    ...Object.fromEntries(
      [...(groups.get("root") || new Map())].map(([k, v]) => [k, resolve(v)]),
    ),
    __revision: revision,
  };
}
export class FirestoreRepository implements StateRepository {
  private db;
  constructor(databaseId: string) {
    this.db = getFirestore(getApps()[0] || initializeApp(), databaseId);
  }
  async transaction<T>(run: (state: State) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (transaction) => {
      const ref = this.db.doc("platform_internal/state_revision"),
        meta = await transaction.get(ref);
      const location = meta.data()?.generation
        ? `platform_generations/${meta.data()!.generation}/records`
        : "platform_state";
      const snapshot = await transaction.get(this.db.collection(location));
      const old = new Map<string, any>(
          snapshot.docs.map((d) => [d.id, d.data()]),
        ),
        state = decode(
          snapshot.docs.map((d) => d.data()),
          Number(meta.data()?.revision || 0),
        );
      const before = JSON.stringify(state),
        result = await context.run(state, () => run(state));
      if (before === JSON.stringify(state)) return result;
      const next = encode(state);
      let writes = 1,
        bytes = 0;
      for (const [id, value] of next)
        if (!isDeepStrictEqual(old.get(id), value)) {
          writes++;
          bytes += Buffer.byteLength(JSON.stringify(value));
        }
      for (const id of old.keys()) if (!next.has(id)) writes++;
      state.__revision++;
      if (writes > 450 || bytes > 7 * 1024 * 1024) {
        const generation = randomUUID();
        let batch = this.db.batch(),
          count = 0,
          size = 0;
        for (const [id, value] of next) {
          const length = Buffer.byteLength(JSON.stringify(value));
          if (count >= 400 || size + length > 6 * 1024 * 1024) {
            await batch.commit();
            batch = this.db.batch();
            count = 0;
            size = 0;
          }
          batch.set(
            this.db.doc(`platform_generations/${generation}/records/${id}`),
            value,
          );
          count++;
          size += length;
        }
        if (count) await batch.commit();
        await this.db.doc(`platform_generations/${generation}`).set({
          complete: true,
          records: next.size,
          createdAt: new Date().toISOString(),
        });
        transaction.set(ref, {
          generation,
          revision: state.__revision,
          schemaVersion: 1,
        });
      } else {
        for (const id of old.keys())
          if (!next.has(id))
            transaction.delete(this.db.doc(`${location}/${id}`));
        for (const [id, value] of next)
          if (!isDeepStrictEqual(old.get(id), value))
            transaction.set(this.db.doc(`${location}/${id}`), value);
        transaction.set(ref, {
          ...meta.data(),
          revision: state.__revision,
          schemaVersion: 1,
        });
      }
      return result;
    });
  }
}
export function createRepository(): StateRepository {
  const mode =
    process.env.SYNDIK_STATE_BACKEND ||
    (process.env.NODE_ENV === "production" ? "firestore" : "file");
  if (mode === "firestore")
    return new FirestoreRepository(
      process.env.FIRESTORE_DATABASE_ID ||
        firebaseConfig.firestoreDatabaseId ||
        "(default)",
    );
  if (mode !== "file" || process.env.NODE_ENV === "production")
    throw new Error("Production requires Firestore");
  return new FileRepository(
    process.env.SYNDIK_DATA_DIR || path.resolve(".data"),
  );
}
