import type { CriterionPriority } from "./reportAnalysis";

export type ImprovementSeed = {
  score: number;
  priority: CriterionPriority;
  criterionCode: string;
  criterionName: string;
  domainName: string;
  evidence: string;
  treatment: string;
  treatmentSource: "extracted" | "suggested";
};

export type ImprovementPlanDraft = {
  targetScore: number;
  needDescription: string;
  improvementActions: string;
  implementationMechanism: string;
};

const priorityOrder: Record<CriterionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function proposedTargetScore(score: number): number {
  const normalized = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0));
  const uplift = normalized < 90 ? 10 : 5;
  return Math.min(100, Number((normalized + uplift).toFixed(2)));
}

export function buildImprovementPlanDraft(seed: ImprovementSeed): ImprovementPlanDraft {
  const current = Math.max(0, Math.min(100, Number(seed.score) || 0));
  const target = proposedTargetScore(current);
  const gap = Number(Math.max(0, target - current).toFixed(2));
  const hasEvidence = seed.evidence.trim() && !seed.evidence.includes("لم يُستخرج دليل");
  const evidencePhrase = hasEvidence
    ? `ويُراجع الدليل المرتبط به («${seed.evidence.trim().slice(0, 280)}»).`
    : "مع استكمال الشواهد والوثائق المرتبطة به.";

  const needDescription = current < 90
    ? `حقق مؤشر «${seed.criterionName}» في مجال «${seed.domainName}» درجة ${current.toFixed(1)}%، ويصنّف بأولوية ${seed.priority === "critical" ? "عاجلة" : seed.priority === "high" ? "عالية" : seed.priority === "medium" ? "متوسطة" : "منخفضة"}. الفجوة عن الهدف المقترح ${target.toFixed(1)}% هي ${gap.toFixed(1)} نقطة. ${evidencePhrase}`
    : `حقق مؤشر «${seed.criterionName}» درجة ${current.toFixed(1)}%. تتركز الحاجة على استدامة الممارسة وتوثيقها ونقلها، مع السعي إلى الهدف المقترح ${target.toFixed(1)}%. ${evidencePhrase}`;

  const sourceLabel = seed.treatmentSource === "extracted"
    ? "مراجعة الإجراء الوارد في التقرير وتكييفه مع نتيجة المؤشر"
    : "تطبيق المعالجة المقترحة للمؤشر";
  const improvementActions = current < 90
    ? `1. تحليل أسباب فجوة المؤشر ومراجعة الشواهد الحالية.\n2. ${sourceLabel}: ${seed.treatment.trim()}\n3. تحديد ناتج قابل للقياس وجمع شواهد التنفيذ، ثم إعادة قياس المؤشر في نهاية المدة.`
    : `1. توثيق الممارسة والشواهد التي أسهمت في النتيجة الحالية.\n2. المحافظة على الإجراء القائم ومراجعة استمراريته دورياً.\n3. مشاركة الممارسة الناجحة مع الفريق والاستفادة منها في رفع المؤشرات ذات الصلة.`;

  const implementationMechanism = `تسمية فريق مصغر من قائدة المدرسة ومسؤولة الجودة والمعنيات بالمؤشر؛ إعداد قائمة تحقق وشواهد قبل البدء؛ متابعة التنفيذ في اجتماع دوري موثق؛ قياس النتيجة ومقارنة الدرجة المستهدفة ${target.toFixed(1)}% بالدرجة المتحققة عند الإغلاق.`;

  return { targetScore: target, needDescription, improvementActions, implementationMechanism };
}

export function sortImprovementPlans<T extends { score: number; priority: CriterionPriority; criterionCode?: string }>(plans: T[]): T[] {
  return [...plans].sort((a, b) =>
    priorityOrder[a.priority] - priorityOrder[b.priority]
    || a.score - b.score
    || (a.criterionCode ?? "").localeCompare(b.criterionCode ?? "", "ar")
  );
}
