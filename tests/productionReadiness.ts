import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { hashPasswordSync } from "../utils/security";
import { decrypt } from "../server/mailer";
const root = resolve(import.meta.dirname, ".."),
  directory = mkdtempSync(join(tmpdir(), "buildmanage-operations-")),
  secret = "synthetic-server-secret-12345678901234567890",
  password = "Synthetic-Password-42!";
process.env.SYNDIK_SERVER_SECRET = secret;
const owner = {
    uid: "owner-a",
    email: "owner@audit.invalid",
    displayName: "Owner A",
    role: "syndic",
    syndicId: "s-a",
    emailVerified: true,
  },
  admin = {
    uid: "admin-a",
    email: "admin@audit.invalid",
    role: "admin",
    displayName: "Admin",
  },
  provider = {
    uid: "user-prest-p-a",
    email: "provider@audit.invalid",
    role: "provider",
    syndicId: "s-a",
    buildingId: "b-a",
    prestataireId: "p-a",
  };
const person = (id: string) => ({
  id,
  name: id,
  email: `${id}@audit.invalid`,
  phone: "0600000000",
  isOwner: true,
  hasAccount: true,
  mustChangePassword: false,
  buildingId: "b-a",
  syndicId: "s-a",
});
const profile = (id: string) => ({
  uid: `user-res-${id}`,
  email: `${id}@audit.invalid`,
  role: "resident",
  displayName: id,
  residentId: id,
  syndicId: id === "r-b" ? "s-b" : "s-a",
  buildingId: id === "r-b" ? "b-b" : "b-a",
});
const account = (p: any) => ({
  uid: p.uid,
  email: p.email,
  passwordHash: hashPasswordSync(password, p.email),
  profile: p,
});
const seed = {
  syndik_prod_registered_users_v1: [
    owner,
    admin,
    provider,
    profile("r-a"),
    profile("r-o"),
    profile("r-b"),
  ].map(account),
  syndik_prod_syndics_v1: [
    {
      id: "s-a",
      name: "Cabinet A",
      createdBy: owner.uid,
      subscriptionPlan: "starter",
      subscriptionStatus: "trialing",
      subscriptionExpiry: "2099-01-01",
      buildings: [
        {
          id: "b-a",
          syndicId: "s-a",
          name: "Building A",
          address: "Test address",
          city: "Casablanca",
          monthlySyndicFees: 100,
          totalTantiemes: 1000,
          reserveFundRate: 5,
          residents: [person("r-a"), person("r-o")],
          apartments: [
            {
              id: "lot-a",
              buildingId: "b-a",
              number: "1",
              ownerId: "r-a",
              floor: 1,
              area: 80,
              monthlyFees: 100,
              tantiemes: 500,
            },
            {
              id: "lot-o",
              buildingId: "b-a",
              number: "2",
              ownerId: "r-o",
              floor: 1,
              area: 80,
              monthlyFees: 100,
              tantiemes: 500,
            },
          ],
          documents: [],
          financials: { balance: 0, reserveFundBalance: 0, transactions: [] },
        },
      ],
    },
    {
      id: "s-b",
      name: "Cabinet B",
      createdBy: "owner-b",
      subscriptionPlan: "starter",
      subscriptionStatus: "active",
      subscriptionExpiry: "2099-01-01",
      buildings: [
        {
          id: "b-b",
          syndicId: "s-b",
          residents: [person("r-b")],
          apartments: [],
        },
      ],
    },
  ],
  syndik_prod_prestataires_v1: [
    {
      id: "p-a",
      buildingId: "b-a",
      syndicId: "s-a",
      email: provider.email,
      name: "Provider A",
      hasAccount: true,
    },
  ],
  syndik_prod_maintenance_v1: [
    {
      id: "m-own",
      buildingId: "b-a",
      residentId: "r-a",
      prestataireId: "p-a",
      status: "in_progress",
      description: "Own request",
    },
    {
      id: "m-other",
      buildingId: "b-a",
      residentId: "r-o",
      status: "pending",
      description: "Other request",
    },
  ],
};
writeFileSync(join(directory, "shared-state.json"), JSON.stringify(seed));
const processes: ChildProcess[] = [];
async function start() {
  const port = await new Promise<number>((resolvePort) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as any).port;
      s.close(() => resolvePort(p));
    });
  });
  const child = spawn(
    process.execPath,
    [
      "--import",
      "./tests/helpers/networkGuard.mjs",
      "--import",
      "tsx",
      "server.ts",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "test",
        SYNDIK_STATE_BACKEND: "file",
        SYNDIK_TEST_MODE: "true",
        SYNDIK_DATA_DIR: directory,
        SYNDIK_SERVER_SECRET: secret,
        SYNDIK_SCHEDULER_SECRET: secret,
        GEMINI_API_KEY: "",
        SENDGRID_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  processes.push(child);
  let logs = "";
  await new Promise<void>((ready, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Startup timeout: " + logs)),
      20000,
    );
    child.stdout!.on("data", (d) => {
      logs += d;
      if (String(d).includes("Server running")) {
        clearTimeout(timer);
        ready();
      }
    });
    child.stderr!.on("data", (d) => (logs += d));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Exited ${code}: ${logs}`));
    });
  });
  return `http://127.0.0.1:${port}`;
}
async function call(
  base: string,
  route: string,
  token?: string,
  body?: any,
  headers: any = {},
) {
  const response = await fetch(base + route, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
  return { status: response.status, data: (await response.json()) as any };
}
async function login(base: string, email: string, pass = password) {
  const r = await call(base, "/api/auth/login", undefined, {
    identifier: email,
    password: pass,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}
const command = (
  base: string,
  token: string,
  operation: string,
  args: any[],
  id = crypto.randomUUID(),
) => call(base, "/api/commands", token, { operation, args, operationId: id });
const disk = () =>
  JSON.parse(readFileSync(join(directory, "shared-state.json"), "utf8"));
try {
  const [base, second] = await Promise.all([start(), start()]),
    o = await login(base, owner.email),
    a = await login(base, admin.email),
    r = await login(base, "r-a@audit.invalid"),
    p = await login(base, provider.email);
  assert.ok(
    disk()
      .syndik_prod_registered_users_v1.find((u: any) => u.uid === owner.uid)
      .passwordHash.startsWith("scrypt$v1$"),
  );
  assert.equal((await call(second, "/api/auth/session", o)).status, 200);
  assert.equal(
    (
      await call(base, "/api/shared-state", r, {
        key: "syndik_prod_maintenance_v1",
        value: { replaceAll: true },
      })
    ).status,
    403,
  );
  assert.equal(disk().syndik_prod_maintenance_v1.length, 2);
  assert.equal(
    (
      await command(base, r, "updateMaintenanceRequest", [
        "m-other",
        { status: "completed" },
      ])
    ).status,
    403,
  );
  assert.equal(
    (
      await command(base, p, "updateMaintenanceRequest", [
        "m-other",
        { status: "completed" },
      ])
    ).status,
    403,
  );
  const completion = await command(base, p, "updateMaintenanceRequest", [
    "m-own",
    { status: "completed" },
    { note: "Completed by provider" },
  ]);
  assert.equal(completion.status, 200, JSON.stringify(completion.data));
  assert.equal(completion.data.result.status, "in_progress");
  assert.equal(
    (
      await command(base, r, "confirmMaintenanceCompletion", [
        "m-own",
        "Confirmed by resident",
      ])
    ).status,
    200,
  );
  console.log(
    "PASS: malformed snapshot denial, record ownership and provider/resident completion.",
  );
  assert.equal(
    (
      await command(base, o, "setOpeningBalances", [
        "b-a",
        { working: 0, reserve: 0, reason: "Verified zero balances" },
      ])
    ).status,
    200,
  );
  const billing = await command(base, o, "generateMonthlyCharges", [
    "b-a",
    "s-a",
    "2026-10",
  ]);
  assert.equal(billing.status, 200, JSON.stringify(billing.data));
  assert.equal(billing.data.result.length, 2);
  const invoice = disk().syndik_prod_invoices_v1.find(
    (i: any) => i.residentId === "r-a",
  );
  assert.ok(invoice.items.length);
  const payments = await Promise.all([
    command(base, o, "recordPayment", [
      invoice,
      60,
      "virement",
      "synthetic-bank-60",
    ]),
    command(second, o, "recordPayment", [
      invoice,
      40,
      "virement",
      "synthetic-bank-40",
    ]),
  ]);
  assert.deepEqual(
    payments.map((x) => x.status),
    [200, 200],
    JSON.stringify(payments),
  );
  let current = disk();
  assert.equal(
    current.syndik_prod_invoices_v1.find((i: any) => i.id === invoice.id)
      .paidAmount,
    100,
  );
  assert.equal(
    current.syndik_prod_syndics_v1[0].buildings[0].financials.balance,
    95,
  );
  assert.equal(
    current.syndik_prod_syndics_v1[0].buildings[0].financials
      .reserveFundBalance,
    5,
  );
  assert.equal(
    (
      await command(second, o, "recordPayment", [
        invoice,
        60,
        "virement",
        "synthetic-bank-60",
      ])
    ).status,
    200,
  );
  const before = JSON.stringify(disk());
  assert.equal(
    (
      await command(base, o, "recordPayment", [
        invoice,
        1,
        "virement",
        "synthetic-overpayment",
      ])
    ).status,
    400,
  );
  assert.equal(JSON.stringify(disk()), before);
  const originalReceipt = await command(base, o, "generateQuittanceForCharge", [
    invoice.chargeIds[0],
  ]);
  assert.equal(
    originalReceipt.status,
    200,
    JSON.stringify(originalReceipt.data),
  );
  assert.equal(
    (
      await command(base, o, "reversePayment", [
        "b-a",
        "synthetic-bank-40",
        "Correction reason",
      ])
    ).status,
    200,
  );
  assert.equal(
    disk().syndik_prod_invoices_v1.find((i: any) => i.id === invoice.id)
      .paidAmount,
    60,
  );
  assert.equal(
    (
      await command(base, o, "reversePayment", [
        "b-a",
        "synthetic-bank-40",
        "Duplicate",
      ])
    ).status,
    409,
  );
  assert.ok(
    disk().syndik_prod_quittances_v1.find(
      (q: any) => q.id === originalReceipt.data.result.id,
    ).voidedAt,
  );
  const correctedReceipt = await command(
    base,
    o,
    "generateQuittanceForCharge",
    [invoice.chargeIds[0]],
  );
  assert.equal(
    correctedReceipt.status,
    200,
    JSON.stringify(correctedReceipt.data),
  );
  assert.equal(correctedReceipt.data.result.amount, 60);
  const period = new Date().toISOString().slice(0, 7),
    key = crypto.randomUUID();
  assert.equal(
    (
      await command(
        base,
        o,
        "closeFinancialPeriod",
        ["b-a", period, "Month reviewed"],
        key,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await command(base, o, "recordPayment", [
        invoice,
        40,
        "virement",
        "closed-payment",
      ])
    ).status,
    409,
  );
  assert.equal(
    (
      await command(base, a, "reopenFinancialPeriod", [
        "b-a",
        period,
        "Authorized reopening",
      ])
    ).status,
    200,
  );
  assert.equal(
    (
      await command(
        base,
        o,
        "closeFinancialPeriod",
        ["b-a", "2026-01", "Different"],
        key,
      )
    ).status,
    409,
  );
  console.log(
    "PASS: cross-process concurrent payments, exact fund split, retries, rollback, reversals and period locks.",
  );
  const scope = await call(base, "/api/shared-state", r);
  assert.equal(scope.data.store.syndik_prod_maintenance_v1.length, 1);
  assert.ok(!JSON.stringify(scope.data.store).includes("scrypt$"));
  const report = await call(base, "/api/reports?buildingId=b-a", r);
  assert.equal(report.status, 200);
  assert.equal(report.data.statements.length, 1);
  assert.equal(report.data.statements[0].outstanding, 40);
  assert.equal(report.data.ledger.length, 0);
  assert.equal(
    (await call(base, "/api/reports?buildingId=b-b", r)).status,
    403,
  );
  const message = await command(base, r, "sendChatMessage", [
    {
      buildingId: "b-a",
      channelId: "private",
      senderId: "spoof",
      senderRole: "admin",
      recipientId: "r-o",
      content: "Private message",
    },
  ]);
  assert.equal(message.status, 200);
  assert.equal(message.data.result.senderId, "r-a");
  const raw70k = Buffer.alloc(70000);
  for (let i = 0; i < raw70k.length; i++) raw70k[i] = i % 251;
  Buffer.from("%PDF-1.4\n").copy(raw70k);
  const upload = await call(base, "/api/uploads", r, {
    buildingId: "b-a",
    name: "proof.pdf",
    dataUrl: "data:application/pdf;base64," + raw70k.toString("base64"),
  });
  assert.equal(upload.status, 200);
  assert.deepEqual(
    Buffer.from(
      await (
        await fetch(base + upload.data.url, {
          headers: { Authorization: `Bearer ${r}` },
        })
      ).arrayBuffer(),
    ),
    raw70k,
  );
  const other = await login(base, "r-o@audit.invalid");
  assert.equal(
    (
      await fetch(base + upload.data.url, {
        headers: { Authorization: `Bearer ${other}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(base, "/api/uploads", r, {
        buildingId: "b-a",
        name: "evil.html",
        dataUrl: "data:text/html;base64,PHNjcmlwdD4=",
      })
    ).status,
    400,
  );
  console.log(
    "PASS: scoped finance exports, private files, safe upload types and server-owned chat identity.",
  );
  const creation = await command(base, o, "createAssembleeGenerale", [
    {
      buildingId: "b-a",
      title: "Synthetic AG",
      date: "2026-10-21",
      time: "18:00",
      type: "ordinaire",
      location: "Hall",
      totalTantiemes: 1,
      quorumRequired: 1,
      resolutions: [
        {
          id: "res-a",
          title: "Budget",
          description: "Test",
          majorityType: "simple",
          budgetAmount: 20,
          votesFor: 99999,
          status: "approved",
        },
      ],
    },
  ]);
  assert.equal(creation.status, 200, JSON.stringify(creation.data));
  const ag = creation.data.result;
  assert.equal(ag.totalTantiemes, 1000);
  assert.equal(ag.resolutions[0].votesFor, 0);
  assert.equal(
    (await command(base, o, "toggleAGVoting", [ag.id, true])).status,
    200,
  );
  assert.equal(
    (
      await call(base, "/api/ag/vote", r, {
        agId: ag.id,
        resolutionId: "res-a",
        apartmentId: "lot-a",
        choice: "for",
        tantiemes: 99999,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await command(base, o, "recordAGVote", [
        ag.id,
        "res-a",
        "for",
        99999,
        { residentId: "r-o", apartmentId: "lot-o" },
      ])
    ).status,
    200,
  );
  assert.equal(
    (await command(base, o, "updateAGAttendee", [ag.id, "r-a", "absent"]))
      .status,
    409,
  );
  const live = disk().syndik_prod_ag_v1.find((x: any) => x.id === ag.id);
  assert.equal(
    (
      await command(base, o, "saveAssembleeGenerale", [
        {
          ...live,
          status: "completed",
          resolutions: live.resolutions.map((x: any) => ({
            ...x,
            votesFor: 99999,
          })),
        },
      ])
    ).status,
    200,
  );
  assert.equal(
    disk().syndik_prod_ag_v1.find((x: any) => x.id === ag.id).resolutions[0]
      .votesFor,
    1000,
  );
  assert.equal(
    (
      await command(base, o, "generateChargesFromAGResolution", [
        ag.id,
        "res-a",
      ])
    ).status,
    200,
  );
  console.log(
    "PASS: server-owned voting roll, named-lot weights, immutable finalized results.",
  );
  const changed = await command(base, o, "updateResident", [
    { ...person("r-o"), email: "new-owner@audit.invalid" },
  ]);
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const invitation =
    changed.data.result.invitationCode || changed.data.result.invitationToken;
  assert.ok(invitation && invitation.length > 25);
  assert.ok(
    !readFileSync(join(directory, "shared-state.json"), "utf8").includes(
      invitation,
    ),
  );
  assert.equal((await call(second, "/api/auth/session", other)).status, 401);
  const invited = await login(base, "new-owner@audit.invalid", invitation);
  assert.equal(
    (
      await command(base, invited, "sendChatMessage", [
        {
          buildingId: "b-a",
          channelId: "general",
          content: "Before password change",
        },
      ])
    ).status,
    403,
  );
  console.log(
    "PASS: account email changes regenerate strong invitations, encrypt retry data and revoke previous sessions.",
  );

  assert.equal(
    (
      await command(base, a, "saveSyndic", [
        { ...disk().syndik_prod_syndics_v1[0], subscriptionStatus: "expired" },
      ])
    ).status,
    200,
  );
  assert.equal(
    (await command(base, o, "addBuilding", ["s-a", { name: "Forbidden" }]))
      .status,
    402,
  );
  assert.equal(
    (
      await command(base, a, "recordSubscriptionPayment", [
        {
          syndicId: "s-a",
          plan: "starter",
          months: 1,
          amount: 200,
          reference: "synthetic-platform-payment",
        },
      ])
    ).status,
    200,
  );
  assert.equal(disk().syndik_prod_subscription_payments_v1.length, 1);
  for (let i = 0; i < 3; i++) {
    const result = await command(base, o, "addBuilding", [
      "s-a",
      {
        name: `Building ${i}`,
        address: "Test address",
        city: "Casablanca",
        monthlySyndicFees: 0,
        apartments: [],
      },
    ]);
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  assert.equal(
    (
      await command(base, o, "addBuilding", [
        "s-a",
        {
          name: "Fifth",
          address: "Test address",
          city: "Casablanca",
          monthlySyndicFees: 0,
          apartments: [],
        },
      ])
    ).status,
    409,
  );
  console.log(
    "PASS: backend expiry, separate platform subscription receipts and building limit.",
  );
  assert.equal(
    (
      await call(base, "/api/auth/recovery/request", undefined, {
        email: owner.email,
      })
    ).status,
    200,
  );
  const mail: any = Object.values(disk().__outbox).find(
    (m: any) => m.to === owner.email,
  );
  const text = decrypt(mail.encryptedText),
    link = text.match(/http[^\s]+/)![0],
    token = new URL(link).searchParams.get("token"),
    replacement = "New-Synthetic-Password-43!";
  assert.equal(
    (
      await call(base, "/api/auth/recovery/complete", undefined, {
        token,
        password: replacement,
      })
    ).status,
    200,
  );
  assert.equal((await call(second, "/api/auth/session", o)).status, 401);
  assert.equal(
    (
      await call(base, "/api/auth/recovery/complete", undefined, {
        token,
        password: replacement,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(base, "/api/auth/login", undefined, {
        identifier: owner.email,
        password,
      })
    ).status,
    401,
  );
  const fresh = await login(base, owner.email, replacement);
  assert.equal((await call(base, "/api/auth/logout", fresh, {})).status, 200);
  assert.equal((await call(second, "/api/auth/session", fresh)).status, 401);
  assert.equal(
    (await call(base, "/api/jobs/monthly-charges", undefined, {})).status,
    403,
  );
  const job = await call(
    base,
    "/api/jobs/monthly-charges",
    undefined,
    {},
    { "X-Syndik-Scheduler": secret },
  );
  assert.equal(job.status, 200, JSON.stringify(job.data));
  assert.equal(
    disk().syndik_prod_charges_v1.filter(
      (c: any) =>
        c.buildingId === "b-a" &&
        c.periodKey === "2026-10" &&
        c.chargeType === "courante",
    ).length,
    2,
  );
  for (const child of processes) child.kill("SIGTERM");
  await Promise.all(
    processes.map(
      (child) =>
        new Promise<void>((done) =>
          child.exitCode !== null || child.signalCode !== null
            ? done()
            : child.once("exit", () => done()),
        ),
    ),
  );
  const restarted = await start();
  await login(restarted, owner.email, replacement);
  assert.equal(disk().syndik_prod_subscription_payments_v1.length, 1);
  console.log(
    "PASS: encrypted recovery, single-use tokens, legacy hash upgrade, cross-instance session revocation, unified scheduled billing and restart durability.",
  );
} finally {
  for (const child of processes)
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  await Promise.all(
    processes.map(
      (child) =>
        new Promise<void>((done) =>
          child.exitCode !== null || child.signalCode !== null
            ? done()
            : child.once("exit", () => done()),
        ),
    ),
  );
  rmSync(directory, { recursive: true, force: true });
}
