import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  randomUUID,
} from "node:crypto";
import type { State, StateRepository } from "./repository";
const key = () =>
  createHash("sha256")
    .update(process.env.SYNDIK_SERVER_SECRET || "")
    .digest();
export function encrypt(text: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  return [
    iv.toString("base64"),
    cipher.update(text, "utf8", "base64") + cipher.final("base64"),
    cipher.getAuthTag().toString("base64"),
  ].join(".");
}
export function decrypt(value: string) {
  const [iv, body, tag] = value.split("."),
    cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return cipher.update(body, "base64", "utf8") + cipher.final("utf8");
}
export function mailIsConfigured() {
  return (
    Boolean(
      process.env.SENDGRID_API_KEY &&
        process.env.SENDGRID_FROM_EMAIL &&
        process.env.PUBLIC_APP_URL,
    ) ||
    (process.env.NODE_ENV === "test" && process.env.SYNDIK_TEST_MODE === "true")
  );
}
export function queueMail(
  state: State,
  to: string,
  subject: string,
  text: string,
) {
  if (!mailIsConfigured())
    throw Object.assign(new Error("Email indisponible."), { status: 503 });
  const id = randomUUID();
  (state.__outbox ??= {})[id] = {
    id,
    to,
    subject,
    encryptedText: encrypt(text),
    status: "queued",
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
}
export async function deliverOutbox(repo: StateRepository, limit = 5) {
  if (!process.env.SENDGRID_API_KEY) return;
  for (let i = 0; i < limit; i++) {
    const item = await repo.transaction(async (s) => {
      const m: any = Object.values(s.__outbox || {}).find(
        (m: any) =>
          m.status !== "sent" &&
          m.attempts < 8 &&
          (m.nextAttemptAt || 0) <= Date.now() &&
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
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: item.to }] }],
          from: { email: process.env.SENDGRID_FROM_EMAIL, name: "ImmoGest" },
          subject: item.subject,
          content: [{ type: "text/plain", value: decrypt(item.encryptedText) }],
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
      if (sent) {
        m.sentAt = new Date().toISOString();
        delete m.encryptedText;
      }
    });
  }
}
