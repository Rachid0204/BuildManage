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
 return new Promise<{booted:boolean; code:number|null; output:string; stdout:string; stderr:string}>((resolve,reject)=>{
  const child = spawn(process.execPath, ['--import','./tests/helpers/networkGuard.mjs','--import','tsx', ...(repository ? ['--input-type=module','-e', 'import {createRepository} from "./server/repository.ts"; createRepository(); console.log("REPOSITORY_READY")'] : [entry])], {env});
  let output='', stdout='', stderr='', booted=false;
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Startup probe timed out'));},10000);
  const checkBoot=()=>{if (/Server running|REPOSITORY_READY/.test(output)) {booted=true;child.kill('SIGTERM');}};
  child.stdout.on('data',(chunk:Buffer)=>{const text=chunk.toString();output+=text;stdout+=text;checkBoot();});
  child.stderr.on('data',(chunk:Buffer)=>{const text=chunk.toString();output+=text;stderr+=text;checkBoot();});
  child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({booted,code,output,stdout,stderr});});
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
test('production boots when optional SYNDIK_SESSION_SECRET is omitted',async()=>assert.equal((await probe({SYNDIK_SESSION_SECRET:undefined})).booted,true));
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
test('non-secret target fields report expected X, got Y in thrown message',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 const target=JSON.parse(readFileSync('deploy/target.json','utf8'));
 const cases: Array<[string, string | undefined, string, string]> = [
  ['K_SERVICE', 'immogest-server', target.service, 'immogest-server'],
  ['GOOGLE_CLOUD_PROJECT', 'wrong-project', target.projectId, 'wrong-project'],
  ['GOOGLE_CLOUD_PROJECT', undefined, target.projectId, 'undefined'],
  ['FIRESTORE_DATABASE_ID', '(default)', target.databaseId, '(default)'],
  ['CLOUD_RUN_PROJECT_ID', 'wrong-project', target.projectId, 'wrong-project'],
  ['CLOUD_RUN_SERVICE', 'wrong-service', target.service, 'wrong-service'],
  ['CLOUD_RUN_REGION', 'us-central1', target.region, 'us-central1'],
 ];
 for (const [field, value, expected, got] of cases) {
  assert.throws(
   () => validateProductionEnvironment({ ...good, [field]: value }),
   (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(`${field} (expected ${expected}, got ${got})`), error.message);
    return true;
   },
  );
 }
});
test('production refuses emulator and test bypasses',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','STORAGE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','FUNCTIONS_EMULATOR','SYNDIK_TEST_MODE'])
  assert.throws(()=>validateProductionEnvironment({...good,[key]:'enabled'}),new RegExp(key));
});
test('secrets and keyring values never appear in thrown message or logs',async()=>{
 const {validateProductionEnvironment}=await import('../server/productionConfig');
 const badServerSecret='change-me-this-is-a-default-secret';
 const repeatedSecret='abcdefghijklmnop'.repeat(4);
 const badSessionSecret='short-session-marker-999';
 const badSchedulerSecret='short-sched-marker-888';
 const rawKeyMaterial='keyring-secret-material-marker-777';
 const badKeyring=JSON.stringify({primary:{kid:'bad-kid-marker',key:'short-key-marker-666'},retired:[]});
 for(const [field,value] of [
  ['SYNDIK_SERVER_SECRET',badServerSecret],
  ['SYNDIK_SERVER_SECRET',repeatedSecret],
  ['SYNDIK_SESSION_SECRET',badSessionSecret],
  ['SYNDIK_SESSION_SECRET',good.SYNDIK_SERVER_SECRET!],
  ['SYNDIK_SCHEDULER_SECRET',badSchedulerSecret],
  ['SYNDIK_SCHEDULER_SECRET',good.SYNDIK_SERVER_SECRET!],
  ['SYNDIK_ENCRYPTION_KEYS',rawKeyMaterial],
  ['SYNDIK_ENCRYPTION_KEYS',badKeyring],
  ['SYNDIK_ENCRYPTION_KEYS',JSON.stringify({primary:{kid:'reused-kid',key:good.SYNDIK_SERVER_SECRET!},retired:[]})],
 ] as const) {
  let stderrCapture='';
  const origError=console.error;
  console.error=(...args:unknown[])=>{stderrCapture+=args.join(' ')+'\n';};
  try {
   validateProductionEnvironment({...good,[field]:value});
   assert.fail(`accepted invalid ${field}`);
  } catch(error) {
   const msg=(error as Error).message;
   assert.match(msg,/PRODUCTION_CONFIG_INVALID/);
   for(const sensitive of [value,badServerSecret,repeatedSecret,badSessionSecret,badSchedulerSecret,rawKeyMaterial,'short-key-marker-666','bad-kid-marker','reused-kid',good.SYNDIK_SERVER_SECRET!,good.SYNDIK_SESSION_SECRET!,good.SYNDIK_SCHEDULER_SECRET!,good.SYNDIK_ENCRYPTION_KEYS!]) {
    assert.ok(!msg.includes(sensitive),`Message leaked sensitive value for ${field}`);
    assert.ok(!stderrCapture.includes(sensitive),`Stderr leaked sensitive value for ${field}`);
   }
  } finally {
   console.error=origError;
  }
 }
});
test('startup failure emits one structured ERROR JSON line on stderr without leaking secrets',async()=>{
 const badKeyring=JSON.stringify({primary:{kid:'probe-kid-marker',key:'short-probe-key-marker'},retired:[]});
 const badSecret='change-me-this-is-a-default-secret';
 const result=await probe({
  K_SERVICE:'immogest-server',
  SYNDIK_SERVER_SECRET:badSecret,
  SYNDIK_ENCRYPTION_KEYS:badKeyring,
 });
 assert.equal(result.booted,false);
 assert.equal(result.code,1);
 assert.equal(result.stdout,'');
 const lines=result.stderr.trim().split('\n');
 assert.equal(lines.length,1,`Expected single JSON line on stderr, got: ${result.stderr}`);
 const entry=JSON.parse(lines[0]);
 assert.equal(entry.severity,'ERROR');
 assert.equal(entry.event,'production_config_invalid');
 assert.deepEqual(entry.fields,['SYNDIK_SERVER_SECRET','SYNDIK_ENCRYPTION_KEYS','K_SERVICE']);
 assert.match(entry.message,/K_SERVICE \(expected buildmanage, got immogest-server\)/);
 for(const sensitive of [badSecret,badKeyring,'short-probe-key-marker','probe-kid-marker',good.SYNDIK_SESSION_SECRET!,good.SYNDIK_SCHEDULER_SECRET!]) {
  assert.ok(!result.stderr.includes(sensitive),'Stderr must not contain secret or keyring values');
  assert.ok(!result.output.includes(sensitive),'Output must not contain secret or keyring values');
 }
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
test('manifest and docs match production configuration contract',()=>{
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
 const envExample=readFileSync('.env.example','utf8');
 assert.match(envExample,/^SYNDIK_SESSION_SECRET=$/m);
 assert.match(envExample,/^SYNDIK_ENCRYPTION_KEYS=$/m);
 assert.match(envExample,/"primary"\s*:\s*\{\s*"kid"/);
 const deploymentDoc=readFileSync('DEPLOYMENT.md','utf8');
 assert.match(deploymentDoc,/\| `SYNDIK_SESSION_SECRET` \|/);
 assert.match(deploymentDoc,/\| `SYNDIK_ENCRYPTION_KEYS` \|.*"primary"/);
 assert.match(deploymentDoc,/## Troubleshooting a failed revision/);
 assert.match(deploymentDoc,/production_config_invalid/);
 assert.match(deploymentDoc,/gcloud run services list/);
 assert.match(deploymentDoc,/gcloud run services describe/);
 assert.match(deploymentDoc,/gcloud logging read/);
});
