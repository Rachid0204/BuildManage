import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { hashPasswordSync } from "../../utils/security";

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
const disk = () =>
  JSON.parse(readFileSync(join(directory, "shared-state.json"), "utf8"));

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
                },
              ],
              apartments: [
                {
                  id: "lot-ui",
                  buildingId: "b-ui",
                  number: "12",
                  ownerId: resident.id,
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
        SYNDIK_STATE_BACKEND: "file",
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
    disk().syndik_prod_marketplace_v1.filter(
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
  const state = disk();
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
      () =>
        disk().syndik_prod_proofs_v1.find((p: any) => p.id === proof.id)
          ?.status,
    )
    .toBe("approved");
  const posted = disk();
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
  const proof = disk().syndik_prod_proofs_v1.find(
    (p: any) => p.referenceNumber === "NEW-REF-AR",
  );
  expect(proof).toMatchObject({
    chargeId: "Monthly fees rejected",
    status: "pending",
    receiptNote: "إثبات جديد",
  });
  expect(
    disk().syndik_prod_proofs_v1.find((p: any) => p.id === "rejected-ui")
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
      () =>
        disk().syndik_prod_proofs_v1.find((p: any) => p.id === proof.id)
          ?.status,
    )
    .toBe("rejected");
  expect(
    disk().syndik_prod_proofs_v1.find((p: any) => p.id === proof.id)
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
  expect(disk().syndik_prod_syndics_v1[0].buildings.filter((b: any) => b.name === 'Form audit residence')).toHaveLength(1);
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
  expect(disk().syndik_prod_syndics_v1[0].buildings[0].apartments.some((a: any) => a.number === 'AUDIT-02')).toBe(true);

  await page.goto(`${base}/residents`);
  await page.getByRole('button', { name: /Ajouter.*résident/i }).click();
  dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/e-?mail/i);
  await dialog.locator('#res-name').fill('Form Audit Resident');
  await dialog.locator('#res-email').fill('new-resident@ui.invalid');
  await dialog.locator('#res-phone').fill('0600000099');
  const newLot = disk().syndik_prod_syndics_v1[0].buildings[0].apartments.find((a: any) => a.number === 'AUDIT-02');
  await dialog.locator('#res-apartment').selectOption(newLot.id);
  await dialog.locator('input[type=checkbox]').uncheck();
  await expectRetryableFailure(page, /Enregistrer/);
  await expect(dialog.locator('#res-email')).toHaveValue('new-resident@ui.invalid');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect(disk().syndik_prod_syndics_v1[0].buildings[0].residents.some((r: any) => r.email === 'new-resident@ui.invalid')).toBe(true);
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
  expect(disk().syndik_prod_maintenance_v1.find((r: any) => r.title === 'Form audit elevator')).toMatchObject({ priority: 'high', residentId: resident.id, status: 'pending' });
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
  expect(disk().syndik_prod_syndics_v1[0].buildings[0].announcements.some((a: any) => a.title === 'Form audit announcement')).toBe(true);

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
  expect(disk().syndik_prod_prestataires_v1.some((p: any) => p.name === 'Form Audit Plumbing')).toBe(true);

  await page.goto(`${base}/ag`);
  await page.getByRole('button', { name: /Planifier.*AG|Planifier.*Assemblée|Nouvelle.*AG|Convoquer/i }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.locator('button[type=submit]').click();
  await expect(dialog.getByRole('alert')).toContainText(/titre/i);
  await dialog.locator('input[type=text]').first().fill('Form audit assembly');
  await expectRetryableFailure(page, /Créer.*AG/);
  await dialog.locator('button[type=submit]').click();
  await expect(dialog).toBeHidden();
  expect(disk().syndik_prod_ag_v1.some((a: any) => a.title === 'Form audit assembly')).toBe(true);
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
  const entries = disk().syndik_prod_syndics_v1[0].buildings[0].financials.transactions.filter((t: any) => t.description === 'Form audit plumbing expense');
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
  expect(disk().syndik_prod_marketplace_v1.filter((item: any) => item.title === 'Uncertain publication response')).toHaveLength(1);
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
  await expect.poll(() => disk().syndik_prod_syndics_v1[0].name).toBe('Audited Cabinet');

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
  expect(disk().syndik_prod_chat_v1.filter((m: any) => m.content === 'Synthetic chat draft retained after failure')).toHaveLength(1);
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
  expect(disk().syndik_prod_syndics_v1.some((s: any) => s.name === 'Synthetic Admin Cabinet')).toBe(true);

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
  expect(disk().syndik_prod_maintenance_v1.find((r: any) => r.id === 'provider-ticket-ui').status).toBe('in_progress');
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
  expect(disk().syndik_prod_charges_v1.some((c: any) => c.period === '2027-02')).toBe(true);
});

test('server validation returns safe field details instead of an unexplained save failure', async () => {
  const sessionResponse = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: profiles[0].email, password }) });
  const session = await sessionResponse.json();
  expect(sessionResponse.status, JSON.stringify(session)).toBe(200);
  const before = disk().syndik_prod_syndics_v1[0].buildings[0].financials.transactions.length;
  const response = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: JSON.stringify({ operation: 'addTransaction', args: ['b-ui', { description: 'Rejected negative magnitude', amount: -25, type: 'expense', fundType: 'courant', date: '2026-10-21' }], operationId: 'synthetic-invalid-amount-ui-1234' }) });
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(400);
  expect(JSON.parse(data.error)).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['amount'], code: 'too_small' })]));
  expect(data.error).not.toContain('stack');
  expect(disk().syndik_prod_syndics_v1[0].buildings[0].financials.transactions).toHaveLength(before);
});
