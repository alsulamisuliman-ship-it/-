import { extractPdfText, localScoreAudit, parseLocalReportText } from "./localPdf";

export type CriterionPriority = "low" | "medium" | "high" | "critical";
export type CriterionClassification = "strength" | "weakness";
export type ScoreSource = "reported" | "calculated";

export type ExtractedCriterion = {
  code: string;
  name: string;
  score: number | null;
  evidence: string;
  treatment: string;
  treatmentSource: "extracted" | "suggested";
};

export type NormalizedDomain = {
  name: string;
  score: number;
  scoreEvidence: string | null;
  scoreSource: ScoreSource;
  criteria: NormalizedCriterion[];
};

export type NormalizedScoreAudit = {
  overallScore: number;
  overallScoreEvidence: string | null;
  overallScoreSource: ScoreSource;
  domains: Array<{
    name: string;
    score: number;
    scoreEvidence: string | null;
    scoreSource: ScoreSource;
  }>;
};

export type NormalizedAnalysis = {
  schoolName: string;
  educationOffice: string;
  city: string;
  stage: string;
  domains: NormalizedDomain[];
  overallScore: number;
  overallScoreEvidence: string | null;
  overallScoreSource: ScoreSource;
};

export type NormalizedCriterion = Omit<ExtractedCriterion, "score"> & {
  score: number;
  classification: CriterionClassification;
  priority: CriterionPriority;
};

type RawDomain = {
  name: string;
  score: number | null;
  scoreEvidence: string;
  criteria: ExtractedCriterion[];
};

export type RawAnalysis = {
  schoolName: string;
  educationOffice: string;
  city: string;
  stage: string;
  overallScore: number | null;
  overallScoreEvidence: string;
  domains: RawDomain[];
};

export type RawScoreAudit = {
  overallScore: number | null;
  overallScoreEvidence: string;
  domains: Array<{ name: string; score: number | null; scoreEvidence: string }>;
};

const boundedScore = (value: unknown) => {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
};

function validScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

function normalizeArabicNumberText(value: string) {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabicIndic = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, digit => String(arabicIndic.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String(easternArabicIndic.indexOf(digit)))
    .replace(/[٫]/g, ".")
    .replace(/[٪]/g, "%")
    .replace(/(?<![\d.])%\s*(\d{1,3}(?:\.\d{1,4})?)/g, "$1%")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/(?<=\d),(?=\d)/g, ".");
}

/** Trust a score as report-reported only when its evidence quote contains the same percentage. */
export function evidenceSupportsScore(score: number, evidence: string | null | undefined) {
  if (!evidence?.trim()) return false;
  const normalized = normalizeArabicNumberText(evidence);
  const percentagePattern = /(\d{1,3}(?:\.\d{1,4})?)\s*%/g;
  let match: RegExpExecArray | null;
  while ((match = percentagePattern.exec(normalized)) !== null) {
    if (Math.abs(Number(match[1]) - score) < 0.05) return true;
  }
  return false;
}

export function evidenceSupportsOverallScore(score: number, evidence: string | null | undefined) {
  const normalized = evidence ? normalizeArabicNumberText(evidence) : "";
  const namesOverall = /(?:التقدم|النتيجة|الدرجة الكلية|النتيجة الكلية|الأداء العام|النتيجة العامة|الإجمالي|المعدل العام|التقدير العام|نسبة الأداء|overall|total|progress)/i.test(normalized);
  return namesOverall && evidenceSupportsScore(score, evidence);
}

export function evidenceSupportsDomainScore(score: number, evidence: string | null | undefined, domainName: string) {
  if (!evidenceSupportsScore(score, evidence)) return false;
  const quote = normalizeDomainName(normalizeArabicNumberText(evidence || ""));
  const domain = normalizeDomainName(normalizeArabicNumberText(domainName));
  return domain.length > 0 && quote.includes(domain);
}

function resolveScore(
  value: unknown,
  evidence: string | null | undefined,
  fallback: number,
  evidenceMatches: (score: number, quote: string) => boolean = (score, quote) => evidenceSupportsScore(score, quote),
) {
  const candidate = validScore(value);
  const quote = evidence?.trim() || "";
  if (candidate !== null && evidenceMatches(candidate, quote)) {
    return {
      score: Number(candidate.toFixed(2)),
      scoreEvidence: quote.slice(0, 180),
      scoreSource: "reported" as const,
    };
  }
  return {
    score: Number(boundedScore(fallback).toFixed(2)),
    scoreEvidence: null,
    scoreSource: "calculated" as const,
  };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeDomainName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, "");
}

