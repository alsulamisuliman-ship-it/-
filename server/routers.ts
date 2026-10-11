import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { createGuestSessionToken, FixedWindowLimiter, GUEST_SESSION_COOKIE, readGuestSessionToken } from "./anonymousSession";
import {
  completeReport,
  createProcessingReport,
  failReport,
  findOrCreateSchool,
  getAnalyticsForOwner,
  getOrCreateGuestOwner,
  getImprovementPlansForReport,
  ensureImprovementPlansForCriteria,
  updateImprovementPlanForOwner,
  updateReportScoresForOwner,
  getReportForOwner,
  incrementUploadRateLimit,
  listReportsForOwner,
} from "./db";
import { analyzeEvaluationPdf, analyzeOfficialReportScores, evidenceSupportsCriterionScore, evidenceSupportsDomainScore, evidenceSupportsOverallScore, normalizeScoreAudit } from "./reportAnalysis";
import { storageGetSignedUrl, storagePut } from "./storage";
import { portalRouter, readActiveSchoolPortal } from "./portalRouter";

const MAX_PDF_BYTES = 12 * 1024 * 1024;

const uploadInput = z.object({
  schoolName: z.string().trim().min(2).max(240),
  educationOffice: z.string().trim().max(240).optional(),
  city: z.string().trim().max(120).optional(),
  stage: z.string().trim().max(120).optional(),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.literal("application/pdf"),
  fileData: z.string().min(50).max(18_000_000),
});

const numberValue = (value: string | null) => Number(value ?? 0);
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const hasVerifiedCriterion = (item: { score: string | number; evidence: string; criterionCode: string; criterionName: string }) =>
  evidenceSupportsCriterionScore(numberValue(String(item.score)), item.evidence, item.criterionCode, item.criterionName);
const updatePlanInput = z.object({
  id: z.string().min(1).max(24),
  targetScore: z.number().min(0).max(100),
  needDescription: z.string().trim().min(1).max(5000),
  improvementActions: z.string().trim().min(1).max(5000),
  implementationMechanism: z.string().trim().min(1).max(5000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  responsibleName: z.string().trim().max(240).nullable(),
  status: z.enum(["planned", "in_progress", "completed"]),
}).refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  message: "يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.",
  path: ["endDate"],
});
const guestProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const activeSchoolPortal = await readActiveSchoolPortal(ctx.req.headers.cookie);
  if (activeSchoolPortal) {
    return next({ ctx: { ...ctx, user: activeSchoolPortal.owner, guestToken: `school:${activeSchoolPortal.account.id}` } });
  }
  let token = readGuestSessionToken(ctx.req.headers.cookie);
  if (!token) {
    token = createGuestSessionToken();
    ctx.res.cookie(GUEST_SESSION_COOKIE, token, {
      ...getSessionCookieOptions(ctx.req),
      sameSite: "lax",
      maxAge: 180 * 24 * 60 * 60 * 1000,
    });
  }
  const guest = await getOrCreateGuestOwner(token);
  return next({ ctx: { ...ctx, user: guest, guestToken: token } });
});
const guestUploadLimiter = new FixedWindowLimiter(8, 60 * 60 * 1000);
const networkUploadLimiter = new FixedWindowLimiter(60, 60 * 60 * 1000);
const scoreAuditLimiter = new FixedWindowLimiter(3, 60 * 60 * 1000);

