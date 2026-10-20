import assert from 'node:assert/strict';
import type { Building, Charge, Syndic } from '../types';
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, String(value)),
  removeItem: (key: string) => values.delete(key), clear: () => values.clear(),
  key: (i: number) => [...values.keys()][i] ?? null, get length() { return values.size; },
} });
const svc = await import('../firebase/services');
const K = svc.STORAGE_KEYS;
const read = <T>(key: string): T => JSON.parse(values.get(key)!);
const write = (key: string, value: unknown) => values.set(key, JSON.stringify(value));
const snapshot = () => JSON.stringify([...values.entries()].sort());
const building = () => read<Syndic[]>(K.SYNDICS)[0].buildings[0];
const charges = () => read<Charge[]>(K.CHARGES);
const charge = (id = 'charge', apartmentId = 'lot', residentId = 'owner'): Charge => ({
  id, syndicId: 'cabinet', buildingId: 'building', apartmentId, residentId, amount: 100, paidAmount: 0,
  status: 'unpaid', period: '2026-10', createdAt: '2026-10-01', dueDate: '2026-11-05',
});
function reset() {
  values.clear();
  const b: Building = { id: 'building', syndicId: 'cabinet', name: 'Fixture', address: '', city: '', monthlySyndicFees: 100,
    reserveFundPercentage: 5, apartments: [{ id: 'lot', buildingId: 'building', number: '1', floor: 1, area: 80,
      ownerId: 'owner', tenantId: null, tantiemes: 1000, monthlyFees: 100 }],
    residents: [{ id: 'owner', syndicId: 'cabinet', buildingId: 'building', name: 'Owner One', email: 'owner@audit.invalid', phone: '', isOwner: true, apartmentId: 'lot' }],
    announcements: [], documents: [], financials: { balance: 1000, reserveFundBalance: 0, transactions: [] } };
  write(K.SYNDICS, [{ id: 'cabinet', createdBy: 'staff', name: 'Cabinet', subscriptionPlan: 'starter', subscriptionStatus: 'active', buildings: [b] }]);
  for (const key of [K.INVOICES, K.PROOFS, K.QUITTANCES, K.AG]) write(key, []);
  write(K.CHARGES, [charge()]);
}
const input = (amount: number, referenceNumber = 'PAYMENT-40') => ({
  chargeId: 'charge', syndicId: 'cabinet', syndicName: 'Cabinet', buildingId: 'building', buildingName: 'Fixture',
  residentId: 'owner', residentName: 'Owner One', apartmentId: 'lot', apartmentNumber: '1', amount,
  paymentDate: '2026-10-20', paymentMethod: 'virement', periodCovered: '2026-10', referenceNumber,
});
async function unchangedRejection(fn: () => Promise<unknown>) { const before = snapshot(); await assert.rejects(fn); assert.equal(snapshot(), before); }
reset();
await unchangedRejection(() => svc.createQuittance({ ...input(40), addTransactionToLedger: false }));
const receipt = await svc.createQuittance(input(40));
assert.equal(charges()[0].paidAmount, 40); assert.equal(charges()[0].status, 'unpaid');
assert.equal(building().financials.balance, 1038); assert.equal(building().financials.reserveFundBalance, 2);
const firstState = snapshot(); assert.equal((await svc.createQuittance(input(40))).id, receipt.id); assert.equal(snapshot(), firstState);
await unchangedRejection(() => svc.createQuittance(input(41)));
await unchangedRejection(() => svc.createQuittance(input(61, 'OVERPAY')));
await unchangedRejection(() => svc.createQuittance({ ...input(10, 'OTHER'), residentId: 'intruder' }));
write(K.QUITTANCES, []); const financialBefore = JSON.stringify(building().financials);
assert.equal((await svc.createQuittance(input(40))).id, receipt.id); assert.equal(charges()[0].paidAmount, 40);
assert.equal(JSON.stringify(building().financials), financialBefore);
await svc.createQuittance(input(60, 'NEXT-PAYMENT'));
assert.equal(charges()[0].paidAmount, 100); assert.equal(charges()[0].status, 'paid');
assert.equal(building().financials.balance, 1095); assert.equal(building().financials.reserveFundBalance, 5);
write(K.QUITTANCES, []); const settled = JSON.stringify(building().financials);
await svc.generateQuittanceForCharge('charge'); assert.equal(JSON.stringify(building().financials), settled);
console.log('PASS: manual retry identity, conflicting reuse, overpayment, reserve split and missing receipt recovery.');

reset();
const proof = await svc.submitPaymentProof({ chargeId: 'charge', syndicId: 'cabinet', buildingId: 'building', residentId: 'owner',
  residentName: 'Owner One', apartmentId: 'lot', apartmentNumber: '1', amount: 150, paymentMethod: 'virement', bankName: 'Fixture', referenceNumber: 'PROOF-150' });
