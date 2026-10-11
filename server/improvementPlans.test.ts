import { describe, expect, it } from "vitest";
import { buildImprovementPlanDraft, proposedTargetScore, sortImprovementPlans } from "./improvementPlans";

describe("improvement plan drafting", () => {
  it("proposes a bounded target based on the current indicator score", () => {
    expect(proposedTargetScore(62)).toBe(72);
    expect(proposedTargetScore(88)).toBe(98);
    expect(proposedTargetScore(92)).toBe(97);
    expect(proposedTargetScore(100)).toBe(100);
    expect(proposedTargetScore(-3)).toBe(10);
  });

  it("creates a result-grounded need, actions, and execution mechanism", () => {
    const draft = buildImprovementPlanDraft({
      score: 68,
      priority: "critical",
      criterionCode: "2.1",
      criterionName: "التخطيط للتعليم",
      domainName: "التعليم والتعلم",
      evidence: "خطة التحسين السنوية لا تشمل خط الأساس.",
      treatment: "تحديث الخطة وإدراج خط أساس ومستهدفات مرحلية.",
      treatmentSource: "extracted",
    });
    expect(draft.targetScore).toBe(78);
    expect(draft.needDescription).toContain("68.0%");
    expect(draft.needDescription).toContain("التخطيط للتعليم");
    expect(draft.needDescription).toContain("خطة التحسين السنوية");
    expect(draft.improvementActions).toContain("تحديث الخطة");
    expect(draft.implementationMechanism).toContain("فريق مصغر");
    expect(draft.implementationMechanism).toContain("78.0%");
  });

  it("sorts urgent and lowest-scoring indicators first with stable code tie-breaks", () => {
    const sorted = sortImprovementPlans([
      { criterionCode: "3", score: 70, priority: "critical" as const },
      { criterionCode: "2", score: 64, priority: "critical" as const },
      { criterionCode: "1", score: 64, priority: "critical" as const },
      { criterionCode: "4", score: 77, priority: "high" as const },
      { criterionCode: "5", score: 92, priority: "low" as const },
    ]);
    expect(sorted.map(item => item.criterionCode)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
