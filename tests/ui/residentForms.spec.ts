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
  await page.goto(`${base}${index === 0 ? "/financials" : "/resident"}`);
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
  await page.unroute("**/api/commands");
  await submit.click();
  await expect(modal).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "Justificatif envoyé" }),
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
  await modal.getByLabel("إثبات الأداء", { exact: true }).setInputFiles(pdf);
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