function normalizeCriterionCode(value: string) {
  return normalizeArabicNumberText(value)
    .toLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^\u0621-\u064Aa-z0-9]/g, "");
}

function normalizedWords(value: string) {
  return normalizeArabicNumberText(value)
    .toLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .split(/[^\u0621-\u064Aa-z0-9]+/)
    .filter(word => word.length >= 3 && !["المؤشر", "معيار", "الدرجة", "نتيجة", "نتائج", "المدرسة"].includes(word));
}

function evidenceSupportsCriterionNumber(score: number, evidence: string) {
  if (evidenceSupportsScore(score, evidence)) return true;
  const normalized = normalizeArabicNumberText(evidence);
  const valuePattern = /(\d{1,3}(?:\.\d{1,4})?)/g;
  let match: RegExpExecArray | null;
  while ((match = valuePattern.exec(normalized)) !== null) {
    if (Math.abs(Number(match[1]) - score) >= 0.05) continue;
    const context = normalized.slice(Math.max(0, match.index - 24), match.index + match[0].length + 24);
    if (/(?:درجة|نسبة|نتيجة|أداء|score|rating)/i.test(context)) return true;
  }
  return false;
}

/** A criterion is stored only when its quoted source includes both its score and its identifier. */
export function evidenceSupportsCriterionScore(score: number, evidence: string | null | undefined, code: string, name: string) {
  if (!evidence?.trim() || !evidenceSupportsCriterionNumber(score, evidence)) return false;
  const normalizedEvidence = normalizeArabicNumberText(evidence)
    .toLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/[ًٌٍَُِّْـ]/g, "");
  const codeKey = normalizeCriterionCode(code);
  if (codeKey.length >= 2 && normalizeCriterionCode(normalizedEvidence).includes(codeKey)) return true;

  const nameWords = normalizedWords(name);
  if (!nameWords.length) return false;
  const matchedWords = nameWords.filter(word => normalizedEvidence.includes(word)).length;
  return matchedWords >= Math.min(2, nameWords.length);
}

export function inferPriority(score: number): CriterionPriority {
  if (score < 75) return "critical";
  if (score < 80) return "high";
  if (score < 90) return "medium";
  return "low";
}

export function inferClassification(score: number): CriterionClassification {
  return score >= 90 ? "strength" : "weakness";
}

export function normalizeAnalysis(raw: RawAnalysis): NormalizedAnalysis {
  const domains: NormalizedDomain[] = [];
  for (const domain of raw.domains || []) {
    if (!domain?.name?.trim()) continue;
    const candidates: NormalizedCriterion[] = [];
    (domain.criteria || []).forEach(criterion => {
      if (!criterion?.name?.trim()) return;
      const score = validScore(criterion.score);
      const code = criterion.code?.trim() || "";
      const evidence = criterion.evidence?.trim() || "";
      if (score === null || !evidenceSupportsCriterionScore(score, evidence, code, criterion.name)) return;
      candidates.push({
        code: code || "غير مرمز",
        name: criterion.name.trim(),
        score,
        evidence,
        treatment:
          criterion.treatment?.trim() ||
          "تحديد سبب الفجوة، وإسناد إجراء تحسين قابل للقياس، ثم متابعة الأثر في دورة التقويم القادمة.",
        treatmentSource: criterion.treatmentSource === "extracted" ? "extracted" : "suggested",
        classification: inferClassification(score),
        priority: inferPriority(score),
      });
    });

    const deduplicated = new Map<string, NormalizedCriterion | null>();
    candidates.forEach(criterion => {
      const key = `${normalizeDomainName(domain.name)}-${normalizeCriterionCode(criterion.code) || normalizeDomainName(criterion.name)}`;
      const existing = deduplicated.get(key);
      if (existing === undefined) {
        deduplicated.set(key, criterion);
        return;
      }
      // Do not silently keep the first copy when two readings disagree.
      if (existing === null || Math.abs(existing.score - criterion.score) >= 0.05) {
        deduplicated.set(key, null);
        return;
      }
      if (criterion.evidence.length > existing.evidence.length) deduplicated.set(key, criterion);
    });
    const criteria = Array.from(deduplicated.values()).filter((criterion): criterion is NormalizedCriterion => criterion !== null);
    const calculated = average(criteria.map(criterion => criterion.score));
    const resolved = resolveScore(domain.score, domain.scoreEvidence, calculated, (score, evidence) => evidenceSupportsDomainScore(score, evidence, domain.name));
    if (criteria.length === 0 && resolved.scoreSource !== "reported") continue;
    domains.push({
      name: domain.name.trim(),
      score: resolved.score,
      scoreEvidence: resolved.scoreEvidence,
      scoreSource: resolved.scoreSource,
      criteria,
    });
  }

  const resolvedOverall = resolveScore(
    raw.overallScore,
    raw.overallScoreEvidence,
    average(domains.map(domain => domain.score)),
    evidenceSupportsOverallScore,
  );

  return {
    schoolName: raw.schoolName?.trim() || "مدرسة غير مسماة",
    educationOffice: raw.educationOffice?.trim() || "",
    city: raw.city?.trim() || "",
    stage: raw.stage?.trim() || "",
    domains,
    overallScore: resolvedOverall.score,
    overallScoreEvidence: resolvedOverall.scoreEvidence,
    overallScoreSource: resolvedOverall.scoreSource,
  };
}

