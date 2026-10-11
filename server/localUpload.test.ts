import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const mocks = vi.hoisted(() => ({
  completeReport: vi.fn(async () => undefined),
  createProcessingReport: vi.fn(async () => "report-local-ocr"),
  findOrCreateSchool: vi.fn(async () => ({ id: "school-test" })),
  incrementUploadRateLimit: vi.fn(async () => 1),
  getOrCreateGuestOwner: vi.fn(async () => ({ id: 44 })),
  failReport: vi.fn(async () => undefined),
  analyzeEvaluationPdf: vi.fn(async () => { throw new Error("Server OCR must not run for a locally read file"); }),
}));
vi.mock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db")>()), ...mocks }));
vi.mock("./reportAnalysis", async importOriginal => ({ ...(await importOriginal<typeof import("./reportAnalysis")>()), analyzeEvaluationPdf: mocks.analyzeEvaluationPdf }));
vi.mock("./portalRouter", async importOriginal => ({ ...(await importOriginal<typeof import("./portalRouter")>()), readActiveSchoolPortal: async () => null }));
vi.mock("./storage", () => ({ storagePut: async () => ({ key: "reports/test.pdf", url: "/files/test.pdf" }), storageGetSignedUrl: vi.fn() }));
import { appRouter } from "./routers";
beforeEach(() => vi.clearAllMocks());
it("saves validated browser OCR results without repeating OCR on the server", async () => {
  const ctx = { user: null, req: { protocol: "https", ip: "198.51.100.45", headers: {}, socket: { remoteAddress: "198.51.100.45" } }, res: { cookie: vi.fn() } } as unknown as TrpcContext;
  const result = await appRouter.createCaller(ctx).reports.uploadAndAnalyze({
    schoolName: "مدرسة الاختبار", fileName: "different-name.pdf", mimeType: "application/pdf",
    fileData: `data:application/pdf;base64,${Buffer.from("%PDF-1.4 browser-read fixture bytes").toString("base64")}`,
    extractedText: "التقدم 88% [OCR صفحة 1]\nالإدارة المدرسية 92% [OCR صفحة 1]\n1-1-1-1 التخطيط المدرسي 81.75% [OCR صفحة 5]",
  });
  expect(result.status).toBe("completed");
  expect(mocks.analyzeEvaluationPdf).not.toHaveBeenCalled();
  expect(mocks.completeReport).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 44, overallScore: 88, domains: expect.arrayContaining([expect.objectContaining({ score: 92, criteria: expect.arrayContaining([expect.objectContaining({ code: "1-1-1-1", score: 81.75 })]) })]) }));
});
