import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { hashPortalPassword } from "./portalSecurity";

const mocks = vi.hoisted(() => ({
  createPortalSession: vi.fn(async () => undefined),
  deletePortalSession: vi.fn(async () => undefined),
  getPortalSession: vi.fn(async () => null),
  getSchoolPortalByUsername: vi.fn(async () => null),
  listSchoolPortals: vi.fn(async () => []),
  registerSchoolPortal: vi.fn(async () => ({ kind: "created" as const, accountId: "school-account-1" })),
  setSchoolPortalStatus: vi.fn(async () => null),
}));

vi.mock("./portalDb", () => mocks);

import { portalRouter, readActiveSchoolPortal } from "./portalRouter";

function createContext(ip = "198.51.100.77", cookie?: string) {
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
  const ctx = {
    user: null,
    req: { protocol: "https", ip, headers: cookie ? { cookie } : {}, socket: { remoteAddress: ip } },
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => cookies.push({ name, value, options }),
      clearCookie: (name: string, options: Record<string, unknown>) => cleared.push({ name, options }),
    },
  } as unknown as TrpcContext;
  return { ctx, cookies, cleared };
}

const activeRecord = {
  account: { id: "school-account-1", ownerId: 44, schoolId: "school-1", principalName: "مديرة الاختبار", mobile: "0500000000", username: "test.school", passwordHash: "", status: "active" as const, activatedAt: new Date(), activatedBy: "supervisor", createdAt: new Date(), updatedAt: new Date() },
  school: { id: "school-1", ownerId: 44, name: "مدرسة الاختبار", educationOffice: null, city: null, stage: "المرحلة الابتدائية", createdAt: new Date(), updatedAt: new Date() },
  owner: { id: 44, openId: "school:school-account-1", name: "مدرسة الاختبار", email: null, loginMethod: "school_portal", role: "user" as const, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
};
const sessionToken = "s".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.registerSchoolPortal.mockResolvedValue({ kind: "created", accountId: "school-account-1" });
  mocks.getSchoolPortalByUsername.mockResolvedValue(null);
  mocks.getPortalSession.mockResolvedValue(null);
});

describe("school and supervisor portal", () => {
  it("hashes the school password before storing a pending registration", async () => {
    const { ctx } = createContext("198.51.100.81");
    const result = await portalRouter.createCaller(ctx).registerSchool({
      schoolName: "مدرسة الاختبار", stage: "المرحلة الابتدائية", principalName: "مديرة الاختبار", mobile: "0500000000", username: "test.school", password: "secure-pass-2026",
    });
    expect(result).toEqual({ status: "pending", accountId: "school-account-1" });
    expect(mocks.registerSchoolPortal).toHaveBeenCalledWith(expect.objectContaining({
      username: "test.school",
      passwordHash: expect.stringMatching(/^scrypt\$/),
    }));
    expect(mocks.registerSchoolPortal.mock.calls[0]?.[0]?.passwordHash).not.toContain("secure-pass-2026");
  });

  it("does not create a school session until the supervisor activates the account", async () => {
    const { ctx, cookies } = createContext("198.51.100.82");
    const passwordHash = await hashPortalPassword("secure-pass-2026");
    mocks.getSchoolPortalByUsername.mockResolvedValueOnce({ ...activeRecord, account: { ...activeRecord.account, status: "pending", passwordHash } });
    await expect(portalRouter.createCaller(ctx).schoolLogin({ username: "test.school", password: "secure-pass-2026" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(cookies).toHaveLength(0);
  });

  it("issues an HttpOnly school session only for an active verified account", async () => {
    const { ctx, cookies } = createContext("198.51.100.83");
    const passwordHash = await hashPortalPassword("secure-pass-2026");
    mocks.getSchoolPortalByUsername.mockResolvedValueOnce({ ...activeRecord, account: { ...activeRecord.account, passwordHash } });
    const result = await portalRouter.createCaller(ctx).schoolLogin({ username: "test.school", password: "secure-pass-2026" });
    expect(result).toEqual({ role: "school", schoolName: "مدرسة الاختبار" });
    expect(mocks.createPortalSession).toHaveBeenCalledWith(expect.objectContaining({ role: "school", schoolAccountId: "school-account-1" }));
    expect(cookies[0]).toMatchObject({ name: "mizan_portal_session", options: expect.objectContaining({ httpOnly: true, secure: true }) });
  });

  it("accepts the configured supervisor verifier and creates a short-lived supervisor session", async () => {
    const { ctx, cookies } = createContext("198.51.100.85");
    const supervisorCode = "test-supervisor-access";
    vi.stubEnv("SUPERVISOR_ACCESS_CODE", supervisorCode);
    const result = await portalRouter.createCaller(ctx).supervisorLogin({ accessCode: supervisorCode });
    expect(result).toEqual({ role: "supervisor" });
    expect(mocks.createPortalSession).toHaveBeenCalledWith(expect.objectContaining({ role: "supervisor", schoolAccountId: null }));
    expect(cookies[0]?.options).toMatchObject({ httpOnly: true, maxAge: 12 * 60 * 60 * 1000 });
  });

  it("revokes the opaque portal session on logout", async () => {
    const { ctx, cleared } = createContext("198.51.100.86", `mizan_portal_session=${sessionToken}`);
    const result = await portalRouter.createCaller(ctx).logout();
    expect(result).toEqual({ success: true });
    expect(mocks.deletePortalSession).toHaveBeenCalledWith(expect.any(String));
    expect(cleared[0]).toMatchObject({ name: "mizan_portal_session", options: expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax" }) });
  });

  it("permits supervisor activation only through a supervisor session", async () => {
    const { ctx } = createContext("198.51.100.84", `mizan_portal_session=${sessionToken}`);
    mocks.getPortalSession.mockResolvedValueOnce({ session: { role: "supervisor", expiresAt: new Date(Date.now() + 60_000) }, account: null, school: null, owner: null });
    mocks.setSchoolPortalStatus.mockResolvedValueOnce(activeRecord);
    const result = await portalRouter.createCaller(ctx).supervisor.setSchoolStatus({ accountId: "school-account-1", status: "active" });
    expect(result).toEqual({ id: "school-account-1", status: "active", schoolName: "مدرسة الاختبار" });
    expect(mocks.setSchoolPortalStatus).toHaveBeenCalledWith("school-account-1", "active", "supervisor");
  });

  it("resolves only an active school portal into a report owner identity", async () => {
    mocks.getPortalSession.mockResolvedValueOnce({ session: { role: "school", expiresAt: new Date(Date.now() + 60_000) }, ...activeRecord });
    const resolved = await readActiveSchoolPortal(`mizan_portal_session=${sessionToken}`);
    expect(resolved?.owner.id).toBe(44);
    mocks.getPortalSession.mockResolvedValueOnce({ session: { role: "school", expiresAt: new Date(Date.now() + 60_000) }, ...activeRecord, account: { ...activeRecord.account, status: "suspended" } });
    expect(await readActiveSchoolPortal(`mizan_portal_session=${sessionToken}`)).toBeNull();
  });
});
