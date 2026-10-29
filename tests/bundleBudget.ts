import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
type Chunk = {file:string;entry:boolean;dynamic:boolean;imports:string[];dynamicImports:string[];modules:string[]};
const chunks:Chunk[] = JSON.parse(readFileSync('dist/bundle-audit.json','utf8'));
const byFile = new Map(chunks.map(c=>[c.file,c]));
const initial = new Set<string>();
function visit(file:string) { if(initial.has(file))return; initial.add(file); byFile.get(file)?.imports.forEach(visit); }
chunks.filter(c=>c.entry).forEach(c=>visit(c.file));
const files=['index.html',...readdirSync('dist/assets').filter(f=>/\.(js|css)$/.test(f)).map(f=>'assets/'+f)];
const report=files.map(file=>{const data=readFileSync('dist/'+file);return {file,bytes:data.length,gzip:gzipSync(data).length,initial:initial.has(file)};});
console.table(report);
writeFileSync('dist/bundle-sizes.json',JSON.stringify(report,null,2));
let failed=0,passed=0;
function check(name:string,fn:()=>void){try{fn();console.log('PASS:',name);passed++;}catch(e){console.error('FAIL:',name,(e as Error).message);failed++;}}
const size=(f:string)=>report.find(r=>r.file===f)!.gzip;
const modules=[...initial].flatMap(f=>byFile.get(f)?.modules||[]);
check('initial JavaScript graph <= 250 KiB gzip',()=>assert.ok([...initial].reduce((n,f)=>n+size(f),0)<=250*1024));
check('entry JavaScript <= 100 KiB gzip',()=>chunks.filter(c=>c.entry).forEach(c=>assert.ok(size(c.file)<=100*1024)));
check('PDF libraries and fonts are absent from initial graph',()=>assert.ok(!modules.some(m=>/jspdf|html2canvas|pdfFonts|pdfService/.test(m))));
check('jspdf is an isolated deferred vendor chunk',()=>{const c=chunks.filter(c=>c.modules.some(m=>m.includes('/jspdf/')));assert.equal(c.length,1);assert.ok(!initial.has(c[0].file));assert.ok(c[0].modules.every(m=>m.includes('node_modules')||m.startsWith('\u0000')));});
for(const portal of ['AdminDashboard','ResidentDashboard','SyndicPortal','PrestatairePortal'])check(portal+' is a separate deferred entry',()=>{const c=chunks.find(c=>c.modules.some(m=>m.endsWith('/'+portal+'.tsx')));assert.ok(c);assert.ok(c.dynamic);assert.ok(!initial.has(c.file));});
check('role navigation cannot statically fetch PDF code',()=>{
  for(const portal of ['AdminDashboard','ResidentDashboard','SyndicPortal','PrestatairePortal']) {
    const root=chunks.find(c=>c.modules.some(m=>m.endsWith('/'+portal+'.tsx')));
    assert.ok(root);
    const seen=new Set<string>();
    const visitRole=(file:string)=>{if(seen.has(file))return;seen.add(file);const c=byFile.get(file);assert.ok(!c?.modules.some(m=>/jspdf|html2canvas|pdfFonts|pdfService/.test(m)),file);c?.imports.forEach(visitRole);};
    visitRole(root.file);
  }
});
check('legacy domain and unused Firebase data SDKs absent from every chunk', () => {
  for (const chunk of chunks) {
    assert.ok(!chunk.modules.some(m => /tests\/fixtures|server\/domain|firebase\/(legacyClient|serverRuntime)|@firebase\/(firestore|functions|storage)\//.test(m)), chunk.file);
    assert.ok(!/legacyClient/.test(chunk.file), chunk.file);
  }
});
check('unused Firebase data SDKs absent from initial graph',()=>assert.ok(!modules.some(m=>/@firebase\/(firestore|functions|storage)/.test(m))));
check('vendor and deferred chunk budgets',()=>chunks.forEach(c=>{const limit=/\/pdf-/.test(c.file)?160:/\/(vendor|firebase)-/.test(c.file)?120:200;assert.ok(size(c.file)<=limit*1024,`${c.file}: ${size(c.file)} > ${limit} KiB`);}));
console.log(`Bundle budget: ${passed} passed, ${failed} failed`);
process.exitCode=failed?1:0;

