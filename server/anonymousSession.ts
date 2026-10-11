import { createHash, randomBytes } from "node:crypto";
import { parse } from "cookie";

export const GUEST_SESSION_COOKIE = "evaluation_guest_session";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createGuestSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function readGuestSessionToken(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  const token = parse(cookieHeader)[GUEST_SESSION_COOKIE];
  return token && TOKEN_PATTERN.test(token) ? token : undefined;
}

/** Store only a one-way digest in the user table; the browser keeps the secret token in an HttpOnly cookie. */
export function guestOpenIdFromToken(token: string): string {
  return `g${createHash("sha256").update(token).digest("hex").slice(0, 63)}`;
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxBuckets = 10_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= this.limit) return false;
    bucket.count += 1;
    if (this.buckets.size > this.maxBuckets) {
      this.buckets.forEach((value, bucketKey) => {
        if (this.buckets.size > this.maxBuckets && value.resetAt <= now) {
          this.buckets.delete(bucketKey);
        }
      });
    }
    return true;
  }
}
