import { describe, expect, it } from "vitest";
import { extractPdfText, parseLocalReportText } from "./localPdf";
import { analyzeEvaluationPdf, normalizeAnalysis } from "./reportAnalysis";

function makePdf(lines: string[]) {
  const chars = Array.from(new Set(lines.join("")));
  const code = (char: string) =>
    (chars.indexOf(char) + 1).toString(16).padStart(2, "0");
  const mappings = chars
    .map(
      char =>
        `<${code(char)}> <${char.charCodeAt(0).toString(16).padStart(4, "0")}>`
    )
    .join("\n");
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Local def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${chars.length} beginbfchar\n${mappings}\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const stream = lines
    .map(
      (line, i) =>
        `BT /F1 12 Tf 20 ${760 - i * 20} Td <${Array.from(line).map(code).join("")}> Tj ET`
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(result.length);
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = result.length;
  result += `xref\n0 7\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, "0")} 00000 n `)
    .join(
      "\n"
    )}\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return `data:application/pdf;base64,${Buffer.from(result).toString("base64")}`;
}

describe("local PDF analysis", () => {
  it("reads an actual PDF without a network service", async () => {
    const text = await extractPdfText(
      makePdf(["School evaluation report", "Indicator 1-1-1 score 80%"])
    );
    expect(text).toContain("School evaluation report");
    expect(text).toContain("80%");
  });
  it("analyzes an actual Arabic PDF end to end", async () => {
    // PDF glyph streams store these RTL runs in visual order; ToUnicode
    // maps glyphs back to characters before PDF.js applies bidi ordering.
    const input = makePdf(["ةيسردملا ةرادإلا", "%80 يسردملا طيطختلا 1-1-1"]);
    const result = await analyzeEvaluationPdf(input);
    expect(result.domains[0].criteria[0].score).toBe(80);
  });
  it("extracts Arabic numbers and preserves official versus calculated totals", () => {
    const raw = parseLocalReportText(
      "اسم المدرسة: مدرسة الاختبار\nالتقدم ٨٨٪\nالإدارة المدرسية ٩٠٪\n١-١-١ التخطيط المدرسي ٨٠٪\n١-١-٢ التطوير المهني الدرجة: ٩٢"
    );
    const result = normalizeAnalysis(raw);
    expect(result.schoolName).toBe("مدرسة الاختبار");
    expect(result.overallScore).toBe(88);
    expect(result.overallScoreSource).toBe("reported");
    expect(result.domains[0].score).toBe(90);
    expect(result.domains[0].criteria.map(item => item.score)).toEqual([
      80, 92,
    ]);
    expect(result.domains[0].criteria[0].treatmentSource).toBe("suggested");
  });
  it("validates and preserves four-decimal reported percentages", () => {
    const result = normalizeAnalysis(
      parseLocalReportText(
        "نواتج التعلم\n3-1-1-1 التحصيل الدراسي 72.5225% [OCR صفحة 19]"
      )
    );
    expect(result.domains[0].criteria[0].score).toBe(72.5225);
    expect(result.domains[0].criteria[0].evidence).toContain("72.5225%");
    expect(result.domains[0].criteria[0].name).not.toContain("OCR");
  });
  it("rejects ambiguous rows, conflicting totals, and duplicate scores", () => {
    const result = normalizeAnalysis(
      parseLocalReportText(
        "التقدم 88%\nالتقدم 90%\nالإدارة المدرسية\n1-1-1 التخطيط المدرسي 80% 90%\n1-1-2 التطوير المهني 80%\n1-1-2 التطوير المهني 85%\n1-1-3 جودة العمل 79%"
      )
    );
    expect(result.overallScoreSource).toBe("calculated");
    expect(result.domains[0].criteria.map(item => item.code)).toEqual([
      "1-1-3",
    ]);
  });
  it("does not infer an unlabeled criterion or a missing domain", () => {
    const raw = parseLocalReportText(
      "1-1-1 التخطيط المدرسي 80%\nالإدارة المدرسية\nالتطوير المهني 90%\n1-1-2 جودة العمل"
    );
    expect(raw.domains[0].criteria).toHaveLength(0);
  });
  it("rejects a valid PDF without readable text", async () => {
    await expect(extractPdfText(makePdf([]))).rejects.toThrow("مؤشرات موثوقة");
  });
  it("rejects a readable PDF that has no verifiable criteria", async () => {
    await expect(
      analyzeEvaluationPdf(makePdf(["School evaluation report with no scores"]))
    ).rejects.toThrow("لم تُقرأ مؤشرات موثوقة");
  });
});
