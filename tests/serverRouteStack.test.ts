import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');

type StackEntry =
  | {
      index: number;
      kind: 'middleware';
      name: string;
      path: string | null;
    }
  | {
      index: number;
      kind: 'route';
      methods: string[];
      path: string;
      handlers: number;
    };

/**
 * Exact baseline Express 5 middleware & route stack captured from unmodified main server.ts
 * before splitting server.ts into server/routes/* modules.
 * Route order, middleware order, HTTP methods, paths, and per-route handler counts must stay identical.
 */
const EXPECTED_PRODUCTION_AND_TEST_STACK: StackEntry[] = [
  { index: 0, kind: 'middleware', name: '<anonymous>', path: null },
  { index: 1, kind: 'middleware', name: '<anonymous>', path: null },
  { index: 2, kind: 'middleware', name: '<anonymous>', path: null },
  { index: 3, kind: 'middleware', name: '<anonymous>', path: null },
  { index: 4, kind: 'middleware', name: '<anonymous>', path: null },
  { index: 5, kind: 'middleware', name: 'bodyParserErrorHandler', path: null },
  { index: 6, kind: 'route', methods: ['POST'], path: '/api/csp-report', handlers: 1 },
  { index: 7, kind: 'middleware', name: '<anonymous>', path: null },
  { index: 8, kind: 'route', methods: ['POST'], path: '/api/auth/recovery/request', handlers: 2 },
  { index: 9, kind: 'route', methods: ['POST'], path: '/api/auth/verification/request', handlers: 1 },
  { index: 10, kind: 'route', methods: ['POST'], path: '/api/auth/recovery/complete', handlers: 2 },
  { index: 11, kind: 'route', methods: ['GET'], path: '/api/events', handlers: 1 },
  { index: 12, kind: 'middleware', name: '<anonymous>', path: null },
  { index: 13, kind: 'route', methods: ['GET'], path: '/api/health', handlers: 1 },
  { index: 14, kind: 'route', methods: ['GET'], path: '/api/devices/push-token', handlers: 1 },
  { index: 15, kind: 'route', methods: ['POST'], path: '/api/devices/push-token', handlers: 1 },
  { index: 16, kind: 'route', methods: ['DELETE'], path: '/api/devices/push-token', handlers: 1 },
  { index: 17, kind: 'route', methods: ['GET'], path: '/api/account/deletion-request', handlers: 1 },
  { index: 18, kind: 'route', methods: ['POST'], path: '/api/account/deletion-request', handlers: 1 },
  { index: 19, kind: 'route', methods: ['DELETE'], path: '/api/account/deletion-request', handlers: 1 },
  { index: 20, kind: 'route', methods: ['POST'], path: '/api/auth/login', handlers: 2 },
  { index: 21, kind: 'route', methods: ['POST'], path: '/api/auth/firebase-session', handlers: 2 },
  { index: 22, kind: 'route', methods: ['POST'], path: '/api/auth/register', handlers: 1 },
  { index: 23, kind: 'route', methods: ['POST'], path: '/api/auth/change-password', handlers: 1 },
  { index: 24, kind: 'route', methods: ['POST'], path: '/api/ag/vote', handlers: 1 },
  { index: 25, kind: 'route', methods: ['GET'], path: '/api/shared-state', handlers: 1 },
  { index: 26, kind: 'route', methods: ['POST'], path: '/api/uploads', handlers: 1 },
  { index: 27, kind: 'route', methods: ['POST'], path: '/api/subscription/upload-proof', handlers: 1 },
  { index: 28, kind: 'route', methods: ['GET'], path: '/api/uploads/:fileId', handlers: 1 },
  { index: 29, kind: 'route', methods: ['GET'], path: '/api/subscription/billing-config', handlers: 1 },
  { index: 30, kind: 'route', methods: ['GET'], path: '/api/admin/billing-config', handlers: 1 },
  { index: 31, kind: 'route', methods: ['PUT'], path: '/api/admin/billing-config', handlers: 1 },
  { index: 32, kind: 'route', methods: ['POST'], path: '/api/admin/billing-config/test-paypal', handlers: 1 },
  { index: 33, kind: 'route', methods: ['POST'], path: '/api/admin/billing-config/test-cmi', handlers: 1 },
  { index: 34, kind: 'route', methods: ['POST'], path: '/api/subscription/validate-promo', handlers: 1 },
  { index: 35, kind: 'route', methods: ['POST'], path: '/api/subscription/paypal/create-order', handlers: 1 },
  { index: 36, kind: 'route', methods: ['POST'], path: '/api/subscription/paypal/capture-order', handlers: 1 },
  { index: 37, kind: 'route', methods: ['POST'], path: '/api/webhooks/paypal', handlers: 1 },
  { index: 38, kind: 'route', methods: ['POST'], path: '/api/subscription/cmi/create-payment', handlers: 1 },
  { index: 39, kind: 'route', methods: ['POST'], path: '/api/subscription/cmi/return', handlers: 1 },
  { index: 40, kind: 'route', methods: ['GET'], path: '/api/subscription/cmi/return', handlers: 1 },
  { index: 41, kind: 'route', methods: ['POST'], path: '/api/webhooks/cmi', handlers: 1 },
  { index: 42, kind: 'route', methods: ['GET'], path: '/api/admin/promos', handlers: 1 },
  { index: 43, kind: 'route', methods: ['PUT'], path: '/api/admin/legal-framework', handlers: 1 },
  { index: 44, kind: 'route', methods: ['POST'], path: '/api/admin/promos', handlers: 1 },
  { index: 45, kind: 'route', methods: ['PATCH'], path: '/api/admin/promos/:id', handlers: 1 },
  { index: 46, kind: 'route', methods: ['DELETE'], path: '/api/admin/promos/:id', handlers: 1 },
  { index: 47, kind: 'route', methods: ['GET'], path: '/api/admin/audit-logs', handlers: 1 },
  { index: 48, kind: 'route', methods: ['GET'], path: '/api/admin/gateway-events', handlers: 1 },
  { index: 49, kind: 'route', methods: ['POST'], path: '/api/admin/cabinets/:id/send-reminder', handlers: 1 },
  { index: 50, kind: 'route', methods: ['POST'], path: '/api/operations/status', handlers: 1 },
  { index: 51, kind: 'route', methods: ['POST'], path: '/api/commands', handlers: 1 },
  { index: 52, kind: 'route', methods: ['GET'], path: '/api/auth/session', handlers: 1 },
  { index: 53, kind: 'route', methods: ['POST'], path: '/api/auth/logout', handlers: 1 },
  { index: 54, kind: 'route', methods: ['GET'], path: '/api/legal-framework', handlers: 1 },
  { index: 55, kind: 'route', methods: ['GET'], path: '/api/reports', handlers: 1 },
  { index: 56, kind: 'route', methods: ['GET'], path: '/api/archives', handlers: 1 },
  { index: 57, kind: 'route', methods: ['GET'], path: '/api/ready', handlers: 1 },
  { index: 58, kind: 'route', methods: ['GET'], path: '/api/diagnostics', handlers: 1 },
  { index: 59, kind: 'route', methods: ['POST'], path: '/api/jobs/lifecycle', handlers: 1 },
  { index: 60, kind: 'route', methods: ['POST'], path: '/api/jobs/monthly-charges', handlers: 1 },
  { index: 61, kind: 'route', methods: ['GET'], path: '/api/billing-runs', handlers: 1 },
  { index: 62, kind: 'route', methods: ['POST'], path: '/api/billing-runs/retry', handlers: 1 },
  { index: 63, kind: 'route', methods: ['POST'], path: '/api/jobs/outbox', handlers: 1 },
  { index: 64, kind: 'route', methods: ['POST'], path: '/api/jobs/overdue', handlers: 1 },
  { index: 65, kind: 'route', methods: ['POST'], path: '/api/shared-state', handlers: 1 },
  { index: 66, kind: 'route', methods: ['POST'], path: '/api/shared-state/reset', handlers: 1 },
  { index: 67, kind: 'middleware', name: 'serveStatic', path: null },
  { index: 68, kind: 'route', methods: ['GET'], path: '*all', handlers: 1 },
];

