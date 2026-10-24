import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { hashPasswordSync } from "../../utils/security";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { FirestoreRepository } from "../../server/repository";
import { startStorageEmulator } from '../helpers/storageEmulator';

const root = resolve(import.meta.dirname, "../..");
const password = "Synthetic-Resident-Forms-42!";
const resident = {
  id: "r-ui",
  name: "Resident UI",
  email: "resident@ui.invalid",
  phone: "0600000000",
  isOwner: true,
  hasAccount: true,
  apartmentId: "lot-ui",
  mustChangePassword: false,
};
const profiles = [
  {
    uid: "owner-ui",
    email: "owner@ui.invalid",
    displayName: "Owner UI",
    role: "syndic",
    syndicId: "s-ui",
    emailVerified: true,
  },
  {
    uid: "user-res-r-ui",
    email: resident.email,
    displayName: resident.name,
    role: "resident",
    residentId: resident.id,
    syndicId: "s-ui",
    buildingId: "b-ui",
    apartmentId: "lot-ui",
    emailVerified: true,
  },
  {
    uid: "user-res-peer-ui",
    email: "peer@ui.invalid",
    displayName: "Peer",
    role: "resident",
    residentId: "peer-ui",
    syndicId: "s-ui",
    buildingId: "b-ui",
    apartmentId: "lot-ui",
    emailVerified: true,
  },
];
profiles.push(
  { uid: 'admin-ui', email: 'admin@ui.invalid', displayName: 'Admin UI', role: 'admin', emailVerified: true } as any,
  { uid: 'user-prest-p-ui', email: 'provider@ui.invalid', displayName: 'Provider UI', role: 'provider', syndicId: 's-ui', buildingId: 'b-ui', prestataireId: 'p-ui', emailVerified: true } as any,
);
const pdf = {
  name: "bank-receipt.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\nSYNTHETIC-RECEIPT\n"),
};
let directory: string,
  base: string,
  server: ChildProcess,
  exited: Promise<unknown>;
let logs = "";
const useFirestore = process.env.UI_TEST_BACKEND === 'firestore';
let testApp: App | undefined;
let testRepository: FirestoreRepository | undefined;
let storage: Awaited<ReturnType<typeof startStorageEmulator>> | undefined;
const disk = async () => testRepository
  ? testRepository.transaction(async state => JSON.parse(JSON.stringify(state)))
  : JSON.parse(readFileSync(join(directory, "shared-state.json"), "utf8"));

