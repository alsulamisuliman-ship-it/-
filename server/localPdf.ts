import type { RawAnalysis, RawScoreAudit, ExtractedCriterion } from "./reportAnalysis";

const domainNames = ["الإدارة المدرسية", "التعليم والتعلم", "نواتج التعلم", "البيئة المدرسية"];
const clean = (text: string) => text.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/٫/g, ".").replace(/٪/g, "%").replace(/(?<![\d.])%\s*(\d{1,3}(?:\.\d{1,2})?)/g, "$1%").replace(/[ًٌٍَُِّْـ]/g, "")
  .replace(/[إأآ]/g, "ا").replace(/[–−]/g, "-");

function singleScore(line: string) {
  const normalized = clean(line);
  let matches = Array.from(normalized.matchAll(/(\d{1,3}(?:\.\d{1,2})?)\s*%/g));
  if (!matches.length) matches = Array.from(normalized.matchAll(/(?:الدرجة|درجة|النسبة|نسبة)\s*[:：]?\s*(\d{1,3}(?:\.\d{1,2})?)(?![\d.-])/g));
  if (matches.length !== 1) return null;
  const score = Number(matches[0][1]);
  return score >= 0 && score <= 100 ? score : null;
}

export function parseLocalReportText(text: string): RawAnalysis {
  const result: RawAnalysis = { schoolName: "", educationOffice: "", city: "", stage: "", overallScore: null, overallScoreEvidence: "", domains: [] };
  let current: RawAnalysis["domains"][number] | undefined;
  const overall: Array<{score: number; evidence: string}> = [];
  for (const original of text.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const normalized = clean(line);
    for (const [field, label] of [["schoolName", "اسم المدرسة"], ["educationOffice", "مكتب التعليم"], ["city", "المدينة"], ["stage", "المرحلة"]] as const) {
      const match = line.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`));
      if (match && !result[field]) result[field] = match[1].trim();
    }
    const codes = Array.from(normalized.matchAll(/(?<![\d-])\d{1,2}(?:\s*-\s*\d{1,2}){1,3}(?![\d-])/g));
    const score = singleScore(line);
    if (!codes.length && /(?:الدرجة الكلية|النتيجة الكلية|النتيجة العامة|الاجمالي|التقدم|الاداء العام|المعدل العام)/.test(normalized) && score !== null && /%/.test(normalized)) {
      if (line.length <= 180) overall.push({ score, evidence: line });
      continue;
    }
    const domain = domainNames.find(name => normalized.includes(clean(name)));
    if (domain && !codes.length) {
      current = result.domains.find(item => item.name === domain);
      if (!current) {
        current = { name: domain, score: null, scoreEvidence: "", criteria: [] };
        result.domains.push(current);
      }
      if (score !== null && normalized.includes("%") && line.length <= 180) {
        // Conflicting official domain totals are ambiguous; do not trust either.
        if (current.scoreEvidence === "conflict" || (current.score !== null && current.score !== score)) {
          current.score = null;
          current.scoreEvidence = "conflict";
        } else {
          current.score = score;
          current.scoreEvidence = line;
        }
      }
      continue;
    }
    // A single row must identify a criterion, its current domain, and one score.
    if (!current || codes.length !== 1 || score === null || line.length > 180) continue;
    const code = codes[0][0].replace(/\s/g, "");
    const name = normalized.replace(codes[0][0], "").replace(/\d{1,3}(?:\.\d{1,2})?\s*%/g, "")
      .replace(/(?:الدرجة|درجة|النسبة|نسبة)\s*[:：]?\s*\d{1,3}(?:\.\d{1,2})?/g, "").replace(/^\s*[:|\-]+|[:|\-]+\s*$/g, "").trim();
    if (!name || !/[\u0621-\u064Aa-z]/i.test(name)) continue;
    const criterion: ExtractedCriterion = {
      code, name, score, evidence: line,
      treatment: `راجعي شواهد مؤشر «${name}»، وحددي إجراءً قابلاً للقياس مع مسؤول التنفيذ والمدة، ثم تابعي النتائج دورياً.`,
      treatmentSource: "suggested",
    };
    current.criteria.push(criterion);
  }
  if (overall.length && overall.every(item => item.score === overall[0].score)) {
    result.overallScore = overall[0].score;
    result.overallScoreEvidence = overall[0].evidence;
  }
  for (const domain of result.domains) if (domain.scoreEvidence === "conflict") domain.scoreEvidence = "";
  return result;
}

export function localScoreAudit(raw: RawAnalysis): RawScoreAudit {
  return { overallScore: raw.overallScore, overallScoreEvidence: raw.overallScoreEvidence,
    domains: raw.domains.map(domain => ({ name: domain.name, score: domain.score, scoreEvidence: domain.scoreEvidence })) };
}

export async function extractPdfText(dataUrl: string) {
  if (!/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error("ملف PDF غير صالح.");
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  if (bytes.length > 12 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("ملف PDF غير صالح أو يتجاوز 12 ميغابايت.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 200) throw new Error("قسّمي التقرير إلى ملفات لا تتجاوز 200 صفحة.");
    const lines: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const rows: Array<{ y: number; items: Array<{ x: number; text: string; rtl: boolean }> }> = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = item.transform[5];
        let row = rows.find(row => Math.abs(row.y - y) < 2);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x: item.transform[4], text: item.str, rtl: item.dir === "rtl" });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        const rtl = row.items.some(item => item.rtl);
        row.items.sort((a, b) => rtl ? b.x - a.x : a.x - b.x);
        lines.push(row.items.map(item => item.text).join(" "));
      }
      page.cleanup();
    }
    const text = lines.join("\n");
    if (text.trim().length < 20) throw new Error("هذا الملف لا يحتوي نصاً قابلاً للاستخراج. ارفعي PDF نصياً؛ الصور الممسوحة تحتاج OCR وغير مدعومة في التحليل المحلي.");
    return text;
  } finally {
    await task.destroy();
  }
}
