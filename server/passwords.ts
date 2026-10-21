import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  hashPasswordSync,
  verifyPasswordSync,
  isAlreadyHashedPassword,
} from "../utils/security";
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(value: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$v1$${salt}$${scryptSync(value, salt, 64, options).toString("hex")}`;
}
export function verifyPassword(
  value: string,
  stored?: string,
  email = "",
): boolean {
  if (!stored || !value || isAlreadyHashedPassword(value)) return false;
  if (!stored.startsWith("scrypt$"))
    return verifyPasswordSync(value, stored, email);
  const parts = stored.split("$");
  const legacy = parts[1] === "legacy-v1",
    salt = parts[legacy ? 3 : 2],
    digest = parts[legacy ? 4 : 3];
  if (
    (parts[1] !== "v1" && !legacy) ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(digest || "")
  )
    return false;
  const candidate = legacy
    ? hashPasswordSync(value, Buffer.from(parts[2], "base64url").toString())
    : value;
  return timingSafeEqual(
    scryptSync(candidate, salt, 64, options),
    Buffer.from(digest, "hex"),
  );
}
export function protectLegacyPassword(stored: string, email: string): string {
  if (stored.startsWith("scrypt$")) return stored;
  if (!stored.startsWith("sha256$")) return hashPassword(stored);
  const salt = randomBytes(16).toString("hex");
  return `scrypt$legacy-v1$${Buffer.from(email.trim().toLowerCase()).toString("base64url")}$${salt}$${scryptSync(stored, salt, 64, options).toString("hex")}`;
}