test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "buildmanage-ui-"));
  const charge = (id: string, amount: number, paidAmount = 0) => ({
    id,
    syndicId: "s-ui",
    buildingId: "b-ui",
    residentId: resident.id,
    apartmentId: "lot-ui",
    description: id,
    amount,
    paidAmount,
    status: "unpaid",
    dueDate: "2026-10-31",
    period: "2026-10",
    createdAt: new Date().toISOString(),
  });
  writeFileSync(
    join(directory, "shared-state.json"),
    JSON.stringify({
      syndik_prod_registered_users_v1: profiles.map((profile) => ({
        uid: profile.uid,
        email: profile.email,
        profile,
        passwordHash: hashPasswordSync(password, profile.email),
      })),
      syndik_prod_syndics_v1: [
        {
          id: "s-ui",
          name: "UI Cabinet",
          email: profiles[0].email,
          createdBy: profiles[0].uid,
          subscriptionPlan: "starter",
          subscriptionStatus: "active",
          subscriptionExpiry: "2099-01-01",
          buildings: [
            {
              id: "b-ui",
              syndicId: "s-ui",
              name: "UI Residence",
              address: "Synthetic address",
              city: "Casablanca",
              monthlySyndicFees: 200,
              reserveFundRate: 5,
              documents: [],
              residents: [
                resident,
                {
                  id: "peer-ui",
                  name: "Peer",
                  email: profiles[2].email,
                  phone: "0600000001",
                  isOwner: false,
                  hasAccount: true,
                  apartmentId: 'lot-ui',
                },
              ],
              apartments: [
                {
                  id: "lot-ui",
                  buildingId: "b-ui",
                  number: "12",
                  ownerId: resident.id,
                  tenantId: 'peer-ui',
                  floor: 1,
                  area: 80,
                  tantiemes: 1000,
                },
              ],
              financials: {
                balance: 40,
                reserveFundBalance: 0,
                transactions: [],
                openingBalancesRecordedAt: new Date().toISOString(),
              },
            },
          ],
        },
      ],
      syndik_prod_prestataires_v1: [{ id: 'p-ui', buildingId: 'b-ui', syndicId: 's-ui', name: 'Synthetic Provider', phone: '0600000007', email: 'provider@ui.invalid', category: 'plumbing', active: true, hasAccount: true, reviews: [] }],
      syndik_prod_maintenance_v1: [{ id: 'provider-ticket-ui', buildingId: 'b-ui', syndicId: 's-ui', residentId: 'r-ui', title: 'Provider test assignment', description: 'Synthetic assignment requiring a report.', category: 'plumbing', priority: 'medium', status: 'pending', assignedTo: 'p-ui', prestataireId: 'p-ui', createdAt: new Date().toISOString() }],
      syndik_prod_charges_v1: [
        charge("Monthly fees partial", 200, 40),
        charge("Monthly fees rejected", 50),
      ],
      syndik_prod_invoices_v1: [
        {
          id: "invoice-ui",
          syndicId: "s-ui",
          buildingId: "b-ui",
          residentId: resident.id,
          apartmentId: "lot-ui",
          invoiceNumber: "UI-001",
          chargeIds: ["Monthly fees partial"],
          totalAmount: 200,
          paidAmount: 40,
          status: "unpaid",
          items: [],
        },
      ],
      syndik_prod_proofs_v1: [
        {
          id: "rejected-ui",
          chargeId: "Monthly fees rejected",
          buildingId: "b-ui",
          residentId: resident.id,
          residentName: resident.name,
          apartmentId: "lot-ui",
          apartmentNumber: "12",
          amount: 50,
          status: "rejected",
          rejectionReason: "Receipt unreadable",
          referenceNumber: "OLD-REF",
          submissionDate: new Date().toISOString(),
        },
      ],
    }),
  );
  if (useFirestore) {
    if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('UI Firestore tests require the local emulator');
    testApp = initializeApp({ projectId: 'demo-buildmanage' });
    testRepository = new FirestoreRepository('(default)');
    storage = await startStorageEmulator();
    const seed = JSON.parse(readFileSync(join(directory, 'shared-state.json'), 'utf8'));
    await testRepository.transaction(async state => {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, seed);
    });
  }
  const port = await new Promise<number>((done, reject) => {
    const listener = createServer();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const p = (listener.address() as { port: number }).port;
      listener.close(() => done(p));
    });
  });
  base = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    ["--import", "./tests/helpers/networkGuard.mjs", "dist-server/server.js"],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(port),
        SYNDIK_STATE_BACKEND: useFirestore ? 'firestore' : 'file',
        GOOGLE_CLOUD_PROJECT: 'demo-buildmanage',
        FIRESTORE_DATABASE_ID: '(default)',
        GOOGLE_APPLICATION_CREDENTIALS: '',
        STORAGE_EMULATOR_HOST: storage?.url || '',
        SYNDIK_UPLOAD_BACKEND: storage ? 'gcs' : 'file',
        SYNDIK_DATA_DIR: directory,
        SYNDIK_SERVER_SECRET: "synthetic-ui-server-secret-32-characters",
        SENDGRID_API_KEY: "",
        GEMINI_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  exited = once(server, "exit");
  server.stdout!.on("data", (data) => (logs += data));
  server.stderr!.on("data", (data) => (logs += data));
  await expect
    .poll(async () => {
      if (server.exitCode !== null) throw new Error(logs);
      try {
        return (await fetch(`${base}/api/health`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
});

test.afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null)
    server.kill("SIGTERM");
  if (exited) await exited;
  if (testApp) await deleteApp(testApp);
  if (storage) await storage.close();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function login(page: Page, index = 1, language = "fr") {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
  const response = await page.request.post(`${base}/api/auth/login`, {
    data: { identifier: profiles[index].email, password },
  });
  expect(response.status()).toBe(200);
  const data = await response.json();
  await page.goto(`${base}/welcome`);
  // Wait for any previous identity restoration before replacing the test session.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(
    ({ token, language }) => {
      localStorage.setItem(
        "syndik_auth_session_v1",
        JSON.stringify({ serverToken: token }),
      );
      localStorage.setItem("syndik_lang", language);
    },
    { token: data.token, language },
  );
  const home = profiles[index].role === 'admin' ? '/admin' : profiles[index].role === 'provider' ? '/provider' : index === 0 ? '/financials' : '/resident';
  await page.goto(`${base}${home}`);
  // A completed navigation is not the same as completed asynchronous restoration.
  await expect(page.getByRole('button', { name: /Déconnexion|تسجيل الخروج/ }).first()).toBeVisible();
  return data.token as string;
}

test("typing preserves focus and caret in payment and marketplace forms; dialog keyboard controls still work", async ({
  page,
}, testInfo) => {
  await login(page);
  await expect(page.getByText('Contactez votre syndic pour obtenir les coordonnées bancaires avant tout virement.')).toBeVisible();
  const trigger = page
    .getByRole("button", { name: "Transmettre Justificatif", exact: true })
    .first();
  await trigger.click();
  const modal = page.getByRole("dialog");
  const reference = modal.getByLabel("N° Référence / Numéro d'opération");
  await reference.pressSequentially("VIR-123456", { delay: 35 });
  await expect(reference).toHaveValue("VIR-123456");
  await expect(reference).toBeFocused();
  await reference.press("Home");
  await reference.press("ArrowRight");
  await reference.pressSequentially("XX", { delay: 35 });
  await expect(reference).toHaveValue("VXXIR-123456");
  const note = modal.getByLabel("Note pour le syndic");
  await note.pressSequentially("Test note", { delay: 35 });
  await expect(note).toHaveValue("Test note");
  await expect(note).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("payment-desktop.png") });
  await note.press("Tab");
  // Footer buttons follow the form. Tab from the last control wraps to close.
  await modal.getByRole("button", { name: "Envoyer pour validation" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    modal.getByRole("button", { name: "Fermer la boîte de dialogue" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(trigger).toBeFocused();

  await page
    .getByRole("button", { name: /Souk Voisins/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Publier une annonce/ })
    .first()
    .click();
  const listing = page.getByRole("dialog");
  const title = listing.getByPlaceholder("Ex: Table basse salon marocain...");
  await title.pressSequentially("Table focus regression", { delay: 35 });
  await expect(title).toHaveValue("Table focus regression");
  await expect(title).toBeFocused();
  const description = listing.locator("textarea");
  await description.pressSequentially("A clean table for neighbours.", {
    delay: 35,
  });
  await expect(description).toHaveValue("A clean table for neighbours.");
  await expect(description).toBeFocused();
  await page.route("**/api/commands", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Synthetic publication failure" },
    }),
  );
  await listing.getByRole("button", { name: "Publier mon annonce" }).click();
  await expect(listing.getByRole("alert")).toContainText(
    "Synthetic publication failure",
  );
  await expect(title).toHaveValue("Table focus regression");
  await page.unroute("**/api/commands");
  await listing.getByRole("button", { name: "Publier mon annonce" }).click();
  await expect(listing).toBeHidden();
  expect(
    (await disk()).syndik_prod_marketplace_v1.filter(
      (item: any) => item.title === "Table focus regression",
    ),
  ).toHaveLength(1);
});

test('receipt picker opens by click and keyboard, confirms the file, and resets only when removed or reopened', async ({ page }, testInfo) => {
  await login(page);
  const trigger = page.getByRole('button', { name: 'Transmettre Justificatif', exact: true }).first();
  await trigger.click();
  const modal = page.getByRole('dialog');
  const input = modal.getByLabel('Justificatif de paiement', { exact: true });
  let uploads = 0;
  page.on('request', request => { if (request.url().endsWith('/api/uploads') && request.method() === 'POST') uploads++; });
  await modal.getByLabel("N° Référence / Numéro d'opération").fill('PICKER-ONLY');
  await modal.getByRole('button', { name: 'Envoyer pour validation' }).click();
  const picker = modal.getByRole('button', { name: 'Joindre un justificatif', exact: true });
  await expect(picker).toBeEnabled();
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute('aria-invalid', 'true');
  const chooserPromise = page.waitForEvent('filechooser');
  await picker.click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles(pdf);
  await expect(modal.getByRole('status')).toContainText(`Prêt à envoyer : ${pdf.name}`);
  await expect(modal.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await modal.getByLabel('Note pour le syndic').fill('Keep the chosen receipt');
  expect(await input.evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe(pdf.name);
  const replace = modal.getByRole('button', { name: 'Changer le justificatif', exact: true });
  await replace.focus();
  const replacePromise = page.waitForEvent('filechooser');
  await replace.press('Space');
  await (await replacePromise).setFiles({ ...pdf, name: 'replacement.pdf' });
  await expect(modal.getByRole('status')).toContainText('replacement.pdf');
  await modal.getByRole('button', { name: 'Retirer le fichier' }).click();
  await expect(modal.getByRole('status')).toContainText('Aucun fichier sélectionné');
  expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
  await picker.focus();
  const reselectPromise = page.waitForEvent('filechooser');
  await picker.press('Enter');
  await (await reselectPromise).setFiles(pdf);
  await expect(modal.getByRole('status')).toContainText(pdf.name);
  expect(uploads).toBe(0); // Selection is not reported as an upload or payment.
  await page.screenshot({ path: testInfo.outputPath('receipt-picker-desktop.png') });
  await modal.getByRole('button', { name: 'Annuler', exact: true }).click();
  await trigger.click();
  await expect(modal.getByRole('status')).toContainText('Aucun fichier sélectionné');
  await expect(picker).toBeEnabled();
  expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
  await modal.getByLabel("N° Référence / Numéro d'opération").fill('PICKER-REOPEN');
  await modal.getByRole('button', { name: 'Envoyer pour validation' }).click();
  await expect(modal.getByRole('alert')).toContainText('joindre');
  await modal.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('storage permission and missing-bucket failures explain the problem without losing the payment form', async ({ page }) => {
  test.skip(!storage, 'Runs against the real Admin Storage client in the Firestore simulation');
  await login(page);
  await page.getByRole('button', { name: 'Transmettre Justificatif', exact: true }).first().click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel("N° Référence / Numéro d'opération").fill('STORAGE-FAILURE-DRAFT');
  await modal.getByLabel('Justificatif de paiement', { exact: true }).setInputFiles(pdf);
  const before = Object.keys((await disk()).__files || {}).length;
  try {
    for (const [status, code] of [[403, 'STORAGE_ACCESS'], [404, 'STORAGE_MISSING']] as const) {
      storage!.faults.status = status;
      const failedResponse = page.waitForResponse(response => response.url().endsWith('/api/uploads') && response.request().method() === 'POST');
      await modal.getByRole('button', { name: 'Envoyer pour validation' }).click();
      const response = await failedResponse;
      const result = await response.json();
      expect(response.status()).toBe(503);
      expect(result.code).toBe(code);
      expect(response.headers()['x-request-id']).toBe(result.requestId);
      await expect(modal.getByRole('alert')).toContainText('stockage des pièces jointes');
      await expect(modal.getByRole('alert')).toContainText(result.requestId);
      await expect(modal.getByLabel("N° Référence / Numéro d'opération")).toHaveValue('STORAGE-FAILURE-DRAFT');
      await expect(modal.getByRole('status')).toContainText(pdf.name);
      expect(Object.keys((await disk()).__files || {})).toHaveLength(before);
    }
  } finally { storage!.faults.status = 0; }
  await modal.getByRole('button', { name: 'Annuler', exact: true }).click();
});

test("resident uploads a private receipt, sees errors, retries once, and syndic approves the remaining balance", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Transmettre Justificatif", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog");
  const submit = modal.getByRole("button", { name: "Envoyer pour validation" });
  await expect(modal.getByLabel("Montant du règlement (MAD)")).toHaveValue(
    "160.00",
  );
  await submit.click();
  await expect(modal.getByRole("alert")).toContainText("référence");
  await modal
    .getByLabel("N° Référence / Numéro d'opération")
    .fill("VIR-UI-RETRY");
  await submit.click();
  await expect(modal.getByRole("alert")).toContainText("joindre");
  const file = modal.getByLabel("Justificatif de paiement", { exact: true });
  await file.setInputFiles({
    name: "bad.html",
    mimeType: "text/html",
    buffer: Buffer.from("<html>bad</html>"),
  });
  await expect(modal.getByRole("alert")).toContainText(
    "PDF, PNG, JPEG ou WebP",
  );
  await file.setInputFiles(pdf);
  await modal.getByLabel("Montant du règlement (MAD)").fill("200");
  await submit.click();
  await expect(modal.getByRole("alert")).toContainText("solde restant");
  await modal.getByLabel("Montant du règlement (MAD)").fill("160");
  await modal.getByLabel("Note pour le syndic").fill("Synthetic bank transfer");
  await page.route("**/api/uploads", (route) =>
    route.fulfill({ status: 503, json: { error: "Synthetic upload failure" } }),
  );
  await submit.click();
  await expect(modal.getByRole("alert")).toContainText(
    "Synthetic upload failure",
  );
  await page.unroute("**/api/uploads");
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  await page.route("**/api/commands", async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: "Synthetic submission failure" },
    });
  });
  await submit.click();
  await expect(
    modal.getByRole("button", { name: "Envoi en cours..." }),
  ).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Changer le justificatif' })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Retirer le fichier' })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Fermer la boîte de dialogue' })).toBeDisabled();
  release();
  await expect(modal.getByRole("alert")).toContainText(
    "Synthetic submission failure",
  );
  await expect(
    modal.getByLabel("N° Référence / Numéro d'opération"),
  ).toHaveValue("VIR-UI-RETRY");
  await expect(modal.getByLabel("Note pour le syndic")).toHaveValue(
    "Synthetic bank transfer",
  );
  await expect(modal.getByRole('button', { name: 'Changer le justificatif' })).toBeEnabled();
  await expect(modal.getByRole('status')).toContainText(pdf.name);
  await page.unroute("**/api/commands");
  await submit.click();
  await expect(modal).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "Justificatif envoyé" }).first(),
  ).toBeVisible();
  const state = (await disk());
  const proofs = state.syndik_prod_proofs_v1.filter(
    (p: any) => p.referenceNumber === "VIR-UI-RETRY",
  );
  expect(proofs).toHaveLength(1);
  const proof = proofs[0];
  expect(proof).toMatchObject({
    amount: 160,
    status: "pending",
    residentName: resident.name,
    apartmentId: "lot-ui",
    apartmentNumber: "12",
  });
  expect(proof.receiptUrl).toMatch(/^\/api\/uploads\//);
  if (storage) expect([...storage.objects.values()].some(item => item.bytes.equals(pdf.buffer))).toBe(true);
  expect(state.syndik_prod_charges_v1[0].paidAmount).toBe(40);
  expect(state.syndik_prod_quittances_v1 || []).toHaveLength(0);
  const peerLogin = await page.request.post(`${base}/api/auth/login`, {
    data: { identifier: profiles[2].email, password },
  });
  const peerToken = (await peerLogin.json()).token;
  expect(
    (
      await page.request.get(base + proof.receiptUrl, {
        headers: { Authorization: `Bearer ${peerToken}` },
      })
    ).status(),
  ).toBe(403);

  await login(page, 0);
  await page
    .getByRole("button", { name: /Vérification des Virements/ })
    .click();
  const row = page
    .locator("div.p-4")
    .filter({ has: page.locator("strong", { hasText: "VIR-UI-RETRY" }) })
    .last();
  await expect(
    row.getByRole("link", { name: "Ouvrir le justificatif" }),
  ).toHaveAttribute("href", proof.receiptUrl);
  // The browser link relies on the HttpOnly session cookie, without a bearer header.
  const receiptResponse = await page.request.get(base + proof.receiptUrl);
  expect(receiptResponse.status()).toBe(200);
  expect(await receiptResponse.body()).toEqual(pdf.buffer);
  await row
    .getByRole("button", { name: "Valider & Délivrer Quittance" })
    .click();
  await expect
    .poll(
      async () =>
        (await disk()).syndik_prod_proofs_v1.find((p: any) => p.id === proof.id)
          ?.status,
    )
    .toBe("approved");
  const posted = (await disk());
  expect(posted.syndik_prod_charges_v1[0]).toMatchObject({
    paidAmount: 200,
    status: "paid",
  });
  expect(posted.syndik_prod_invoices_v1[0]).toMatchObject({
    paidAmount: 200,
    status: "paid",
  });
  expect(posted.syndik_prod_quittances_v1).toHaveLength(1);
  const ledger =
    posted.syndik_prod_syndics_v1[0].buildings[0].financials.transactions;
  expect(
    ledger.reduce((sum: number, entry: any) => sum + entry.amount, 0),
  ).toBe(160);
  expect(
    ledger.filter((entry: any) => entry.fundType === "reserve")[0].amount,
  ).toBe(8);
});

