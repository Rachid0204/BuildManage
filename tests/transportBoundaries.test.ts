import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import ts from 'typescript';
import {
  CommandEnvelopeSchema,
  parseBackendCommand,
} from '../server/domain/commandContracts';
import { WireResponseSchema, sanitizeSnapshot } from '../firebase/wire';

test('all browser entry paths exclude the legacy oracle and data SDKs', async () => {
  const result = await build({
    entryPoints: ['index.tsx'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
    outdir: '/tmp/a3-client-graph',
    loader: { '.css': 'empty' },
  });
  for (const path of Object.keys(result.metafile!.inputs)) {
    assert.ok(
      !/(^|\/)(tests\/fixtures|server\/domain|firebase\/(legacyClient|serverRuntime))/.test(
        path,
      ),
      path,
    );
    assert.ok(
      !/node_modules\/@firebase\/(firestore|functions|storage)(\/|$)/.test(
        path,
      ),
      path,
    );
  }
});

test('client and dispatch boundaries contain no explicit any or TypeScript suppression', () => {
  for (const path of [
    'firebase/services.ts',
    'firebase/transport.ts',
    'firebase/wire.ts',
    'server/domain/context.ts',
    'server/domain/dispatch.ts',
    'server/domain/commandContracts.ts',
    'shared/api/commands.ts',
  ]) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /@ts-(ignore|nocheck)/, path);
    const file = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, path);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.equal(
    JSON.parse(readFileSync('tsconfig.json', 'utf8')).compilerOptions.strict,
    true,
  );
});

test('command framing rejects unknown operations, internal helpers and malformed tuples', () => {
  const operationId = 'op:fixture:20261029';
  assert.equal(
    CommandEnvelopeSchema.safeParse({
      operation: 'postIncome',
      args: [],
      operationId,
    }).success,
    false,
  );
  assert.equal(
    CommandEnvelopeSchema.safeParse({
      operation: 'saveSyndic',
      args: {},
      operationId,
    }).success,
    false,
  );
  assert.throws(() => parseBackendCommand('constructor', []));
  assert.throws(() => parseBackendCommand('postIncome', []));
  assert.throws(() => parseBackendCommand('addAnnouncement', [123, {}]));
  assert.throws(() =>
    parseBackendCommand('addAnnouncement', ['building', 'invalid']),
  );
  assert.throws(() =>
    parseBackendCommand('deleteBuilding', ['building', 'extra']),
  );
  assert.deepEqual(
    parseBackendCommand('approvePaymentProofsBatch', ['building']),
    {
      operation: 'approvePaymentProofsBatch',
      args: ['building', undefined],
    },
  );
});

test('wire parsing rejects malformed envelopes and snapshots discard credential material', () => {
  assert.equal(
    WireResponseSchema.safeParse({ ok: 'yes', store: [] }).success,
    false,
  );
  assert.equal(
    WireResponseSchema.safeParse({
      ok: true,
      result: { id: 'result' },
      revision: 2,
    }).success,
    true,
  );
  assert.deepEqual(
    sanitizeSnapshot({
      residents: [
        {
          id: 'resident',
          name: 'Owner',
          password: 'secret',
          passwordHash: 'hash',
          generatedPassword: 'secret',
          invitationCode: 'code',
          invitationToken: 'token',
        },
      ],
    }),
    { residents: [{ id: 'resident', name: 'Owner' }] },
  );
});


test('server entry cannot import browser transport or test-only adapters', async () => {
  const result = await build({entryPoints: ['server.ts'], bundle: true, platform: 'node',
    format: 'esm', packages: 'external', write: false, metafile: true});
  for (const path of Object.keys(result.metafile!.inputs)) {
    assert.ok(!/(^|\/)(tests\/fixtures|firebase\/(services|transport|cache|legacyClient|serverRuntime))/.test(path), path);
  }
});
