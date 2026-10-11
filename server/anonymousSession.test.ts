import { beforeEach, describe, expect, it, vi } from "vitest";
import { serialize } from "cookie";
import { createGuestSessionToken, FixedWindowLimiter, GUEST_SESSION_COOKIE, guestOpenIdFromToken, readGuestSessionToken } from "./anonymousSession";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  completeReport: vi.fn(async () => undefined),
  createProcessingReport: vi.fn(async () => "report-anon"),
  ensureImprovementPlansForCriteria: vi.fn(async () => undefined),
  failReport: vi.fn(async () => undefined),
  findOrCreateSchool: vi.fn(async () => ({ id: "school-anon", ownerId: 41, name: "مدرسة اختبار", educationOffice: null, city: null, stage: null, createdAt: new Date(), updatedAt: new Date() })),
  getAnalyticsForOwner: vi.fn(async () => ({ reports: [], criteria: [] })),
  getImprovementPlansForReport: vi.fn(async () => []),
  getOrCreateGuestOwner: vi.fn(async () => ({ id: 41, openId: "guest-hash", email: null, name: "زائر", loginMethod: "anonymous", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() })),
  getReportForOwner: vi.fn(async (): Promise<any> => null),
  incrementUploadRateLimit: vi.fn(async () => 1),
  updateImprovementPlanForOwner: vi.fn(async (ownerId: number, id: string) => ({ id, ownerId, reportId: "report-anon", criterionId: "criterion-anon", targetScore: "82.00", needDescription: "وصف الاحتياج", improvementActions: "إجراء تحسين", implementationMechanism: "آلية التنفيذ", startDate: null, endDate: null, responsibleName: null, status: "planned" as const, createdAt: new Date(), updatedAt: new Date() })),
  updateReportScoresForOwner: vi.fn(async () => true),
  listReportsForOwner: vi.fn(async () => []),
  storagePut: vi.fn(async () => ({ key: "evaluation-reports/private/file.pdf", url: "/manus-storage/evaluation-reports/private/file.pdf" })),
  storageGetSignedUrl: vi.fn(async () => "https://storage.example.test/signed.pdf"),
  analyzeEvaluationPdf: vi.fn(async () => ({ overallScore: 84, overallScoreEvidence: null, overallScoreSource: "calculated" as const, domains: [] })),
  analyzeOfficialReportScores: vi.fn(async (): Promise<any> => ({ overallScore: null, overallScoreEvidence: "", domains: [] })),
}));

vi.mock("./db", () => mocks);
vi.mock("./storage", () => ({ storagePut: mocks.storagePut, storageGetSignedUrl: mocks.storageGetSignedUrl }));
vi.mock("./reportAnalysis", async importOriginal => {
  const actual = await importOriginal<typeof import("./reportAnalysis")>();
  return { ...actual, analyzeEvaluationPdf: mocks.analyzeEvaluationPdf, analyzeOfficialReportScores: mocks.analyzeOfficialReportScores };
});

import { appRouter } from "./routers";

function createAnonymousContext(cookieHeader?: string, ip = "192.0.2.21"): { ctx: TrpcContext; setCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> } {
  const setCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const ctx = {
    user: null,
    req: { protocol: "https", headers: cookieHeader ? { cookie: cookieHeader } : {}, ip, socket: { remoteAddress: ip } },
    res: { cookie: (name: string, value: string, options: Record<string, unknown>) => setCookies.push({ name, value, options }), clearCookie: vi.fn() },
  } as unknown as TrpcContext;
  return { ctx, setCookies };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrCreateGuestOwner.mockImplementation(async () => ({ id: 41, openId: "guest-hash", email: null, name: "زائر", loginMethod: "anonymous", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }));
  mocks.incrementUploadRateLimit.mockResolvedValue(1);
});

