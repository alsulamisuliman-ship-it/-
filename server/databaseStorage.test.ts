import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifySupervisorAccessCode } from "./portalSecurity";

const state = vi.hoisted(() => ({ rows: [] as Array<{ fileKey: string; chunkIndex: number; content: Buffer }> }));
vi.mock("./db", () => ({ getDb: async () => ({
  transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ insert: () => ({ values: async (row: typeof state.rows[number]) => { state.rows.push({ ...row, content: Buffer.from(row.content) }); } }) }),
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.rows }) }) }) }),
}) }));
import { readStoredFile, storageGetSignedUrl, storagePut, verifyStorageSignature } from "./storage";
beforeEach(() => { vi.unstubAllEnvs(); state.rows = []; vi.stubEnv("STORAGE_BACKEND", "database"); vi.stubEnv("STORAGE_SIGNING_SECRET", "test-only-stable-signing-key"); });
describe("database-backed report storage", () => {
  it("round-trips multiple binary chunks and authenticates retrieval links", async () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 37);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const stored = await storagePut("reports/large.pdf", bytes);
    expect(state.rows).toHaveLength(3);
    expect(state.rows.every(row => row.content.length <= 1024 * 1024)).toBe(true);
    expect(await readStoredFile(stored.key)).toEqual(bytes);
    const url = new URL(await storageGetSignedUrl(stored.key));
    expect(await verifyStorageSignature(stored.key, Number(url.searchParams.get("expires")), url.searchParams.get("signature")!)).toBe(true);
  });
  it("rejects incomplete saved files", async () => {
    const stored = await storagePut("reports/large.pdf", Buffer.alloc(2 * 1024 * 1024 + 10));
    state.rows.splice(1, 1);
    await expect(readStoredFile(stored.key)).rejects.toThrow("Corrupt");
  });
  it("requires a stable signing secret before writing any database file", async () => {
    vi.stubEnv("STORAGE_SIGNING_SECRET", "");
    await expect(storagePut("reports/test.pdf", Buffer.from("%PDF-1.4"))).rejects.toThrow("STORAGE_SIGNING_SECRET");
    expect(state.rows).toHaveLength(0);
  });
  it("rejects missing or incorrect supervisor access codes", () => {
    vi.stubEnv("SUPERVISOR_ACCESS_CODE", "");
    expect(verifySupervisorAccessCode("anything")).toBe(false);
    vi.stubEnv("SUPERVISOR_ACCESS_CODE", "test-supervisor-secret");
    expect(verifySupervisorAccessCode("test-supervisor-secret")).toBe(true);
    expect(verifySupervisorAccessCode("wrong")).toBe(false);
  });
});