test("a rejected proof can be resubmitted from the exact charge on mobile in Arabic", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 1, "ar");
  await expect(page.getByText("Receipt unreadable")).toBeVisible();
  const chargeRow = page
    .locator("div.py-3")
    .filter({ has: page.getByText("Monthly fees rejected", { exact: true }) });
  await chargeRow
    .getByRole("button", { name: "إرسال إثبات الأداء", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByLabel("مبلغ الأداء (درهم)")).toHaveValue("50.00");
  const reference = modal.getByLabel("رقم المرجع / رقم العملية");
  await reference.pressSequentially("NEW-REF-AR", { delay: 35 });
  await expect(reference).toBeFocused();
  await modal
    .getByLabel("ملاحظة للسنديك")
    .pressSequentially("إثبات جديد", { delay: 35 });
  const arabicChooser = page.waitForEvent('filechooser');
  await modal.getByRole('button', { name: 'إرفاق إثبات الأداء', exact: true }).click();
  await (await arabicChooser).setFiles(pdf);
  await expect(modal.getByRole('status')).toContainText(`جاهز للإرسال: ${pdf.name}`);
  await page.screenshot({ path: testInfo.outputPath("payment-ar-mobile.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await modal.getByRole("button", { name: "إرسال للمصادقة" }).click();
  await expect(modal).toBeHidden();
  const proof = (await disk()).syndik_prod_proofs_v1.find(
    (p: any) => p.referenceNumber === "NEW-REF-AR",
  );
  expect(proof).toMatchObject({
    chargeId: "Monthly fees rejected",
    status: "pending",
    receiptNote: "إثبات جديد",
  });
  expect(
    (await disk()).syndik_prod_proofs_v1.find((p: any) => p.id === "rejected-ui")
      .status,
  ).toBe("rejected");
  await login(page, 0);
  await page
    .getByRole("button", { name: /Vérification des Virements/ })
    .click();
  const row = page
    .locator("div.p-4")
    .filter({ has: page.locator("strong", { hasText: "NEW-REF-AR" }) })
    .last();
  page.once("dialog", (dialog) =>
    dialog.accept("Receipt unclear - please resend"),
  );
  await row.getByRole("button", { name: "Rejeter", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await disk()).syndik_prod_proofs_v1.find((p: any) => p.id === proof.id)
          ?.status,
    )
    .toBe("rejected");
  expect(
    (await disk()).syndik_prod_proofs_v1.find((p: any) => p.id === proof.id)
      .rejectionReason,
  ).toBe("Receipt unclear - please resend");
  await login(page, 1, "ar");
  await expect(page.getByText("Receipt unclear - please resend")).toBeVisible();
  await chargeRow
    .getByRole("button", { name: "إرسال إثبات الأداء", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("رقم المرجع / رقم العملية"),
  ).toHaveValue("");
});

async function field(page: Page, label: string | RegExp) {
  return page.getByRole('dialog').locator('label').filter({ hasText: label }).first().locator('..').locator('input, textarea, select').first();
}

async function failNextSave(page: Page) {
  await page.route('**/api/commands', route => route.fulfill({ status: 503, json: { error: 'Synthetic save failure — please retry' } }));
}

async function expectRetryableFailure(page: Page, submit: string | RegExp) {
  const dialog = page.getByRole('dialog');
  await failNextSave(page);
  await dialog.getByRole('button', { name: submit }).click();
  await expect(dialog.getByRole('alert').first()).toContainText('Synthetic save failure');
  await expect(dialog).toBeVisible();
  await page.unroute('**/api/commands');
}

test('building creation explains missing fields, keeps the draft on failure and closes only after saving', async ({ page }, testInfo) => {
  await login(page, 0);
  await page.goto(`${base}/buildings`);
  await page.getByRole('button', { name: /Ajouter.*immeuble/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/nom/i);
  await dialog.locator('#bld-name').pressSequentially('Form audit residence', { delay: 20 });
  await expect(dialog.locator('#bld-name')).toBeFocused();
  await dialog.locator('#bld-address').fill('123 Synthetic Street');
  await dialog.locator('#bld-city').fill('Casablanca');
  await expectRetryableFailure(page, /Enregistrer|Créer|Ajouter/);
  await expect(dialog.locator('#bld-name')).toHaveValue('Form audit residence');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_syndics_v1[0].buildings.filter((b: any) => b.name === 'Form audit residence')).toHaveLength(1);
  await expect(page.getByRole('status').filter({ hasText: 'Immeuble créé' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('building-success.png') });
});

test('lot and resident forms retain drafts on failures and persist complete records', async ({ page }) => {
  await login(page, 0);
  await page.goto(`${base}/apartments`);
  await page.getByRole('button', { name: 'Ajouter un lot', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/numéro/i);
  await dialog.locator('input').first().fill('AUDIT-02');
  await expectRetryableFailure(page, /Enregistrer/);
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_syndics_v1[0].buildings[0].apartments.some((a: any) => a.number === 'AUDIT-02')).toBe(true);

  await page.goto(`${base}/residents`);
  await page.getByRole('button', { name: /Ajouter.*résident/i }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/e-?mail/i);
  await dialog.locator('#res-name').fill('Form Audit Resident');
  await dialog.locator('#res-email').fill('new-resident@ui.invalid');
  await dialog.locator('#res-phone').fill('0600000099');
  const newLot = (await disk()).syndik_prod_syndics_v1[0].buildings[0].apartments.find((a: any) => a.number === 'AUDIT-02');
  await dialog.locator('#res-apartment').selectOption(newLot.id);
  await dialog.locator('input[type=checkbox]').uncheck();
  await expectRetryableFailure(page, /Enregistrer/);
  await expect(dialog.locator('#res-email')).toHaveValue('new-resident@ui.invalid');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_syndics_v1[0].buildings[0].residents.some((r: any) => r.email === 'new-resident@ui.invalid')).toBe(true);
});

test('building reserve rate accepts fractional percentages and persists the same rate used by payments', async ({ page }) => {
  const token = await login(page, 0);
  const originalRate = (await disk()).syndik_prod_syndics_v1[0].buildings[0].reserveFundRate;
  try {
    await page.goto(`${base}/buildings`);
    await page.getByTitle("Modifier l'immeuble").first().click();
    const dialog = page.getByRole('dialog');
    const rate = dialog.locator('#bld-reserve-rate');
    await expect(rate).toHaveAttribute('max', '100');
    await expect(rate).toHaveAttribute('step', 'any');
    const before = (await disk()).syndik_prod_syndics_v1[0].buildings[0].financials;
    await rate.fill('7.5');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toBeHidden();
    const updated = (await disk()).syndik_prod_syndics_v1[0].buildings[0];
    expect(updated.reserveFundRate).toBe(7.5);
    expect(updated.reserveFundPercentage).toBeUndefined();
    expect(updated.financials).toEqual(before);
  } finally {
    const restored = await page.request.post(`${base}/api/commands`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { operation: 'updateBuilding', args: ['b-ui', { reserveFundRate: originalRate }], operationId: crypto.randomUUID() },
    });
    expect(restored.status()).toBe(200);
  }
});

test('receipt form cannot bypass posting and limits payment to the selected outstanding charge', async ({ page }) => {
  const token = await login(page, 0);
  const generated = await apiCommand(token, 'generateMonthlyCharges', ['b-ui', 's-ui', '2034-06', false]);
  expect(generated.status, JSON.stringify(generated.data)).toBe(200);
  const charge = generated.data.result.find((c: any) => c.residentId === 'r-ui');
  expect(charge).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: /Appels de Charges/ }).click();
  await page.getByRole('button', { name: /Émettre une Quittance/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: /Inscrire automatiquement/ })).toHaveCount(0);
  await dialog.getByLabel('Charge à régler').selectOption(charge.id);
  const amount = dialog.getByLabel('Montant Total Encaissé (MAD)');
  await expect(amount).toHaveAttribute('max', String(charge.amount));
  await expect(dialog.getByText('Tout nouveau reçu confirme un paiement enregistré.')).toBeVisible();
  await amount.fill('1');
  const unrelated = await apiCommand(token, 'generateMonthlyCharges', ['b-ui', 's-ui', '2034-07', false]);
  expect(unrelated.status, JSON.stringify(unrelated.data)).toBe(200);
  await expect(dialog.getByLabel('Charge à régler')).toContainText('2034-07');
  await expect(amount).toHaveValue('1');
  const before = ((await disk()).syndik_prod_quittances_v1 || []).filter((q: any) => q.chargeId === charge.id);
  await amount.fill(String(charge.amount + 1));
  await dialog.locator('button[type=submit]').click();
  expect(await amount.evaluate((element: HTMLInputElement) => element.validity.rangeOverflow)).toBe(true);
  expect(((await disk()).syndik_prod_quittances_v1 || []).filter((q: any) => q.chargeId === charge.id)).toEqual(before);
  await amount.fill(String(charge.amount));
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  const receipts = ((await disk()).syndik_prod_quittances_v1 || []).filter((q: any) => q.chargeId === charge.id);
  expect(receipts).toHaveLength(1);
  const receipt = receipts[0];
  const row = page.getByRole('row').filter({ hasText: '2034-06' }).filter({ hasText: 'Resident UI' }).first();
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Quittance PDF' }).click();
  expect((await download).suggestedFilename()).toContain(receipt.quittanceNumber);
  expect(((await disk()).syndik_prod_quittances_v1 || []).filter((q: any) => q.chargeId === charge.id)).toEqual(receipts);
});

