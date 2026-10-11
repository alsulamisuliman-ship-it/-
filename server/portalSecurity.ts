import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { parse } from "cookie";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const PORTAL_SESSION_COOKIE = "mizan_portal_session";

export async function hashPortalPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPortalPassword(password: string, stored: string) {
  const [algorithm, salt, encodedHash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encodedHash) return false;
  const expected = Buffer.from(encodedHash, "base64url");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function verifySupervisorAccessCode(value: string) {
  const configured = process.env.SUPERVISOR_ACCESS_CODE?.trim();
  if (!configured || configured.length < 8) return false;
  const candidate = createHash("sha256").update(value.trim()).digest();
  const expected = createHash("sha256").update(configured).digest();
  return timingSafeEqual(candidate, expected);
}

export function createPortalSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPortalSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function readPortalSessionToken(cookieHeader?: string) {
  if (!cookieHeader) return undefined;
  const token = parse(cookieHeader)[PORTAL_SESSION_COOKIE];
  return token && TOKEN_PATTERN.test(token) ? token : undefined;
}
