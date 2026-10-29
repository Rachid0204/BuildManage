import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const good: NodeJS.ProcessEnv = {
 NODE_ENV: 'production', SYNDIK_STATE_BACKEND: 'firestore', SYNDIK_UPLOAD_BACKEND: 'gcs',
 SYNDIK_AUTH_PROVIDER: 'firebase', SYNDIK_SERVER_SECRET: randomBytes(32).toString('hex'),
 SYNDIK_SESSION_SECRET: randomBytes(32).toString('hex'),
 SYNDIK_ENCRYPTION_KEYS: JSON.stringify({primary:{kid:'test-primary',key:randomBytes(32).toString('hex')},retired:[]}),
 SYNDIK_SCHEDULER_SECRET: randomBytes(32).toString('hex'), GOOGLE_CLOUD_PROJECT: 'immogest-7faaf',
 FIRESTORE_DATABASE_ID: 'ai-studio-immogest-6d16b790-183d-49fd-9d4f-086d99dc2be3',
 PUBLIC_APP_URL: 'https://immogest.cloud.run', SYNDIK_UPLOAD_BUCKET: 'immogest-7faaf-uploads', PORT: '3000',
};
async function probe(overrides: NodeJS.ProcessEnv, repository = false) {
 const env = { ...process.env, ...good, ...overrides };
 for (const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','FUNCTIONS_EMULATOR','SYNDIK_TEST_MODE','FIREBASE_PROJECT_ID']) if (!(key in overrides)) delete env[key];
 const entry = process.argv.includes('--built') ? 'dist-server/server.js' : 'server.ts';
 return new Promise<{booted:boolean; code:number|null; output:string}>((resolve,reject)=>{
  const child = spawn(process.execPath, ['--import','./tests/helpers/networkGuard.mjs','--import','tsx', ...(repository ? ['--input-type=module','-e', 'import {createRepository} from "./server/repository.ts"; createRepository(); console.log("REPOSITORY_READY")'] : [entry])], {env});
  let output='', booted=false;
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Startup probe timed out'));},10000);
  const collect=(chunk:Buffer)=>{output+=chunk.toString(); if (/Server running|REPOSITORY_READY/.test(output)) {booted=true;child.kill('SIGTERM');}};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({booted,code,output});});
 });
}
for (const [label,value] of Object.entries({missing:undefined,blank:'',short:'short',default:'change-me-this-is-a-default-secret',repeated:'a'.repeat(64)})) {
 test(`production refuses ${label} server secret`, async()=>{
  const result=await probe({SYNDIK_SERVER_SECRET:value});
  assert.equal(result.booted,false); assert.equal(result.code,1);
  assert.match(result.output,/PRODUCTION_CONFIG_INVALID.*SYNDIK_SERVER_SECRET/);
 });
}
test('repository refuses production file override',async()=>{
 const result=await probe({SYNDIK_STATE_BACKEND:'file'},true);
 assert.equal(result.booted,false);assert.equal(result.code,1);assert.match(result.output,/PRODUCTION_CONFIG_INVALID.*SYNDIK_STATE_BACKEND/);
});
test('complete production environment boots',async()=>assert.equal((await probe({})).booted,true));
test('Hosting and workflow use canonical production service',()=>{
 const firebase=JSON.parse(readFileSync('firebase.json','utf8'));
 assert.deepEqual(firebase.hosting.rewrites.find((r:any)=>r.source==='/api/**').run,{serviceId:'buildmanage',region:'europe-west1'});
 const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
 assert.match(workflow,/CLOUD_RUN_SERVICE: buildmanage/);assert.match(workflow,/CLOUD_RUN_REGION: europe-west1/);
});

