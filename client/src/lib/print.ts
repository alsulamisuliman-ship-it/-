export type PrintReportResult = "opened" | "unavailable";

type PrintPopup = Pick<Window, "document" | "focus" | "print" | "close" | "addEventListener">;

const PRINT_READY_DELAY_MS = 420;

const PRINT_FALLBACK_STYLES = `
  @page { size: A4 portrait; margin: 12mm 12mm 14mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #172b35; direction: rtl; font-family: "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  *, *::before, *::after { box-sizing: border-box; }
  #report-print-root { width: 186mm; max-width: 186mm; margin: 0 auto; padding: 0; }
  #report-print-root .no-print, #report-print-root .print-hidden { display: none !important; }
  #report-print-root .print-only { display: block !important; }
  #report-print-root .report-banner { padding: 6mm; border: 1px solid #123b60; border-radius: 5mm; background: #0b2644; color: #fff; }
  #report-print-root .report-banner * { color: #fff !important; }
  #report-print-root .report-banner .print-total-score { border: 1px solid #2a8193; background: #0d4b69; }
  #report-print-root .report-banner .print-total-score p:last-child { color: #66e3d7 !important; }
  #report-print-root .report-school-info, #report-print-root .report-score-summary { margin-top: 4mm; padding: 4mm; border: 1px solid #d9e4e7; border-radius: 4mm; background: #fff; }
  #report-print-root .screen-score-progress { display: none !important; }
  #report-print-root .print-score-strip { display: grid !important; gap: 2mm; margin-top: 3mm; padding: 3mm; border-radius: 2mm; background: #f2f6ff; }
  #report-print-root .print-score-track { height: 3mm; overflow: hidden; border-radius: 99px; background: #dfe9f4; }
  #report-print-root .print-score-track span { display: block; height: 100%; border-radius: inherit; background: #2673d8; }
  #report-print-root .print-summary-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4mm; margin-top: 4mm; }
  #report-print-root .print-summary-grid > article { padding: 4mm; border: 1px solid #d9e4e7; border-radius: 4mm; }
  #report-print-root .print-indicators-page, #report-print-root .print-plan-list { display: block !important; margin: 0; }
  #report-print-root .print-indicators-page { break-before: page; page-break-before: always; }
  #report-print-root .print-plan-list { break-before: page; page-break-before: always; }
  #report-print-root .print-section-header, #report-print-root .print-plan-list-header { margin-bottom: 5mm; padding-bottom: 3mm; border-bottom: 1.5pt solid #2e87b7; }
  #report-print-root .print-section-header h2, #report-print-root .print-plan-list-header h2 { margin: 0; color: #173b56; font-size: 18pt; line-height: 1.4; }
  #report-print-root .print-section-header p, #report-print-root .print-plan-list-header p { color: #506671; font-size: 10pt; line-height: 1.6; }
  #report-print-root .print-indicator-row { padding: 3mm 0; border-bottom: .6pt solid #e3e8e9; break-inside: avoid-page; page-break-inside: avoid; }
  #report-print-root .print-plan { margin: 0 0 5mm; padding: 5mm; border: 1px solid #cfdde5; border-radius: 4mm; background: #f8fcfe; break-inside: avoid-page; page-break-inside: avoid; }
  #report-print-root .print-plan + .print-plan { break-before: page; page-break-before: always; }
  #report-print-root .print-plan-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4mm; margin-bottom: 3mm; padding-bottom: 3mm; border-bottom: 1px solid #d5e3eb; }
  #report-print-root .print-plan-title { margin: 0; color: #172b35; font-size: 15pt; line-height: 1.5; }
  #report-print-root .print-plan-kicker { margin: 0 0 1mm; color: #225c85; font-size: 10pt; font-weight: 700; }
  #report-print-root .print-plan-domain { margin: 1mm 0 0; color: #5b6b73; font-size: 10pt; }
  #report-print-root .print-plan-score { display: grid; grid-template-columns: repeat(3, minmax(19mm, 1fr)); gap: 2mm; }
  #report-print-root .print-plan-score > div { min-width: 19mm; padding: 2mm; border: 1px solid #d3e6f1; border-radius: 2mm; background: #eaf4fa; text-align: center; }
  #report-print-root .print-plan-score span { display: block; color: #516874; font-size: 8.5pt; }
  #report-print-root .print-plan-score strong { display: block; color: #1b70aa; font-size: 12pt; }
  #report-print-root .print-plan-evidence { margin: 3mm 0; padding: 3mm; border-inline-start: 2px solid #318bc0; border-radius: 1.5mm; background: #edf7fb; color: #162b34; font-size: 10.5pt; line-height: 1.8; }
  #report-print-root .print-plan-fields { display: grid; gap: 3mm; }
  #report-print-root .print-plan-field { padding: 3mm; border: .6pt solid #dce8ed; border-radius: 2.5mm; background: #fff; break-inside: avoid-page; page-break-inside: avoid; }
  #report-print-root .print-plan-field h4 { margin: 0 0 2mm; padding-bottom: 1.5mm; border-bottom: .6pt solid #e2edf1; color: #185779; font-size: 11pt; font-weight: 700; }
  #report-print-root .print-plan-field p, #report-print-root .print-plan-field li { margin: 0; color: #172b35; font-size: 10.5pt; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
  #report-print-root .print-plan-field ol { margin: 0; padding-inline-start: 5mm; }
  #report-print-root .print-plan-meta { display: flex; flex-wrap: wrap; gap: 2mm 5mm; margin-top: 3mm; padding-top: 3mm; border-top: 1px solid #d5e3eb; color: #39535f; font-size: 10pt; }
  @media print { #report-print-root { width: 100%; max-width: none; } }
`;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function collectStyles() {
  if (typeof document === "undefined") return "";
  return Array.from(document.querySelectorAll("style, link[rel='stylesheet']"))
    .map(node => {
      if (node instanceof HTMLLinkElement) return `<link rel="stylesheet" href="${escapeHtml(node.href)}">`;
      return node.outerHTML;
    })
    .join("\n");
}

