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

function ownershipFixture() {
  const state = fixture();
  const b = state.syndik_prod_syndics_v1[0].buildings[0];
  b.apartments.push({ ...b.apartments[0], id: 'second-lot', number: '2' });
  b.residents.push({ ...b.residents[0], id: 'new-owner', apartmentId: undefined, name: 'New owner', email: 'new@example.test' });
  return { state, b };
}

await test('resident profile edits preserve multiple owned lots and frozen financial/voting history', async () => {
  const { state, b } = ownershipFixture();
  const service = createCommandService(state);
  await service.runOperation(actor, 'toggleAGVoting', ['meeting', true], 'c2-freeze');
  const apartments = structuredClone(b.apartments);
  const charges = structuredClone(state.syndik_prod_charges_v1);
  const assemblies = structuredClone(state.syndik_prod_ag_v1);
  await service.runOperation(actor, 'updateResident', [{ ...b.residents[0], name: 'Updated name', phone: '0612345678' }], 'c2-operation');
  const updated = state.syndik_prod_syndics_v1[0].buildings[0];
  assert.equal(updated.residents[0].phone, '0612345678');
  assert.deepStrictEqual(updated.apartments, apartments);
  assert.deepStrictEqual(state.syndik_prod_charges_v1, charges);
  assert.deepStrictEqual(state.syndik_prod_ag_v1, assemblies);
  const { apartmentId, ...withoutPrimary } = updated.residents[0];
  await service.runOperation(actor, 'updateResident', [{ ...withoutPrimary, phone: '0699999999' }], 'c2-operation');
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].residents[0].apartmentId, apartmentId);
  assert.deepStrictEqual(state.syndik_prod_syndics_v1[0].buildings[0].apartments, apartments);
});

await test('resident creation cannot silently replace an occupied owner or tenant', async () => {
  for (const isOwner of [true, false]) {
    const { state, b } = ownershipFixture();
    if (!isOwner) b.apartments[0].tenantId = 'existing-tenant';
    const before = structuredClone(state);
    await assert.rejects(createCommandService(state).runOperation(actor, 'addResident', [{
      ...b.residents[1], id: undefined, apartmentId: 'lot', isOwner,
    }, true], 'c2-operation'), /Lot déjà occupé/);
    assert.deepStrictEqual(state, before);
  }
});

await test('resident update cannot assign, clear, or change ownership role', async () => {
  for (const change of [{ apartmentId: 'lot' }, { isOwner: false }]) {
    const { state, b } = ownershipFixture();
    const before = structuredClone(state);
    await assert.rejects(createCommandService(state).runOperation(actor, 'updateResident', [{ ...b.residents[1], ...change }], 'c2-operation'), /affectation explicite/);
    assert.deepStrictEqual(state, before);
  }
  const { state, b } = ownershipFixture();
  await assert.rejects(createCommandService(state).runOperation(actor, 'updateResident', [{ ...b.residents[0], apartmentId: '' }], 'c2-operation'), /affectation explicite/);
});

await test('explicit ownership transfer preserves other lots, charges and frozen assembly snapshots', async () => {
  const { state, b } = ownershipFixture();
  const service = createCommandService(state);
  await service.runOperation(actor, 'toggleAGVoting', ['meeting', true], 'c2-freeze');
  const charges = structuredClone(state.syndik_prod_charges_v1);
  const assemblies = structuredClone(state.syndik_prod_ag_v1);
  await service.runOperation(actor, 'assignApartmentOwner', [{ buildingId: 'building', apartmentId: 'lot', residentId: 'new-owner', expectedOwnerId: 'resident', reason: 'Sale completed' }], 'c2-operation');
  assert.equal(b.apartments[0].ownerId, 'new-owner');
  assert.equal(b.apartments[1].ownerId, 'resident');
  assert.equal(b.residents[0].apartmentId, 'second-lot');
  assert.equal(b.residents[1].apartmentId, 'lot');
  assert.deepStrictEqual(state.syndik_prod_charges_v1, charges);
  assert.deepStrictEqual(state.syndik_prod_ag_v1, assemblies);
});