await unchangedRejection(() => svc.reviewPaymentProof(proof.id, 'approved'));
assert.equal(read<import('../types').PaymentProof[]>(K.PROOFS)[0].status, 'pending');
const wrong = await svc.submitPaymentProof({ chargeId: 'charge', buildingId: 'building', residentId: 'intruder', residentName: 'Intruder',
  apartmentId: 'lot', apartmentNumber: '1', amount: 100, paymentMethod: 'virement', bankName: 'Fixture', referenceNumber: 'WRONG-PAYER' });
await unchangedRejection(() => svc.reviewPaymentProof(wrong.id, 'approved'));
console.log('PASS: proof ownership and overpayment are rejected before state changes.');

reset();
const b = building();
b.apartments.push({ ...b.apartments[0], id: 'lot-10', number: '10', ownerId: 'owner-10' });
b.residents.push({ ...b.residents[0], id: 'owner-10', name: 'Owner Ten', email: 'ten@audit.invalid', apartmentId: 'lot-10' });
write(K.SYNDICS, [{ ...read<Syndic[]>(K.SYNDICS)[0], buildings: [b] }]);
write(K.CHARGES, [charge(), charge('charge-10', 'lot-10', 'owner-10')]);
const row = { date: '2026-10-20', label: 'VIREMENT LOT 10', amount: 100, reference: 'BANK-CREDIT-10' };
const matched = await svc.reconcileBankStatementCSV('building', [row]); assert.equal(matched.matchedCount, 1);
assert.equal(charges().find((c) => c.apartmentId === 'lot-10')?.paidAmount, 100); assert.equal(charges()[0].paidAmount, 0);
assert.equal((await svc.reconcileBankStatementCSV('building', [row])).matchedCount, 0);
assert.equal((await svc.reconcileBankStatementCSV('building', [{ ...row, reference: 'DEBIT', amount: -100 }])).matchedCount, 0);
assert.equal((await svc.reconcileBankStatementCSV('building', [{ ...row, label: 'LOT 1', reference: 'EXCESS', amount: 1000 }])).matchedCount, 0);
console.log('PASS: exact lot identifiers, debit rejection, amount matching and bank-reference reimport.');

reset();
const invoice = await svc.createInvoiceForResident('owner', 'building', 'cabinet');
assert.equal((await svc.createInvoiceForResident('owner', 'building', 'cabinet')).id, invoice.id);
await svc.recordPayment({ ...invoice, paidAmount: 999 }, 60, 'virement', 'INVOICE-60');
await svc.recordPayment({ ...invoice, paidAmount: 0 }, 40, 'virement', 'INVOICE-40');
assert.equal(read<import('../types').Invoice[]>(K.INVOICES)[0].paidAmount, 100); assert.equal(charges()[0].paidAmount, 100);
assert.equal(building().financials.balance, 1095); assert.equal(building().financials.reserveFundBalance, 5);
const invoiceState = snapshot(); await svc.recordPayment(invoice, 40, 'virement', 'INVOICE-40'); assert.equal(snapshot(), invoiceState);
await unchangedRejection(() => svc.recordPayment(invoice, 41, 'virement', 'INVOICE-40'));
await unchangedRejection(() => svc.recordPayment(invoice, 1, 'virement', 'INVOICE-OVERPAY'));
console.log('PASS: stored invoice authority, unique charge linking, idempotency and reserve reconciliation.');

reset(); await svc.createInvoiceForResident('owner', 'building', 'cabinet');
await svc.createQuittance(input(40));
assert.equal(read<import('../types').Invoice[]>(K.INVOICES)[0].paidAmount, 40);
const remaining = await svc.submitPaymentProof({ chargeId: 'charge', syndicId: 'cabinet', buildingId: 'building', residentId: 'owner', residentName: 'Owner One',
  apartmentId: 'lot', apartmentNumber: '1', amount: 60, paymentMethod: 'virement', bankName: 'Fixture', referenceNumber: 'INVOICE-PROOF' });
await svc.reviewPaymentProof(remaining.id, 'approved');
assert.equal(read<import('../types').Invoice[]>(K.INVOICES)[0].paidAmount, 100); assert.equal(charges()[0].paidAmount, 100);
const proofBalance = JSON.stringify(building().financials); write(K.QUITTANCES, []);
await svc.reviewPaymentProof(remaining.id, 'approved'); assert.equal(JSON.stringify(building().financials), proofBalance);
assert.equal(charges()[0].paidAmount, 100);
console.log('PASS: manual and proof payments update the linked invoice; proof receipt recovery never posts twice.');
