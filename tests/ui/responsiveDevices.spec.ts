import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashPasswordSync } from '../../utils/security';

const ROOT = resolve(import.meta.dirname, '..', '..');
const TEST_PASSWORD = 'Responsive-Audit-Password-2026!';

let serverProcess: ChildProcess | null = null;
let tempDir = '';
let baseUrl = '';
let tokens: Record<'syndic' | 'resident' | 'provider' | 'admin', string> = {
  syndic: '',
  resident: '',
  provider: '',
  admin: '',
};

async function allocatePort(): Promise<number> {
  return new Promise<number>((done, reject) => {
    const listener = createServer();
    listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = (listener.address() as { port: number }).port;
      listener.close(() => done(port));
    });
  });
}

function buildSeedState() {
  const nowIso = new Date().toISOString();
  const nextYearIso = new Date(Date.now() + 240 * 86_400_000).toISOString();
  const monthPeriod = nowIso.slice(0, 7);

  const profiles = [
    {
      uid: 'resp-syndic-1',
      email: 'syndic@atlascopro.ma',
      displayName: 'Karim Bennani',
      role: 'syndic',
      syndicId: 'syndic-atlas',
      emailVerified: true,
    },
    {
      uid: 'resp-res-1',
      email: 'nadia@atlascopro.ma',
      displayName: 'Nadia El Idrissi',
      role: 'resident',
      residentId: 'res-a1',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      apartmentId: 'apt-a1',
      isOwner: true,
      emailVerified: true,
    },
    {
      uid: 'resp-prov-1',
      email: 'atelier@maghrebplomberie.ma',
      displayName: 'Maghreb Plomberie Services',
      role: 'provider',
      prestataireId: 'prest-1',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      prestataireCategory: 'plumbing',
      emailVerified: true,
    },
    {
      uid: 'resp-admin-1',
      email: 'admin@syndik.ma',
      displayName: 'Direction Syndik',
      role: 'admin',
      emailVerified: true,
    },
  ];

  return {
    syndik_prod_registered_users_v1: profiles.map((profile) => ({
      uid: profile.uid,
      email: profile.email,
      profile,
      passwordHash: hashPasswordSync(TEST_PASSWORD, profile.email),
    })),
    syndik_prod_syndics_v1: [
      {
        id: 'syndic-atlas',
        name: 'Cabinet Atlas Copro Gestion',
        email: 'syndic@atlascopro.ma',
        phone: '+212 522 48 19 30',
        city: 'Casablanca',
        address: '42 Bd d’Anfa, Casablanca',
        ice: '002489175000042',
        rc: 'RC 418920 Casablanca',
        subscriptionPlan: 'professional',
        subscriptionStatus: 'active',
        subscriptionExpiry: nextYearIso,
        buildings: [
          {
            id: 'bld-yasmin',
            syndicId: 'syndic-atlas',
            name: 'Résidence Al Yasmin',
            address: '42 Bd d’Anfa, Quartier Racine',
            city: 'Casablanca',
            totalTantiemes: 1000,
            reserveFundRate: 10,
            bankName: 'Attijariwafa Bank',
            bankRib: '007780000123450000123456',
            openingCurrentBalance: 38450,
            openingReserveBalance: 24500,
            openingBalancesConfirmedAt: nowIso,
            apartments: [
              {
                id: 'apt-a1',
                buildingId: 'bld-yasmin',
                number: 'A1',
                floor: 1,
                area: 110,
                tantiemes: 1000,
                monthlyFee: 350,
                residentId: 'res-a1',
                ownerId: 'res-a1',
                status: 'occupied',
              },
            ],
            residents: [
              {
                id: 'res-a1',
                buildingId: 'bld-yasmin',
                syndicId: 'syndic-atlas',
                name: 'Nadia El Idrissi',
                email: 'nadia@atlascopro.ma',
                phone: '0661-24-58-90',
                cin: 'BK482910',
                isOwner: true,
                hasAccount: true,
                apartmentId: 'apt-a1',
                mustChangePassword: false,
              },
            ],
            financials: {
              currentBalance: 38800,
              reserveBalance: 24500,
              transactions: [
                {
                  id: 'trx-1',
                  buildingId: 'bld-yasmin',
                  syndicId: 'syndic-atlas',
                  date: nowIso,
                  description: 'Cotisation mensuelle Lot A1',
                  amount: 350,
                  type: 'income',
                  fundType: 'current',
                  category: 'charges',
                  paymentMethod: 'virement',
                  lotNumber: 'A1',
                  thirdPartyName: 'Nadia El Idrissi',
                },
              ],
            },
            announcements: [],
            documents: [],
          },
        ],
      },
    ],
    syndik_prod_charges_v1: [
      {
        id: 'chg-1',
        buildingId: 'bld-yasmin',
        syndicId: 'syndic-atlas',
        apartmentId: 'apt-a1',
        residentId: 'res-a1',
        period: monthPeriod,
        dueDate: nowIso,
        amount: 350,
        paidAmount: 0,
        status: 'pending',
        createdAt: nowIso,
      },
    ],
    syndik_prod_quittances_v1: [
      {
        id: 'quit-1',
        quittanceNumber: 'QUIT-2026-0001',
        buildingId: 'bld-yasmin',
        syndicId: 'syndic-atlas',
        apartmentId: 'apt-a1',
        apartmentNumber: 'A1',
        residentId: 'res-a1',
        residentName: 'Nadia El Idrissi',
        periodCovered: monthPeriod,
        amount: 350,
        chargesCourantesAmount: 315,
        reserveFundAmount: 35,
        paymentMethod: 'virement',
        paymentDate: nowIso,
        createdAt: nowIso,
      },
    ],
    syndik_prod_proofs_v1: [],
    syndik_prod_ag_v1: [
      {
        id: 'ag-2026',
        buildingId: 'bld-yasmin',
        syndicId: 'syndic-atlas',
        title: 'AGO Annuelle 2026',
        type: 'AGO',
        convocationRound: 1,
        date: nowIso.slice(0, 10),
        time: '18:30',
        location: 'Hall principal',
        status: 'in_progress',
        isVotingOpen: true,
        presentTantiemes: 1000,
        totalTantiemes: 1000,
        attendees: [],
        resolutions: [
          {
            id: 'res-1',
            number: 1,
            title: 'Approbation des comptes 2025',
            description: 'Validation du bilan financier annuel.',
            majorityRule: 'article_18_simple',
            votes: [],
          },
        ],
        createdAt: nowIso,
      },
    ],
    syndik_prod_prestataires_v1: [
      {
        id: 'prest-1',
        buildingId: 'bld-yasmin',
        syndicId: 'syndic-atlas',
        name: 'Maghreb Plomberie Services',
        category: 'plumbing',
        phone: '0662-11-22-33',
        email: 'atelier@maghrebplomberie.ma',
        hasAccount: true,
        rating: 4.8,
      },
    ],
    syndik_prod_maintenance_v1: [
      {
        id: 'mnt-1',
        buildingId: 'bld-yasmin',
        syndicId: 'syndic-atlas',
        apartmentId: 'apt-a1',
        residentId: 'res-a1',
        residentName: 'Nadia El Idrissi',
        apartmentNumber: 'A1',
        title: 'Fuite colonne eau chaude',
        description: 'Suintement détecté au niveau du palier 1.',
        category: 'plumbing',
        priority: 'high',
        status: 'in_progress',
        prestataireId: 'prest-1',
        assignedTo: 'Maghreb Plomberie Services',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    syndik_prod_chat_v1: [],
    syndik_prod_marketplace_v1: [],
    syndik_prod_subscription_payments_v1: [
      {
        id: 'sp-1',
        syndicId: 'syndic-atlas',
        syndicName: 'Cabinet Atlas Copro Gestion',
        syndicEmail: 'syndic@atlascopro.ma',
        plan: 'professional',
        months: 12,
        amount: 4680,
        currency: 'MAD',
        method: 'cmi',
        reference: 'CMI-2026-88412',
        invoiceNumber: 'FAC-SYN-2026-0001',
        createdAt: nowIso,
      },
    ],
    syndik_prod_subscription_requests_v1: [],
    syndik_prod_notifications_v1: [],
    syndik_prod_audit_v1: [],
  };
}

async function apiLogin(url: string, email: string): Promise<string> {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: TEST_PASSWORD }),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function applySession(
  page: Page,
  lang: 'fr' | 'ar',
  serverToken?: string,
) {
  await page.evaluate(
    ({ l, token }) => {
      window.localStorage.setItem('syndik_lang', l);
      if (token) {
        window.localStorage.setItem(
          'syndik_auth_session_v1',
          JSON.stringify({ serverToken: token }),
        );
      } else {
        window.localStorage.removeItem('syndik_auth_session_v1');
      }
    },
    { l: lang, token: serverToken || '' },
  );
}

async function waitUiQuiet(page: Page) {
  await page.waitForLoadState('load').catch(() => {});
  await page
    .locator('.animate-spin')
    .first()
    .waitFor({ state: 'hidden', timeout: 4_000 })
    .catch(() => {});
  await page.waitForTimeout(350);
}

async function assertCleanLayout(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const vw = window.innerWidth;
    const docOverflow = Math.max(0, document.documentElement.scrollWidth - vw);
    const bodyOverflow = Math.max(0, document.body.scrollWidth - vw);

    const clipped: string[] = [];
    const headerControls = document.querySelectorAll(
      'header button, header a, nav button, nav a',
    );
    headerControls.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        rect.width === 0 ||
        rect.height === 0
      ) {
        return;
      }
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const ps = window.getComputedStyle(parent);
        if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') return;
        parent = parent.parentElement;
      }
      if (rect.left < -1 || rect.right > vw + 1) {
        clipped.push(
          `${el.tagName}[${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}] (${Math.round(rect.left)}..${Math.round(rect.right)} vs ${vw})`,
        );
      }
    });

    return { vw, docOverflow, bodyOverflow, clipped };
  });

  expect(
    metrics.docOverflow,
    `${label}: document horizontal overflow (${metrics.docOverflow}px)`,
  ).toBeLessThanOrEqual(1);
  expect(
    metrics.bodyOverflow,
    `${label}: body horizontal overflow (${metrics.bodyOverflow}px)`,
  ).toBeLessThanOrEqual(1);
  expect(
    metrics.clipped,
    `${label}: clipped header/nav controls: ${metrics.clipped.join(', ')}`,
  ).toEqual([]);
}