function createPrintableClone(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.classList.add("pdf-export-mode", "pdf-break-before-indicators", "pdf-break-before-plans", "native-print-document");
  clone.querySelectorAll(".no-print, .print-hidden").forEach(node => node.remove());
  return clone;
}

export function buildPrintDocument(element: HTMLElement, title: string, stylesheetMarkup = collectStyles()) {
  const report = createPrintableClone(element);
  return `<!doctype html>
<html class="pdf-export-mode" lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${stylesheetMarkup}
  <style>${PRINT_FALLBACK_STYLES}</style>
</head>
<body class="pdf-export-mode">
  ${report.outerHTML}
</body>
</html>`;
}

function schedulePrint(popup: PrintPopup) {
  let queued = false;
  const invoke = () => {
    if (queued) return;
    queued = true;
    window.setTimeout(() => {
      try {
        popup.focus();
        popup.print();
      } catch {
        // The preview stays open, so iOS users can still use Share > Print or Save as PDF.
      }
    }, PRINT_READY_DELAY_MS);
  };
  const waitForFonts = () => {
    const fontReady = popup.document.fonts?.ready;
    if (fontReady) {
      void fontReady.then(invoke, invoke);
      return;
    }
    invoke();
  };

  popup.addEventListener("load", waitForFonts, { once: true });
  if (popup.document.readyState === "complete") waitForFonts();
}

export function printReport(element: HTMLElement | null, title: string): PrintReportResult {
  if (typeof window === "undefined" || !element || typeof window.open !== "function") return "unavailable";

  const popup = window.open("", "_blank", "popup=yes,width=960,height=740") as PrintPopup | null;
  if (!popup) return "unavailable";

  try {
    popup.document.open();
    popup.document.write(buildPrintDocument(element, title));
    popup.document.close();
    schedulePrint(popup);
    return "opened";
  } catch {
    try {
      popup.close();
    } catch {
      // No further action is needed when a browser blocks closing an unfinished print window.
    }
    return "unavailable";
  }
}
