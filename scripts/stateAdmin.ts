import { readFile, writeFile } from "node:fs/promises";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { createRepository, type State } from "../server/repository";
import { protectLegacyPassword } from "../server/passwords";
import { normalizeBillingPeriodKey } from "../shared/domain/billingPeriod";
const args = process.argv.slice(2),
  mode = args[0],
  option = (name: string) => args[args.indexOf(name) + 1],
  repo = createRepository();
function audit(state: State) {
  const errors: string[] = [],
    cabinets = state.syndik_prod_syndics_v1 || [],
    buildings = cabinets.flatMap((s: any) =>
      (s.buildings || []).map((b: any) => ({ ...b, syndicId: s.id })),
    ),
    seen = new Set<string>(),
    claimed = new Map<string, string>();
  for (const [key, rows] of Object.entries(state))
    if (key.startsWith("syndik_prod_")) {
      if (!Array.isArray(rows)) {
        errors.push(`${key}: expected an array`);
        continue;
      }
      const ids = new Set();
      for (const row of rows) {
        const id = row.id || row.uid || row.residentId || row.prestataireId;
        if (!id || ids.has(id))
          errors.push(`${key}: missing or duplicate identity`);
        ids.add(id);
      }
    }
  for (const charge of state.syndik_prod_charges_v1 || []) {
    const b = buildings.find(
      (b: any) => b.id === charge.buildingId && b.syndicId === charge.syndicId,
    );
    if (!b) errors.push(`Charge ${charge.id}: cabinet/building mismatch`);
    if (
      !Number.isFinite(charge.amount) ||
      charge.amount < 0 ||
      (charge.paidAmount || 0) > charge.amount + 0.005
    )
      errors.push(`Charge ${charge.id}: invalid balance`);
    const period =
        charge.periodKey || normalizeBillingPeriodKey(charge.period || ""),
      key = `${charge.buildingId}:${charge.apartmentId}:${period}:${charge.chargeType || "courante"}`;
    if (!charge.openingArrears && /^\d{4}-\d{2}$/.test(period)) {
      if (seen.has(key)) errors.push(`Duplicate billing event: ${key}`);
      seen.add(key);
    }
  }
  for (const invoice of state.syndik_prod_invoices_v1 || [])
    if (invoice.status !== "cancelled")
      for (const id of invoice.chargeIds || []) {
        if (claimed.has(id)) errors.push(`Charge ${id}: multiple invoices`);
        claimed.set(id, invoice.id);
      }
  return {
    cabinets: cabinets.length,
    buildings: buildings.length,
    charges: (state.syndik_prod_charges_v1 || []).length,
    invoices: (state.syndik_prod_invoices_v1 || []).length,
    errors,
  };
}
function backupKey() {
  const value = process.env.SYNDIK_BACKUP_KEY;
  if (!value || value.length < 32)
    throw new Error(
      "Set a separate SYNDIK_BACKUP_KEY of at least 32 random characters",
    );
  return createHash("sha256").update(value).digest();
}
if (mode === "export") {
  if (!args.includes("--out"))
    throw new Error(
      "Usage: state:admin export --out /secure/path/backup.enc.json",
    );
  const snapshot = await repo.transaction(async (state) =>
      JSON.parse(JSON.stringify(state)),
    ),
    report = audit(snapshot);
  if (report.errors.length) throw new Error(JSON.stringify(report));
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", backupKey(), iv),
    body = Buffer.concat([
      cipher.update(JSON.stringify(snapshot)),
      cipher.final(),
    ]);
  await writeFile(
    option("--out"),
    JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      body: body.toString("base64"),
    }),
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify({ exported: true, ...report }));
} else if (mode === "import") {
  if (!args.includes("--in"))
    throw new Error(
      "Usage: state:admin import --in backup.enc.json [--legacy-json] [--apply] [--replace]",
    );
  let snapshot = JSON.parse(await readFile(option("--in"), "utf8"));
  if (!args.includes("--legacy-json")) {
    if (snapshot.schemaVersion !== 1)
      throw new Error("Unsupported backup schema");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      backupKey(),
      Buffer.from(snapshot.iv, "base64"),
    );
    cipher.setAuthTag(Buffer.from(snapshot.tag, "base64"));
    snapshot = JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(snapshot.body, "base64")),
        cipher.final(),
      ]).toString(),
    );
  }
  const report = audit(snapshot);
  console.log(JSON.stringify({ dryRun: !args.includes("--apply"), ...report }));
  if (report.errors.length)
    throw new Error("Repair data conflicts before importing");
  if (args.includes("--apply"))
    await repo.transaction(async (state) => {
      if (
        Object.keys(state).some((key) => key.startsWith("syndik_prod_")) &&
        !args.includes("--replace")
      )
        throw new Error(
          "Target is not empty; --replace requires a maintenance-window restore",
        );
      for (const s of snapshot.syndik_prod_syndics_v1 || [])
        for (const b of s.buildings || []) {
          b.syndicId = s.id;
          for (const r of b.residents || [])
            for (const key of [
              "password",
              "passwordHash",
              "generatedPassword",
              "invitationCode",
              "invitationToken",
            ])
              delete r[key];
        }
      for (const p of snapshot.syndik_prod_prestataires_v1 || [])
        for (const key of [
          "password",
          "passwordHash",
          "generatedPassword",
          "invitationCode",
          "invitationToken",
        ])
          delete p[key];
      for (const key of [
        "syndik_prod_registered_users_v1",
        "syndik_prod_resident_accounts_v1",
        "syndik_prod_prestataire_accounts_v1",
      ])
        for (const account of snapshot[key] || []) {
          const secret = account.passwordHash || account.password;
          if (secret)
            account.passwordHash = protectLegacyPassword(
              secret,
              account.email || "",
            );
          delete account.password;
        }
      const versions = (snapshot.__sessionVersions ??= {});
      for (const user of snapshot.syndik_prod_registered_users_v1 || [])
        versions[user.uid] =
          Math.max(
            versions[user.uid] || 0,
            state.__sessionVersions?.[user.uid] || 0,
          ) + 1;
      snapshot.__identityActions = {};
      snapshot.__outbox = {};
      snapshot.__operations = {};
      snapshot.__restoredAt = new Date().toISOString();
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, snapshot);
    });
} else if (mode === "audit") {
  const report = await repo.transaction(async (state) => audit(state));
  console.log(JSON.stringify(report));
  if (report.errors.length) process.exitCode = 1;
} else
  throw new Error(
    "Choose export, import or audit. Import is a dry run unless --apply is present.",
  );

