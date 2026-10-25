import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile, utimes, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encrypt, decrypt } from '../server/mailer';
import { FileRepository } from '../server/repository';
const load=async()=>{const module=await import('../server/lifecycle').catch(()=>null);assert.ok(module,'lifecycle module must exist');return module;};
const DAY=86400000, now=Date.now(), old=new Date(now-30*DAY).toISOString();
process.env.SYNDIK_SERVER_SECRET=randomBytes(32).toString('hex');
function legacy(text:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(process.env.SYNDIK_SERVER_SECRET!).digest(),iv);return [iv.toString('base64'),cipher.update(text,'utf8','base64')+cipher.final('base64'),cipher.getAuthTag().toString('base64')].join('.');}
async function local(run:(repo:FileRepository,dir:string)=>Promise<void>){const dir=await mkdtemp(path.join(os.tmpdir(),'lifecycle-'));try{await run(new FileRepository(dir),dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('legacy ciphertext remains readable',()=>assert.equal(decrypt(legacy('ancien secret')),'ancien secret'));
test('new encryption is versioned and round trips',()=>{const value=encrypt('nouveau secret');assert.match(value,/^v1:/);assert.equal(decrypt(value),'nouveau secret');});
test('unknown encryption versions are rejected',()=>assert.throws(()=>decrypt('v999:'+legacy('secret')),/Unsupported encryption version/));
test('expired receipts are removed but recent, retried and pending identities survive',async()=>{const {pruneOperationReceipts}=await load();const s:any={__lifecycle:{legacyAcceptedUntil:now-DAY},__firebaseMutations_v1:{pending:{status:'running'}},__operations:{expired:{createdAt:old},recent:{createdAt:new Date(now).toISOString()},retried:{createdAt:old,lastAccessAt:new Date(now).toISOString()},pending:{createdAt:old,identityMutationId:'pending'}}};assert.equal(pruneOperationReceipts(s,now),1);assert.deepEqual(Object.keys(s.__operations).sort(),['pending','recent','retried']);});
test('legacy transition protects receipts; expired unknown IDs cannot replay',async()=>{const {pruneOperationReceipts,assertFreshOperationId}=await load();const s:any={__operations:{legacy:{createdAt:old}}};pruneOperationReceipts(s,now);assert.ok(s.__operations.legacy);assertFreshOperationId(s,'legacy-command-id',now);assert.throws(()=>assertFreshOperationId(s,'legacy-command-id',now+15*DAY),/Actualisez/);assert.throws(()=>assertFreshOperationId(s,`op:${now-20*DAY}:expired-operation`,now),/expir/);assertFreshOperationId(s,`op:${now}:new-operation`,now);});
test('receipt cleanup is capped and progresses through retained records',async()=>{const {pruneOperationReceipts}=await load();const s:any={__lifecycle:{legacyAcceptedUntil:0},__operations:Object.fromEntries(Array.from({length:30},(_,i)=>[String(i).padStart(3,'0'),{createdAt:i<10?new Date(now).toISOString():old}]))};assert.equal(pruneOperationReceipts(s,now,10),0);assert.equal(pruneOperationReceipts(s,now,10),10);assert.equal(pruneOperationReceipts(s,now,10),10);});
test('active finance and archived legal references are strictly protected',async()=>{const {claimFileForDeletion}=await load();for(const field of ['charges','quittances','archivedAssemblies','documents']){const s:any={__files:{proof:{key:'private/b/proof',createdAt:old}},[field]:[{receiptUrl:'/api/uploads/proof'}]};assert.equal(claimFileForDeletion(s,{id:'proof',key:'private/b/proof',createdAt:old},now),false);}});
test('orphan deletion is claimed before bytes are pruned and preserves active proof',async()=>{const {cleanupFiles}=await load();await local(async repo=>{await repo.transaction(async s=>{s.__files={proof:{key:'private/b/proof',createdAt:old}};s.charges=[{receiptUrl:'/api/uploads/proof'}];});const removed:string[]=[];await cleanupFiles(repo,{list:async()=>({files:[{id:'orphan',key:'private/b/orphan',createdAt:old},{id:'proof',key:'private/b/proof',createdAt:old}]}),remove:async file=>{await repo.transaction(async s=>assert.equal(s.__files[file.id].lifecycle,'deleting'));removed.push(file.id);return true;}},now);assert.deepEqual(removed,['orphan']);await repo.transaction(async s=>{assert.ok(s.__files.proof);assert.equal(s.__files.orphan,undefined);});});});
test('failed deletion retains claim and blocks concurrent attachment until retry',async()=>{const {cleanupFiles}=await load();await local(async repo=>{const file={id:'orphan',key:'private/b/orphan',createdAt:old};await cleanupFiles(repo,{list:async()=>({files:[file]}),remove:async()=>{await assert.rejects(repo.transaction(async s=>{s.charges=[{receiptUrl:'/api/uploads/orphan'}];}),/Fichier/);throw new Error('offline');}},now);await repo.transaction(async s=>assert.equal(s.__files.orphan.lifecycle,'deleting'));assert.equal((await cleanupFiles(repo,{list:async()=>({files:[]}),remove:async()=>true},now)).deleted,1);});});
test('fresh files, unknown ages and changed storage generations remain safe',async()=>{const {claimFileForDeletion,cleanupFiles}=await load();for(const date of [new Date(now).toISOString(),'unknown'])assert.equal(claimFileForDeletion({},{id:'fresh',key:'private/b/fresh',createdAt:date},now),false);await local(async repo=>{await cleanupFiles(repo,{list:async()=>({files:[{id:'old',key:'private/b/old',createdAt:old}]}),remove:async()=>false},now);await repo.transaction(async s=>assert.equal(s.__files.old.lifecycle,undefined));});});
test('hourly lifecycle lease prevents duplicate work',async()=>{const {runLifecycle}=await load();await local(async repo=>{let calls=0;const storage={list:async()=>{calls++;return {files:[]};},remove:async()=>true};const results=await Promise.all([runLifecycle(repo,storage,now),runLifecycle(repo,storage,now)]);assert.equal(results.filter(r=>r.skipped).length,1);assert.equal(calls,1);});});
test('local cleanup removes only abandoned snapshot temporaries',async()=>{await local(async(repo,dir)=>{assert.equal(typeof repo.cleanupGenerations,'function');const stale=path.join(dir,'shared-state.json.11111111-1111-4111-8111-111111111111.tmp'),fresh=path.join(dir,'shared-state.json.22222222-2222-4222-8222-222222222222.tmp');await writeFile(stale,'aborted');await writeFile(fresh,'pending');await utimes(stale,new Date(old),new Date(old));await repo.cleanupGenerations(now);await assert.rejects(access(stale));await access(fresh);});});
if(process.argv.includes('--firestore'))test('Firestore GC protects active/fresh trees and incrementally prunes abandoned/legacy trees',async()=>{
 assert.ok(process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:'));
 const {initializeApp,deleteApp}=await import('firebase-admin/app'),{getFirestore}=await import('firebase-admin/firestore'),{FirestoreRepository}=await import('../server/repository');
 const app=initializeApp({projectId:'demo-buildmanage'}),db=getFirestore(app,'a5-lifecycle-test'),repo=new FirestoreRepository('a5-lifecycle-test');
 try{assert.equal(typeof repo.cleanupGenerations,'function');await db.recursiveDelete(db.collection('platform_generations'));await db.doc('platform_internal/lifecycle_gc').delete();await db.doc('platform_internal/state_revision').set({revision:1,generation:'active'});
 for(const [id,date] of [['active',old],['abandoned',old],['fresh',new Date(now).toISOString()]]){await db.doc(`platform_generations/${id}`).set({createdAt:date,updatedAt:date,complete:id==='active'});const batch=db.batch();for(let i=0;i<120;i++)batch.set(db.doc(`platform_generations/${id}/records/${i}`),{test:true});await batch.commit();}
 await db.doc('platform_generations/legacy/records/record').set({test:true});await repo.cleanupGenerations(now);
 assert.equal((await db.collection('platform_generations/active/records').get()).size,120);assert.equal((await db.collection('platform_generations/fresh/records').get()).size,120);assert.ok((await db.collection('platform_generations/abandoned/records').get()).size<120);
 for(let i=0;i<8;i++)await repo.cleanupGenerations(now);
 assert.equal((await db.collection('platform_generations/abandoned/records').get()).size,0);assert.ok((await db.doc('platform_generations/legacy').get()).exists);assert.ok((await db.doc('platform_generations/legacy/records/record').get()).exists);
 for(let i=0;i<8;i++)await repo.cleanupGenerations(now+2*DAY);
 assert.equal((await db.collection('platform_generations/legacy/records').get()).size,0);assert.equal((await db.collection('platform_generations/active/records').get()).size,120);
 }finally{await deleteApp(app);}
});
test('HTTP scheduler authorization, physical orphan cleanup and expired retry rejection',async()=>{
 const {spawn}=await import('node:child_process'),{createServer}=await import('node:net'),{mkdir,readFile}=await import('node:fs/promises'),{hashPasswordSync}=await import('../utils/security');
 await local(async(repo,dir)=>{
  const orphan='a'.repeat(64),proof='b'.repeat(64),scheduler=randomBytes(32).toString('hex');
  await mkdir(path.join(dir,'uploads'));
  for(const id of [orphan,proof]){const file=path.join(dir,'uploads',id);await writeFile(file,'content');await utimes(file,new Date(old),new Date(old));}
  const recentId='recent-command-123456', operation='noop',args:unknown[]=[],fingerprint=createHash('sha256').update(JSON.stringify({operation,args})).digest('hex');
  await repo.transaction(async s=>{
   s.syndik_prod_registered_users_v1=[{uid:'admin',email:'admin@lifecycle.invalid',passwordHash:hashPasswordSync('SafePassword123!','admin@lifecycle.invalid'),profile:{uid:'admin',email:'admin@lifecycle.invalid',role:'admin',emailVerified:true}}];
   s.__lifecycle={legacyAcceptedUntil:0};s.__files={[proof]:{key:`private/b/${proof}`,createdAt:old}};s.charges=[{receiptUrl:`/api/uploads/${proof}`}];
   s.__operations={expired:{createdAt:old},['admin:'+recentId]:{fingerprint,createdAt:old,lastAccessAt:new Date(now).toISOString(),responseJson:JSON.stringify({result:'canonical'})}};
  });
  const port=await new Promise<number>(resolve=>{const socket=createServer();socket.listen(0,'127.0.0.1',()=>{const p=(socket.address() as any).port;socket.close(()=>resolve(p));});});
  const child=spawn(process.execPath,['--import','./tests/helpers/networkGuard.mjs','--import','tsx','server.ts'],{env:{...process.env,NODE_ENV:'test',SYNDIK_AUTH_PROVIDER:'legacy',SYNDIK_STATE_BACKEND:'file',SYNDIK_UPLOAD_BACKEND:'file',SYNDIK_DATA_DIR:dir,SYNDIK_SCHEDULER_SECRET:scheduler,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',chunk=>{logs+=chunk;});const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  try{
   await new Promise<void>((resolve,reject)=>{child.stdout.on('data',chunk=>{if(String(chunk).includes('Server running'))resolve();});child.on('error',reject);child.on('exit',code=>reject(new Error(`Server exited ${code}: ${logs}`)));});
   const post=async(route:string,body:unknown,headers:Record<string,string>={})=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
   assert.equal((await post('/api/jobs/lifecycle',{})).status,403);
   assert.equal((await post('/api/jobs/lifecycle',{}, {'X-Syndik-Scheduler':'wrong'})).status,403);
   const login=await post('/api/auth/login',{identifier:'admin@lifecycle.invalid',password:'SafePassword123!'});assert.equal(login.status,200);
   const auth={Authorization:`Bearer ${login.data.token}`};assert.equal((await post('/api/jobs/lifecycle',{},auth)).status,403);
   const result=await post('/api/jobs/lifecycle',{}, {'X-Syndik-Scheduler':scheduler});assert.equal(result.status,200);assert.equal(result.data.files.deleted,1);
   await assert.rejects(access(path.join(dir,'uploads',orphan)));await access(path.join(dir,'uploads',proof));
   const retried=await post('/api/commands',{operation,args,operationId:recentId},auth);assert.equal(retried.status,200);assert.equal(retried.data.result,'canonical');
   const expired=await post('/api/commands',{operation,args,operationId:`op:${now-20*DAY}:old-command-123456`},auth);
   assert.equal(expired.status,410);assert.equal(expired.data.code,'OPERATION_EXPIRED');assert.match(expired.data.error,/expir/);
   const final=JSON.parse(await readFile(path.join(dir,'shared-state.json'),'utf8'));assert.equal(final.__operations.expired,undefined);assert.ok(final.__operations['admin:'+recentId]);
  }finally{clearTimeout(timer);const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}
 });
});
if(process.argv.includes('--firestore'))test('paused staging writer retries instead of activating a generation claimed by GC',async()=>{
 const {initializeApp,deleteApp}=await import('firebase-admin/app'),{getFirestore}=await import('firebase-admin/firestore'),{FirestoreRepository}=await import('../server/repository');
 const app=initializeApp({projectId:'demo-buildmanage'}),db=getFirestore(app,'a5-staging-race'),repo=new FirestoreRepository('a5-staging-race');
 const original=db.runTransaction.bind(db);let intercepted=false,staged='',attempts=0;
 try{
  await db.recursiveDelete(db.collection('platform_generations'));await db.recursiveDelete(db.collection('platform_state'));await db.recursiveDelete(db.collection('platform_internal'));
  (db as any).runTransaction=async(...args:any[])=>{
   if(!intercepted){intercepted=true;staged=(await db.collection('platform_generations').get()).docs[0].id;await repo.cleanupGenerations(Date.now()+2*DAY);}
   return (original as any)(...args);
  };
  await repo.transaction(async s=>{attempts++;s.items=Array.from({length:650},(_,i)=>({id:String(i),value:i}));});
  assert.ok(attempts>=2);assert.notEqual((await db.doc('platform_internal/state_revision').get()).data()?.generation,staged);
  assert.equal((await db.doc(`platform_generations/${staged}`).get()).exists,false);
  await repo.transaction(async s=>assert.equal(s.items.length,650));
 }finally{(db as any).runTransaction=original;await deleteApp(app);}
});
if(process.argv.includes('--firestore'))test('Firestore deletion claim prevents new proof references and resumes after failure',async()=>{
 const {initializeApp,deleteApp}=await import('firebase-admin/app'),{getFirestore}=await import('firebase-admin/firestore'),{FirestoreRepository}=await import('../server/repository'),{cleanupFiles}=await load();
 const app=initializeApp({projectId:'demo-buildmanage'}),db=getFirestore(app,'a5-file-race'),repo=new FirestoreRepository('a5-file-race');
 try{
  await db.recursiveDelete(db.collection('platform_generations'));await db.recursiveDelete(db.collection('platform_state'));await db.recursiveDelete(db.collection('platform_internal'));
  const file={id:'orphan',key:'private/b/orphan',createdAt:old};
  await cleanupFiles(repo,{list:async()=>({files:[file]}),remove:async()=>{await assert.rejects(repo.transaction(async s=>{s.charges=[{receiptUrl:'/api/uploads/orphan'}];}),/Fichier/);throw new Error('interrupted');}},now);
  await repo.transaction(async s=>assert.equal(s.__files.orphan.lifecycle,'deleting'));
  assert.equal((await cleanupFiles(repo,{list:async()=>({files:[]}),remove:async()=>true},now)).deleted,1);
 }finally{await deleteApp(app);}
});
test('a full file page uses at most three repository snapshots, not two per object',async()=>{
 const {cleanupFiles}=await load();await local(async repo=>{let transactions=0,deleted=0;const bounded={transaction:async<T>(run:(s:any)=>Promise<T>)=>{transactions++;return repo.transaction(run);}};
 const files=Array.from({length:50},(_,i)=>({id:`file${i}`,key:`private/b/file${i}`,createdAt:old}));
 const result=await cleanupFiles(bounded,{list:async()=>({files}),remove:async()=>{deleted++;return true;}},now);
 assert.equal(result.deleted,50);assert.equal(deleted,50);assert.ok(transactions<=3,`Expected <=3 snapshots, got ${transactions}`);
 });
});
test('pending deletion keeps its original generation when inventory contains a replacement',async()=>{
 const {cleanupFiles}=await load();await local(async repo=>{
 const file={id:'orphan',key:'private/b/orphan',createdAt:old,generation:'1'};
 await cleanupFiles(repo,{list:async()=>({files:[file]}),remove:async()=>{throw new Error('interrupted');}},now);
 let attempted='';await cleanupFiles(repo,{list:async()=>({files:[{...file,createdAt:new Date(now).toISOString(),generation:'2'}]}),remove:async candidate=>{attempted=candidate.generation!;return false;}},now);
 assert.equal(attempted,'1');await repo.transaction(async s=>assert.equal(s.__files.orphan.lifecycle,undefined));
 });
});
