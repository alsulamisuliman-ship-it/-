import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { reportFileChunks } from "../drizzle/schema";
import { getDb } from "./db";

export function storageRoot() {
  return path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), ".local-storage"));
}

export function resolveStorageKey(key: string) {
  if (!key || key.includes("\\") || key.includes("\0") || key.startsWith("/") || key.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error("Invalid storage key");
  }
  return path.join(storageRoot(), "files", key);
}

function databaseStorage() {
  return process.env.STORAGE_BACKEND === "database";
}

async function requireStorageDb() {
  const db = await getDb();
  if (!db) throw new Error("Database storage requires DATABASE_URL");
  return db;
}

async function signingSecret() {
  if (process.env.STORAGE_SIGNING_SECRET) return process.env.STORAGE_SIGNING_SECRET;
  if (databaseStorage()) throw new Error("Database storage requires STORAGE_SIGNING_SECRET");
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const secretPath = path.join(root, ".signing-secret");
  try {
    await writeFile(secretPath, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readFile(secretPath, "utf8");
}

async function signature(key: string, expires: number) {
  return createHmac("sha256", await signingSecret()).update(`${key}\n${expires}`).digest("hex");
}

export async function verifyStorageSignature(key: string, expires: number, token: string) {
  resolveStorageKey(key);
  if (!Number.isSafeInteger(expires) || expires <= Date.now() || expires > Date.now() + 11 * 60_000 || !/^[a-f0-9]{64}$/.test(token)) return false;
  const expected = Buffer.from(await signature(key, expires), "hex");
  return timingSafeEqual(expected, Buffer.from(token, "hex"));
}

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, _contentType = "application/octet-stream"): Promise<{ key: string; url: string }> {
  resolveStorageKey(relKey);
  const extension = path.posix.extname(relKey);
  const stem = extension ? relKey.slice(0, -extension.length) : relKey;
  const key = `${stem}_${randomBytes(16).toString("hex")}${extension}`;
  const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error("Invalid report file size");
  if (databaseStorage()) {
    // Fail before writing if the stable signing key has not been configured.
    await signingSecret();
    const db = await requireStorageDb();
    await db.transaction(async tx => {
      const chunkSize = 1024 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        await tx.insert(reportFileChunks).values({ fileKey: key, chunkIndex: offset / chunkSize, content: bytes.subarray(offset, offset + chunkSize) });
      }
    });
  } else {
    const target = resolveStorageKey(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  }
  return { key, url: `/files/${key.split("/").map(encodeURIComponent).join("/")}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  resolveStorageKey(relKey);
  return { key: relKey, url: await storageGetSignedUrl(relKey) };
}

export async function storageGetSignedUrl(key: string) {
  resolveStorageKey(key);
  const expires = Date.now() + 10 * 60_000;
  const token = await signature(key, expires);
  // This URL is fetched by the server only. Public downloads need a separate,
  // owner-authorized API; never infer a public origin from request headers.
  const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
  return `${origin}/files/${key.split("/").map(encodeURIComponent).join("/")}?expires=${expires}&signature=${token}`;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  resolveStorageKey(key);
  if (!databaseStorage()) return readFile(resolveStorageKey(key));
  const db = await requireStorageDb();
  const chunks = await db.select().from(reportFileChunks).where(eq(reportFileChunks.fileKey, key)).orderBy(asc(reportFileChunks.chunkIndex)).limit(13);
  if (!chunks.length) throw new Error("File not found");
  if (chunks.some((chunk, index) => chunk.chunkIndex !== index) || chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) > 12 * 1024 * 1024) throw new Error("Corrupt stored file");
  return Buffer.concat(chunks.map(chunk => chunk.content));
}