test('maintenance validates required fields, preserves failed reports and saves the selected urgency', async ({ page }, testInfo) => {
  await login(page);
  await page.getByRole('button', { name: /Incidents.*Suivi/ }).first().click();
  await page.getByRole('button', { name: 'Signaler un incident', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Envoyer le signalement' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/Titre|Description/);
  await dialog.locator('input[type=text]').first().pressSequentially('Form audit elevator', { delay: 20 });
  await expect(dialog.locator('input[type=text]').first()).toBeFocused();
  await dialog.locator('textarea').fill('Elevator stopped on floor 2. Please arrange an inspection.');
  await dialog.locator('select').nth(1).selectOption('high');
  await expectRetryableFailure(page, 'Envoyer le signalement');
  await expect(dialog.locator('textarea')).toHaveValue('Elevator stopped on floor 2. Please arrange an inspection.');
  await page.screenshot({ path: testInfo.outputPath('maintenance-retry.png') });
  await dialog.getByRole('button', { name: 'Envoyer le signalement' }).click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_maintenance_v1.find((r: any) => r.title === 'Form audit elevator')).toMatchObject({ priority: 'high', residentId: resident.id, status: 'pending' });
  await expect(page.getByRole('status').filter({ hasText: 'Signalement envoyé' })).toBeVisible();
});

test('announcements, provider and assembly forms explain missing information and save real data', async ({ page }) => {
  await login(page, 0);
  await page.goto(`${base}/announcements`);
  await page.getByRole('button', { name: /Nouvelle annonce|Créer.*annonce/i }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/Titre|Contenu/);
  await dialog.locator('#title').fill('Form audit announcement');
  await dialog.locator('#content').fill('Scheduled lift inspection on Saturday.');
  await expectRetryableFailure(page, /Publier/);
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_syndics_v1[0].buildings[0].announcements.some((a: any) => a.title === 'Form audit announcement')).toBe(true);

  await page.goto(`${base}/prestataires`);
  await page.getByRole('button', { name: /Ajouter.*prestataire/i }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/nom|téléphone/i);
  await (await field(page, /Nom de l'Entreprise/)).fill('Form Audit Plumbing');
  await (await field(page, /Téléphone/)).fill('0600000088');
  await dialog.locator('input[type=checkbox]').last().uncheck();
  await expectRetryableFailure(page, 'Enregistrer');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_prestataires_v1.some((p: any) => p.name === 'Form Audit Plumbing')).toBe(true);

  await page.goto(`${base}/ag`);
  await page.getByRole('button', { name: /Planifier.*AG|Planifier.*Assemblée|Nouvelle.*AG|Convoquer/i }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/titre/i);
  await dialog.locator('input[type=text]').first().fill('Form audit assembly');
  await expectRetryableFailure(page, /Créer.*AG/);
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_ag_v1.some((a: any) => a.title === 'Form audit assembly')).toBe(true);
});

test('expense form saves a positive input as one negative ledger entry', async ({ page }) => {
  await login(page, 0);
  await page.getByRole('button', { name: /Nouvelle.*Opération|Ajouter.*opération|Nouvelle écriture/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Valider & Enregistrer' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/montant|libellé/i);
  await (await field(page, /Libellé/)).fill('Form audit plumbing expense');
  await (await field(page, /Montant/)).fill('25');
  await (await field(page, /Nom.*Raison sociale/i)).fill('Synthetic Plumber');
  await (await field(page, /N°.*Facture|Numéro.*facture|N° de facture/i)).fill('AUDIT-INVOICE-25');
  await expectRetryableFailure(page, 'Valider & Enregistrer');
  await dialog.getByRole('button', { name: 'Valider & Enregistrer' }).click();
  await expect(dialog).toBeHidden();
  const entries = (await disk()).syndik_prod_syndics_v1[0].buildings[0].financials.transactions.filter((t: any) => t.description === 'Form audit plumbing expense');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ amount: -25, type: 'expense' });
});

test('Arabic mobile form validation is visible, focuses the missing field and does not overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 0, 'ar');
  await page.goto(`${base}/announcements`);
  await page.getByRole('button', { name: /إعلان جديد|إنشاء إعلان|إعلان/ }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText('يرجى تصحيح');
  await expect(dialog.locator('#title')).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('arabic-validation-mobile.png') });
});

