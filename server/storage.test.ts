import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveStorageKey, storageGetSignedUrl, storagePut, verifyStorageSignature } from "./storage";
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "mizan-storage-")); vi.stubEnv("STORAGE_DIR", root); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
describe("private local report storage", () => {
  it("stores bytes locally and validates the signed URL", async () => {
    const stored = await storagePut("reports/test.pdf", Buffer.from("%PDF-1.4 test"));
    expect(await readFile(resolveStorageKey(stored.key), "utf8")).toBe("%PDF-1.4 test");
    const url = new URL(await storageGetSignedUrl(stored.key));
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature")!;
    expect(await verifyStorageSignature(stored.key, expires, signature)).toBe(true);
    expect(await verifyStorageSignature("reports/other.pdf", expires, signature)).toBe(false);
    expect(await verifyStorageSignature(stored.key, Date.now() - 1, signature)).toBe(false);
    expect(await verifyStorageSignature(stored.key, expires, "bad")).toBe(false);
  });
  it("prevents traversal and access to internal files", () => {
    for (const key of ["../x", "/etc/passwd", "reports/../../x", "a\\b", ".signing-secret", "a/./b"]) expect(() => resolveStorageKey(key)).toThrow();
  });
});