function inspectServerStack(nodeEnv: 'test' | 'development'): StackEntry[] {
  const dataDir = mkdtempSync(join(tmpdir(), `buildmanage-route-stack-${nodeEnv}-`));
  const probeScript = `
    import express from 'express';
    express.application.listen = function () {
      const stack = this.router.stack.map((layer, index) => {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods)
            .filter((m) => layer.route.methods[m])
            .map((m) => m.toUpperCase())
            .sort();
          return {
            index,
            kind: 'route',
            methods,
            path: layer.route.path,
            handlers: layer.route.stack.length,
          };
        }
        return {
          index,
          kind: 'middleware',
          name: layer.name || '<anonymous>',
          path: layer.path ?? null,
        };
      });
      process.stdout.write('__STACK_JSON__' + JSON.stringify(stack) + '\\n');
      process.exit(0);
    };
    await import('./server.ts');
  `;
  try {
    const out = execFileSync(
      process.execPath,
      ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', '--input-type=module', '-e', probeScript],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 25_000,
        env: {
          ...process.env,
          NODE_ENV: nodeEnv,
          SYNDIK_STATE_BACKEND: 'file',
          SYNDIK_DATA_DIR: dataDir,
          SYNDIK_SERVER_SECRET: 'synthetic-route-stack-secret-0123456789abcdef',
          FIREBASE_SERVICE_ACCOUNT_JSON: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const markerLine = out.split('\n').find((line) => line.startsWith('__STACK_JSON__'));
    assert.ok(markerLine, `Expected __STACK_JSON__ marker in probe output, got: ${out}`);
    return JSON.parse(markerLine.slice('__STACK_JSON__'.length)) as StackEntry[];
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('Express middleware and route stack order, methods, paths and positions match baseline identically', () => {
  const testStack = inspectServerStack('test');
  assert.equal(testStack.length, 69);
  assert.equal(testStack.filter((entry) => entry.kind === 'route').length, 60);
  assert.deepEqual(testStack, EXPECTED_PRODUCTION_AND_TEST_STACK);

  const devStack = inspectServerStack('development');
  assert.equal(devStack.length, 68);
  assert.deepEqual(devStack.slice(0, 67), EXPECTED_PRODUCTION_AND_TEST_STACK.slice(0, 67));
  assert.deepEqual(devStack[67], {
    index: 67,
    kind: 'middleware',
    name: 'app',
    path: null,
  });
});

const EXTRACTED_ROUTE_MODULES: ReadonlyArray<{
  file: string;
  exportedFns: string[];
}> = [
  { file: 'server/routes/auth.ts', exportedFns: ['registerAuthRoutes', 'registerAuthSessionRoutes'] },
  { file: 'server/routes/uploads.ts', exportedFns: ['registerUploadsRoutes'] },
  { file: 'server/routes/webhooks.ts', exportedFns: ['registerPayPalWebhookRoutes', 'registerCmiWebhookRoutes'] },
  { file: 'server/routes/subscription.ts', exportedFns: ['registerSubscriptionRoutes', 'registerCmiSubscriptionRoutes'] },
  { file: 'server/routes/admin.ts', exportedFns: ['registerAdminRoutes'] },
  {
    file: 'server/routes/commands.ts',
    exportedFns: [
      'registerStateAndVoteRoutes',
      'registerCommandRoutes',
      'registerPlatformReadRoutes',
      'registerSharedStateGuardRoutes',
    ],
  },
  { file: 'server/routes/jobs.ts', exportedFns: ['registerJobsRoutes'] },
  { file: 'server/routes/static.ts', exportedFns: ['registerStaticRoutes'] },
];

test('server.ts delegates extracted route areas to dedicated server/routes/* modules with explicit deps', () => {
  const serverSource = readFileSync(join(ROOT, 'server.ts'), 'utf8');
  for (const mod of EXTRACTED_ROUTE_MODULES) {
    const fullPath = join(ROOT, mod.file);
    assert.equal(existsSync(fullPath), true, `Expected extracted route module ${mod.file} to exist`);
    const modSource = readFileSync(fullPath, 'utf8');
    // Ensure no top-level mutable globals (top-level `let` or `var`) are introduced in route modules.
    assert.doesNotMatch(modSource, /^(?:let|var)\s+/m, `Unexpected top-level mutable global in ${mod.file}`);
    for (const fnName of mod.exportedFns) {
      assert.match(modSource, new RegExp(`export\\s+(async\\s+)?function\\s+${fnName}\\b`));
      assert.match(serverSource, new RegExp(`\\b${fnName}\\s*\\(`));
    }
  }
  assert.doesNotMatch(serverSource, /\bapi\.(?:get|post)\s*\(/);
  assert.doesNotMatch(serverSource, /\bapp\.(?:put|patch|delete)\s*\(/);
});
