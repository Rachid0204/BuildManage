import { randomUUID } from 'node:crypto';
import type { State, StateRepository } from './repository';
export class LifecycleError extends Error {
 constructor(message:string, public readonly status=409, public readonly code='FILE_LIFECYCLE_CONFLICT'){super(message);}
}
export const DAY=86400000, OPERATION_RETENTION=14*DAY, FILE_RETENTION=7*DAY, GENERATION_RETENTION=DAY;
const instant=(value:unknown)=>typeof value==='number'?value:Date.parse(String(value));
export function assertFreshOperationId(state:State,id:string,now=Date.now()) {
 const stamp=/^op:(\d{13}):[a-zA-Z0-9:_-]+$/.exec(id);
 const reject=(message:string)=>{throw new LifecycleError(message,410,'OPERATION_EXPIRED');};
 if(stamp){if(+stamp[1]<now-OPERATION_RETENTION || +stamp[1]>now+300000)reject('Demande expirée. Vérifiez son résultat avant de créer une nouvelle opération.');}
 else if(now>=(state.__lifecycle?.legacyAcceptedUntil??Infinity))reject('Actualisez l’application avant de créer une nouvelle demande. Vérifiez les anciennes opérations.');
}
export function pruneOperationReceipts(state:State,now=Date.now(),limit=100) {
 const meta=state.__lifecycle??={};meta.legacyAcceptedUntil??=now+OPERATION_RETENTION;
 const receipts=state.__operations||{},keys=Object.keys(receipts).sort();
 const batch=keys.filter(k=>k>(meta.operationCursor||'')).slice(0,Math.min(100,Math.max(1,limit)));let removed=0;
 for(const key of batch){const r=receipts[key],last=instant(r.lastAccessAt||r.createdAt),intent=r.identityMutationId&&state.__firebaseMutations_v1?.[r.identityMutationId];
  if(r.identityMutationId&&(!intent||intent.status!=='finalized'))continue;
  if(r.status==='pending'||r.status==='running'||r.leaseUntil>now)continue;
  if(now<meta.legacyAcceptedUntil)continue;
  if(Number.isFinite(last)&&last<now-OPERATION_RETENTION){delete receipts[key];removed++;}
 }
 meta.operationCursor=batch.length?batch.at(-1):'';return removed;
}
function referenceText(state:State){return JSON.stringify(Object.fromEntries(Object.entries(state).filter(([k])=>!['__files','__lifecycle'].includes(k))));}
export function fileIsReferenced(state:State,file:{id:string;key:string}){const text=referenceText(state);return text.includes(file.id)||text.includes(file.key);}
export function assertFileLifecycle(state:State,before:State){
 const text=referenceText(state),previous=referenceText(before);
 for(const match of text.matchAll(/\/api\/uploads\/([A-Za-z0-9_-]+)/g)){const meta=state.__files?.[match[1]];
  if(meta?.lifecycle==='deleting'||(!meta&&!previous.includes(match[0])))throw new LifecycleError('Fichier expiré ou en cours de suppression. Téléversez-le à nouveau.');
 }
 for(const [id,meta] of Object.entries(state.__files||{}) as [string,any][])
  if(meta.lifecycle==='deleting'&&fileIsReferenced(state,{id,key:meta.key}))throw new LifecycleError('Fichier encore référencé.');
}
export type StoredFile={id:string;key:string;createdAt:string;generation?:string};
export interface LifecycleStorage{list(cursor?:string):Promise<{files:StoredFile[];cursor?:string}>;remove(file:StoredFile):Promise<boolean>;}
export function claimFileForDeletion(state:State,file:StoredFile,now=Date.now()){
 if(!/^[A-Za-z0-9_-]+$/.test(file.id)||!file.key.startsWith('private/')||!file.key.endsWith('/'+file.id))return false;
 if(Object.values(state.__firebaseMutations_v1||{}).some((i:any)=>i.status!=='finalized'))return false;
 const meta=state.__files?.[file.id],age=Math.max(instant(file.createdAt),instant(meta?.lastUploadedAt||meta?.createdAt||file.createdAt));
 if(!Number.isFinite(age)||age>now-FILE_RETENTION||fileIsReferenced(state,file))return false;
 if(meta?.key&&meta.key!==file.key)return false;
 if(meta?.lifecycle==='deleting')return meta.deletionClaim;
 const claim=randomUUID();(state.__files??={})[file.id]={...meta,fileId:file.id,key:file.key,createdAt:meta?.createdAt||file.createdAt,lifecycle:'deleting',deletionClaim:claim,deletionCandidate:file};return claim;
}
export async function cleanupFiles(repo:StateRepository,storage:LifecycleStorage,now=Date.now()){
 const snapshot=await repo.transaction(async s=>({cursor:s.__lifecycle?.fileCursor,pending:Object.values(s.__files||{}).filter((m:any)=>m.lifecycle==='deleting').slice(0,50).map((m:any)=>m.deletionCandidate as StoredFile)}));
 const page=await storage.list(snapshot.cursor);
 const unique=new Map<string,StoredFile>();
 for(const file of [...snapshot.pending,...page.files])if(file&&!unique.has(file.id))unique.set(file.id,file);
 const candidates=[...unique.values()].slice(0,50);
 // Commit every claim in one snapshot. Each subsequent attachment transaction
 // sees the fence before any external deletion can happen.
 const claims=await repo.transaction(async s=>candidates.map(candidate=>{
  const file={...candidate};
  if(file.key===`private/local/${file.id}`&&s.__files?.[file.id]?.key)file.key=s.__files[file.id].key;
  return {file,claim:claimFileForDeletion(s,file,now)};
 }));
 const completed:{file:StoredFile;claim:string;removed:boolean}[]=[];
 let deleted=0,retained=0,failed=0;
 for(const {file,claim} of claims){
  if(!claim){retained++;continue;}
  try{const removed=await storage.remove(file);completed.push({file,claim,removed});if(removed)deleted++;else retained++;}
  catch{failed++;} // Failed claims survive for retry; no external calls in transactions.
 }
 await repo.transaction(async s=>{
  for(const {file,claim,removed} of completed){const m=s.__files?.[file.id];if(m?.deletionClaim!==claim)continue;
   if(removed)delete s.__files[file.id];else{delete m.lifecycle;delete m.deletionClaim;delete m.deletionCandidate;}
  }
  // Retry pending deletions before advancing past an only partially processed page.
  if(!snapshot.pending.length)(s.__lifecycle??={}).fileCursor=page.cursor||'';
 });
 return {deleted,retained,failed};
}
export async function runLifecycle(repo:StateRepository,storage:LifecycleStorage,now=Date.now()){
 const owner=randomUUID(),acquired=await repo.transaction(async s=>{const m=s.__lifecycle??={};if(m.leaseUntil>now||m.nextRunAt>now)return false;m.leaseOwner=owner;m.leaseUntil=now+600000;m.nextRunAt=now+3600000;return true;});
 if(!acquired)return {skipped:true};
 try{const operations=await repo.transaction(async s=>pruneOperationReceipts(s,now));const generations=await repo.cleanupGenerations?.(now),files=await cleanupFiles(repo,storage,now);return {skipped:false,operations,generations,files};}
 finally{await repo.transaction(async s=>{if(s.__lifecycle?.leaseOwner===owner){delete s.__lifecycle.leaseOwner;delete s.__lifecycle.leaseUntil;}});}
}
