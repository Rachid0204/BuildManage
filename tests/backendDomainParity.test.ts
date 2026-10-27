import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRepository } from '../server/repository';
import { createCommandService } from '../server/domain/command.service';
import { runOperation as legacy } from './fixtures/a32/legacyOperations';

const actor = { uid: 'owner', role: 'syndic', syndicId: 'cab' } as const;
const fixed = '2026-10-01T12:00:00.000Z';
const NativeDate = Date;
class Clock extends NativeDate {
  constructor(value?: any) { super(value === undefined ? fixed : value); }
  static now() { return new NativeDate(fixed).getTime(); }
}
function fixture(): any {
  return { syndik_prod_syndics_v1: [{ id: 'cab', name: 'Cabinet', createdBy: 'owner', subscriptionPlan: 'starter', subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [{
    id: 'building', syndicId: 'cab', name: 'Building', address: 'Main street', city: 'Tanger', reserveFundRate: 7.5, monthlySyndicFees: 135,
    apartments: [{ id: 'lot', buildingId: 'building', number: '1', floor: 0, area: 50, tantiemes: 1000, ownerId: 'resident', tenantId: null, monthlyFees: 135 }],
    residents: [{ id: 'resident', syndicId: 'cab', buildingId: 'building', apartmentId: 'lot', name: 'Resident', email: 'resident@example.test', phone: '0600000000', isOwner: true }],
    documents: [], announcements: [], financials: { balance: 0, reserveFundBalance: 0, transactions: [], openingWorkingBalance: 0, openingReserveBalance: 0, openingBalancesRecordedAt: fixed },
  }] }], syndik_prod_charges_v1: [{ id: 'charge', buildingId: 'building', syndicId: 'cab', residentId: 'resident', apartmentId: 'lot', amount: 135, paidAmount: 0, status: 'unpaid', period: '2026-10', dueDate: '2026-10-05' }],
  syndik_prod_ag_v1: [{ id: 'meeting', buildingId: 'building', syndicId: 'cab', title: 'Meeting', status: 'planned', isVotingOpen: false, resolutions: [], attendees: [] }] };
}
const receipt = { apartmentNumber: '1', buildingName: 'Building', syndicName: 'Cabinet', residentName: 'Resident', chargeId: 'charge', buildingId: 'building', syndicId: 'cab', residentId: 'resident', apartmentId: 'lot', amount: 135, paymentId: 'payment', paymentDate: fixed, paymentMethod: 'virement', periodCovered: '2026-10' };
const cases: { name: string; operation: string; args: any[]; setup?: (s: any) => void; rejected?: boolean; steps?: {operation:string;args:any[]}[] }[] = [
  { name: 'postIncome through receipt: exact 7.5% ledger and receipt sequence', operation: 'createQuittance', args: [receipt] },
  { name: 'fractional centime receipt', operation: 'createQuittance', args: [{ ...receipt, amount: .03 }] },
  { name: 'setOpeningBalances', operation: 'setOpeningBalances', args: ['building', { working: 100.01, reserve: 50.02, reason: 'Initial balances' }], setup: s => delete s.syndik_prod_syndics_v1[0].buildings[0].financials.openingBalancesRecordedAt },
  { name: 'addBuilding', operation: 'addBuilding', args: ['cab', { name: 'Second building', address: 'Other street', city: 'Tanger', monthlySyndicFees: 100, apartments: [] }] },
  { name: 'toggleAGVoting creates canonical snapshot', operation: 'toggleAGVoting', args: ['meeting', true] },
  { name: 'closed accounting period', operation: 'createQuittance', args: [receipt], setup: s => s.__closedPeriods = { 'building:2026-10': { closedAt: fixed } }, rejected: true },
  { name: 'capacity exceeded', operation: 'addBuilding', args: ['cab', { name: 'Fifth building', address: 'Other street', city: 'Tanger', monthlySyndicFees: 100, apartments: [] }], setup: s => { const b=s.syndik_prod_syndics_v1[0].buildings[0]; for(let i=1;i<4;i++)s.syndik_prod_syndics_v1[0].buildings.push({...structuredClone(b),id:`b${i}`}); }, rejected: true },
  { name: 'frozen opening balances', operation: 'setOpeningBalances', args: ['building', { working: 1, reserve: 2, reason: 'Again' }], rejected: true },
  { name: 'closed meeting', operation: 'toggleAGVoting', args: ['meeting', true], setup: s => s.syndik_prod_ag_v1[0].status='completed', rejected: true },
  { name: 'archive building retains history', operation:'deleteBuilding', args:['building'] },
  { name: 'restore archived building', operation:'restoreArchived', args:['buildings','building'], setup:s=>s.syndik_prod_syndics_v1[0].buildings[0].archivedAt=fixed },
  { name: 'duplicate receipt does not post again or reuse a new number', operation:'createQuittance', args:[receipt], steps:[{operation:'createQuittance',args:[receipt]},{operation:'createQuittance',args:[receipt]}] },
  { name: 'second payment keeps centime accounting and increments receipt number', operation:'createQuittance',args:[receipt],steps:[{operation:'createQuittance',args:[{...receipt,amount:100}]},{operation:'createQuittance',args:[{...receipt,amount:35,paymentId:'second-payment'}]}] },
  { name: 'overpayment rejected', operation:'createQuittance',args:[{...receipt,amount:136}],rejected:true },
  { name: 'recordPayment invokes shared income posting',operation:'recordPayment',args:[{id:'invoice'},135,'virement','bank-ref'],setup:s=>s.syndik_prod_invoices_v1=[{id:'invoice',buildingId:'building',syndicId:'cab',residentId:'resident',invoiceNumber:'INV-1',totalAmount:135,paidAmount:0,status:'unpaid',chargeIds:['charge'],createdAt:fixed,dueDate:fixed}] },
  { name: 'foreign cabinet' , operation: 'addBuilding', args: ['foreign', {}], rejected: true },
];