test('password recovery errors stay inside the dialog and short reset passwords are explained', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/login`);
  await page.getByRole('button', { name: /Mot de passe oublié/i }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Envoyer les instructions' }).click();
  await expect(dialog.getByRole('alert')).toContainText(/e-?mail/i);
  await dialog.locator('input').fill('resident@ui.invalid');
  await dialog.getByRole('button', { name: 'Envoyer les instructions' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Email indisponible');
  await expect(dialog.locator('input')).toHaveValue('resident@ui.invalid');
  await page.goto(`${base}/account-action?mode=reset&token=synthetic-expired`);
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText(/obligatoire|caractères/i);
});

test('retry after a lost publication response reuses the upload and does not create a duplicate listing', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: /Souk Voisins/ }).first().click();
  await page.getByRole('button', { name: /Publier une annonce/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Ex: Table basse salon marocain...').fill('Uncertain publication response');
  await dialog.locator('textarea').fill('Retry this publication without creating a second advertisement.');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6b6sAAAAASUVORK5CYII=', 'base64');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByText(/Photos de l’objet \(1\/5\)|Photos de l'objet \(1\/5\)/)).toBeVisible();
  const ids: string[] = [];
  let uploads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/uploads') uploads++; });
  await page.route('**/api/commands', async route => {
    ids.push(route.request().postDataJSON().operationId);
    if (ids.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.fulfill({ status: 503, json: { error: 'Synthetic lost response after commit' } });
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: 'Publier mon annonce' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Synthetic lost response');
  await dialog.getByRole('button', { name: 'Publier mon annonce' }).click();
  await expect(dialog).toBeHidden();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(uploads).toBe(1);
  expect((await disk()).syndik_prod_marketplace_v1.filter((item: any) => item.title === 'Uncertain publication response')).toHaveLength(1);
});

test('document upload rejects unsupported files and previews the actual private PDF', async ({ page }) => {
  await login(page, 0);
  await page.goto(`${base}/documents`);
  const upload = page.locator('input[type=file]');
  await upload.setInputFiles({ name: 'unsupported.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('synthetic') });
  await expect(page.getByRole('alert').filter({ hasText: 'Formats acceptés' })).toBeVisible();
  await upload.setInputFiles(pdf);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const src = await dialog.locator('iframe').getAttribute('src');
  expect(src).toMatch(/^\/api\/uploads\//);
  const response = await page.request.get(base + src);
  expect(response.status()).toBe(200);
  expect(await response.body()).toEqual(pdf.buffer);
});

test('cabinet settings and chat preserve input after errors and save successfully on retry', async ({ page }) => {
  await login(page, 0);
  await page.goto(`${base}/settings`);
  const name = page.locator('#companyName');
  await name.fill('Audited Cabinet');
  await failNextSave(page);
  await page.locator('button[type=submit]').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic save failure' }).first()).toBeVisible();
  await expect(name).toHaveValue('Audited Cabinet');
  await page.unroute('**/api/commands');
  await page.locator('button[type=submit]').click();
  await expect.poll(async () => (await disk()).syndik_prod_syndics_v1[0].name).toBe('Audited Cabinet');

  await page.goto(`${base}/chat`);
  const message = page.getByPlaceholder(/Écrire un message/);
  await message.fill('Synthetic chat draft retained after failure');
  await failNextSave(page);
  await page.getByRole('button', { name: /^Envoyer/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic save failure' }).first()).toBeVisible();
  await expect(message).toHaveValue('Synthetic chat draft retained after failure');
  await page.unroute('**/api/commands');
  await page.getByRole('button', { name: /^Envoyer/ }).click();
  await expect(message).toHaveValue('');
  expect((await disk()).syndik_prod_chat_v1.filter((m: any) => m.content === 'Synthetic chat draft retained after failure')).toHaveLength(1);
});

test('admin cabinet creation validates and retries, and provider reports require a note before saving', async ({ page }) => {
  await login(page, 3);
  await page.getByRole('button', { name: /Nouveau Cabinet|Créer.*Cabinet/i }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/nom.*cabinet/i);
  await (await field(page, /Nom.*Cabinet/i)).fill('Synthetic Admin Cabinet');
  await (await field(page, /Email de connexion/i)).fill('new-cabinet@ui.invalid');
  await expectRetryableFailure(page, /Créer le Cabinet/);
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_syndics_v1.some((s: any) => s.name === 'Synthetic Admin Cabinet')).toBe(true);

  await login(page, 4);
  await page.getByRole('button', { name: /Mettre à jour|Compte.rendu/i }).first().click();
  await page.getByRole('button', { name: 'Envoyer le rapport' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/obligatoire/i);
  const report = page.locator('textarea');
  await report.fill('Synthetic repair inspection completed; replacement ordered.');
  await failNextSave(page);
  await page.getByRole('button', { name: 'Envoyer le rapport' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic save failure' }).first()).toBeVisible();
  await expect(report).toHaveValue('Synthetic repair inspection completed; replacement ordered.');
  await page.unroute('**/api/commands');
  await page.getByRole('button', { name: 'Envoyer le rapport' }).click();
  await expect(report).toBeHidden();
  expect((await disk()).syndik_prod_maintenance_v1.find((r: any) => r.id === 'provider-ticket-ui').status).toBe('in_progress');
});

test('monthly charges use the period selected in the form', async ({ page }) => {
  await login(page, 0);
  await page.getByRole('button', { name: 'Lancer un appel de fonds', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=month]').fill('2027-02');
  await expectRetryableFailure(page, 'Générer pour tous les lots');
  await expect(dialog.locator('input[type=month]')).toHaveValue('2027-02');
  await dialog.getByRole('button', { name: 'Générer pour tous les lots' }).click();
  await expect(dialog).toBeHidden();
  expect((await disk()).syndik_prod_charges_v1.some((c: any) => c.period === '2027-02')).toBe(true);
});

test('250 MAD monthly fees stay fixed as residents are added and opening setup unlocks payment approval', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const registered = await apiCall('', '/api/auth/register', {
    email: 'monthly-fees@ui.invalid', password,
    profile: { role: 'syndic', displayName: 'Monthly Fees Manager' },
    syndic: { name: 'Monthly Fees Cabinet', city: 'Casablanca', initialBuilding: {
      name: 'Monthly Fees Residence', address: 'Synthetic test address', apartmentsCount: 12, monthlyFees: 250,
    } },
  });
  expect(registered.status, JSON.stringify(registered.data)).toBe(200);
  const token = registered.data.token, cabinetId = registered.data.syndic.id;
  const building = () => disk().then(s => s.syndik_prod_syndics_v1.find((s: any) => s.id === cabinetId).buildings[0]);
  const initial = await building(), bId = initial.id;
  expect(initial.apartments.reduce((sum: number, a: any) => sum + a.tantiemes, 0)).toBe(1000);
  expect(Math.max(...initial.apartments.map((a: any) => a.tantiemes)) - Math.min(...initial.apartments.map((a: any) => a.tantiemes))).toBe(1);
  // Existing buildings retain the old 87/83 shares: the monthly fee must still be 250.
  for (let i = 0; i < 4; i++) {
    const result = await apiCommand(token, 'updateApartment', [{ ...initial.apartments[i], tantiemes: i === 0 ? 87 : 83 }]);
    expect(result.status, JSON.stringify(result.data)).toBe(200);
  }
  const addResident = async (index: number) => {
    const result = await apiCommand(token, 'addResident', [{ syndicId: cabinetId, buildingId: bId,
      name: `Monthly Resident ${index}`, email: `monthly-resident-${index}@ui.invalid`, phone: '0600000000',
      isOwner: true, apartmentId: initial.apartments[index].id }, false]);
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    return result.data.result;
  };
  await addResident(0);
  await page.goto(`${base}/welcome`);
  await page.evaluate(token => {
    localStorage.setItem('syndik_auth_session_v1', JSON.stringify({ serverToken: token }));
    localStorage.setItem('syndik_lang', 'fr');
  }, token);
  await page.goto(`${base}/financials`);
  await expect(page.getByText('Avant le premier encaissement : confirmez les soldes initiaux')).toBeVisible();
  await expect(page.getByLabel('Fonds courant MAD')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('opening-balances-mobile.png'), fullPage: true });
  const issue = async (expectedRows: number, weightedPreview = false) => {
    await page.getByRole('button', { name: 'Lancer un appel de fonds', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Période concernée').fill('2027-04');
    const weighted = dialog.getByRole('checkbox', { name: /Répartir un budget global/ });
    await expect(weighted).not.toBeChecked();
    const rows = dialog.getByRole('table', { name: 'Aperçu des cotisations' }).locator('tbody tr');
    await expect(rows).toHaveCount(expectedRows);
    for (const row of await rows.all()) await expect(row).toContainText(/250,00/);
    if (weightedPreview) {
      await weighted.check();
      await expect(rows.first()).toContainText(/261,00/);
      await weighted.uncheck();
      await expect(rows.first()).toContainText(/250,00/);
      await page.screenshot({ path: testInfo.outputPath('monthly-fee-preview-mobile.png') });
    }
    await dialog.getByRole('button', { name: 'Générer pour tous les lots' }).click();
    await expect(dialog).toBeHidden();
  };
  await issue(1, true);
  const resident2 = await addResident(1);
  await page.reload();
  await issue(2);
  await issue(2); // Reissuing the same month must not duplicate either resident's charge.
  let state = await disk();
  const issued = state.syndik_prod_charges_v1.filter((c: any) => c.buildingId === bId);
  expect(issued).toHaveLength(2);
  expect(issued.map((c: any) => c.amount)).toEqual([250, 250]);
  const charge = issued.find((c: any) => c.residentId === resident2.id);
  const uploaded = await apiCall(token, '/api/uploads', { buildingId: bId, name: 'monthly-receipt.pdf',
    dataUrl: `data:application/pdf;base64,${pdf.buffer.toString('base64')}` });
  expect(uploaded.status, JSON.stringify(uploaded.data)).toBe(200);
  const submitted = await apiCommand(token, 'submitPaymentProof', [{ chargeId: charge.id, amount: 250,
    receiptUrl: uploaded.data.url, bankName: 'Synthetic Bank', referenceNumber: 'MONTHLY-250', paymentMethod: 'virement' }]);
  expect(submitted.status, JSON.stringify(submitted.data)).toBe(200);
  const proofId = submitted.data.result.id;
  const blocked = await apiCommand(token, 'reviewPaymentProof', [proofId, 'approved']);
  expect(blocked.status).toBe(409);
  expect((await disk()).syndik_prod_proofs_v1.find((p: any) => p.id === proofId).status).toBe('pending');
  await page.reload(); // Load the proof submitted through the separate API session.
  await page.getByRole('button', { name: /Vérification des Virements/ }).click();
  await page.getByRole('button', { name: /Valider les virements conformes/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Confirmez les soldes initiaux' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Configurer les soldes initiaux' }).click();
  await expect(page.getByLabel('Fonds courant MAD')).toBeFocused();
  await page.getByLabel('Fonds courant MAD').fill('0');
  await page.getByLabel('Réserve MAD', { exact: true }).fill('0');
  await page.getByLabel('Motif de confirmation des soldes').fill('Verified zero opening funds for this new residence');
  await page.getByRole('button', { name: 'Confirmer une fois' }).click();
  await expect(page.getByRole('button', { name: 'Configurer les soldes initiaux' })).toHaveCount(0);
  await page.getByRole('button', { name: /Vérification des Virements/ }).click();
  await page.getByRole('button', { name: 'Valider & Délivrer Quittance' }).click();
  await expect.poll(async () => (await disk()).syndik_prod_proofs_v1.find((p: any) => p.id === proofId).status).toBe('approved');
  expect((await apiCommand(token, 'reviewPaymentProof', [proofId, 'approved'])).status).toBe(200);
  state = await disk();
  expect(state.syndik_prod_charges_v1.find((c: any) => c.id === charge.id)).toMatchObject({ amount: 250, paidAmount: 250, status: 'paid' });
  expect(state.syndik_prod_invoices_v1.find((i: any) => i.residentId === resident2.id)).toMatchObject({ totalAmount: 250, paidAmount: 250, status: 'paid' });
  expect(state.syndik_prod_quittances_v1.filter((q: any) => q.buildingId === bId)).toHaveLength(1);
  const financials = (await building()).financials;
  expect(financials.balance).toBe(237.5);
  expect(financials.reserveFundBalance).toBe(12.5);
  expect(financials.transactions.reduce((sum: number, t: any) => sum + t.amount, 0)).toBe(250);
  await expect(page.getByRole('button', { name: 'Valider & Délivrer Quittance' })).toHaveCount(0);
});

test('server validation returns safe field details instead of an unexplained save failure', async () => {
  const sessionResponse = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: profiles[0].email, password }) });
  const session = await sessionResponse.json();
  expect(sessionResponse.status, JSON.stringify(session)).toBe(200);
  const before = (await disk()).syndik_prod_syndics_v1[0].buildings[0].financials.transactions.length;
  const response = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ operation: 'addTransaction', args: ['b-ui', { description: 'Rejected negative magnitude', amount: -25, type: 'expense', fundType: 'courant', date: '2026-10-21' }], operationId: 'synthetic-invalid-amount-ui-1234' }) });
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(400);
  expect(JSON.parse(data.error)).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['amount'], code: 'too_small' })]));
  expect(data.error).not.toContain('stack');
  expect((await disk()).syndik_prod_syndics_v1[0].buildings[0].financials.transactions).toHaveLength(before);
});

test('session recovery: sign-in and account action routes stay reachable during an outage', async ({ page }) => {
  await login(page, 0);
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, json: { error: 'Synthetic session outage' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connexion au serveur interrompue' })).toBeVisible();
  await page.goto(`${base}/login`);
  await expect(page.getByRole('heading', { name: 'Connexion à votre espace' })).toBeVisible();
  await page.goto(`${base}/account-action?mode=reset&token=synthetic-link`);
  await expect(page.getByRole('heading', { name: 'Nouveau mot de passe' })).toBeVisible();
});

test('session recovery: malformed stored sessions return to sign-in instead of retrying forever', async ({ page }) => {
  await login(page, 0);
  for (const raw of ['null', '[]', '{', '{"serverToken":null}', '{"serverToken":12}', '{"serverToken":"invalid-session","profile":{"role":"admin"}}']) {
    await page.evaluate(raw => localStorage.setItem('syndik_auth_session_v1', raw), raw);
    await page.goto(`${base}/login`);
    await expect(page.getByRole('heading', { name: 'Connexion à votre espace' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connexion au serveur interrompue' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('syndik_auth_session_v1'))).toBeNull();
  }
});

test('session recovery: retry with no remaining saved session exits the interruption screen', async ({ page }) => {
  await login(page, 0);
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, json: { error: 'Synthetic session outage' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connexion au serveur interrompue' })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('syndik_auth_session_v1'));
  await page.getByRole('button', { name: 'Réessayer la connexion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connexion au serveur interrompue' })).toHaveCount(0);
  await page.goto(`${base}/login`);
  await expect(page.getByRole('heading', { name: 'Connexion à votre espace' })).toBeVisible();
});

test('session recovery: fresh sign-in cancels a hung verification and ignores its late result', async ({ page }) => {
  const token = await login(page, 0);
  let hang = false, waiting = false;
  let release!: () => void, finished!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const completed = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/api/auth/session', async route => {
    if (!hang) return route.fulfill({ status: 503, json: { error: 'Synthetic session outage' } });
    waiting = true;
    await gate;
    try { await route.fulfill({ status: 200, json: { ok: true, profile: profiles[0], token } }); }
    catch { /* The cancelled request is expected to reject a late response. */ }
    finally { finished(); }
  });
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connexion au serveur interrompue' })).toBeVisible();
    hang = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => waiting).toBe(true);
    await page.getByRole('button', { name: 'Se connecter à nouveau', exact: true }).click();
    await expect(page).toHaveURL(`${base}/login`);
    await expect(page.getByRole('heading', { name: 'Connexion à votre espace' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('syndik_auth_session_v1'))).toBeNull();
    release(); await completed;
    await expect(page.getByRole('heading', { name: 'Connexion à votre espace' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('syndik_auth_session_v1'))).toBeNull();
    const existing = await apiCall(token, '/api/shared-state');
    expect(existing.status).toBe(200); // Local recovery never deletes the account or revokes other sessions.
  } finally { release(); }
});

test('session recovery: temporary verification failure retains the verified view and its open draft', async ({ page }) => {
  await login(page, 0);
  await page.getByRole('button', { name: /Ajouter.*opération/i }).first().click();
  const dialog = page.getByRole('dialog');
  const description = await field(page, /Libellé/), amount = await field(page, /Montant/);
  await description.fill('Session recovery draft'); await amount.fill('37.45');
  await page.evaluate(() => { (window as any).__sessionRecoveryDocument = 'same-document'; });
  await page.route('**/api/auth/session', route => route.fulfill({ status: 503, json: { error: 'Synthetic session outage' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('syndik-session-invalid')));
  await expect(page.getByRole('status').filter({ hasText: 'Vérification de session indisponible' })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(description).toHaveValue('Session recovery draft'); await expect(amount).toHaveValue('37.45');
  await page.unroute('**/api/auth/session');
  const restored = page.waitForResponse(response => response.url().endsWith('/api/auth/session') && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await restored;
  await expect(page.getByRole('status').filter({ hasText: 'Vérification de session indisponible' })).toHaveCount(0);
  await expect(dialog).toBeVisible(); await expect(description).toHaveValue('Session recovery draft');
  await expect(amount).toHaveValue('37.45');
  expect(await page.evaluate(() => (window as any).__sessionRecoveryDocument)).toBe('same-document');
});

test('temporary session failures preserve credentials and offer retry instead of silently logging out', async ({ page }) => {
  await login(page, 0);
  for (const failure of ['server', 'network'] as const) {
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('syndik_auth_session_v1')!).serverToken);
    await page.route('**/api/auth/session', route => failure === 'server'
      ? route.fulfill({ status: 503, json: { error: 'Synthetic dependency outage' } }) : route.abort());
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connexion au serveur interrompue' })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('syndik_auth_session_v1')!).serverToken)).toBe(token);
    await page.unroute('**/api/auth/session');
    await page.getByRole('button', { name: 'Réessayer la connexion' }).click();
    await expect(page.getByRole('button', { name: 'Déconnexion' }).first()).toBeVisible();
  }
});

test('connection retry verifies the saved session without reloading and transient outages recover automatically', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(10_000);
  await login(page, 0);
  for (const automatic of [false, true]) {
    let available = false, failures = 0;
    await page.route('**/api/auth/session', route => {
      if (available || (automatic && failures >= 2)) return route.continue();
      failures++;
      return route.fulfill({ status: 503, json: { error: 'Synthetic temporary outage' } });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Connexion au serveur interrompue' })).toBeVisible();
    await page.evaluate(() => { (window as any).__retryProbe = 'keep-this-document'; });
    expect(await page.evaluate(() => !!JSON.parse(localStorage.getItem('syndik_auth_session_v1')!).serverToken)).toBe(true);
    if (!automatic) {
      available = true;
      await page.getByRole('button', { name: 'Réessayer la connexion', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Gestion Financière & Recouvrement' })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as any).__retryProbe)).toBe('keep-this-document');
    await page.unroute('**/api/auth/session');
  }
});

test('a newly created provider is assigned by ID through the maintenance form and can be unassigned', async ({ page }) => {
  page.setDefaultTimeout(10_000);
  const token = await login(page, 0);
  await page.goto(`${base}/prestataires`);
  await page.getByRole('button', { name: /Ajouter.*prestataire/i }).first().click();
  let dialog = page.getByRole('dialog');
  await (await field(page, /Nom de l'Entreprise/)).fill('Live Assignment Plumbing');
  await (await field(page, /Téléphone/)).fill('0600000093');
  await dialog.locator('input[type=checkbox]').last().uncheck();
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  const provider = (await disk()).syndik_prod_prestataires_v1.find((p: any) => p.name === 'Live Assignment Plumbing');
  expect(provider).toBeTruthy();
  const created = await apiCommand(token, 'addMaintenanceRequest', [{ buildingId: 'b-ui',
    title: 'Provider assignment browser regression', description: 'Synthetic plumbing request.', category: 'plumbing', priority: 'medium' }]);
  expect(created.status, JSON.stringify(created.data)).toBe(200);
  await page.goto(`${base}/maintenance`);
  await page.getByPlaceholder('Rechercher ascenseur, fuite, artisan...').fill('Provider assignment browser regression');
  await page.getByRole('button', { name: 'Mettre à jour statut & suivi' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Prestataire / Artisan assigné :', { exact: true }).selectOption(provider.id);
  await dialog.locator('select').first().selectOption('in_progress');
  await dialog.locator('textarea').fill('The selected plumber will inspect the leak.');
  await dialog.getByRole('button', { name: 'Enregistrer dans le journal' }).click();
  await expect(dialog).toBeHidden();
  const saved = () => disk().then(s => s.syndik_prod_maintenance_v1.find((m: any) => m.id === created.data.result.id));
  expect(await saved()).toMatchObject({ assignedTo: provider.id, prestataireId: provider.id, status: 'in_progress' });
  await expect(page.getByText(provider.name, { exact: true }).first()).toBeVisible();
  const rejected = await apiCommand(token, 'updateMaintenanceRequest', [created.data.result.id, { assignedTo: 'not-a-provider-in-this-building' }, { note: 'Rejected foreign assignment' }]);
  expect(rejected.status).toBe(400);
  expect((await saved()).prestataireId).toBe(provider.id);
  await page.getByRole('button', { name: 'Mettre à jour statut & suivi' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Prestataire / Artisan assigné :', { exact: true }).selectOption('');
  await dialog.locator('textarea').fill('The provider assignment has been withdrawn.');
  await dialog.getByRole('button', { name: 'Enregistrer dans le journal' }).click();
  await expect(dialog).toBeHidden();
  expect(await saved()).toMatchObject({ assignedTo: '', prestataireId: '' });
});

test('offline recovery preserves an open form and live changes appear without page navigation', async ({ page, context }) => {
  page.setDefaultTimeout(10_000);
  const token = await login(page, 0);
  await page.goto(`${base}/maintenance`);
  await page.getByRole('button', { name: 'Nouveau ticket travaux', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=text]').first().fill('Unsaved maintenance draft');
  await dialog.locator('textarea').fill('Keep this report while the connection recovers.');
  await page.evaluate(() => { (window as any).__liveProbe = 'original-document'; });
  try {
    await context.setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'Connexion interrompue' })).toBeVisible();
    const created = await apiCommand(token, 'addMaintenanceRequest', [{ buildingId: 'b-ui',
      title: 'Live change during offline interval', description: 'Created by a different client while this form is offline.', category: 'other', priority: 'low' }]);
    expect(created.status, JSON.stringify(created.data)).toBe(200);
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Live change during offline interval', exact: true })).toHaveCount(1, { timeout: 20_000 });
    await expect(dialog.locator('input[type=text]').first()).toHaveValue('Unsaved maintenance draft');
    await expect(dialog.locator('textarea')).toHaveValue('Keep this report while the connection recovers.');
    expect(await page.evaluate(() => (window as any).__liveProbe)).toBe('original-document');
    await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  } finally { await context.setOffline(false); }
});

test('live state changes update separate resident and syndic sessions through payment approval', async ({ page, browser }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  const owner = await login(page, 0);
  await page.locator('summary').filter({ hasText: 'Relevés, corrections et clôture' }).click();
  const statement = page.getByRole('table', { name: 'Relevés des résidents' }).getByRole('row').filter({ hasText: resident.name });
  await expect(statement).toBeVisible();
  await page.getByRole('button', { name: 'Maintenance', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nouveau ticket travaux', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Finances', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Relevés, corrections et clôture' }).click();
  await expect(statement).toBeVisible();
  const paidBefore = await statement.locator('td').nth(2).textContent();
  const imported = await apiCommand(owner, 'importOpeningArrears', ['b-ui', [{ residentId: 'r-ui', apartmentId: 'lot-ui',
    amount: 79.25, period: '2027-09', description: 'Live payment probe' }], 'Synthetic opening arrears for live regression']);
  expect(imported.status, JSON.stringify(imported.data)).toBe(200);
  const residentContext = await browser.newContext();
  const residentPage = await residentContext.newPage();
  residentPage.setDefaultTimeout(10_000);
  let releaseOldReport = () => {};
  const oldReportGate = new Promise<void>(resolve => { releaseOldReport = resolve; });
  try {
    await login(residentPage);
    await page.getByRole('button', { name: /Vérification des Virements/ }).click();
    const chargeRow = residentPage.getByText('Live payment probe', { exact: true }).locator('../..');
    await expect(chargeRow).toBeVisible();
    await page.evaluate(() => { (window as any).__liveProbe = 'syndic-original-document'; });
    await residentPage.evaluate(() => { (window as any).__liveProbe = 'resident-original-document'; });
    await chargeRow.getByRole('button', { name: 'Transmettre Justificatif', exact: true }).click();
    const modal = residentPage.getByRole('dialog');
    await modal.getByLabel("N° Référence / Numéro d'opération").fill('LIVE-CROSS-SESSION-79');
    await modal.getByLabel('Justificatif de paiement', { exact: true }).setInputFiles(pdf);
    await modal.getByRole('button', { name: 'Envoyer pour validation' }).click();
    await expect(modal).toBeHidden();
    const proofRow = page.locator('div.p-4').filter({ has: page.locator('strong', { hasText: 'LIVE-CROSS-SESSION-79' }) }).last();
    await expect(proofRow.getByRole('button', { name: 'Valider & Délivrer Quittance' })).toBeVisible({ timeout: 20_000 });
    let captured = false, oldReportReady = false;
    await page.route('**/api/reports?*', async route => {
      if (captured) return route.continue();
      captured = true;
      const response = await route.fetch();
      oldReportReady = true;
      await oldReportGate;
      await route.fulfill({ response }).catch(() => {});
    });
    const probe = await apiCommand(owner, 'addMaintenanceRequest', [{ buildingId: 'b-ui',
      title: 'Report concurrency probe', description: 'Trigger a report refresh before the payment changes.', category: 'other', priority: 'low' }]);
    expect(probe.status, JSON.stringify(probe.data)).toBe(200);
    await expect.poll(() => oldReportReady).toBe(true);
    await proofRow.getByRole('button', { name: 'Valider & Délivrer Quittance' }).click();
    await expect(chargeRow.getByText('✓ Réglé', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(chargeRow.getByRole('button', { name: 'Quittance PDF', exact: true })).toBeVisible();
    releaseOldReport();
    await expect(statement.locator('td').nth(2)).not.toHaveText(paidBefore!);
    const reports = await apiCall(owner, '/api/reports?buildingId=b-ui');
    const paid = reports.data.statements.find((row: any) => row.residentId === resident.id).paid;
    await expect(statement.locator('td').nth(2)).toHaveText(`${paid} MAD`);
    expect(await page.evaluate(() => (window as any).__liveProbe)).toBe('syndic-original-document');
    expect(await residentPage.evaluate(() => (window as any).__liveProbe)).toBe('resident-original-document');
    expect((await page.request.get(`${base}/api/events`)).status()).toBe(401);
  } finally { releaseOldReport(); await residentContext.close(); }
});

test('live updates fall back to background reads when the event stream is unavailable', async ({ page }) => {
  let streamAttempts = 0;
  const token = await login(page, 0);
  await page.route('**/api/events', route => {
    streamAttempts++;
    return route.fulfill({ status: 503, json: { error: 'Synthetic stream outage' } });
  });
  await page.goto(`${base}/maintenance`);
  await expect(page.getByRole('button', { name: 'Nouveau ticket travaux', exact: true })).toBeVisible();
  await expect.poll(() => streamAttempts).toBeGreaterThan(0);
  await page.evaluate(() => { (window as any).__liveProbe = 'polling-document'; });
  const created = await apiCommand(token, 'addMaintenanceRequest', [{ buildingId: 'b-ui',
    title: 'Fallback synchronization probe', description: 'Created while every event stream request fails.', category: 'other', priority: 'low' }]);
  expect(created.status, JSON.stringify(created.data)).toBe(200);
  await expect(page.getByRole('heading', { name: 'Fallback synchronization probe', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => (window as any).__liveProbe)).toBe('polling-document');
});

test('authenticated live events publish committed revisions without exposing business records', async () => {
  const token = await apiSession(0);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`${base}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const nextRevision = async () => {
      while (true) {
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (!data) continue;
          const payload = JSON.parse(data.slice(6));
          expect(Object.keys(payload)).toEqual(['revision']);
          expect(Number.isSafeInteger(payload.revision)).toBe(true);
          return payload.revision as number;
        }
        const chunk = await reader!.read();
        if (chunk.done) throw new Error('Live stream ended before a committed revision arrived');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };
    const initial = await nextRevision();
    const created = await apiCommand(token, 'addMaintenanceRequest', [{ buildingId: 'b-ui',
      title: 'Authenticated revision probe', description: 'This private description must not appear in the event stream.', category: 'other', priority: 'low' }]);
    expect(created.status, JSON.stringify(created.data)).toBe(200);
    expect(await nextRevision()).toBeGreaterThan(initial);
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader?.cancel().catch(() => {});
  }
});

