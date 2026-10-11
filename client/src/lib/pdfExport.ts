const MAX_CANVAS_EDGE = 30_000;
const MAX_CANVAS_SCALE = 2;

export type PdfExportSections = {
  summary: boolean;
  domains: boolean;
  priority: boolean;
  indicators: boolean;
  plans: boolean;
};

export const DEFAULT_PDF_EXPORT_SECTIONS: PdfExportSections = {
  summary: true,
  domains: true,
  priority: true,
  indicators: true,
  plans: true,
};

export function sanitizePdfFilename(title: string) {
  const safeBase = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.pdf$/i, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 100);
  return `${safeBase || "mizan-report"}.pdf`;
}

export function getPdfCanvasScale(contentHeight: number) {
  return Math.min(MAX_CANVAS_SCALE, MAX_CANVAS_EDGE / Math.max(1, contentHeight));
}

function nextPaint() {
  return new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    else setTimeout(resolve, 0);
  });
}

export async function downloadReportPdf(
  element: HTMLElement,
  title: string,
  sections: PdfExportSections = DEFAULT_PDF_EXPORT_SECTIONS,
) {
  const filename = sanitizePdfFilename(title);
  const documentTargets = typeof document === "undefined" ? [] : [document.documentElement, document.body];
  const hiddenClasses = Object.entries(sections)
    .filter(([, include]) => !include)
    .map(([section]) => `pdf-hide-${section}`);
  const addedHiddenClasses = hiddenClasses.filter(className => !element.classList.contains(className));
  const pageBreakClasses = [
    ...(sections.indicators && (sections.summary || sections.domains || sections.priority) ? ["pdf-break-before-indicators"] : []),
    ...(sections.plans && (sections.summary || sections.domains || sections.priority || sections.indicators) ? ["pdf-break-before-plans"] : []),
  ];
  const addedPageBreakClasses = pageBreakClasses.filter(className => !element.classList.contains(className));
  element.classList.add("pdf-export-mode");
  addedHiddenClasses.forEach(className => element.classList.add(className));
  addedPageBreakClasses.forEach(className => element.classList.add(className));
  documentTargets.forEach(target => target.classList.add("pdf-export-mode"));

  try {
    await nextPaint();
    if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
    await nextPaint();

    const contentHeight = Math.max(element.scrollHeight, element.offsetHeight, 1);
    const scale = getPdfCanvasScale(contentHeight);
    const { default: html2pdf } = await import("html2pdf.js");
    const worker = new html2pdf.Worker();
    const options = {
      margin: [12, 12, 14, 12],
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        windowWidth: 794,
        windowHeight: Math.max(1_100, contentHeight),
        scrollX: 0,
        scrollY: 0,
        logging: false,
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait", compress: true },
      pagebreak: {
        mode: ["css", "legacy"],
        avoid: [".report-banner", ".report-school-info", ".report-score-summary", ".print-plan"],
      },
    } as Parameters<typeof worker.set>[0];

    await worker.set(options).from(element).save(filename);
  } finally {
    element.classList.remove("pdf-export-mode");
    addedHiddenClasses.forEach(className => element.classList.remove(className));
    addedPageBreakClasses.forEach(className => element.classList.remove(className));
    documentTargets.forEach(target => target.classList.remove("pdf-export-mode"));
  }
}
