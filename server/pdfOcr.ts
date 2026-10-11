import path from "node:path";
import { createCanvas, clearAllCache } from "@napi-rs/canvas";
import { createWorker, PSM, type Line } from "tesseract.js";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

export type OcrLine = Pick<Line, "text" | "bbox" | "confidence">;
const normalize = (text: string) =>
  text
    .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٪/g, "%")
    .replace(/٫/g, ".")
    .replace(/[ًٌٍَُِّْـ\u200e\u200f]/g, "")
    .replace(/[إأآ]/g, "ا")
    .trim();
const cy = (line: OcrLine) => (line.bbox.y0 + line.bbox.y1) / 2;
const cx = (line: OcrLine) => (line.bbox.x0 + line.bbox.x1) / 2;
function domainName(text: string) {
  const value = normalize(text);
  // OCR can omit the meem or duplicate the article in المدرسة. These aliases
  // recognize only domain headings; never repair digits or criterion codes.
  if (value.length > 40) return undefined;
  if (/الادارة\s+(?:المدرسية|اللدرسية|للدرسية|الدرسية|الدرس[يه]ة)/.test(value))
    return "الإدارة المدرسية";
  if (/التعليم\s+والتعلم/.test(value)) return "التعليم والتعلم";
  if (/نواتج\s+التعلم/.test(value)) return "نواتج التعلم";
  if (/البي[ئء]ة\s+(?:المدرسية|اللدرسية|للدرسية|الدرسية)/.test(value))
    return "البيئة المدرسية";
  return undefined;
}
function percentage(line: OcrLine) {
  if (line.confidence < 75) return undefined;
  const text = normalize(line.text);
  const match = text.match(
    /^(?:(\d{1,3}(?:\.\d{1,4})?)\s*%|%\s*(\d{1,3}(?:\.\d{1,4})?))$/
  );
  if (!match) return undefined;
  const value = Number(match[1] || match[2]);
  return value <= 100 ? value : undefined;
}

export function assembleOcrPage(
  lines: OcrLine[],
  width: number,
  height: number,
  pageNumber: number
) {
  const output: string[] = [];
  const percentages = lines.filter(line => percentage(line) !== undefined);
  const labels = lines.filter(
    line => domainName(line.text) && line.confidence >= 70
  );
  // The official overview is a labelled total at the right of one row.
  for (const label of lines.filter(
    line =>
      normalize(line.text) === "التقدم" &&
      cx(line) > width * 0.7 &&
      line.confidence >= 80
  )) {
    const candidates = percentages.filter(
      line =>
        cx(line) < width * 0.3 &&
        Math.abs(cy(line) - cy(label)) < height * 0.015
    );
    if (candidates.length === 1)
      output.push(
        `التقدم ${percentage(candidates[0])}% [OCR صفحة ${pageNumber}]`
      );
  }
  // Chart bars: require a unique percentage above the domain in its column.
  if (labels.length >= 3 && output.some(line => line.startsWith("التقدم "))) {
    for (const label of labels) {
      const candidates = percentages.filter(
        line =>
          Math.abs(cx(line) - cx(label)) < width * 0.035 &&
          cy(line) < cy(label) &&
          cy(label) - cy(line) < height * 0.25
      );
      if (candidates.length === 1)
        output.push(
          `${domainName(label.text)} ${percentage(candidates[0])}% [OCR صفحة ${pageNumber}]`
        );
    }
  }
  const headings = labels.filter(
    line => cy(line) < height * 0.2 && cx(line) > width * 0.6
  );
  const codes = lines.filter(
    line =>
      /^\d{1,2}(?:-\d{1,2}){3}$/.test(
        normalize(line.text).replace(/\s/g, "")
      ) &&
      cx(line) > width * 0.8 &&
      line.confidence >= 80
  );
  if (codes.length && headings.length === 1) {
    output.push(domainName(headings[0].text)!);
    for (const code of codes) {
      const scores = percentages.filter(
        line =>
          cx(line) < width * 0.22 &&
          Math.abs(cy(line) - cy(code)) < height * 0.022
      );
      const names = lines.filter(
        line =>
          line.bbox.x0 > width * 0.18 &&
          line.bbox.x1 < width * 0.83 &&
          Math.abs(cy(line) - cy(code)) < height * 0.018 &&
          line.confidence >= 70 &&
          /[\u0621-\u064A]/.test(line.text)
      );
      if (scores.length !== 1 || !names.length || names.length > 6) continue;
      const name = names
        .sort((a, b) => a.bbox.y0 - b.bbox.y0 || b.bbox.x0 - a.bbox.x0)
        .map(line => line.text.replace(/[\u200e\u200f]/g, "").trim())
        .join(" ")
        .slice(0, 115);
      const id = normalize(code.text).replace(/\s/g, "");
      output.push(
        `${id} ${name} ${percentage(scores[0])}% [OCR صفحة ${pageNumber}]`
      );
    }
  }
  return output.join("\n");
}

