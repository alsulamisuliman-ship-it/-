import path from "node:path";
import { createCanvas, clearAllCache, type Canvas } from "@napi-rs/canvas";
import { ocrPdfEngine, type OcrCanvas } from "../shared/pdfOcrEngine";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
export { assembleOcrPage, type OcrLine } from "../shared/pdfOcrEngine";
export function ocrPdf(
  pdf: PDFDocumentProxy,
  onPage?: Parameters<typeof ocrPdfEngine>[2]
) {
  return ocrPdfEngine(
    pdf,
    {
      createCanvas: (width, height) => createCanvas(width, height) as OcrCanvas,
      encode: async canvas => (canvas as Canvas).toBuffer("image/png"),
      workerOptions: {
        langPath: path.resolve(".ocr-models"),
        gzip: false,
        cacheMethod: "none",
      },
      cleanup: () => {
        clearAllCache();
        global.gc?.();
      },
    },
    onPage
  );
}