test.beforeAll(async () => {
  const port = await allocatePort();
  baseUrl = `http://127.0.0.1:${port}`;
  tempDir = mkdtempSync(join(tmpdir(), 'syndik-responsive-e2e-'));
  writeFileSync(
    join(tempDir, 'shared-state.json'),
    JSON.stringify(buildSeedState()),
    'utf8',
  );

  let logs = '';
  serverProcess = spawn(process.execPath, ['dist-server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      SYNDIK_STATE_BACKEND: 'file',
      SYNDIK_UPLOAD_BACKEND: 'file',
      SYNDIK_DATA_DIR: tempDir,
      SYNDIK_SERVER_SECRET: 'responsive-e2e-synthetic-server-secret-32c',
      SENDGRID_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout?.on('data', (d) => (logs += String(d)));
  serverProcess.stderr?.on('data', (d) => (logs += String(d)));

  const deadline = Date.now() + 20_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Test server exited early:\n${logs}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        healthy = true;
        break;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!healthy) {
    throw new Error(`Test server did not become healthy at ${baseUrl}:\n${logs}`);
  }

  tokens = {
    syndic: await apiLogin(baseUrl, 'syndic@atlascopro.ma'),
    resident: await apiLogin(baseUrl, 'nadia@atlascopro.ma'),
    provider: await apiLogin(baseUrl, 'atelier@maghrebplomberie.ma'),
    admin: await apiLogin(baseUrl, 'admin@syndik.ma'),
  };
});

test.afterAll(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('PWA manifest, service worker, brand icons, and HTML metadata are properly served', async ({
  page,
}) => {
  const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
  expect(manifestRes.status).toBe(200);
  expect(manifestRes.headers.get('content-type') || '').toContain(
    'application/manifest+json',
  );
  const manifest = (await manifestRes.json()) as {
    short_name: string;
    display: string;
    theme_color: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  expect(manifest.short_name).toBe('SyndicUnion');
  expect(manifest.display).toBe('standalone');
  expect(manifest.theme_color).toBe('#0f766e');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(4);

  const swRes = await fetch(`${baseUrl}/sw.js`);
  expect(swRes.status).toBe(200);
  expect(swRes.headers.get('cache-control') || '').toContain('no-cache');

  for (const iconPath of [
    '/icons/syndicunion-icon.svg',
    '/icons/favicon-32x32.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
  ]) {
    const res = await fetch(`${baseUrl}${iconPath}`);
    expect(res.status, `Icon ${iconPath} should return 200`).toBe(200);
  }

  const missingIcon = await fetch(`${baseUrl}/icons/does-not-exist.png`);
  expect(missingIcon.status).toBe(404);

  await page.route('**/*', (route) =>
    route.request().url().startsWith(baseUrl) ? route.continue() : route.abort(),
  );
  await page.goto(`${baseUrl}/welcome`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    '#0f766e',
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/icons/apple-touch-icon.png',
  );
});

test('Public Landing, Login, and Help Center have zero overflow across 360px–1280px in FR & AR and preserve Arabic cursive glyphs', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    route.request().url().startsWith(baseUrl) ? route.continue() : route.abort(),
  );

  const viewports = [
    { name: 'xs360', width: 360, height: 740 },
    { name: 'iphone390', width: 390, height: 844 },
    { name: 'ipad768', width: 768, height: 1024 },
    { name: 'desktop1280', width: 1280, height: 800 },
  ];

  await page.goto(`${baseUrl}/welcome`, { waitUntil: 'domcontentloaded' });

  for (const lang of ['fr', 'ar'] as const) {
    await applySession(page, lang);
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${baseUrl}/welcome`, { waitUntil: 'domcontentloaded' });
      await waitUiQuiet(page);
      await assertCleanLayout(page, `Landing ${vp.name} ${lang}`);

      if (lang === 'ar' && vp.name === 'xs360') {
        const rtlTypography = await page.evaluate(() => {
          const eyebrow = document.querySelector('main p');
          const monoEl = document.querySelector('.font-mono');
          return {
            dir: document.documentElement.getAttribute('dir'),
            eyebrowLetterSpacing: eyebrow
              ? window.getComputedStyle(eyebrow).letterSpacing
              : null,
            monoFontFamily: monoEl
              ? window.getComputedStyle(monoEl).fontFamily
              : null,
          };
        });
        expect(rtlTypography.dir).toBe('rtl');
        expect(rtlTypography.eyebrowLetterSpacing).toMatch(/^0(px)?|normal$/);
        expect(rtlTypography.monoFontFamily || '').toContain('Cairo');
      }

      if (lang === 'fr' && vp.name === 'xs360') {
        const menuBtn = page.getByRole('button', {
          name: /Menu de navigation/i,
        });
        await expect(menuBtn).toBeVisible();
        await menuBtn.click();
        await expect(
          page.getByRole('link', { name: /Centre d’Aide & Guides/i }),
        ).toBeVisible();
      }
    }

    for (const vp of [viewports[0], viewports[3]]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${baseUrl}/guide`, { waitUntil: 'domcontentloaded' });
      await waitUiQuiet(page);
      await assertCleanLayout(page, `Guide ${vp.name} ${lang}`);
      await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
      await waitUiQuiet(page);
      await assertCleanLayout(page, `Login ${vp.name} ${lang}`);
    }
  }
});