let running = false;
export async function ocrPdf(
  pdf: PDFDocumentProxy,
  onPage?: (
    lines: OcrLine[],
    width: number,
    height: number,
    index: number
  ) => void
) {
  if (running)
    throw new Error(
      "تجري حالياً قراءة تقرير مصوّر آخر. حاولي مجدداً بعد اكتماله."
    );
  if (pdf.numPages > 40)
    throw new Error("قسّمي التقرير المصوّر إلى ملفات لا تتجاوز 40 صفحة.");
  running = true;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      await (async () => {
        const page = await pdf.getPage(index);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 1800 / base.height });
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height)
        );
        const context = canvas.getContext("2d");
        await page.render({
          canvas: canvas as never,
          canvasContext: context as never,
          viewport,
        }).promise;
        // Blank printer pages are common. Sample pixels before running OCR.
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;
        let ink = 0;
        for (let i = 0; i < pixels.length; i += 256)
          if (pixels[i] < 235 || pixels[i + 1] < 235 || pixels[i + 2] < 235)
            ink++;
        if (ink > 20) {
          worker = await createWorker("ara+eng", 1, {
            langPath: path.resolve(".ocr-models"),
            gzip: false,
            cacheMethod: "none",
          });
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            tessedit_char_whitelist: "",
          });
          const response = await worker.recognize(
            canvas.toBuffer("image/png"),
            {},
            { text: true, blocks: true }
          );
          const lines: OcrLine[] =
            response.data.blocks?.flatMap(block =>
              block.paragraphs.flatMap(paragraph => paragraph.lines)
            ) || [];
          const overview =
            lines.some(line => /المجالات/.test(normalize(line.text))) &&
            lines.some(
              line =>
                normalize(line.text) === "التقدم" &&
                cx(line) > canvas.width * 0.7
            );
          if (overview) {
            // Read unclear Arabic chart labels again without the English model.
            const unclear = lines.filter(
              line =>
                cy(line) > canvas.height * 0.55 &&
                cy(line) < canvas.height * 0.8 &&
                /التعلم/.test(normalize(line.text)) &&
                !domainName(line.text)
            );
            if (unclear.length) {
              await worker.reinitialize("ara");
              await worker.setParameters({
                tessedit_pageseg_mode: PSM.SINGLE_LINE,
                tessedit_char_whitelist: "",
              });
              for (const line of unclear) {
                const rectangle = {
                  left: Math.max(0, line.bbox.x0 - 10),
                  top: Math.max(0, line.bbox.y0 - 15),
                  width: line.bbox.x1 - line.bbox.x0 + 20,
                  height: line.bbox.y1 - line.bbox.y0 + 30,
                };
                const label = await worker.recognize(
                  canvas.toBuffer("image/png"),
                  { rectangle },
                  { text: true }
                );
                if (
                  domainName(label.data.text) &&
                  label.data.confidence >= 80
                ) {
                  line.text = label.data.text;
                  line.confidence = label.data.confidence;
                }
              }
              await worker.reinitialize("ara+eng");
            }
          }
          // Retry uncertain or incomplete codes in their own cells; never infer
          // missing digits from neighbouring rows or an expected indicator count.
          const uncertainCodes = lines.filter(
            line =>
              /^\d{1,2}(?:-\d{1,2}){2,3}$/.test(
                normalize(line.text).replace(/\s/g, "")
              ) &&
              cx(line) > canvas.width * 0.8 &&
              (!/^\d{1,2}(?:-\d{1,2}){3}$/.test(
                normalize(line.text).replace(/\s/g, "")
              ) ||
                line.confidence < 80)
          );
          if (uncertainCodes.length) {
            await worker.reinitialize("eng");
            await worker.setParameters({
              tessedit_pageseg_mode: PSM.SINGLE_LINE,
              tessedit_char_whitelist: "0123456789-",
            });
            for (const line of uncertainCodes) {
              const rectangle = {
                left: line.bbox.x0 - 12,
                top: line.bbox.y0 - 10,
                width: line.bbox.x1 - line.bbox.x0 + 24,
                height: line.bbox.y1 - line.bbox.y0 + 20,
              };
              const retry = await worker.recognize(
                canvas.toBuffer("image/png"),
                { rectangle },
                { text: true }
              );
              const code = normalize(retry.data.text).replace(/\s/g, "");
              if (
                /^\d{1,2}(?:-\d{1,2}){3}$/.test(code) &&
                retry.data.confidence >= 80
              ) {
                line.text = code;
                line.confidence = retry.data.confidence;
              }
            }
          }
          const uncertainNames = lines.filter(
            line =>
              line.confidence < 70 &&
              line.bbox.x0 > canvas.width * 0.18 &&
              line.bbox.x1 < canvas.width * 0.83 &&
              /[\u0621-\u064A]/.test(line.text) &&
              lines.some(
                code =>
                  /^\d{1,2}(?:-\d{1,2}){3}$/.test(
                    normalize(code.text).replace(/\s/g, "")
                  ) &&
                  cx(code) > canvas.width * 0.8 &&
                  Math.abs(cy(code) - cy(line)) < canvas.height * 0.018
              )
          );
          if (uncertainNames.length) {
            await worker.reinitialize("ara");
            await worker.setParameters({
              tessedit_pageseg_mode: PSM.SINGLE_LINE,
              tessedit_char_whitelist: "",
            });
            for (const line of uncertainNames) {
              const rectangle = {
                left: line.bbox.x0 - 5,
                top: line.bbox.y0 - 8,
                width: line.bbox.x1 - line.bbox.x0 + 10,
                height: line.bbox.y1 - line.bbox.y0 + 16,
              };
              const retry = await worker.recognize(
                canvas.toBuffer("image/png"),
                { rectangle },
                { text: true }
              );
              if (
                retry.data.confidence >= 70 &&
                /[\u0621-\u064A]/.test(retry.data.text)
              ) {
                line.text = retry.data.text;
                line.confidence = retry.data.confidence;
              }
            }
          }
          if (uncertainCodes.length || uncertainNames.length)
            await worker.reinitialize("ara+eng");
          // Colored score badges can be missed by full-page segmentation. Read
          // only the score cell horizontally aligned with each detected code.
          const anchors = lines.filter(
            line =>
              /^\d{1,2}(?:-\d{1,2}){3}$/.test(
                normalize(line.text).replace(/\s/g, "")
              ) &&
              cx(line) > canvas.width * 0.8 &&
              line.confidence >= 80
          );
          const totalLabels = lines.filter(
            line =>
              normalize(line.text) === "التقدم" &&
              cx(line) > canvas.width * 0.7 &&
              line.confidence >= 80
          );
          const cells = [...anchors, ...totalLabels].filter(
            anchor =>
              !lines.some(
                line =>
                  percentage(line) !== undefined &&
                  cx(line) < canvas.width * 0.22 &&
                  Math.abs(cy(line) - cy(anchor)) < canvas.height * 0.022
              )
          );
          if (cells.length) await worker.reinitialize("eng");
          for (const anchor of cells) {
            const total = totalLabels.includes(anchor);
            const top = Math.max(
              0,
              Math.floor(cy(anchor) - canvas.height * (total ? 0.013 : 0.021))
            );
            const left = Math.floor(canvas.width * (total ? 0.072 : 0.07));
            const rectangle = {
              left,
              top,
              width: Math.floor(canvas.width * (total ? 0.065 : 0.1)),
              height: Math.floor(canvas.height * 0.023),
            };
            await worker.setParameters({
              tessedit_pageseg_mode: PSM.SINGLE_LINE,
              tessedit_char_whitelist: "0123456789.%",
            });
            const cell = await worker.recognize(
              canvas.toBuffer("image/png"),
              { rectangle },
              { text: true }
            );
            const candidate: OcrLine = {
              text: cell.data.text.trim(),
              confidence: cell.data.confidence,
              bbox: {
                x0: left,
                x1: left + rectangle.width,
                y0: top,
                y1: top + rectangle.height,
              },
            };
            if (percentage(candidate) !== undefined) lines.push(candidate);
          }
          if (cells.length) await worker.reinitialize("ara+eng");
          onPage?.(lines, canvas.width, canvas.height, index);
          pages.push(
            assembleOcrPage(lines, canvas.width, canvas.height, index)
          );
          await worker.terminate();
          worker = undefined;
        }
        canvas.width = 1;
        canvas.height = 1;
        page.cleanup();
        console.log(`[Local OCR] page ${index}/${pdf.numPages} processed`);
      })();
      await pdf.cleanup();
      clearAllCache();
      global.gc?.();
      console.log(
        `[Local OCR] memory ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MiB`
      );
    }
    const text = pages.filter(Boolean).join("\n");
    if (text.length < 20)
      throw new Error(
        "لم تتمكن القراءة الآلية من استخراج مؤشرات موثوقة من الصور. جرّبي نسخة أوضح أو نسخة PDF نصية."
      );
    return text;
  } finally {
    try {
      if (worker) await worker.terminate();
    } finally {
      running = false;
    }
  }
}