test('database read failures offer recovery instead of claiming the account has no cabinet', async ({ page }) => {
  await login(page, 0);
  await page.route('**/api/shared-state*', route => route.fulfill({ status: 503, json: { error: 'Synthetic database outage' } }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Données temporairement indisponibles' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compte en attente de rattachement' })).toHaveCount(0);
  await page.unroute('**/api/shared-state*');
  await page.getByRole('button', { name: 'Réessayer le chargement' }).click();
  await expect(page.getByRole('button', { name: 'Déconnexion' }).first()).toBeVisible();
});

test('every syndic module renders through an authenticated navigation without browser exceptions', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 0);
  for (const route of ['/', '/buildings', '/apartments', '/residents', '/financials', '/announcements', '/documents', '/maintenance', '/ag', '/prestataires', '/chat', '/marketplace', '/analytics', '/settings']) {
    await page.goto(base + route);
    await expect(page.getByRole('button', { name: 'Déconnexion' }).first(), route).toBeVisible();
    await expect(page.locator('main'), route).toBeVisible();
    await expect(page.locator('main'), route).not.toHaveText('');
    await expect(page.getByText('Une erreur est survenue lors du chargement du module')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(route);
  }
  expect(errors).toEqual([]);
});

test('owner and tenant can visit every resident module and cannot enter admin or syndic routes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const profile of [1, 2]) {
    await login(page, profile);
    for (const name of ['Mon Logement & Finances', 'AG & Vote Digital', 'Incidents & Suivi', 'Chat Résidence', 'Prestataires & Artisans', 'Souk Voisins']) {
      await page.getByRole('button', { name: new RegExp(name) }).first().click();
      await expect(page.getByRole('button', { name: 'Déconnexion' }).first()).toBeVisible();
      await expect(page.getByText('Une erreur est survenue lors du chargement du module')).toHaveCount(0);
    }
    await page.goto(base + '/admin');
    await expect(page).toHaveURL(base + '/resident');
    await page.goto(base + '/financials');
    await expect(page).toHaveURL(base + '/resident');
  }
  expect(errors).toEqual([]);
});