await test('ownership assignment rejects stale, unscoped, archived and unauthorized requests', async () => {
  for (const scenario of ['stale', 'foreign', 'archived', 'unauthorized', 'missing-expectation']) {
    const { state, b } = ownershipFixture();
    const input: any = { buildingId: 'building', apartmentId: 'lot', residentId: 'new-owner', expectedOwnerId: 'resident', reason: 'Sale completed' };
    if (scenario === 'stale') input.expectedOwnerId = null;
    if (scenario === 'foreign') b.residents[1].syndicId = 'other-cab';
    if (scenario === 'archived') b.residents[1].archivedAt = fixed;
    if (scenario === 'missing-expectation') delete input.expectedOwnerId;
    const before = structuredClone(state);
    await assert.rejects(createCommandService(state).runOperation(scenario === 'unauthorized' ? { ...actor, uid: 'stranger', role: 'resident' } : actor, 'assignApartmentOwner', [input], 'c2-operation'));
    assert.deepStrictEqual(state, before);
  }
});

await test('explicit assignment adds another lot without moving existing ownership', async () => {
  const { state, b } = ownershipFixture();
  b.apartments[1].ownerId = null;
  await createCommandService(state).runOperation(actor, 'assignApartmentOwner', [{ buildingId: 'building', apartmentId: 'second-lot', residentId: 'resident', expectedOwnerId: null, reason: 'Additional lot acquired' }], 'c2-operation');
  assert.ok(b.apartments.every((a: any) => a.ownerId === 'resident'));
  assert.equal(b.residents[0].apartmentId, 'lot');
});


for (const source of ['csv', 'proof']) {
  async function postBankDate(state: any, date: string, options: any = {}) {
    const service = createCommandService(state);
    if (source === 'csv') return service.runOperation(actor, 'reconcileBankStatementCSV', ['building', [
      { date, label: 'LOT 1', amount: 135, reference: 'H1-BANK' },
    ], options], 'h1-csv');
    const proof = await service.runOperation(actor, 'submitPaymentProof', [{ ...receipt,
      bankTransactionDate: date, bankName: 'Bank', referenceNumber: 'H1-BANK',
    }], 'h1-submit');
    return service.runOperation(actor, 'reviewPaymentProof', [proof.id, 'approved', undefined, options], 'h1-approve');
  }
  await test(`${source}: actual September bank date survives later submission and posting`, async () => {
    const state = fixture();
    await postBankDate(state, '2026-09-20');
    const q = state.syndik_prod_quittances_v1[0];
    assert.equal(q.bankTransactionDate, '2026-09-20');
    assert.equal(q.paymentDate, '2026-09-20');
    assert.equal(q.postingDate, '2026-09-20');
    assert.ok(q.submissionDate);
    assert.notEqual(q.submissionDate, q.bankTransactionDate);
    for (const t of state.syndik_prod_syndics_v1[0].buildings[0].financials.transactions) {
      assert.equal(t.bankTransactionDate, q.bankTransactionDate);
      assert.equal(t.date, q.postingDate);
      assert.equal(t.postingDate, q.postingDate);
      assert.equal(t.submissionDate, q.submissionDate);
    }
  });
  await test(`${source}: closed bank period rejects silent posting, accepts audited adjustment`, async () => {
    for (const options of [{}, { postingDate: '2026-10-27' }, { postingDate: '2026-09-25', priorPeriodAdjustmentReason: 'Late statement' }]) {
      const state = fixture();
      state.__closedPeriods = { 'building:2026-09': { closedAt: fixed } };
      await assert.rejects(postBankDate(state, '2026-09-20', options), /clôturée|Ajustement explicite/);
      assert.equal(state.syndik_prod_quittances_v1?.length || 0, 0);
      assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 0);
      assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.transactions.length, 0);
    }
    const state = fixture();
    state.__closedPeriods = { 'building:2026-09': { closedAt: fixed } };
    await postBankDate(state, '2026-09-20', { postingDate: '2026-10-27', priorPeriodAdjustmentReason: 'Late September statement received' });
    const q = state.syndik_prod_quittances_v1[0];
    assert.equal(q.bankTransactionDate, '2026-09-20');
    assert.equal(q.postingDate, '2026-10-27');
    assert.equal(q.paymentDate, '2026-09-20');
    assert.equal(state.syndik_prod_audit_v1.filter((a: any) => a.operation === 'priorPeriodPaymentAdjustment').length, 1);
    assert.equal(state.syndik_prod_audit_v1.find((a: any) => a.operation === 'priorPeriodPaymentAdjustment').detail.reason, 'Late September statement received');
  });
  await test(`${source}: malformed or impossible bank dates fail without posting`, async () => {
    for (const date of ['2026-02-30', '31/04/2026', '20 September 2026', '', '2026-09-20T25:00:00Z']) {
      const state = fixture();
      await assert.rejects(postBankDate(state, date), /Date bancaire invalide/);
      assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 0);
    }
  });
}
await test('CSV preview exposes bank and posting dates without writing payment records', async () => {
  const state = fixture();
  const before = structuredClone(state);
  const preview = await createCommandService(state).runOperation(actor, 'reconcileBankStatementCSV', ['building', [
    { date: '20/09/2026', label: 'LOT 1', amount: 135 },
  ], { preview: true }], 'h1-preview');
  assert.equal(preview.preview[0].bankTransactionDate, '2026-09-20');
  assert.equal(preview.preview[0].postingDate, '2026-09-20');
  assert.deepEqual(state, before);
});