export const appRouter = router({
  system: systemRouter,
  portal: portalRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  guest: router({
    ensureSession: guestProcedure.query(() => ({ ready: true as const })),
  }),
  reports: router({
    list: guestProcedure.query(async ({ ctx }) => {
      const reports = await listReportsForOwner(ctx.user.id);
      return reports.map(({ report, school }) => {
        const { fileKey: _fileKey, fileUrl: _fileUrl, ownerId: _reportOwnerId, ...safeReport } = report;
        const { ownerId: _schoolOwnerId, ...safeSchool } = school;
        const overallScore = numberValue(report.overallScore);
        const overallScoreEvidence = evidenceSupportsOverallScore(overallScore, report.overallScoreEvidence)
          ? report.overallScoreEvidence
          : null;
        return { ...safeReport, overallScore, overallScoreEvidence, school: safeSchool };
      });
    }),
    get: guestProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
      const result = await getReportForOwner(ctx.user.id, input.id);
      if (!result) return null;
      const { fileKey: _fileKey, fileUrl: _fileUrl, ownerId: _reportOwnerId, ...safeReport } = result.report;
      const { ownerId: _schoolOwnerId, ...safeSchool } = result.school;
      const verifiedCriteria = result.criteria.filter(hasVerifiedCriterion);
      await ensureImprovementPlansForCriteria(ctx.user.id, input.id, verifiedCriteria);
      const plans = (await getImprovementPlansForReport(ctx.user.id, input.id)).filter(hasVerifiedCriterion);
      const domains = result.domains.flatMap(domain => {
        const reported = evidenceSupportsDomainScore(numberValue(domain.score), domain.scoreEvidence, domain.domainName);
        const domainCriteria = verifiedCriteria.filter(item => item.domainName === domain.domainName);
        if (!reported && !domainCriteria.length) return [];
        return [{
          ...domain,
          score: reported ? numberValue(domain.score) : average(domainCriteria.map(item => numberValue(item.score))),
          scoreEvidence: reported ? domain.scoreEvidence : null,
        }];
      });
      const storedOverallScore = numberValue(result.report.overallScore);
      const overallReported = evidenceSupportsOverallScore(storedOverallScore, result.report.overallScoreEvidence);
      const overallScore = overallReported ? storedOverallScore : average(domains.map(domain => Number(domain.score)));
      return {
        report: { ...safeReport, overallScore, overallScoreEvidence: overallReported ? result.report.overallScoreEvidence : null },
        school: safeSchool,
        criteria: verifiedCriteria.map(item => ({ ...item, score: numberValue(item.score) })),
        domains,
        improvementPlans: plans,
      };
    }),
    reauditScores: guestProcedure.input(z.object({ id: z.string().min(1).max(24) })).mutation(async ({ ctx, input }) => {
      const result = await getReportForOwner(ctx.user.id, input.id);
      if (!result || result.report.status !== "completed") {
        throw new TRPCError({ code: "NOT_FOUND", message: "التقرير غير متاح في جلسة هذا المتصفح." });
      }
      const quotaKey = createHash("sha256").update(ctx.guestToken).digest("hex");
      if (!scoreAuditLimiter.allow(quotaKey)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "تم بلوغ حد إعادة تدقيق الدرجات. حاولي مجدداً بعد ساعة." });
      }

      try {
        const signedUrl = await storageGetSignedUrl(result.report.fileKey);
        const fileResponse = await fetch(signedUrl, { signal: AbortSignal.timeout(60_000) });
        if (!fileResponse.ok) throw new Error("تعذّر استرجاع ملف التقرير المحفوظ.");
        const declaredLength = Number(fileResponse.headers.get("content-length") || 0);
        if (declaredLength > MAX_PDF_BYTES) throw new Error("ملف التقرير المحفوظ يتجاوز الحد المسموح.");
        const fileBytes = Buffer.from(await fileResponse.arrayBuffer());
        if (fileBytes.length > MAX_PDF_BYTES || fileBytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
          throw new Error("تعذّر التحقق من ملف PDF المحفوظ.");
        }

        const rawScores = await analyzeOfficialReportScores(`data:application/pdf;base64,${fileBytes.toString("base64")}`);
        const audited = normalizeScoreAudit(rawScores, result.criteria.filter(hasVerifiedCriterion).map(item => ({
          domainName: item.domainName,
          score: numberValue(item.score),
        })));
        const previousDomains = new Map(result.domains
          .filter(item => evidenceSupportsDomainScore(numberValue(item.score), item.scoreEvidence, item.domainName))
          .map(item => [item.domainName, item]));
        const domains = audited.domains.map(domain => {
          if (domain.scoreEvidence) return domain;
          const previous = previousDomains.get(domain.name);
          return previous
            ? { ...domain, score: numberValue(previous.score), scoreEvidence: previous.scoreEvidence, scoreSource: "reported" as const }
            : domain;
        });
        const previousOverallIsReported = evidenceSupportsOverallScore(
          numberValue(result.report.overallScore),
          result.report.overallScoreEvidence,
        );
        const overallScore = audited.overallScoreEvidence
          ? audited.overallScore
          : previousOverallIsReported
            ? numberValue(result.report.overallScore)
            : domains.length ? domains.reduce((sum, item) => sum + item.score, 0) / domains.length : audited.overallScore;
        const scores = {
          ...audited,
          overallScore,
          overallScoreEvidence: audited.overallScoreEvidence || (previousOverallIsReported ? result.report.overallScoreEvidence : null),
          overallScoreSource: audited.overallScoreEvidence || previousOverallIsReported ? "reported" as const : "calculated" as const,
          domains,
        };
        const saved = await updateReportScoresForOwner(ctx.user.id, input.id, scores);
        if (!saved) throw new Error("التقرير غير متاح في جلسة هذا المتصفح.");
        return {
          overallScore: scores.overallScore,
          overallScoreEvidence: scores.overallScoreEvidence,
          overallScoreSource: scores.overallScoreSource,
          domainCount: domains.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[Score audit] Failed to re-read official scores.");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "تعذّرت إعادة قراءة الدرجات من ملف التقرير. لم تتغير خطط التحسين." });
      }
    }),
    updatePlan: guestProcedure.input(updatePlanInput).mutation(async ({ ctx, input }) => {
      const { id, ...values } = input;
      const saved = await updateImprovementPlanForOwner(ctx.user.id, id, values);
      if (!saved) throw new TRPCError({ code: "NOT_FOUND", message: "خطة التحسين غير متاحة في جلسة هذا المتصفح." });
      const { ownerId: _ownerId, ...safePlan } = saved;
      return { ...safePlan, targetScore: Number(saved.targetScore) };
    }),
    uploadAndAnalyze: guestProcedure.input(uploadInput).mutation(async ({ ctx, input }) => {
      const address = ctx.req.ip || ctx.req.socket.remoteAddress || "unknown";
      const addressDigest = createHash("sha256").update(address).digest("hex").slice(0, 48);
      const guestDigest = createHash("sha256").update(ctx.guestToken).digest("hex").slice(0, 48);
      const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600;
      const networkCount = await incrementUploadRateLimit(`${windowStart}:${addressDigest}`, windowStart);
      const guestCount = await incrementUploadRateLimit(`${windowStart}:${guestDigest}`, windowStart);
      if (!guestUploadLimiter.allow(guestDigest) || !networkUploadLimiter.allow(addressDigest) || networkCount > 60 || guestCount > 8) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "تم بلوغ حد الرفع المؤقت. حاولي مجدداً بعد ساعة." });
      }
      const matches = input.fileData.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/);
      if (!matches) throw new Error("صيغة ملف PDF غير صالحة.");
      const fileBytes = Buffer.from(matches[1].replace(/\s/g, ""), "base64");
      if (fileBytes.length > MAX_PDF_BYTES) throw new Error("الحد الأقصى لحجم التقرير هو 12 ميغابايت.");
      if (fileBytes.subarray(0, 4).toString() !== "%PDF") throw new Error("الملف المرفوع ليس PDF صالحاً.");

      const school = await findOrCreateSchool({
        ownerId: ctx.user.id,
        name: input.schoolName,
        educationOffice: input.educationOffice,
        city: input.city,
        stage: input.stage,
      });
      const storageKey = `evaluation-reports/${ctx.user.id}/${nanoid(32)}.pdf`;
      const stored = await storagePut(storageKey, fileBytes, input.mimeType);
      const reportId = await createProcessingReport({
        ownerId: ctx.user.id,
        schoolId: school.id,
        fileName: input.fileName,
        fileKey: stored.key,
        fileUrl: stored.url,
      });

      try {
        const extracted = await analyzeEvaluationPdf(input.fileData);
        await completeReport({ ownerId: ctx.user.id, reportId, overallScore: extracted.overallScore, overallScoreEvidence: extracted.overallScoreEvidence, domains: extracted.domains });
        return { reportId, status: "completed" as const, overallScore: extracted.overallScore };
      } catch (error) {
        const message = error instanceof Error ? error.message : "تعذّر إكمال التحليل.";
        await failReport(reportId, message);
        throw new Error(`تم حفظ التقرير، لكن تعذّر تحليله: ${message}`);
      }
    }),
  }),
  analytics: router({
    overview: guestProcedure.query(async ({ ctx }) => {
      const { reports, criteria } = await getAnalyticsForOwner(ctx.user.id);
      const completed = reports.filter(item => item.report.status === "completed");
      const domains = new Map<string, { total: number; count: number; strengthCount: number; weaknessCount: number }>();
      const verifiedCriteria = criteria.filter(hasVerifiedCriterion);
      verifiedCriteria.forEach(item => {
        const existing = domains.get(item.domainName) || { total: 0, count: 0, strengthCount: 0, weaknessCount: 0 };
        existing.total += numberValue(item.score);
        existing.count += 1;
        if (item.classification === "strength") existing.strengthCount += 1;
        else existing.weaknessCount += 1;
        domains.set(item.domainName, existing);
      });
      return {
        schools: Array.from(new Map(reports.map(item => [item.school.id, item.school])).values()).map(({ ownerId: _ownerId, ...school }) => school),
        reports: reports.map(({ report, school }) => ({
          id: report.id,
          status: report.status,
          schoolId: school.id,
          schoolName: school.name,
          overallScore: numberValue(report.overallScore),
          overallScoreEvidence: evidenceSupportsOverallScore(numberValue(report.overallScore), report.overallScoreEvidence) ? report.overallScoreEvidence : null,
          createdAt: report.createdAt,
        })),
        summary: {
          totalReports: reports.length,
          completedReports: completed.length,
          totalCriteria: verifiedCriteria.length,
          strengths: verifiedCriteria.filter(item => item.classification === "strength").length,
          weaknesses: verifiedCriteria.filter(item => item.classification === "weakness").length,
        },
        domains: Array.from(domains.entries()).map(([name, item]) => ({
          name,
          averageScore: Number((item.total / item.count).toFixed(2)),
          strengthCount: item.strengthCount,
          weaknessCount: item.weaknessCount,
        })),
        criteria: verifiedCriteria.map(item => ({
          ...item,
          score: numberValue(item.score),
        })),
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
