import { describe, expect, it } from "vitest";
import { assembleOcrPage, type OcrLine } from "./pdfOcr";
const line = (
  text: string,
  x: number,
  y: number,
  confidence = 95
): OcrLine => ({
  text,
  confidence,
  bbox: { x0: x - 30, x1: x + 30, y0: y - 8, y1: y + 8 },
});
describe("geometric OCR report reading", () => {
  it("pairs scores with their table rows despite different text baselines", () => {
    const text = assembleOcrPage(
      [
        line("الإدارة المدرسية", 850, 150),
        line("1-1-1-1", 880, 400),
        line("التخطيط المدرسي", 500, 403),
        line("81.75%", 100, 390),
        line("1-1-1-2", 880, 650),
        line("متابعة الخطة", 500, 653),
        line("86.5%", 100, 640),
      ],
      1000,
      1400,
      5
    );
    expect(text).toContain("1-1-1-1 التخطيط المدرسي 81.75%");
    expect(text).toContain("1-1-1-2 متابعة الخطة 86.5%");
  });
  it("corroborates a partial domain heading using every table code prefix", () => {
    const lines = [
      line("dual الإدارة", 850, 150, 56),
      line("1-1-1-1", 880, 400),
      line("التخطيط المدرسي", 500, 403),
      line("81.75%", 100, 390),
    ];
    expect(assembleOcrPage(lines, 1000, 1400, 5)).toContain(
      "الإدارة المدرسية\n1-1-1-1"
    );
    lines[1] = line("2-1-1-1", 880, 400);
    expect(assembleOcrPage(lines, 1000, 1400, 5)).toBe("");
  });
  it("reads official overview totals and each uniquely labelled chart column", () => {
    const text = assembleOcrPage(
      [
        line("التقدم", 850, 500),
        line("88%", 100, 500),
        line("الإدارة المدرسية", 850, 1000),
        line("92%", 850, 760),
        line("التعليم والتعلم", 650, 1000),
        line("92%", 650, 760),
        line("نواتج التعلم", 450, 1000),
        line("78.5%", 450, 790),
        line("البيئة المدرسية", 200, 1000),
        line("90.5%", 200, 760),
      ],
      1000,
      1400,
      1
    );
    expect(text).toContain("التقدم 88%");
    expect(text).toContain("نواتج التعلم 78.5%");
    expect(text).toContain("البيئة المدرسية 90.5%");
  });
  it("preserves official percentages with four decimal places", () => {
    const text = assembleOcrPage(
      [
        line("نواتج التعلم", 850, 150),
        line("3-1-1-1", 880, 400),
        line("اختبارات التحصيل", 500, 400),
        line("72.5225%", 100, 390),
      ],
      1000,
      1400,
      19
    );
    expect(text).toContain("72.5225%");
  });
  it("does not treat subdomain chart values as official domain totals", () => {
    const text = assembleOcrPage(
      [
        line("الإدارة المدرسية", 850, 1000),
        line("92%", 850, 760),
        line("التعليم والتعلم", 650, 1000),
        line("92%", 650, 760),
        line("نواتج التعلم", 450, 1000),
        line("96%", 450, 790),
      ],
      1000,
      1400,
      3
    );
    expect(text).toBe("");
  });
  it("excludes ambiguous scores and incomplete or uncertain indicator codes", () => {
    const header = line("الإدارة المدرسية", 850, 150);
    const ambiguous = assembleOcrPage(
      [
        header,
        line("1-1-1-1", 880, 400),
        line("اسم المؤشر", 500, 400),
        line("80%", 100, 390),
        line("90%", 140, 399),
      ],
      1000,
      1400,
      5
    );
    expect(ambiguous).not.toContain("1-1-1-1");
    const uncertain = assembleOcrPage(
      [
        header,
        line("1-1-1", 880, 400),
        line("اسم المؤشر", 500, 400),
        line("80%", 100, 390),
      ],
      1000,
      1400,
      5
    );
    expect(uncertain).not.toContain("80%");
    const low = assembleOcrPage(
      [
        header,
        line("1-1-1-1", 880, 400, 60),
        line("اسم المؤشر", 500, 400),
        line("80%", 100, 390),
      ],
      1000,
      1400,
      5
    );
    expect(low).not.toContain("80%");
  });
});
