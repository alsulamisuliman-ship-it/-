import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ocrPdfEngine, type OcrCanvas } from "@shared/pdfOcrEngine";
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
export async function readPdfLocally(
  file: File,
  onProgress: (page: number, total: number) => void,
  onPage?: Parameters<typeof ocrPdfEngine>[2]
) {
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 200)
      throw new Error("قسّمي التقرير إلى ملفات لا تتجاوز 200 صفحة.");
    const lines: string[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const rows: Array<{
        y: number;
        items: Array<{ x: number; text: string; rtl: boolean }>;
      }> = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = item.transform[5];
        let row = rows.find(row => Math.abs(row.y - y) < 2);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({
          x: item.transform[4],
          text: item.str,
          rtl: item.dir === "rtl",
        });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        const rtl = row.items.some(item => item.rtl);
        row.items.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
        lines.push(row.items.map(item => item.text).join(" "));
      }
      page.cleanup();
    }
    const text = lines.join("\n");
    if (text.trim().length >= 20) return text;
    return await ocrPdfEngine(
      pdf,
      {
        createCanvas: (width, height) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          return canvas as unknown as OcrCanvas;
        },
        encode: canvas =>
          new Promise((resolve, reject) =>
            (canvas as unknown as HTMLCanvasElement).toBlob(async blob => {
              if (!blob) return reject(new Error("تعذّر قراءة صورة الصفحة."));
              resolve(blob);
            }, "image/png")
          ),
        workerOptions: {
          workerPath: "/local-ocr/worker.min.js",
          corePath: "/local-ocr/core",
          langPath: "/local-ocr/models",
          gzip: false,
          cacheMethod: "none",
        },
        onProgress,
      },
      onPage
    );
  } finally {
    await task.destroy();
  }
}
