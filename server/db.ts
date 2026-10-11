import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { getDatabasePool } from "./databaseConnection";
import { nanoid } from "nanoid";
import {
  evaluationCriteria,
  evaluationReportDomains,
  evaluationReports,
  improvementPlans,
  InsertUser,
  schools,
  uploadRateLimits,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import type { NormalizedDomain, NormalizedScoreAudit } from "./reportAnalysis";
import { buildImprovementPlanDraft, sortImprovementPlans } from "./improvementPlans";
import { guestOpenIdFromToken } from "./anonymousSession";

let _db: MySql2Database | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(getDatabasePool());
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حالياً.");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: new Date() };
  (["name", "email", "loginMethod"] as const).forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getOrCreateGuestOwner(token: string) {
  const openId = guestOpenIdFromToken(token);
  const existing = await getUserByOpenId(openId);
  if (existing) return existing;
  await upsertUser({ openId, name: "زائر", email: null, loginMethod: "anonymous", role: "user" });
  const created = await getUserByOpenId(openId);
  if (!created) throw new Error("تعذّر إنشاء مساحة الزائر.");
  return created;
}

let uploadLimitCleanupCounter = 0;
export async function incrementUploadRateLimit(bucketKey: string, windowStart: number): Promise<number> {
  const db = await requireDb();
  await db.insert(uploadRateLimits).values({ bucketKey, windowStart, requestCount: 1 }).onDuplicateKeyUpdate({
    set: { requestCount: sql`${uploadRateLimits.requestCount} + 1` },
  });
  const result = await db.select({ requestCount: uploadRateLimits.requestCount })
    .from(uploadRateLimits).where(eq(uploadRateLimits.bucketKey, bucketKey)).limit(1);
  uploadLimitCleanupCounter += 1;
  if (uploadLimitCleanupCounter >= 100) {
    uploadLimitCleanupCounter = 0;
    await db.delete(uploadRateLimits).where(lt(uploadRateLimits.windowStart, windowStart - 48 * 60 * 60));
  }
  return Number(result[0]?.requestCount ?? 0);
}

export async function findOrCreateSchool(input: {
  ownerId: number;
  name: string;
  educationOffice?: string;
  city?: string;
  stage?: string;
}) {
  const db = await requireDb();
  const existing = await db
    .select()
    .from(schools)
    .where(and(eq(schools.ownerId, input.ownerId), eq(schools.name, input.name)))
    .limit(1);
  if (existing[0]) return existing[0];
  const id = nanoid();
  await db.insert(schools).values({
    id,
    ownerId: input.ownerId,
    name: input.name,
    educationOffice: input.educationOffice || null,
    city: input.city || null,
    stage: input.stage || null,
  });
  const created = await db.select().from(schools).where(eq(schools.id, id)).limit(1);
  return created[0]!;
}

export async function createProcessingReport(input: {
  ownerId: number;
  schoolId: string;
  fileName: string;
  fileKey: string;
  fileUrl: string;
}) {
  const db = await requireDb();
  const id = nanoid();
  await db.insert(evaluationReports).values({ ...input, id, status: "processing" });
  return id;
}

export async function completeReport(input: {
  ownerId: number;
  reportId: string;
  overallScore: number;
  overallScoreEvidence: string | null;
  domains: NormalizedDomain[];
}) {
  const db = await requireDb();
  await db
    .update(evaluationReports)
    .set({ status: "completed", overallScore: input.overallScore.toFixed(2), overallScoreEvidence: input.overallScoreEvidence, analyzedAt: new Date() })
    .where(eq(evaluationReports.id, input.reportId));
  const domainRecords = input.domains.map(domain => ({
    id: nanoid(),
    reportId: input.reportId,
    domainName: domain.name,
    score: domain.score.toFixed(2),
    scoreEvidence: domain.scoreEvidence,
  }));
  if (domainRecords.length) await db.insert(evaluationReportDomains).values(domainRecords);
  const records = input.domains.flatMap(domain =>
    domain.criteria.map(criterion => ({
      id: nanoid(),
      reportId: input.reportId,
      domainName: domain.name,
      criterionCode: criterion.code,
      criterionName: criterion.name,
      score: criterion.score.toFixed(2),
      classification: criterion.classification,
      priority: criterion.priority,
      evidence: criterion.evidence,
      treatment: criterion.treatment,
      treatmentSource: criterion.treatmentSource,
    }))
  );
  if (records.length) {
    await db.insert(evaluationCriteria).values(records);
    const plans = input.domains.flatMap(domain => domain.criteria.map(criterion => {
      const criterionId = records.find(item => item.domainName === domain.name && item.criterionCode === criterion.code)?.id;
      if (!criterionId) return null;
      const draft = buildImprovementPlanDraft({
        score: criterion.score,
        priority: criterion.priority,
        criterionCode: criterion.code,
        criterionName: criterion.name,
        domainName: domain.name,
        evidence: criterion.evidence,
        treatment: criterion.treatment,
        treatmentSource: criterion.treatmentSource,
      });
      return {
        id: nanoid(),
        ownerId: input.ownerId,
        reportId: input.reportId,
        criterionId,
        targetScore: draft.targetScore.toFixed(2),
        needDescription: draft.needDescription,
        improvementActions: draft.improvementActions,
        implementationMechanism: draft.implementationMechanism,
      };
    }).filter((plan): plan is NonNullable<typeof plan> => plan !== null));
    if (plans.length) await db.insert(improvementPlans).values(plans);
  }
}

export async function updateReportScoresForOwner(ownerId: number, reportId: string, scores: NormalizedScoreAudit) {
  const db = await requireDb();
  const where = and(eq(evaluationReports.ownerId, ownerId), eq(evaluationReports.id, reportId));
  const owned = await db.select({ id: evaluationReports.id }).from(evaluationReports).where(where).limit(1);
  if (!owned[0]) return false;

  await db.update(evaluationReports).set({
    overallScore: scores.overallScore.toFixed(2),
    overallScoreEvidence: scores.overallScoreEvidence,
    analyzedAt: new Date(),
  }).where(where);
  await db.delete(evaluationReportDomains).where(eq(evaluationReportDomains.reportId, reportId));
  if (scores.domains.length) {
    await db.insert(evaluationReportDomains).values(scores.domains.map(domain => ({
      id: nanoid(),
      reportId,
      domainName: domain.name,
      score: domain.score.toFixed(2),
      scoreEvidence: domain.scoreEvidence,
    })));
  }
  return true;
}

export async function failReport(reportId: string, message: string) {
  const db = await requireDb();
  await db
    .update(evaluationReports)
    .set({ status: "failed", errorMessage: message.slice(0, 2000) })
    .where(eq(evaluationReports.id, reportId));
}

export async function listReportsForOwner(ownerId: number) {
  const db = await requireDb();
  return db
    .select({ report: evaluationReports, school: schools })
    .from(evaluationReports)
    .innerJoin(schools, eq(evaluationReports.schoolId, schools.id))
    .where(eq(evaluationReports.ownerId, ownerId))
    .orderBy(desc(evaluationReports.createdAt));
}

export async function getReportForOwner(ownerId: number, reportId: string) {
  const db = await requireDb();
  const rows = await db
    .select({ report: evaluationReports, school: schools })
    .from(evaluationReports)
    .innerJoin(schools, eq(evaluationReports.schoolId, schools.id))
    .where(and(eq(evaluationReports.ownerId, ownerId), eq(evaluationReports.id, reportId)))
    .limit(1);
  if (!rows[0]) return null;
  const criteria = await db
    .select()
    .from(evaluationCriteria)
    .where(eq(evaluationCriteria.reportId, reportId));
  const domains = await db.select().from(evaluationReportDomains)
    .where(eq(evaluationReportDomains.reportId, reportId));
  return { ...rows[0], criteria, domains };
}

export async function ensureImprovementPlansForCriteria(ownerId: number, reportId: string, criteria: Awaited<ReturnType<typeof getReportCriteria>>) {
  if (!criteria.length) return;
  const db = await requireDb();
  const existing = await db.select({ criterionId: improvementPlans.criterionId })
    .from(improvementPlans)
    .where(and(eq(improvementPlans.ownerId, ownerId), eq(improvementPlans.reportId, reportId)));
  const known = new Set(existing.map(item => item.criterionId));
  const missing = criteria.filter(item => !known.has(item.id)).map(item => {
    const draft = buildImprovementPlanDraft({
      score: Number(item.score),
      priority: item.priority,
      criterionCode: item.criterionCode,
      criterionName: item.criterionName,
      domainName: item.domainName,
      evidence: item.evidence,
      treatment: item.treatment,
      treatmentSource: item.treatmentSource,
    });
    return {
      id: nanoid(), ownerId, reportId, criterionId: item.id,
      targetScore: draft.targetScore.toFixed(2),
      needDescription: draft.needDescription,
      improvementActions: draft.improvementActions,
      implementationMechanism: draft.implementationMechanism,
    };
  });
  if (missing.length) await db.insert(improvementPlans).values(missing).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
}

async function getReportCriteria(reportId: string) {
  const db = await requireDb();
  return db.select().from(evaluationCriteria).where(eq(evaluationCriteria.reportId, reportId));
}

export async function getImprovementPlansForReport(ownerId: number, reportId: string) {
  const db = await requireDb();
  const rows = await db.select({ plan: improvementPlans, criterion: evaluationCriteria })
    .from(improvementPlans)
    .innerJoin(evaluationCriteria, eq(improvementPlans.criterionId, evaluationCriteria.id))
    .where(and(eq(improvementPlans.ownerId, ownerId), eq(improvementPlans.reportId, reportId)));
  return sortImprovementPlans(rows.map(({ plan, criterion }) => {
    const { ownerId: _ownerId, ...safePlan } = plan;
    return {
    ...safePlan,
    targetScore: Number(plan.targetScore),
    criterionCode: criterion.criterionCode,
    criterionName: criterion.criterionName,
    domainName: criterion.domainName,
    score: Number(criterion.score),
    classification: criterion.classification,
    priority: criterion.priority,
    evidence: criterion.evidence,
    treatment: criterion.treatment,
    treatmentSource: criterion.treatmentSource,
  };
  }));
}

export async function updateImprovementPlanForOwner(ownerId: number, planId: string, values: {
  targetScore: number;
  needDescription: string;
  improvementActions: string;
  implementationMechanism: string;
  startDate: string | null;
  endDate: string | null;
  responsibleName: string | null;
  status: "planned" | "in_progress" | "completed";
}) {
  const db = await requireDb();
  await db.update(improvementPlans).set({
    targetScore: values.targetScore.toFixed(2),
    needDescription: values.needDescription,
    improvementActions: values.improvementActions,
    implementationMechanism: values.implementationMechanism,
    startDate: values.startDate,
    endDate: values.endDate,
    responsibleName: values.responsibleName,
    status: values.status,
  }).where(and(eq(improvementPlans.id, planId), eq(improvementPlans.ownerId, ownerId)));
  const rows = await db.select().from(improvementPlans).where(and(eq(improvementPlans.id, planId), eq(improvementPlans.ownerId, ownerId))).limit(1);
  return rows[0] ?? null;
}

export async function getAnalyticsForOwner(ownerId: number) {
  const reports = await listReportsForOwner(ownerId);
  const completedIds = reports
    .filter(item => item.report.status === "completed")
    .map(item => item.report.id);
  const db = await requireDb();
  const criteria = completedIds.length
    ? await db.select().from(evaluationCriteria).where(inArray(evaluationCriteria.reportId, completedIds))
    : [];
  return { reports, criteria };
}
