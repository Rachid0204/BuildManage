import { assertFileLifecycle, GENERATION_RETENTION } from './lifecycle';
import { validateProductionEnvironment } from "./productionConfig";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, rename, rm, stat } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { dependencyFailure } from './dependencyErrors';
export type State = Record<string, any>;
const context = new AsyncLocalStorage<State>();
export function assertOutsideTransaction() {
  if (context.getStore()) throw new Error('External identity mutations are forbidden inside repository transactions');
}
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
  cleanupGenerations?(now?: number): Promise<unknown>;
  watchRevision?(onRevision: (revision: number) => void, onError: (error: Error) => void): () => void;
}
export class FileRepository implements StateRepository {
  constructor(public directory: string) {}
  async cleanupGenerations(now=Date.now()) {
    return this.transaction(async () => {
      const {readdir}=await import('node:fs/promises');let deleted=0;
      for(const name of await readdir(this.directory)) {
        if(deleted>=100)break;
        if(!/^shared-state\.json\.[a-f0-9-]{36}\.tmp$/.test(name))continue;
        const file=path.join(this.directory,name), info=await stat(file);
        if(info.mtimeMs<now-GENERATION_RETENTION){await rm(file);deleted++;}
      }
      return {deleted};
    });
  }
  watchRevision(onRevision: (revision: number) => void, onError: (error: Error) => void) {
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const state = JSON.parse(await readFile(path.join(this.directory, 'shared-state.json'), 'utf8'));
        if (!closed) onRevision(Number(state.__revision) || 0);
      } catch (error: any) {
        if (!closed && error.code !== 'ENOENT') onError(error);
      }
    };
    const watcher = watch(this.directory, (_event, file) => {
      if (file && String(file) !== 'shared-state.json') return;
      clearTimeout(timer);
      timer = setTimeout(() => void read(), 30);
    });
    watcher.on('error', onError);
    void read();
    return () => { closed = true; clearTimeout(timer); watcher.close(); };
  }
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
        const info = await stat(lock).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 60000) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
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
      const revision = Number(state.__revision) || 0,
        before = JSON.stringify(state),
        result = await context.run(state, () => run(state)),
        after = JSON.stringify(state);
      if (after === before) return result;
      assertFileLifecycle(state, JSON.parse(before));
      state.__revision = revision + 1;
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
    const json = JSON.stringify(value), chunks: string[] = [];
    for (let start = 0; start < json.length;) {
      let end = Math.min(start + 60000, json.length);
      // Firestore encodes each string as UTF-8; never split an emoji surrogate pair.
      if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
      chunks.push(json.slice(start, end));
      start = end;
    }
    const parts = chunks.length;
    for (let part = 0; part < parts; part++)
      rows.set(`${hash}_${part}`, {
        group,
        id,
        part,
        parts,
        json: chunks[part],
      });
  }
  function walk(value: any, location: string): any {
    if (Array.isArray(value)) {
      if (
        value.length <= 8 ||
        !value.every((v) => v && typeof v === "object" && !Array.isArray(v))
      )
        return value.map((v, i) => walk(v, `${location}/${i}`));
      const order: string[] = [], group = `list:${location}`;
      const identities = value.map((item, index) => String(
          item.id ||
            item.uid ||
            item.apartmentId ||
            (item.residentId
              ? `${item.residentId}:${item.apartmentNumber || ""}`
              : index),
        ));
      const repeated = new Set(identities).size !== identities.length;
      const occurrences = new Map<string, number>();
      for (const [index, item] of value.entries()) {
        const candidate = identities[index], occurrence = occurrences.get(candidate) || 0;
        occurrences.set(candidate, occurrence + 1);
        // Repeated residents in history/metadata are valid JSON. Storage keys must
        // preserve every entry without treating a resident ID as a unique event ID.
        const id = repeated ? JSON.stringify([candidate, occurrence]) : candidate;
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
class RevisionChanged extends Error {}
export class FirestoreRepository implements StateRepository {
  private db;
  constructor(databaseId: string) {
    this.db = getFirestore(getApps()[0] || initializeApp(), databaseId);
  }
  async cleanupGenerations(now=Date.now()) {
    const control=this.db.doc('platform_internal/lifecycle_gc'),cursors=(await control.get()).data()||{};
    let discovery=this.db.collectionGroup('records').orderBy(FieldPath.documentId()).select().limit(100);
    if(cursors.discoveryCursor)discovery=discovery.startAfter(this.db.doc(cursors.discoveryCursor));
    const discovered=await discovery.get();
    const parents=new Map(discovered.docs.filter(d=>d.ref.path.startsWith('platform_generations/')).map(d=>[d.ref.parent.parent!.path,d.ref.parent.parent!]));
    for(const parent of parents.values())await this.db.runTransaction(async tx=>{const marker=await tx.get(parent);if(!marker.exists)tx.create(parent,{createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),status:'legacy-discovered',complete:false});});
    let query=this.db.collection('platform_generations').orderBy(FieldPath.documentId()).limit(10);
    if(cursors.generationCursor)query=query.startAfter(cursors.generationCursor);
    const candidates=await query.get();let deleted=0,reclaimed=0,lastCursor='';
    for(const candidate of candidates.docs){if(deleted>=100)break;
      const claimed=await this.db.runTransaction(async tx=>{const active=await tx.get(this.db.doc('platform_internal/state_revision')),marker=await tx.get(candidate.ref),data=marker.data();if(!data||active.data()?.generation===candidate.id)return false;const age=Date.parse(data.updatedAt||data.createdAt);if(data.status!=='deleting'&&(!Number.isFinite(age)||age>now-GENERATION_RETENTION))return false;tx.update(candidate.ref,{status:'deleting'});return true;});
      if(!claimed){lastCursor=candidate.id;continue;}
      const rows=await candidate.ref.collection('records').limit(100-deleted).get();
      if(rows.empty){await candidate.ref.delete();reclaimed++;lastCursor=candidate.id;}else{const batch=this.db.batch();for(const row of rows.docs)batch.delete(row.ref);await batch.commit();deleted+=rows.size;break;}
    }
    await control.set({discoveryCursor:discovered.empty?'':discovered.docs.at(-1)!.ref.path,generationCursor:candidates.empty?'':lastCursor},{merge:true});
    return {scanned:candidates.size,discovered:discovered.size,deleted,reclaimed};
  }
  watchRevision(onRevision: (revision: number) => void, onError: (error: Error) => void) {
    return this.db.doc('platform_internal/state_revision').onSnapshot(
      snapshot => onRevision(Number(snapshot.data()?.revision) || 0), onError);
  }
  async transaction<T>(run: (state: State) => Promise<T>): Promise<T> {
    const ref = this.db.doc("platform_internal/state_revision");
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          // Read one consistent generation without holding pessimistic locks during
          // SDK uploads, domain work, or staging batches. The monotonic revision is
          // checked before/after the read and again atomically at commit.
          const meta = await ref.get();
          const revision = Number(meta.data()?.revision) || 0;
          const location = meta.data()?.generation
            ? `platform_generations/${meta.data()!.generation}/records`
            : "platform_state";
          const snapshot = await this.db.collection(location).get();
          const observed = await ref.get();
          if ((Number(observed.data()?.revision) || 0) !== revision ||
              observed.data()?.generation !== meta.data()?.generation) throw new RevisionChanged();
          const old = new Map<string, any>(snapshot.docs.map(d => [d.id, d.data()]));
          const state = decode(snapshot.docs.map(d => d.data()), revision);
          const before = JSON.stringify(state);
          const result = await context.run(state, () => run(state));
          const after = JSON.stringify(state);
          if (after === before) return result;
          assertFileLifecycle(state, JSON.parse(before));
          const next = encode(state);
          let writes = 1, bytes = 0;
          for (const [id, value] of next) if (!isDeepStrictEqual(old.get(id), value)) {
            writes++;
            bytes += Buffer.byteLength(JSON.stringify(value));
          }
          for (const id of old.keys()) if (!next.has(id)) writes++;
          state.__revision = revision + 1;
          let generation: string | undefined;
          if (writes > 450 || bytes > 7 * 1024 * 1024) {
            generation = randomUUID();
            const parent=this.db.doc(`platform_generations/${generation}`);
            await parent.create({createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),complete:false,status:'staging'});
            let rows:[string,any][]=[],size=0;
            const flush=async()=>{
              if(!rows.length)return;const pending=rows;
              await this.db.runTransaction(async tx=>{
                const marker=await tx.get(parent);
                if(!marker.exists||marker.data()?.status==='deleting')throw new RevisionChanged();
                for(const [id,value] of pending)tx.set(parent.collection('records').doc(id),value);
                tx.update(parent,{updatedAt:new Date().toISOString()});
              });rows=[];size=0;
            };
            for(const [id,value] of next){const length=Buffer.byteLength(JSON.stringify(value));if(rows.length>=400||size+length>6*1024*1024)await flush();rows.push([id,value]);size+=length;}
            await flush();
            await this.db.runTransaction(async tx=>{const marker=await tx.get(parent);if(!marker.exists||marker.data()?.status==='deleting')throw new RevisionChanged();tx.update(parent,{complete:true,records:next.size,updatedAt:new Date().toISOString()});});
          }
          await this.db.runTransaction(async transaction => {
            const current = await transaction.get(ref);
            if ((Number(current.data()?.revision) || 0) !== revision ||
                current.data()?.generation !== meta.data()?.generation) throw new RevisionChanged();
            if(generation){const marker=await transaction.get(this.db.doc(`platform_generations/${generation}`));if(!marker.exists||!marker.data()?.complete||marker.data()?.status==='deleting')throw new RevisionChanged();}
            if (!generation) {
              for (const id of old.keys()) if (!next.has(id)) transaction.delete(this.db.doc(`${location}/${id}`));
              for (const [id, value] of next) if (!isDeepStrictEqual(old.get(id), value))
                transaction.set(this.db.doc(`${location}/${id}`), value);
            }
            transaction.set(ref, {
              ...meta.data(), ...(generation ? { generation } : {}),
              revision: state.__revision, schemaVersion: 1,
            });
          }, { maxAttempts: 1 });
          return result;
        } catch (error: any) {
          if (!(error instanceof RevisionChanged) && error?.code !== 10) throw error;
          if (attempt === 11) throw dependencyFailure('database', new Error('Concurrent writers: retry the request.'));
          await new Promise(resolve => setTimeout(resolve, Math.min(25 * (attempt + 1), 250) + Math.random() * 25));
        }
      }
      throw new Error('Database transaction exhausted');
    } catch (error: any) {
      if (typeof error?.code === 'number' && !error?.rejected && !error?.status)
        throw dependencyFailure('database', error);
      throw error;
    }
  }
}

export function createRepository(): StateRepository {
  validateProductionEnvironment();
  const mode =
    process.env.SYNDIK_STATE_BACKEND ||
    (process.env.NODE_ENV === "production" ? "firestore" : "file");
  if (mode === "firestore")
    return new FirestoreRepository(
      process.env.FIRESTORE_DATABASE_ID ||
        firebaseConfig.firestoreDatabaseId ||
        "(default)",
    );
  return new FileRepository(
    process.env.SYNDIK_DATA_DIR || path.resolve(".data"),
  );
}
