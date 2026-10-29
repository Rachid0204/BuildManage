import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
const target=JSON.parse(readFileSync('deploy/target.json','utf8'));
const env={NODE_ENV:'production',SYNDIK_STATE_BACKEND:'firestore',SYNDIK_UPLOAD_BACKEND:'gcs',SYNDIK_AUTH_PROVIDER:'firebase',SYNDIK_SERVER_SECRET:randomBytes(32).toString('hex'),SYNDIK_SESSION_SECRET:randomBytes(32).toString('hex'),SYNDIK_ENCRYPTION_KEYS:JSON.stringify({primary:{kid:'startup-v1',key:randomBytes(32).toString('hex')},retired:[]}),SYNDIK_SCHEDULER_SECRET:randomBytes(32).toString('hex'),GOOGLE_CLOUD_PROJECT:target.projectId,FIRESTORE_DATABASE_ID:target.databaseId,PUBLIC_APP_URL:target.publicAppUrl,SYNDIK_UPLOAD_BUCKET:'startup-smoke.invalid',GCE_METADATA_DISABLED:'true'};
const docker=process.argv.includes('--docker');
const run=(args)=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
const check=`const base='http://127.0.0.1:'+process.env.PORT;const health=await fetch(base+'/api/health',{signal:AbortSignal.timeout(3000)});if(health.status!==200||(await health.json()).status!=='ok')throw Error('Health failed');const page=await fetch(base+'/',{signal:AbortSignal.timeout(3000)});if(page.status!==200||!/<html/i.test(await page.text()))throw Error('Frontend failed');`;
if(docker)execFileSync('docker',['build','-t','immogest-startup-smoke','.'],{stdio:'inherit',timeout:600000});
for(const port of ['3000','31847']){
 let child,id,closed,logs='';
 try{
  if(docker){
   id=run(['run','-d','--network','none',...Object.entries({...env,PORT:port}).flatMap(([k,v])=>['-e',`${k}=${v}`]),'immogest-startup-smoke']).trim();
  }else{
   child=spawn(process.execPath,['--import',resolve('tests/helpers/networkGuard.mjs'),'dist-server/server.js'],{env:{PATH:process.env.PATH,...env,PORT:port},stdio:['ignore','pipe','pipe']});
   closed=once(child,'close');child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
  }
  const deadline=Date.now()+20000;
  while(!logs.includes('Server running')&&Date.now()<deadline){
   if(docker){logs=run(['logs',id]);assert.equal(run(['inspect','-f','{{.State.Running}}',id]).trim(),'true',logs);}
   else assert.equal(child.exitCode,null,logs);
   await new Promise(r=>setTimeout(r,100));
  }
  assert.match(logs,/Server running/);
  for(const key of ['SYNDIK_SERVER_SECRET','SYNDIK_SESSION_SECRET','SYNDIK_ENCRYPTION_KEYS','SYNDIK_SCHEDULER_SECRET'])assert.ok(!logs.includes(env[key]),'Logs must not reveal secrets');
  if(docker)run(['exec',id,'node','--input-type=module','-e',check]);
  else execFileSync(process.execPath,['--input-type=module','-e',check],{env:{PATH:process.env.PATH,PORT:port},timeout:10000});
  console.log(`PASS: ${docker?'runtime-only Docker image':'compiled server'} health and frontend HTTP on PORT=${port}`);
 }finally{
  if(id)run(['rm','-f',id]);
  if(child){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await closed;clearTimeout(timer);}
 }
}