describe("anonymous upload access", () => {
  it("creates a long-lived HttpOnly guest session without collecting email", async () => {
    const { ctx, setCookies } = createAnonymousContext();
    const result = await appRouter.createCaller(ctx).guest.ensureSession();
    expect(result).toEqual({ ready: true });
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0].name).toBe(GUEST_SESSION_COOKIE);
    expect(setCookies[0].options).toMatchObject({ httpOnly: true, secure: true, maxAge: 180 * 24 * 60 * 60 * 1000 });
    expect(mocks.getOrCreateGuestOwner).toHaveBeenCalledWith(setCookies[0].value);
    expect(setCookies[0].value).not.toContain("@");
  });

  it("accepts a valid PDF upload when no authenticated user is present", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    const fileData = `data:application/pdf;base64,${Buffer.from("%PDF-1.7\nminimal test payload").toString("base64")}`;
    const result = await caller.reports.uploadAndAnalyze({ schoolName: "مدرسة اختبار", fileName: "report.pdf", mimeType: "application/pdf", fileData });
    expect(result).toMatchObject({ reportId: "report-anon", status: "completed", overallScore: 84 });
    expect(mocks.createProcessingReport).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 41, schoolId: "school-anon" }));
    expect(mocks.completeReport).toHaveBeenCalled();
    expect(mocks.getOrCreateGuestOwner).toHaveBeenCalled();
  });

  it("does not reveal another anonymous session’s report", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.reports.get({ id: "another-guest-report" });
    expect(result).toBeNull();
    expect(mocks.getReportForOwner).toHaveBeenCalledWith(41, "another-guest-report");
  });

  it("hides legacy indicators and plans whose quoted evidence does not identify the score and criterion", async () => {
    mocks.getReportForOwner.mockResolvedValueOnce({
      report: { id: "report-anon", ownerId: 41, status: "completed", overallScore: "88.00", overallScoreEvidence: "التقدم 88%", fileKey: "private/report.pdf", fileUrl: "private/report.pdf" },
      school: { id: "school-anon", ownerId: 41, name: "مدرسة اختبار" },
      criteria: [
        { id: "criterion-good", reportId: "report-anon", domainName: "نتائج التعلم", criterionCode: "3-1-1", criterionName: "مؤشر موثق", score: "72.50", evidence: "3-1-1 مؤشر موثق: الدرجة 72.5%", treatment: "إجراء", treatmentSource: "extracted", classification: "weakness", priority: "critical" },
        { id: "criterion-bad", reportId: "report-anon", domainName: "نتائج التعلم", criterionCode: "3-1-2", criterionName: "مؤشر غير موثق", score: "0.00", evidence: "دليل عام لا يتضمن القراءة الرقمية", treatment: "إجراء", treatmentSource: "suggested", classification: "weakness", priority: "critical" },
      ],
      domains: [{ id: "domain", reportId: "report-anon", domainName: "نتائج التعلم", score: "78.50", scoreEvidence: "نتائج التعلم 78.5%" }],
    });
    mocks.getImprovementPlansForReport.mockResolvedValueOnce([
      { id: "plan-good", criterionCode: "3-1-1", criterionName: "مؤشر موثق", domainName: "نتائج التعلم", score: 72.5, evidence: "3-1-1 مؤشر موثق: الدرجة 72.5%" },
      { id: "plan-bad", criterionCode: "3-1-2", criterionName: "مؤشر غير موثق", domainName: "نتائج التعلم", score: 0, evidence: "دليل عام لا يتضمن القراءة الرقمية" },
    ]);
    const { ctx } = createAnonymousContext();
    const result = await appRouter.createCaller(ctx).reports.get({ id: "report-anon" });

    expect(result?.criteria).toHaveLength(1);
    expect(result?.criteria[0]).toMatchObject({ criterionCode: "3-1-1", score: 72.5 });
    expect(result?.improvementPlans).toHaveLength(1);
    expect(result?.improvementPlans[0]).toMatchObject({ id: "plan-good" });
    expect(mocks.ensureImprovementPlansForCriteria).toHaveBeenCalledWith(41, "report-anon", [expect.objectContaining({ id: "criterion-good" })]);
  });

  it("re-reads the saved PDF’s official total and domain scores without replacing plans", async () => {
    mocks.getReportForOwner.mockResolvedValueOnce({
      report: { id: "report-anon", ownerId: 41, status: "completed", fileKey: "private/report.pdf", overallScore: "91.60", overallScoreEvidence: null },
      school: { id: "school-anon", ownerId: 41, name: "مدرسة اختبار" },
      criteria: [{ domainName: "البيئة المدرسية", score: "91.60" }],
      domains: [],
    });
    mocks.analyzeOfficialReportScores.mockResolvedValueOnce({
      overallScore: 88,
      overallScoreEvidence: "التقدم 88%",
      domains: [{ name: "البيئة المدرسية", score: 90.5, scoreEvidence: "البيئة المدرسية 90.5%" }],
    });
    const fetchMock = vi.fn(async () => new Response("%PDF-1.7\nscore audit", { status: 200, headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { ctx } = createAnonymousContext();
      const result = await appRouter.createCaller(ctx).reports.reauditScores({ id: "report-anon" });
      expect(result).toMatchObject({ overallScore: 88, overallScoreEvidence: "التقدم 88%", overallScoreSource: "reported", domainCount: 1 });
      expect(mocks.storageGetSignedUrl).toHaveBeenCalledWith("private/report.pdf");
      expect(mocks.updateReportScoresForOwner).toHaveBeenCalledWith(41, "report-anon", expect.objectContaining({
        overallScore: 88,
        overallScoreEvidence: "التقدم 88%",
        domains: [expect.objectContaining({ name: "البيئة المدرسية", score: 90.5, scoreEvidence: "البيئة المدرسية 90.5%" })],
      }));
      expect(fetchMock).toHaveBeenCalledWith("https://storage.example.test/signed.pdf", expect.any(Object));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not preserve a legacy total when its quote identifies only a criterion", async () => {
    mocks.getReportForOwner.mockResolvedValueOnce({
      report: { id: "report-anon", ownerId: 41, status: "completed", fileKey: "private/report.pdf", overallScore: "91.60", overallScoreEvidence: "مؤشر الرياضيات 91.6%" },
      school: { id: "school-anon", ownerId: 41, name: "مدرسة اختبار" },
      criteria: [
        { domainName: "الإدارة المدرسية", criterionCode: "1-1-1", criterionName: "مؤشر أول", score: "80.00", evidence: "1-1-1 مؤشر أول: الدرجة 80%" },
        { domainName: "الإدارة المدرسية", criterionCode: "1-1-2", criterionName: "مؤشر ثان", score: "90.00", evidence: "1-1-2 مؤشر ثان: الدرجة 90%" },
      ],
      domains: [{ domainName: "الإدارة المدرسية", score: "91.60", scoreEvidence: "مجال غير صحيح 91.6%" }],
    });
    mocks.analyzeOfficialReportScores.mockResolvedValueOnce({ overallScore: null, overallScoreEvidence: "", domains: [] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("%PDF-1.7\nscore audit", { status: 200, headers: { "content-type": "application/pdf" } })));
    try {
      const { ctx } = createAnonymousContext();
      const result = await appRouter.createCaller(ctx).reports.reauditScores({ id: "report-anon" });
      expect(result).toMatchObject({ overallScore: 85, overallScoreEvidence: null, overallScoreSource: "calculated", domainCount: 1 });
      expect(mocks.updateReportScoresForOwner).toHaveBeenCalledWith(41, "report-anon", expect.objectContaining({
        overallScore: 85,
        overallScoreEvidence: null,
        domains: [expect.objectContaining({ name: "الإدارة المدرسية", score: 85, scoreEvidence: null, scoreSource: "calculated" })],
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects content that is not really a PDF before storing or analyzing it", async () => {
    const { ctx } = createAnonymousContext();
    const fileData = `data:application/pdf;base64,${Buffer.from("this is not a pdf").toString("base64")}`;
    await expect(appRouter.createCaller(ctx).reports.uploadAndAnalyze({ schoolName: "مدرسة اختبار", fileName: "report.pdf", mimeType: "application/pdf", fileData })).rejects.toMatchObject({ message: "الملف المرفوع ليس PDF صالحاً." });
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.createProcessingReport).not.toHaveBeenCalled();
  });

  it("rejects a PDF larger than 12 MB before storage", async () => {
    const { ctx } = createAnonymousContext();
    const payload = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(12 * 1024 * 1024 + 1)]);
    const fileData = `data:application/pdf;base64,${payload.toString("base64")}`;
    await expect(appRouter.createCaller(ctx).reports.uploadAndAnalyze({ schoolName: "مدرسة اختبار", fileName: "large.pdf", mimeType: "application/pdf", fileData })).rejects.toMatchObject({ message: "الحد الأقصى لحجم التقرير هو 12 ميغابايت." });
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("returns a localized TOO_MANY_REQUESTS error when the visitor quota is exceeded", async () => {
    const { ctx } = createAnonymousContext();
    mocks.incrementUploadRateLimit.mockResolvedValue(9);
    const fileData = `data:application/pdf;base64,${Buffer.from("%PDF-1.7\nquota-test payload").toString("base64")}`;
    await expect(appRouter.createCaller(ctx).reports.uploadAndAnalyze({ schoolName: "مدرسة اختبار", fileName: "report.pdf", mimeType: "application/pdf", fileData })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "تم بلوغ حد الرفع المؤقت. حاولي مجدداً بعد ساعة." });
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("does not resolve another guest’s report under a different session cookie", async () => {
    const firstToken = createGuestSessionToken();
    const secondToken = createGuestSessionToken();
    mocks.getOrCreateGuestOwner.mockImplementation(async token => ({ id: token === firstToken ? 51 : 62, openId: guestOpenIdFromToken(token), email: null, name: "زائر", loginMethod: "anonymous", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }));
    const { ctx } = createAnonymousContext(serialize(GUEST_SESSION_COOKIE, secondToken), "192.0.2.62");
    const result = await appRouter.createCaller(ctx).reports.get({ id: "report-from-first-guest" });
    expect(result).toBeNull();
    expect(mocks.getReportForOwner).toHaveBeenCalledWith(62, "report-from-first-guest");
    expect(guestOpenIdFromToken(firstToken)).not.toBe(guestOpenIdFromToken(secondToken));
  });

  it("saves plan edits only within the visitor’s owner scope and hides internal ownership", async () => {
    const { ctx } = createAnonymousContext();
    const result = await appRouter.createCaller(ctx).reports.updatePlan({
      id: "plan-anon",
      targetScore: 82,
      needDescription: "وصف الاحتياج المحدّث",
      improvementActions: "إجراء تحسين محدّث",
      implementationMechanism: "آلية تنفيذ محدّثة",
      startDate: "2026-10-10",
      endDate: "2026-12-10",
      responsibleName: "مسؤولة الجودة",
      status: "in_progress",
    });
    expect(mocks.updateImprovementPlanForOwner).toHaveBeenCalledWith(41, "plan-anon", expect.objectContaining({ startDate: "2026-10-10", responsibleName: "مسؤولة الجودة", status: "in_progress" }));
    expect(result).toMatchObject({ id: "plan-anon", targetScore: 82 });
    expect(result).not.toHaveProperty("ownerId");
  });

  it("rejects invalid session cookies and stores only a digest of valid tokens", () => {
    const token = createGuestSessionToken();
    expect(readGuestSessionToken(serialize(GUEST_SESSION_COOKIE, token))).toBe(token);
    expect(readGuestSessionToken(serialize(GUEST_SESSION_COOKIE, "not-a-session"))).toBeUndefined();
    expect(guestOpenIdFromToken(token)).not.toContain(token);
    expect(guestOpenIdFromToken(token)).toBe(guestOpenIdFromToken(token));
  });

  it("enforces a fixed-window request limit", () => {
    const limiter = new FixedWindowLimiter(2, 60_000);
    expect(limiter.allow("visitor", 10_000)).toBe(true);
    expect(limiter.allow("visitor", 20_000)).toBe(true);
    expect(limiter.allow("visitor", 30_000)).toBe(false);
    expect(limiter.allow("visitor", 70_001)).toBe(true);
  });
});