for (const c of cases) await test(c.name, async () => {
  const initial=fixture(); c.setup?.(initial);
  const run=async (old: boolean) => {
    const dir=await mkdtemp(join(tmpdir(),'a32-parity-'));
    let sequence=0;
    const uuid=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}` as `${string}-${string}-${string}-${string}-${string}`;
    mock.method(crypto,'randomUUID',uuid); mock.method(globalThis.crypto,'randomUUID',uuid); syncBuiltinESMExports();
    globalThis.Date=Clock as DateConstructor;
    try {
      let outcome: any;
      await new FileRepository(dir).transaction(async state => {
        Object.assign(state,structuredClone(initial));
        try {
          const result=[];
          for(const [i,step] of (c.steps || [{operation:c.operation,args:c.args}]).entries()) result.push(old ? await legacy(actor,step.operation,step.args,`parity-operation-${i}`) : await createCommandService(state).runOperation(actor,step.operation,step.args,`parity-operation-${i}`));
          outcome={ result: structuredClone(result), state: structuredClone(state) };
        } catch(e: any) { outcome={ error: { message:e.message,status:e.status }, state: structuredClone(state) }; }
      });
      return outcome;
    } finally { globalThis.Date=NativeDate; mock.restoreAll(); syncBuiltinESMExports(); await rm(dir,{recursive:true,force:true}); }
  };
  const before=await run(true),after=await run(false);
  assert.equal(Boolean(before.error),Boolean(c.rejected),JSON.stringify(before.error));
  assert.deepStrictEqual(after,before);
});

await test('explicit transaction contexts remain isolated without global storage',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Global storage forbidden');}});
 try {
  const left=fixture(),right=fixture();
 right.syndik_prod_syndics_v1[0].id='other-cab'; right.syndik_prod_syndics_v1[0].buildings[0].id='other-building'; right.syndik_prod_syndics_v1[0].buildings[0].syndicId='other-cab';
 right.syndik_prod_charges_v1[0].buildingId='other-building';right.syndik_prod_charges_v1[0].syndicId='other-cab';
  const other={...actor,syndicId:'other-cab'};
  await Promise.all([
   createCommandService(left).runOperation(actor,'createQuittance',[receipt],'left-operation'),
   createCommandService(right).runOperation(other,'createQuittance',[{...receipt,buildingId:'other-building',syndicId:'other-cab'}],'right-operation'),
  ]);
  assert.equal(left.syndik_prod_quittances_v1.length,1);assert.equal(right.syndik_prod_quittances_v1.length,1);
  assert.equal(left.syndik_prod_quittances_v1[0].buildingId,'building');assert.equal(right.syndik_prod_quittances_v1[0].buildingId,'other-building');
 } finally {if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete (globalThis as any).localStorage;}
});

await test('production server bundle cannot reach the frontend service or global adapter',async()=>{
 const { build }=await import('esbuild');
 const output=await build({entryPoints:['server.ts'],bundle:true,platform:'node',format:'esm',packages:'external',write:false,metafile:true});
 for(const path of Object.keys(output.metafile!.inputs))assert.ok(!/^(firebase\/(services|cache|config|serverRuntime)\.ts|server\/domain\.ts|data\/mockData\.ts)$/.test(path),path);
});
await test('repository rolls back a failed multi-step financial mutation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'a32-rollback-'));
 try {
  const repository=new FileRepository(dir);
  await repository.transaction(async state=>{Object.assign(state,fixture());});
  const before=await repository.transaction(async state=>structuredClone(state));
  await assert.rejects(repository.transaction(async state=>{
   await createCommandService(state).runOperation(actor,'createQuittance',[receipt],'first-step');
   await createCommandService(state).runOperation(actor,'createQuittance',[{...receipt,amount:136,paymentId:'overpayment'}],'second-step');
  }));
  await repository.transaction(async state=>{
   for(const key of Object.keys(before).filter(k=>!k.startsWith('__')))assert.deepStrictEqual(state[key],before[key]);
   assert.equal(state.syndik_prod_quittances_v1,undefined);
  });
 }finally{await rm(dir,{recursive:true,force:true});}
});


// Security invariants intentionally do not compare against the vulnerable legacy oracle.
async function paidReversalFixture() {
  const state = fixture();
  await createCommandService(state).runOperation(actor, 'createQuittance', [receipt], 'c1-payment');
  return state;
}

for (const legacyReceipt of [false, true]) {
  await test(`reversal isolates cabinets and buildings (${legacyReceipt ? 'legacy charge matching' : 'identical payment references'})`, async () => {
    const state = await paidReversalFixture();
    const originalReceipt = state.syndik_prod_quittances_v1[0];
    if (legacyReceipt) delete originalReceipt.paymentId;
    const foreignCabinet = structuredClone(state.syndik_prod_syndics_v1[0]);
    foreignCabinet.id = 'cab-b';
    foreignCabinet.createdBy = 'owner-b';
    foreignCabinet.buildings[0].id = 'building-b';
    foreignCabinet.buildings[0].syndicId = 'cab-b';
    for (const lot of foreignCabinet.buildings[0].apartments) lot.buildingId = 'building-b';
    for (const resident of foreignCabinet.buildings[0].residents) {
      resident.syndicId = 'cab-b'; resident.buildingId = 'building-b';
    }
    state.syndik_prod_syndics_v1.push(foreignCabinet);
    const foreignCharge = { ...structuredClone(state.syndik_prod_charges_v1[0]),
      id: 'charge-b', syndicId: 'cab-b', buildingId: 'building-b' };
    state.syndik_prod_charges_v1.push(foreignCharge);
    for (const transaction of foreignCabinet.buildings[0].financials.transactions) {
      transaction.sourceChargeId = foreignCharge.id;
      transaction.receiptSnapshots = transaction.receiptSnapshots?.map((q: any) => ({
        ...q, id: 'receipt-b', syndicId: 'cab-b', buildingId: 'building-b', chargeId: 'charge-b',
      }));
    }
    const foreignReceipt = { ...structuredClone(originalReceipt), id: 'receipt-b',
      syndicId: 'cab-b', buildingId: 'building-b', chargeId: 'charge-b' };
    // Legacy collisions exercise both parts of the scope guard independently.
    const collisionReceipts = [
      { ...structuredClone(originalReceipt), id: 'foreign-cabinet-collision', syndicId: 'cab-b' },
      { ...structuredClone(originalReceipt), id: 'foreign-building-collision', buildingId: 'building-b' },
      { ...structuredClone(originalReceipt), id: 'missing-cabinet', syndicId: undefined },
      { ...structuredClone(originalReceipt), id: 'missing-building', buildingId: undefined },
    ];
    state.syndik_prod_quittances_v1.push(foreignReceipt, ...collisionReceipts);
    const untouched = structuredClone({ foreignCabinet, foreignCharge, foreignReceipt, collisionReceipts });
    await createCommandService(state).runOperation(actor, 'reversePayment',
      ['building', receipt.paymentId, 'Correction'], 'c1-reversal');
    assert.deepStrictEqual({
      foreignCabinet: state.syndik_prod_syndics_v1.find((s: any) => s.id === 'cab-b'),
      foreignCharge: state.syndik_prod_charges_v1.find((c: any) => c.id === 'charge-b'),
      foreignReceipt: state.syndik_prod_quittances_v1.find((q: any) => q.id === 'receipt-b'),
      collisionReceipts: state.syndik_prod_quittances_v1.filter((q: any) => collisionReceipts.some(c => c.id === q.id)),
    }, untouched);
    assert.ok(originalReceipt.voidedAt);
    assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 0);
    const financials = state.syndik_prod_syndics_v1[0].buildings[0].financials;
    assert.equal(financials.balance, 0);
    assert.equal(financials.reserveFundBalance, 0);
    assert.equal(financials.transactions.filter((t: any) => t.reversalOf === receipt.paymentId).length, 2);
  });
}

for (const field of ['syndicId', 'buildingId']) {
  for (const recordType of ['charge', 'invoice']) {
    await test(`reversal rejects an allocated ${recordType} with a foreign ${field} before mutation`, async () => {
      const state = fixture();
      const service = createCommandService(state);
      const invoice = await service.runOperation(actor, 'createInvoiceForResident',
        ['resident', 'building', 'cab'], 'c1-invoice');
      await service.runOperation(actor, 'recordPayment', [invoice, 135, 'virement', 'payment'], 'c1-pay');
      const row = recordType === 'charge' ? state.syndik_prod_charges_v1[0] : state.syndik_prod_invoices_v1[0];
      row[field] = 'foreign';
      const before = structuredClone(state);
      await assert.rejects(service.runOperation(actor, 'reversePayment',
        ['building', 'payment', 'Correction'], 'c1-reject'), { status: 409 });
      assert.deepStrictEqual(state, before);
    });
  }
}

await test('reversal rejects an invoice that does not own the allocated charge', async () => {
  const state = fixture();
  const service = createCommandService(state);
  const invoice = await service.runOperation(actor, 'createInvoiceForResident',
    ['resident', 'building', 'cab'], 'c1-invoice');
  await service.runOperation(actor, 'recordPayment', [invoice, 135, 'virement', 'payment'], 'c1-pay');
  state.syndik_prod_invoices_v1[0].chargeIds = ['unrelated-charge'];
  const before = structuredClone(state);
  await assert.rejects(service.runOperation(actor, 'reversePayment',
    ['building', 'payment', 'Correction'], 'c1-reject'), { status: 409 });
  assert.deepStrictEqual(state, before);
});

await test('reversal rejects duplicate allocations before changing a charge twice', async () => {
  const state = await paidReversalFixture();
  for (const entry of state.syndik_prod_syndics_v1[0].buildings[0].financials.transactions) {
    entry.paymentAllocations = [{ chargeId: 'charge', amount: 67.5 }, { chargeId: 'charge', amount: 67.5 }];
  }
  const before = structuredClone(state);
  await assert.rejects(createCommandService(state).runOperation(actor, 'reversePayment',
    ['building', 'payment', 'Correction'], 'c1-reject'), { status: 409 });
  assert.deepStrictEqual(state, before);
});