/** Reconcile a lightweight score-only audit against the already saved indicator scores. */
export function normalizeScoreAudit(
  raw: RawScoreAudit,
  fallbackCriteria: Array<{ domainName: string; score: number }>,
): NormalizedScoreAudit {
  const grouped = new Map<string, { name: string; scores: number[] }>();
  fallbackCriteria.forEach(item => {
    const key = normalizeDomainName(item.domainName);
    if (!key) return;
    const existing = grouped.get(key) || { name: item.domainName, scores: [] };
    existing.scores.push(boundedScore(item.score));
    grouped.set(key, existing);
  });

  (raw.domains || []).forEach(domain => {
    if (!domain?.name?.trim()) return;
    const key = normalizeDomainName(domain.name);
    if (!grouped.has(key)) grouped.set(key, { name: domain.name.trim(), scores: [] });
  });

  const domains = Array.from(grouped.entries()).flatMap(([key, group]) => {
    const match = (raw.domains || []).find(domain => normalizeDomainName(domain.name || "") === key);
    const resolved = resolveScore(match?.score, match?.scoreEvidence, average(group.scores), (score, evidence) => evidenceSupportsDomainScore(score, evidence, group.name));
    if (group.scores.length === 0 && resolved.scoreSource !== "reported") return [];
    return [{
      name: group.name,
      score: resolved.score,
      scoreEvidence: resolved.scoreEvidence,
      scoreSource: resolved.scoreSource,
    }];
  });
  const overall = resolveScore(
    raw.overallScore,
    raw.overallScoreEvidence,
    average(domains.map(domain => domain.score)),
    evidenceSupportsOverallScore,
  );

  return {
    overallScore: overall.score,
    overallScoreEvidence: overall.scoreEvidence,
    overallScoreSource: overall.scoreSource,
    domains,
  };
}

/**
 * The detailed pass extracts criteria, while this smaller second pass focuses only on official totals.
 * A score from the audit replaces the first pass only when its quote independently proves the value.
 */