test('Syndic portal renders mobile cards on 360px, desktop tables on 1280px, and unclipped AG PV button on 768px iPad', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    route.request().url().startsWith(baseUrl) ? route.continue() : route.abort(),
  );

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await applySession(page, 'fr', tokens.syndic);

  for (const route of ['/', '/financials', '/ag', '/residents', '/settings']) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
    await waitUiQuiet(page);
    await assertCleanLayout(page, `Syndic ${route} xs360 FR`);
  }

  // Verify Financials opens on Charges appelées cleanly and Tout l'historique shows mobile cards on 360px
  await page.goto(`${baseUrl}/financials`, { waitUntil: 'domcontentloaded' });
  await waitUiQuiet(page);
  await page.getByRole('button', { name: /Tout l'historique/ }).click();
  await assertCleanLayout(page, 'Syndic /financials historique xs360 FR');
  const journalTable = page.locator('table').filter({ hasText: 'Date & Réf' });
  await expect(
    page.getByText('Cotisation mensuelle Lot A1').first(),
  ).toBeVisible();
  await expect(journalTable).toBeHidden();

  // Desktop 1280px displays Journal table cleanly
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(journalTable).toBeVisible();

  // Verify AG PV PDF button does NOT clip off-screen on 768px iPad
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${baseUrl}/ag`, { waitUntil: 'domcontentloaded' });
  await waitUiQuiet(page);
  await assertCleanLayout(page, 'Syndic /ag ipad768 FR');
  const pvBtn = page.getByRole('button', {
    name: /Télécharger le PV Officiel/i,
  });
  await expect(pvBtn).toBeVisible();
  const pvBox = await pvBtn.boundingBox();
  expect(pvBox).not.toBeNull();
  expect(pvBox!.x + pvBox!.width).toBeLessThanOrEqual(769);
});

test('Resident portal has readable AG CTA contrast, single-row 360px header, and clean FR/AR mobile layout', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    route.request().url().startsWith(baseUrl) ? route.continue() : route.abort(),
  );

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await applySession(page, 'fr', tokens.resident);
  await page.goto(`${baseUrl}/resident`, { waitUntil: 'domcontentloaded' });
  await waitUiQuiet(page);

  await assertCleanLayout(page, 'Resident xs360 FR');

  const navBox = await page.locator('nav').first().boundingBox();
  expect(navBox).not.toBeNull();
  expect(navBox!.height).toBeLessThanOrEqual(72);

  const agCta = page.getByRole('button', {
    name: /Accéder au Scrutin Numérique/i,
  });
  await expect(agCta).toBeVisible();
  const colors = await agCta.evaluate((el) => {
    const s = window.getComputedStyle(el);
    return { color: s.color, bg: s.backgroundColor };
  });
  expect(colors.color).not.toBe(colors.bg);
  expect(colors.color).not.toBe('rgb(255, 255, 255)');

  // AR RTL check
  await applySession(page, 'ar', tokens.resident);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitUiQuiet(page);
  await assertCleanLayout(page, 'Resident xs360 AR');
});

test('Provider and Super-Admin portals render cleanly on 360px with Admin mobile cards and 1280px desktop table', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    route.request().url().startsWith(baseUrl) ? route.continue() : route.abort(),
  );

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await applySession(page, 'fr', tokens.provider);
  await page.goto(`${baseUrl}/provider`, { waitUntil: 'domcontentloaded' });
  await waitUiQuiet(page);
  await assertCleanLayout(page, 'Provider xs360 FR');

  await applySession(page, 'fr', tokens.admin);
  await page.goto(`${baseUrl}/admin`, { waitUntil: 'domcontentloaded' });
  await waitUiQuiet(page);
  await assertCleanLayout(page, 'Admin xs360 FR');

  await expect(
    page.getByText('Cabinet Atlas Copro Gestion').first(),
  ).toBeVisible();
  await expect(page.locator('table').first()).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('table').first()).toBeVisible();
  await assertCleanLayout(page, 'Admin desktop1280 FR');
});

test('Mobile touch gestures smoothly scroll both public pages and Syndic portal without body scroll lock', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.route('**/*', (route) =>
    route.request().url().startsWith(baseUrl) ? route.continue() : route.abort(),
  );

  try {
    const cdp = await context.newCDPSession(page);

    // 1. Public Landing Page touch scroll
    await page.goto(`${baseUrl}/welcome`, { waitUntil: 'domcontentloaded' });
    await waitUiQuiet(page);
    const bodyOverflowY = await page.evaluate(
      () => window.getComputedStyle(document.body).overflowY,
    );
    expect(bodyOverflowY).toBe('visible');

    await cdp.send('Input.synthesizeScrollGesture', {
      x: 195,
      y: 620,
      yDistance: -380,
      speed: 900,
    });
    const landingScrollY = await page.evaluate(() => window.scrollY);
    expect(landingScrollY).toBeGreaterThan(150);

    // 2. Syndic Portal (DashboardLayout) mobile touch scroll
    await applySession(page, 'fr', tokens.syndic);
    await page.goto(`${baseUrl}/financials`, { waitUntil: 'domcontentloaded' });
    await waitUiQuiet(page);
    await page.evaluate(() => window.scrollTo(0, 0));

    await cdp.send('Input.synthesizeScrollGesture', {
      x: 195,
      y: 620,
      yDistance: -380,
      speed: 900,
    });
    const syndicScrollY = await page.evaluate(() => window.scrollY);
    expect(syndicScrollY).toBeGreaterThan(150);
  } finally {
    await context.close();
  }
});
