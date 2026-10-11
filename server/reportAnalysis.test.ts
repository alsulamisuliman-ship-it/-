import { describe, expect, it } from "vitest";
import { evidenceSupportsCriterionScore, inferClassification, inferPriority, normalizeAnalysis, normalizeScoreAudit, parseAnalysisOutput, reconcileAnalysisWithScoreAudit } from "./reportAnalysis";

describe("تحويل نتائج التقرير", () => {
  it("يصنف الدرجات ويحدد الأولوية وفق عتبات واضحة", () => {
    expect(inferClassification(94)).toBe("strength");
    expect(inferClassification(89.99)).toBe("weakness");
    expect(inferPriority(91)).toBe("low");
    expect(inferPriority(82)).toBe("medium");
    expect(inferPriority(77)).toBe("high");
    expect(inferPriority(60)).toBe("critical");
  });

  it("يحذف المعايير المكررة ويمنح المعالجة المقترحة وسمها الصحيح", () => {
    const result = normalizeAnalysis({
      schoolName: "مدرسة اختبار",
      educationOffice: "",
      city: "",
      stage: "",
      overallScore: null,
      overallScoreEvidence: "",
      domains: [{
        name: "نتائج التعلم",
        score: 0,
        scoreEvidence: "",
        criteria: [
          { code: "3-1", name: "القراءة", score: 72, evidence: "3-1 القراءة: الدرجة 72%", treatment: "", treatmentSource: "suggested" },
          { code: "3-1", name: "القراءة", score: 72, evidence: "3-1 القراءة: الدرجة 72%", treatment: "", treatmentSource: "suggested" },
        ],
      }],
    });
    expect(result.domains[0].criteria).toHaveLength(1);
    expect(result.domains[0].criteria[0]).toMatchObject({ classification: "weakness", priority: "critical", treatmentSource: "suggested" });
    expect(result.overallScore).toBe(72);
  });

  it("يعتمد الدرجة الرسمية الموثقة 88% ولا يستبدلها بمتوسط مؤشرات قدره 91.6%", () => {
    const criterionScores = [92, 94, 95, 89, 88];
    const result = normalizeAnalysis({
      schoolName: "مدرسة الإمام عبدالله بن سعود",
      educationOffice: "",
      city: "",
      stage: "",
      overallScore: 88,
      overallScoreEvidence: "التقدم ٨٨٪",
      domains: [
        {
          name: "البيئة المدرسية",
          score: 90.5,
          scoreEvidence: "البيئة المدرسية 90.5%",
          criteria: criterionScores.map((score, index) => ({
            code: `1-${index + 1}`,
            name: `مؤشر ${index + 1}`,
            score,
            evidence: "دليل",
            treatment: "إجراء",
            treatmentSource: "suggested" as const,
          })),
        },
        { name: "نواتج التعلم", score: 78.5, scoreEvidence: "نواتج التعلم 78.5%", criteria: [] },
        { name: "التعليم والتعلم", score: 92, scoreEvidence: "التعليم والتعلم 92%", criteria: [] },
        { name: "الإدارة المدرسية", score: 92, scoreEvidence: "الإدارة المدرسية 92%", criteria: [] },
      ],
    });
    const indicatorAverage = criterionScores.reduce((sum, score) => sum + score, 0) / criterionScores.length;
    expect(indicatorAverage).toBe(91.6);
    expect(result).toMatchObject({ overallScore: 88, overallScoreEvidence: "التقدم ٨٨٪", overallScoreSource: "reported" });
    expect(result.domains.map(domain => [domain.name, domain.score, domain.scoreSource])).toEqual([
      ["البيئة المدرسية", 90.5, "reported"],
      ["نواتج التعلم", 78.5, "reported"],
      ["التعليم والتعلم", 92, "reported"],
      ["الإدارة المدرسية", 92, "reported"],
    ]);
  });

  it("لا يصف رقماً غير متطابق مع شاهد النسبة بأنه درجة رسمية", () => {
    const result = normalizeAnalysis({
      schoolName: "مدرسة اختبار",
      educationOffice: "",
      city: "",
      stage: "",
      overallScore: 91.6,
      overallScoreEvidence: "التقدم 88%",
      domains: [{
        name: "الإدارة المدرسية",
        score: 99,
        scoreEvidence: "الإدارة المدرسية 92%",
        criteria: [
          { code: "1", name: "مؤشر أول", score: 80, evidence: "مؤشر أول: الدرجة 80%", treatment: "إجراء", treatmentSource: "suggested" },
          { code: "2", name: "مؤشر ثانٍ", score: 90, evidence: "مؤشر ثانٍ: الدرجة 90%", treatment: "إجراء", treatmentSource: "suggested" },
        ],
      }],
    });
    expect(result).toMatchObject({ overallScore: 85, overallScoreEvidence: null, overallScoreSource: "calculated" });
    expect(result.domains[0]).toMatchObject({ score: 85, scoreEvidence: null, scoreSource: "calculated" });
  });

  it("يرفض نسبة صحيحة عددياً إذا كان شاهدها لمؤشر أو مجال آخر", () => {
    const result = normalizeAnalysis({
      schoolName: "مدرسة اختبار",
      educationOffice: "",
      city: "",
      stage: "",
      overallScore: 88,
      overallScoreEvidence: "مؤشر الرياضيات 88%",
      domains: [{
        name: "الإدارة المدرسية",
        score: 85,
        scoreEvidence: "نواتج التعلم 85%",
        criteria: [
          { code: "1", name: "مؤشر أول", score: 80, evidence: "مؤشر أول: الدرجة 80%", treatment: "إجراء", treatmentSource: "suggested" },
          { code: "2", name: "مؤشر ثانٍ", score: 90, evidence: "مؤشر ثانٍ: الدرجة 90%", treatment: "إجراء", treatmentSource: "suggested" },
        ],
      }],
    });
    expect(result).toMatchObject({ overallScore: 85, overallScoreEvidence: null, overallScoreSource: "calculated" });
    expect(result.domains[0]).toMatchObject({ score: 85, scoreEvidence: null, scoreSource: "calculated" });
  });

  it("يعيد تدقيق درجات المجالات دون أن يغيّر المؤشرات المخزنة", () => {
    const result = normalizeScoreAudit({
      overallScore: 88,
      overallScoreEvidence: "التقدم 88%",
      domains: [
        { name: "نتائج التعلم", score: 78.5, scoreEvidence: "نتائج التعلم 78.5%" },
        { name: "الإدارة المدرسية", score: null, scoreEvidence: "" },
      ],
    }, [
      { domainName: "نتائج التعلم", score: 76 },
      { domainName: "نتائج التعلم", score: 80 },
      { domainName: "الإدارة المدرسية", score: 90 },
      { domainName: "الإدارة المدرسية", score: 94 },
    ]);
    expect(result.overallScore).toBe(88);
    expect(result.overallScoreSource).toBe("reported");
    expect(result.domains).toEqual([
      { name: "نتائج التعلم", score: 78.5, scoreEvidence: "نتائج التعلم 78.5%", scoreSource: "reported" },
      { name: "الإدارة المدرسية", score: 92, scoreEvidence: null, scoreSource: "calculated" },
    ]);
  });

  it("لا ينشئ مجالاً من شاهد درجة يخص مجالاً آخر أثناء إعادة التدقيق", () => {
    const result = normalizeScoreAudit({
      overallScore: 88,
      overallScoreEvidence: "التقدم 88%",
      domains: [{ name: "مجال غير معروف", score: 90, scoreEvidence: "الإدارة المدرسية 90%" }],
    }, [
      { domainName: "الإدارة المدرسية", score: 80 },
      { domainName: "الإدارة المدرسية", score: 90 },
    ]);
    expect(result.overallScore).toBe(88);
    expect(result.domains).toEqual([
      { name: "الإدارة المدرسية", score: 85, scoreEvidence: null, scoreSource: "calculated" },
    ]);
  });

  it("لا يقبل درجة مؤشر إلا عندما يجمع الشاهد بين هوية المؤشر وقيمته", () => {
    expect(evidenceSupportsCriterionScore(72.5, "المؤشر 3-1-1: الدرجة 72.5%", "3-1-1", "يحقق المتعلمون نتائج متقدمة")).toBe(true);
    expect(evidenceSupportsCriterionScore(72.5, "المؤشر 3-1-1: الدرجة 71%", "3-1-1", "يحقق المتعلمون نتائج متقدمة")).toBe(false);
    expect(evidenceSupportsCriterionScore(72.5, "الدرجة 72.5%", "3-1-1", "يحقق المتعلمون نتائج متقدمة")).toBe(false);
  });

  it("يستبعد المؤشرات غير المسندة أو المتعارضة بدلاً من تحويلها إلى أولوية عاجلة خاطئة", () => {
    const result = normalizeAnalysis({
      schoolName: "مدرسة اختبار",
      educationOffice: "",
      city: "",
      stage: "",
      overallScore: null,
      overallScoreEvidence: "",
      domains: [{
        name: "نتائج التعلم",
        score: null,
        scoreEvidence: "",
        criteria: [
          { code: "3-1-1", name: "المؤشر الموثق", score: 72.5, evidence: "3-1-1 المؤشر الموثق: الدرجة 72.5%", treatment: "إجراء", treatmentSource: "extracted" as const },
          { code: "3-1-2", name: "مؤشر بلا شاهد", score: 0, evidence: "الدليل عام ولا يذكر رقماً", treatment: "", treatmentSource: "suggested" as const },
          { code: "3-1-3", name: "مؤشر متعارض", score: 80, evidence: "3-1-3 مؤشر متعارض: الدرجة 80%", treatment: "", treatmentSource: "suggested" as const },
          { code: "3-1-3", name: "مؤشر متعارض", score: 82, evidence: "3-1-3 مؤشر متعارض: الدرجة 82%", treatment: "", treatmentSource: "suggested" as const },
        ],
      }],
    });
    expect(result.domains[0].criteria).toEqual([
      expect.objectContaining({ code: "3-1-1", score: 72.5, priority: "critical" }),
    ]);
    expect(result.overallScore).toBe(72.5);
  });

  it("يعطي قراءة الدرجات الرسمية المستقلة أولوية على قراءة التفاصيل عند اختلافهما", () => {
    const detailed = normalizeAnalysis({
      schoolName: "مدرسة اختبار",
      educationOffice: "",
      city: "",
      stage: "",
      overallScore: 91.6,
      overallScoreEvidence: "التقدم 91.6%",
      domains: [{
        name: "البيئة المدرسية",
        score: 89.9,
        scoreEvidence: "البيئة المدرسية 89.9%",
        criteria: [{ code: "4-2-1", name: "بيئة آمنة", score: 89.9, evidence: "4-2-1 بيئة آمنة: الدرجة 89.9%", treatment: "إجراء", treatmentSource: "suggested" as const }],
      }],
    });
    const verified = reconcileAnalysisWithScoreAudit(detailed, {
      overallScore: 88,
      overallScoreEvidence: "التقدم 88%",
      domains: [{ name: "البيئة المدرسية", score: 90.5, scoreEvidence: "البيئة المدرسية 90.5%" }],
    });
    expect(verified).toMatchObject({ overallScore: 88, overallScoreEvidence: "التقدم 88%", overallScoreSource: "reported" });
    expect(verified.domains[0]).toMatchObject({ score: 90.5, scoreEvidence: "البيئة المدرسية 90.5%", scoreSource: "reported" });
  });

  it("يحوّل JSON منظماً إلى بيانات خام قابلة للمعالجة", () => {
    expect(parseAnalysisOutput('{"schoolName":"مدرسة","educationOffice":"","city":"","stage":"","overallScore":null,"overallScoreEvidence":"","domains":[]}', "stop"))
      .toMatchObject({ schoolName: "مدرسة", domains: [] });
  });

  it("يرفض استجابة مقتطعة برسالة واضحة بدلاً من تمرير JSON تالف", () => {
    expect(() => parseAnalysisOutput('{"domains":[', "length"))
      .toThrow("لم تكتمل نتيجة التحليل بسبب كثرة تفاصيل التقرير");
  });
});
