import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  randomUUID,
} from "node:crypto";
import { OperationError } from "./domain/errors";
import type { State, StateRepository } from "./repository";

type EncryptionKey = { kid: string; key: string };
type Keyring = { primary: EncryptionKey; retired: EncryptionKey[] };
const KID = /^[A-Za-z0-9_-]{1,64}$/;
const digestKey = (value: string) => createHash("sha256").update(value).digest();

function encryptionKeyring(): Keyring {
  const configured = process.env.SYNDIK_ENCRYPTION_KEYS;
  if (!configured) {
    // Compatibility for development and existing deployments during rollout.
    // Production configuration requires an explicit keyring.
    return { primary: { kid: "legacy-server", key: process.env.SYNDIK_SERVER_SECRET || "" }, retired: [] };
  }
  let value: any;
  try { value = JSON.parse(configured); }
  catch { throw new Error("SYNDIK_ENCRYPTION_KEYS must be valid JSON"); }
  const primary = value?.primary;
  const retired = value?.retired ?? [];
  const valid = (entry: any) => entry && typeof entry.kid === "string" && KID.test(entry.kid) &&
    typeof entry.key === "string" && entry.key.length >= 32;
  if (!valid(primary) || !Array.isArray(retired) || !retired.every(valid))
    throw new Error("SYNDIK_ENCRYPTION_KEYS requires a primary key and retired keys with kid and at least 32 characters");
  const kids = [primary.kid, ...retired.map((entry: EncryptionKey) => entry.kid)];
  if (new Set(kids).size !== kids.length)
    throw new Error("SYNDIK_ENCRYPTION_KEYS contains duplicate key identifiers");
  return { primary, retired };
}

function keyFor(entry: EncryptionKey) { return digestKey(entry.key); }
function legacyKey() { return digestKey(process.env.SYNDIK_SERVER_SECRET || ""); }
export function activeEncryptionKeyId() { return encryptionKeyring().primary.kid; }

export function encrypt(text: string) {
  const { primary } = encryptionKeyring();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(primary), iv);
  const body = cipher.update(text, "utf8", "base64") + cipher.final("base64");
  return "v2:" + primary.kid + ":" + [
    iv.toString("base64"), body, cipher.getAuthTag().toString("base64"),
  ].join(".");
}

export function decrypt(value: string) {
  let iv: string, body: string, tag: string, key: Buffer;
  if (value.startsWith("v2:")) {
    const separator = value.indexOf(":", 3);
    if (separator < 0) throw new Error("Invalid encrypted value");
    const kid = value.slice(3, separator);
    if (!KID.test(kid)) throw new Error("Invalid encryption key identifier");
    const { primary, retired } = encryptionKeyring();
    const entry = [primary, ...retired].find(candidate => candidate.kid === kid);
    if (!entry) throw new Error("Encryption key not available for kid " + kid);
    [iv, body, tag] = value.slice(separator + 1).split(".");
    key = keyFor(entry);
  } else if (value.startsWith("v1:")) {
    // v1 stored no key id and was encrypted with SHA-256(SYNDIK_SERVER_SECRET).
    [iv, body, tag] = value.slice(3).split(".");
    key = legacyKey();
  } else if (/^v[^:]*:/.test(value)) {
    throw new Error("Unsupported encryption version");
  } else {
    [iv, body, tag] = value.split(".");
    key = legacyKey();
  }
  if (!iv || !body || !tag || value.startsWith("v2:") && value.slice(value.indexOf(":", 3) + 1).split(".").length !== 3 ||
    !value.startsWith("v2:") && value.replace(/^v1:/, "").split(".").length !== 3)
    throw new Error("Invalid encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return decipher.update(body, "base64", "utf8") + decipher.final("utf8");
}

export function needsEncryptionRotation(value: string | undefined) {
  if (!value) return false;
  if (!value.startsWith("v2:")) return true;
  const separator = value.indexOf(":", 3);
  return separator < 0 || value.slice(3, separator) !== activeEncryptionKeyId();
}

export function reencryptDurableState(state: State) {
  const changed = { identityPlans: 0, identityResponses: 0, operationReceipts: 0, queuedMail: 0 };
  const rotate = (record: any, field: string, count: keyof typeof changed) => {
    if (typeof record?.[field] !== "string" || !needsEncryptionRotation(record[field])) return;
    record[field] = encrypt(decrypt(record[field]));
    changed[count]++;
  };
  for (const intent of Object.values(state.__firebaseMutations_v1 || {}) as any[]) {
    rotate(intent, "encryptedPlan", "identityPlans");
    rotate(intent, "encryptedResponse", "identityResponses");
  };
  for (const receipt of Object.values(state.__operations || {}) as any[])
    rotate(receipt, "encryptedResponse", "operationReceipts");
  for (const message of Object.values(state.__outbox || {}) as any[]) {
    if (message.status !== "sent") rotate(message, "encryptedText", "queuedMail");
  }
  return changed;
}

export function mailIsConfigured() {
  return (
    Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL && process.env.PUBLIC_APP_URL) ||
    (process.env.NODE_ENV === "test" && process.env.SYNDIK_TEST_MODE === "true")
  );
}
export function queueMail(state: State, to: string, subject: string, text: string) {
  if (!mailIsConfigured())
    throw new OperationError("Email indisponible.", 503);
  const id = randomUUID();
  (state.__outbox ??= {})[id] = {
    id, to, subject, encryptedText: encrypt(text), status: "queued", attempts: 0,
    createdAt: new Date().toISOString(),
  };
}
export async function deliverOutbox(repo: StateRepository, limit = 5) {
  if (!process.env.SENDGRID_API_KEY) return;
  for (let i = 0; i < limit; i++) {
    const item = await repo.transaction(async (s) => {
      const m: any = Object.values(s.__outbox || {}).find((m: any) =>
        m.status !== "sent" && m.attempts < 8 && (m.nextAttemptAt || 0) <= Date.now() &&
        (m.leaseUntil || 0) < Date.now(),
      );
      if (!m) return;
      m.status = "sending";
      m.leaseUntil = Date.now() + 60000;
      m.attempts++;
      return JSON.parse(JSON.stringify(m));
    });
    if (!item) return;
    let sent = false;
    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: "Bearer " + process.env.SENDGRID_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: item.to }] }],
          from: { email: process.env.SENDGRID_FROM_EMAIL, name: "ImmoGest" },
          subject: item.subject, content: [{ type: "text/plain", value: decrypt(item.encryptedText) }],
        }),
      });
      sent = response.ok;
    } catch {}
    await repo.transaction(async (s) => {
      const m = s.__outbox?.[item.id];
      if (!m) return;
      m.status = sent ? "sent" : "failed";
      m.leaseUntil = 0;
      m.nextAttemptAt = Date.now() + Math.min(3600000, 30000 * 2 ** m.attempts);
      if (sent) { m.sentAt = new Date().toISOString(); delete m.encryptedText; }
    });
  }
}