await test('an open historical bank period is usable even when the current month is closed', async () => {
  const state = fixture();
  state.__closedPeriods = { [`building:${new Date().toISOString().slice(0, 7)}`]: { closedAt: fixed } };
  await createCommandService(state).runOperation(actor, 'reconcileBankStatementCSV', ['building', [
    { date: '2025-09-20', label: 'LOT 1', amount: 135, reference: 'H1-OPEN-HISTORY' },
  ]], 'h1-open-history');
  assert.equal(state.syndik_prod_quittances_v1[0].postingDate, '2025-09-20');
});

await test('legacy proofs retain unknown bank date and use their submission date for accounting', async () => {
  const state = fixture();
  state.syndik_prod_proofs_v1 = [{ ...receipt, id: 'legacy-proof', status: 'pending', submissionDate: '2026-09-20T10:00:00.000Z' }];
  await createCommandService(state).runOperation(actor, 'reviewPaymentProof', ['legacy-proof', 'approved'], 'h1-legacy');
  const q = state.syndik_prod_quittances_v1[0];
  assert.equal(q.bankTransactionDate, undefined);
  assert.equal(q.postingDate, '2026-09-20');
  assert.equal(q.submissionDate, '2026-09-20T10:00:00.000Z');
});

await test('CSV date validation is atomic across all rows and canonical dates deduplicate retries', async () => {
  const state = fixture();
  const service = createCommandService(state);
  const before = structuredClone(state);
  await assert.rejects(service.runOperation(actor, 'reconcileBankStatementCSV', ['building', [
    { date: '20/09/2026', label: 'LOT 1', amount: 135 },
    { date: '2026-02-30', label: 'LOT 2', amount: 135 },
  ]], 'h1-invalid-batch'), /Date bancaire invalide/);
  assert.deepEqual(state, before);
  await service.runOperation(actor, 'reconcileBankStatementCSV', ['building', [
    { date: '20/09/2026', label: 'LOT 1', amount: 135 },
  ]], 'h1-import');
  const payments = structuredClone(state.syndik_prod_quittances_v1);
  await service.runOperation(actor, 'reconcileBankStatementCSV', ['building', [
    { date: '2026-09-20', label: 'LOT 1', amount: 135 },
  ]], 'h1-reimport');
  assert.deepEqual(state.syndik_prod_quittances_v1, payments);
});

await test('proof receipt recovery preserves dates after its accounting period closes', async () => {
  const state = fixture();
  state.syndik_prod_proofs_v1 = [{ ...receipt, id: 'historical-proof', status: 'pending',
    bankTransactionDate: '2026-09-20', submissionDate: '2026-10-27T10:00:00.000Z' }];
  const service = createCommandService(state);
  await service.runOperation(actor, 'reviewPaymentProof', ['historical-proof', 'approved'], 'h1-original');
  const original = structuredClone(state.syndik_prod_quittances_v1[0]);
  const ledger = structuredClone(state.syndik_prod_syndics_v1[0].buildings[0].financials);
  state.syndik_prod_quittances_v1 = [];
  state.__closedPeriods = { 'building:2026-09': { closedAt: fixed } };
  await service.runOperation(actor, 'reviewPaymentProof', ['historical-proof', 'approved'], 'h1-recovery');
  assert.deepEqual(state.syndik_prod_quittances_v1[0], original);
  assert.deepEqual(state.syndik_prod_syndics_v1[0].buildings[0].financials, ledger);
});
