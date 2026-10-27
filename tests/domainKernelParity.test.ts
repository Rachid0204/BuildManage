import assert from 'node:assert/strict';
import * as legacy from './fixtures/a31/legacyFinance';
import * as kernel from '../shared/domain/money';
import { computeBuildingFinancialBalances } from '../shared/domain/balances';
import { evaluateResolutionStatus, canonicalQuorum, legacyQuorum, presentVotingWeight } from '../shared/domain/voting';
import { evaluateResolutionStatus as oldStatus } from './fixtures/a31/legacyVoting';
import { getBuildingCapacity } from '../shared/domain/subscription';
import { getBuildingCapacity as oldCapacity } from './fixtures/a31/legacyCapacity';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
let checks = 0;
function equal(a: unknown, b: unknown) { assert.deepStrictEqual(a,b); checks++; }
// Independent frozen references retain the pre-extraction algorithms, not aliases
// to the shared kernel. Historical allocations must not use today's reserve rate.
for (const rate of [undefined, 0, .125, 7.5, 100, -1, NaN]) {
  const building = { reserveFundRate: rate, reserveFundPercentage: 12.5 };
  equal(kernel.getBuildingReserveRate(building), legacy.getBuildingReserveRate(building));
  for (const reserve of [undefined, 0, .01, 1.01]) {
    const receipt = { amount: 1.01, reserveRateApplied: rate, reserveFundAmount: reserve };
    equal(kernel.getRecordedReserveSplit(receipt), legacy.getRecordedReserveSplit(receipt));
    const receipts = [receipt, { ...receipt, voidedAt: 'historical' }] as any;
    equal(kernel.getRecordedReserveTotal(receipts, 1.01), legacy.getRecordedReserveTotal(receipts, 1.01));
  }
}
for (const amount of [0, .01, .03, .1, 1.005, 12.99, 9999.99]) {
  for (const rate of [0, .125, 5, 7.5, 33.333, 100, -1, NaN]) {
    equal(kernel.splitChargeReserveAndOperating(amount,rate),legacy.splitChargeReserveAndOperating(amount,rate));
  }
  for (const weights of [[1,1,1],[.125,.375,1.5],[0,2,3]]) {
    const lots=weights.map((tantiemes,i)=>({id:String(i),tantiemes}));
    equal(kernel.allocateBudgetInCentimes(amount,lots),legacy.allocateBudgetInCentimes(amount,lots));
  }
}
for (const opening of [undefined,0,10.01,-12.34]) {
  for (const balance of [undefined,0,150.23]) {
    const building:any={financials:{openingWorkingBalance:opening,openingBalance:99,openingReserveBalance:opening,balance,reserveFundBalance:balance,transactions:[{amount:1.005,type:'income'},{amount:2.01,type:'expense'},{amount:.15,type:'income',fundType:'reserve'}]}};
    equal(computeBuildingFinancialBalances(building),legacy.computeBuildingFinancialBalances(building));
    delete building.financials.openingBalance;
    equal(computeBuildingFinancialBalances(building),legacy.computeBuildingFinancialBalances(building));
  }
}
for (const majorityType of ['simple','absolute','absolue_25','unanimity','unanimite','three_quarters','trois_quarts_26']) {
  for (const totalTantiemes of [1000,1000.5,3.125]) for (const quorumReached of [true,false]) for (const votesFor of [0,.125,500,501,750,1000]) {
    const res:any={majorityType,votesFor,votesAgainst:.375,votesAbstain:.125};
    const ag:any={totalTantiemes,quorumReached};
    equal(evaluateResolutionStatus(res,ag),oldStatus(res,ag));
  }
}
for (const subscriptionPlan of ['starter','professional','enterprise'] as const) for(const count of [0,4,8,9,10000]) {
  const cabinet={subscriptionPlan,buildings:Array.from({length:count},(_,i)=>({id:String(i),archivedAt:i%3===0?'old':undefined}))};
  equal(getBuildingCapacity(cabinet),oldCapacity(cabinet));
}
for (const total of [0, .125, 3.5, 1000, 1000.5]) {
  equal(canonicalQuorum(total), Math.floor(total / 2) + 1);
  equal(legacyQuorum(total), Math.ceil((total || 1000) / 2));
}
const historical = [{status:'present',tantiemes:.125},{status:'represented',tantiemes:.375},{status:'absent',tantiemes:999}];
equal(presentVotingWeight(historical), .5);
for(const file of readdirSync('shared/domain').filter(f=>f.endsWith('.ts'))) {
  const source = ts.createSourceFile(file, readFileSync(`shared/domain/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      assert.ok(node.importClause?.isTypeOnly, `${file}: only erased type imports are allowed`);
      assert.equal((node.moduleSpecifier as ts.StringLiteral).text, '../../types');
    }
    if (ts.isIdentifier(node)) {
      assert.ok(!['window', 'localStorage', 'document', 'req', 'res', 'fetch', 'Date', 'crypto', 'require'].includes(node.text), `${file}: impure dependency ${node.text}`);
    }
    if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, `${file}: dynamic import`);
    if (ts.isPropertyAccessExpression(node)) assert.notEqual(node.getText(source), 'Math.random', `${file}: implicit randomness`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  checks++;
}
console.log(`A3.1 parity: ${checks}/${checks} passed`);