async function apiSession(index: number) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: profiles[index].email, password }) });
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(200);
  return data.token as string;
}
async function apiCall(token: string, path: string, body?: unknown) {
  const response = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
const apiCommand = (token: string, operation: string, args: unknown[]) => apiCall(token, '/api/commands', { operation, args, operationId: crypto.randomUUID() });

test('maintenance assignment, private attachments, completion, notifications and accounting remain connected across roles', async () => {
  const owner = await apiSession(0), reporter = await apiSession(1), peer = await apiSession(2), provider = await apiSession(4);
  const before = (await disk()).syndik_prod_syndics_v1[0].buildings[0].financials;
  const upload = await apiCall(reporter, '/api/uploads', { buildingId: 'b-ui', name: 'private-maintenance.pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\nPRIVATE-MAINTENANCE-ATTACHMENT').toString('base64')}` });
  expect(upload.status, JSON.stringify(upload.data)).toBe(200);
  const fileStatus = async (token: string) => (await fetch(base + upload.data.url, { headers: { Authorization: `Bearer ${token}` } })).status;
  const created = await apiCommand(reporter, 'addMaintenanceRequest', [{ buildingId: 'b-ui', title: 'Connected maintenance cycle', description: 'Private file shared with the assigned provider only.', category: 'plumbing', priority: 'high', photos: [upload.data.url] }]);
  expect(created.status, JSON.stringify(created.data)).toBe(200);
  const id = created.data.result.id;
  expect(await fileStatus(peer)).toBe(403);
  expect(await fileStatus(provider)).toBe(403);
  const stolen = await apiCommand(peer, 'addMarketplaceItem', [{ buildingId: 'b-ui', title: 'Forbidden private file reuse', description: 'Cannot republish someone else\'s receipt.', price: 1, imageUrl: upload.data.url }]);
  expect(stolen.status).toBe(403);
  expect(await fileStatus(peer)).toBe(403);
  const assigned = await apiCommand(owner, 'updateMaintenanceRequest', [id, { prestataireId: 'p-ui', assignedTo: 'p-ui', status: 'in_progress', cost: 75 }, { note: 'Assigned after review' }]);
  expect(assigned.status, JSON.stringify(assigned.data)).toBe(200);
  expect(await fileStatus(provider)).toBe(200);
  expect((await apiCommand(peer, 'updateMaintenanceRequest', [id, { description: 'Unauthorized edit' }])).status).toBe(403);
  const completion = await apiCommand(provider, 'updateMaintenanceRequest', [id, { status: 'completed' }, { note: 'Repair complete, resident confirmation requested' }]);
  expect(completion.status, JSON.stringify(completion.data)).toBe(200);
  expect(completion.data.result).toMatchObject({ status: 'in_progress', completionPending: true });
  expect((await apiCommand(reporter, 'confirmMaintenanceCompletion', [id, 'Resident checked the repair'])).status).toBe(200);
  expect((await disk()).syndik_prod_maintenance_v1.find((m: any) => m.id === id)).toMatchObject({ status: 'completed', completionPending: false });
  const notices = (await apiCall(reporter, '/api/shared-state')).data.store.syndik_prod_notifications_v1;
  const notice = notices.find((n: any) => n.type === 'maintenance' && !n.read);
  expect(notice).toBeTruthy();
  expect((await apiCommand(reporter, 'markNotificationAsRead', [notice.id])).status).toBe(200);
  expect((await apiCommand(reporter, 'reopenMaintenance', [id, 'Issue returned after confirmation'])).status).toBe(200);
  expect((await apiCommand(owner, 'updateMaintenanceRequest', [id, { prestataireId: '', assignedTo: '' }, { note: 'Assignment removed' }])).status).toBe(200);
  expect(await fileStatus(provider)).toBe(403);
  expect((await disk()).syndik_prod_syndics_v1[0].buildings[0].financials).toEqual(before);
});

test('private chat attachments reach the named recipient and stay private to other accounts', async () => {
  const sender = await apiSession(1), recipient = await apiSession(2), provider = await apiSession(4);
  const upload = await apiCall(sender, '/api/uploads', { buildingId: 'b-ui', name: 'private-chat.pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4\nPRIVATE-CHAT-FILE').toString('base64')}` });
  expect(upload.status, JSON.stringify(upload.data)).toBe(200);
  const sent = await apiCommand(sender, 'sendChatMessage', [{ buildingId: 'b-ui', channelId: 'private', recipientId: 'peer-ui', content: 'Private file for the tenant', attachmentUrl: upload.data.url, attachmentName: 'private-chat.pdf' }]);
  expect(sent.status, JSON.stringify(sent.data)).toBe(200);
  const response = await fetch(base + upload.data.url, { headers: { Authorization: `Bearer ${recipient}` } });
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer()).toString()).toContain('PRIVATE-CHAT-FILE');
  expect((await fetch(base + upload.data.url, { headers: { Authorization: `Bearer ${provider}` } })).status).toBe(403);
  const providerState = await apiCall(provider, '/api/shared-state');
  expect(providerState.data.store.syndik_prod_chat_v1.some((m: any) => m.id === sent.data.result.id)).toBe(false);
});