export function reconcileAnalysisWithScoreAudit(analysis: NormalizedAnalysis, rawAudit: RawScoreAudit): NormalizedAnalysis {
  const audit = normalizeScoreAudit(
    rawAudit,
    analysis.domains.flatMap(domain => domain.criteria.map(criterion => ({ domainName: domain.name, score: criterion.score }))),
  );
  const auditDomains = new Map(audit.domains.map(domain => [normalizeDomainName(domain.name), domain]));
  const matchedDomains = new Set<string>();
  const domains = analysis.domains.map(domain => {
    const key = normalizeDomainName(domain.name);
    const audited = auditDomains.get(key);
    if (!audited || audited.scoreSource !== "reported") return domain;
    matchedDomains.add(key);
    return {
      ...domain,
      score: audited.score,
      scoreEvidence: audited.scoreEvidence,
      scoreSource: "reported" as const,
    };
  });

  // Retain a source-evidenced domain that the detailed pass could not classify into criteria.
  audit.domains.forEach(domain => {
    const key = normalizeDomainName(domain.name);
    if (matchedDomains.has(key) || domain.scoreSource !== "reported") return;
    domains.push({
      name: domain.name,
      score: domain.score,
      scoreEvidence: domain.scoreEvidence,
      scoreSource: "reported",
      criteria: [],
    });
  });

  const overall = audit.overallScoreSource === "reported"
    ? audit
    : {
      overallScore: analysis.overallScore,
      overallScoreEvidence: analysis.overallScoreEvidence,
      overallScoreSource: analysis.overallScoreSource,
    };
  return {
    ...analysis,
    domains,
    overallScore: overall.overallScore,
    overallScoreEvidence: overall.overallScoreEvidence,
    overallScoreSource: overall.overallScoreSource,
  };
}

const analysisSchema = {
  name: "school_evaluation_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      schoolName: { type: "string" },
      educationOffice: { type: "string" },
      city: { type: "string" },
      stage: { type: "string" },
      overallScore: { type: ["number", "null"] },
      overallScoreEvidence: { type: "string", maxLength: 180 },
      domains: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            score: { type: ["number", "null"] },
            scoreEvidence: { type: "string", maxLength: 180 },
            criteria: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  name: { type: "string" },
                  score: { type: ["number", "null"] },
                  evidence: { type: "string", maxLength: 180 },
                  treatment: { type: "string", maxLength: 240 },
                  treatmentSource: { type: "string", enum: ["extracted", "suggested"] },
                },
                required: ["code", "name", "score", "evidence", "treatment", "treatmentSource"],
                additionalProperties: false,
              },
            },
          },
          required: ["name", "score", "scoreEvidence", "criteria"],
          additionalProperties: false,
        },
      },
    },
    required: ["schoolName", "educationOffice", "city", "stage", "overallScore", "overallScoreEvidence", "domains"],
    additionalProperties: false,
  },
} as const;

const scoreAuditSchema = {
  name: "school_evaluation_score_audit",
  strict: true,
  schema: {
    type: "object",
    properties: {
      overallScore: { type: ["number", "null"] },
      overallScoreEvidence: { type: "string", maxLength: 180 },
      domains: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            score: { type: ["number", "null"] },
            scoreEvidence: { type: "string", maxLength: 180 },
          },
          required: ["name", "score", "scoreEvidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["overallScore", "overallScoreEvidence", "domains"],
    additionalProperties: false,
  },
} as const;

function parseStructuredOutput<T>(content: unknown, finishReason: string | null | undefined): T {
  if (finishReason === "length") {
    throw new Error("لم تكتمل نتيجة التحليل بسبب كثرة تفاصيل التقرير. جرّبي تقسيم التقرير إلى ملفات أصغر ثم إعادة رفعه.");
  }
  if (typeof content !== "string") {
    throw new Error("تعذّر استلام نتيجة تحليل قابلة للقراءة.");
  }
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error("تعذّر قراءة النتيجة المنظمة للتقرير. جرّبي إعادة رفع الملف أو تقسيمه إلى أجزاء أصغر.");
  }
}

export function parseAnalysisOutput(content: unknown, finishReason: string | null | undefined) {
  return parseStructuredOutput<RawAnalysis>(content, finishReason);
}

export async function analyzeEvaluationPdf(fileDataUrl: string) {
  const raw = parseLocalReportText(await extractPdfText(fileDataUrl));
  const normalized = normalizeAnalysis(raw);
  if (!normalized.domains.some(domain => domain.criteria.length > 0)) {
    throw new Error("لم تُقرأ مؤشرات موثوقة. ارفعي تقرير تقويم يحتوي على المجال ورمز المؤشر واسمه ودرجته. تدعم القراءة المحلية الملفات النصية والصور الواضحة ذات جدول المؤشرات القياسي؛ اسم الملف لا يؤثر في التحليل.");
  }
  return normalized;
}

export async function analyzeOfficialReportScores(fileDataUrl: string) {
  return localScoreAudit(parseLocalReportText(await extractPdfText(fileDataUrl)));
}