test('typed validator preserves stable keys without mutating environment',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 const before={...good};const result=validateProductionEnvironment(good)!;
 assert.deepEqual(good,before);assert.equal(result.SYNDIK_SERVER_SECRET,good.SYNDIK_SERVER_SECRET);
});
test('all required fields fail closed when missing',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 for(const key of Object.keys(good).filter(k=>!['NODE_ENV','PORT','SYNDIK_SESSION_SECRET'].includes(k)))
  assert.throws(()=>validateProductionEnvironment({...good,[key]:undefined}),new RegExp(`PRODUCTION_CONFIG_INVALID.*${key}`));
});
test('invalid target, auth, storage and URL values are refused',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 for(const [key,values] of Object.entries({PUBLIC_APP_URL:['not-url','http://example.org','https://u:p@example.org','https://example.org/path','https://localhost'],SYNDIK_STATE_BACKEND:['file','unknown'],SYNDIK_UPLOAD_BACKEND:['local'],SYNDIK_AUTH_PROVIDER:['local'],K_SERVICE:['immogest-server'],CLOUD_RUN_REGION:['us-central1'],GOOGLE_CLOUD_PROJECT:['other'],FIRESTORE_DATABASE_ID:['(default)'],SYNDIK_UPLOAD_BUCKET:['bad bucket']}))
  for(const value of values)assert.throws(()=>validateProductionEnvironment({...good,[key]:value}),new RegExp(key));
});
test('production refuses emulator and test bypasses',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','FUNCTIONS_EMULATOR','SYNDIK_TEST_MODE'])
  assert.throws(()=>validateProductionEnvironment({...good,[key]:'enabled'}),new RegExp(key));
});
test('secrets are redacted and scheduler key must be independent',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 for(const value of ['change-me-this-is-a-default-secret','abcdefghijklmnop'.repeat(4)]) {
  try {validateProductionEnvironment({...good,SYNDIK_SERVER_SECRET:value});assert.fail('accepted weak key');}
  catch(error){assert.match((error as Error).message,/PRODUCTION_CONFIG_INVALID/);assert.ok(!(error as Error).message.includes(value));}
 }
 assert.throws(()=>validateProductionEnvironment({...good,SYNDIK_SCHEDULER_SECRET:good.SYNDIK_SERVER_SECRET}),/SYNDIK_SCHEDULER_SECRET/);
});
test('repository independently refuses missing signing key',async()=>{
 const result=await probe({SYNDIK_SERVER_SECRET:undefined},true);
 assert.equal(result.booted,false);assert.equal(result.code,1);assert.match(result.output,/PRODUCTION_CONFIG_INVALID.*SYNDIK_SERVER_SECRET/);
});
test('server refuses file override before listener',async()=>{
 const result=await probe({SYNDIK_STATE_BACKEND:'file'});
 assert.equal(result.booted,false);assert.equal(result.code,1);assert.match(result.output,/PRODUCTION_CONFIG_INVALID.*SYNDIK_STATE_BACKEND/);
});
test('nonproduction local development stays compatible',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 assert.equal(validateProductionEnvironment({NODE_ENV:'test',SYNDIK_STATE_BACKEND:'file'}),undefined);
});
test('manifest matches Firebase database and workflow target',()=>{
 const target=JSON.parse(readFileSync('deploy/target.json','utf8'));
 const firebase=JSON.parse(readFileSync('firebase.json','utf8'));
 const workflow=readFileSync('.github/workflows/deploy.yml','utf8');
 assert.equal(firebase.firestore.database,target.databaseId);
 assert.equal(firebase.hosting.rewrites[0].run.serviceId,target.service);
 assert.equal(firebase.hosting.rewrites[0].run.region,target.region);
 assert.ok(workflow.includes(`CLOUD_RUN_PROJECT_ID: ${target.projectId}`));
 const client=JSON.parse(readFileSync('firebase-applet-config.json','utf8'));
 assert.equal(client.projectId,target.projectId);
 assert.equal(client.firestoreDatabaseId,target.databaseId);
 const runtime=readFileSync('deploy/runtime.env.example','utf8');
 for(const value of [target.projectId,target.databaseId,target.service,target.region,target.publicAppUrl]) assert.ok(runtime.includes(value));
 assert.match(readFileSync('Dockerfile','utf8'),/ENV NODE_ENV=production/);
});