test('deployment diagnostics expose safe configuration to managers and deny other roles', async () => {
  const owner = await apiSession(0), reporter = await apiSession(1), provider = await apiSession(4);
  const result = await apiCall(owner, '/api/diagnostics');
  expect(result.status).toBe(200);
  expect(result.data.sessionSecretConfigured).toBe(true);
  expect(result.data.database.read).toBe('ok');
  expect(result.data.storage.write).toBe('not_checked');
  expect(JSON.stringify(result.data)).not.toContain('synthetic-ui-server-secret');
  expect((await apiCall(reporter, '/api/diagnostics')).status).toBe(403);
  expect((await apiCall(provider, '/api/diagnostics')).status).toBe(403);
  const ready = await fetch(base + '/api/ready');
  expect(ready.status).toBe(200);
  expect((await ready.json()).checks).toEqual({ databaseRead: 'ok', storageWrite: 'not_checked' });
});

test('building archive confirmation preserves records and the archive view restores the building', async ({ page }) => {
  const token = await apiSession(0);
  const created = await apiCommand(token, 'addBuilding', ['s-ui', { name: 'Archive simulation', address: 'Synthetic archive address', city: 'Casablanca', monthlySyndicFees: 100 }]);
  expect(created.status, JSON.stringify(created.data)).toBe(200);
  const id = created.data.result.id;
  await login(page, 0);
  await page.goto(base + '/buildings');
  await page.getByRole('heading', { name: 'Archive simulation', exact: true }).locator('../..').getByTitle("Archiver l'immeuble").click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Les lots, résidents et historiques sont conservés');
  await expectRetryableFailure(page, "Archiver l'immeuble");
  await dialog.getByRole('button', { name: "Archiver l'immeuble", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Archive simulation', exact: true })).toHaveCount(0);
  expect((await disk()).syndik_prod_syndics_v1[0].buildings.find((b: any) => b.id === id).archivedAt).toBeTruthy();
  await page.locator('summary').filter({ hasText: 'Immeubles archivés' }).click();
  await page.evaluate(() => { (window as any).__archiveProbe = 'same-document'; });
  await page.getByRole('button', { name: 'Restaurer Archive simulation' }).click();
  await expect(page.getByRole('heading', { name: 'Archive simulation', exact: true })).toBeVisible();
  expect((await disk()).syndik_prod_syndics_v1[0].buildings.find((b: any) => b.id === id).archivedAt).toBeUndefined();
  expect(await page.evaluate(() => (window as any).__archiveProbe)).toBe('same-document');
  const archived = await apiCommand(token, 'deleteBuilding', [id]);
  expect(archived.status, JSON.stringify(archived.data)).toBe(200);
  await expect(page.getByRole('heading', { name: 'Archive simulation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restaurer Archive simulation' })).toBeVisible();
});

test('subscription capacity: archive frees a slot, restore enforces the limit and admin counts stay active-only', async ({ page }) => {
  test.setTimeout(90_000);
  const registered = await apiCall('', '/api/auth/register', {
    email: 'capacity-ui@ui.invalid', password,
    profile: { role: 'syndic', displayName: 'Capacity UI Manager' },
    syndic: { name: 'Capacity UI cabinet', city: 'Casablanca' },
  });
  expect(registered.status, JSON.stringify(registered.data)).toBe(200);
  const token = registered.data.token, cabinetId = registered.data.syndic.id;
  const original: any[] = [];
  for (let index = 0; index < 4; index++) {
    const created = await apiCommand(token, 'addBuilding', [cabinetId, { name: `Capacity residence ${index}`,
      address: 'Synthetic capacity address', city: 'Casablanca', monthlySyndicFees: 100 }]);
    expect(created.status, JSON.stringify(created.data)).toBe(200); original.push(created.data.result);
  }
  await page.goto(base + '/welcome');
  await page.evaluate(token => {
    localStorage.setItem('syndik_auth_session_v1', JSON.stringify({ serverToken: token }));
    localStorage.setItem('syndik_lang', 'fr');
  }, token);
  await page.goto(base + '/buildings');
  await expect(page.getByText('Utilisation : 4 / 4 immeubles', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ajouter.*immeuble/i }).first()).toBeDisabled();
  expect((await apiCommand(token, 'deleteBuilding', [original[3].id])).status).toBe(200);
  await expect(page.getByText('Utilisation : 3 / 4 immeubles', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Ajouter.*immeuble/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#bld-name').fill('Capacity replacement');
  await dialog.locator('#bld-address').fill('Synthetic replacement address');
  await dialog.locator('#bld-city').fill('Casablanca');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Capacity replacement', exact: true })).toBeVisible();
  await expect(page.getByText('Utilisation : 4 / 4 immeubles', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Immeubles archivés' }).click();
  await page.getByRole('button', { name: 'Restaurer Capacity residence 3', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /Limite.*forfait.*atteinte/ })).toBeVisible();
  expect((await disk()).syndik_prod_syndics_v1.find((s: any) => s.id === cabinetId).buildings.find((b: any) => b.id === original[3].id).archivedAt).toBeTruthy();
  expect((await apiCommand(token, 'deleteBuilding', [original[2].id])).status).toBe(200);
  await expect(page.getByText('Utilisation : 3 / 4 immeubles', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restaurer Capacity residence 3', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Capacity residence 3', exact: true })).toBeVisible();
  await expect(page.getByText('Utilisation : 4 / 4 immeubles', { exact: true })).toBeVisible();
  const stored = (await disk()).syndik_prod_syndics_v1.find((s: any) => s.id === cabinetId);
  expect(stored.buildings.filter((b: any) => !b.archivedAt)).toHaveLength(4);
  expect(stored.buildings.filter((b: any) => b.archivedAt)).toHaveLength(1);
  expect(stored.buildings.find((b: any) => b.id === original[3].id).financials).toEqual(original[3].financials);
  const all = (await disk()).syndik_prod_syndics_v1;
  const expected = all.filter((s: any) => !s.archivedAt).reduce((sum: number, s: any) => sum + s.buildings.filter((b: any) => !b.archivedAt).length, 0);
  await login(page, 3);
  await expect(page.getByText('Immeubles Gérés', { exact: true }).locator('..').getByText(String(expected), { exact: true })).toBeVisible();
});
