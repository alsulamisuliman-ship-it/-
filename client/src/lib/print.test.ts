import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildPrintDocument, printReport } from "./print";

afterEach(() => vi.unstubAllGlobals());

function createReportElement() {
  const clone = {
    classList: { add: vi.fn() },
    querySelectorAll: vi.fn(() => []),
    outerHTML: '<section id="report-print-root"><div class="no-print">تحكم</div><article class="print-plan">خطة</article></section>',
  };
  const element = { cloneNode: vi.fn(() => clone) } as unknown as HTMLElement;
  return { element, clone };
}

describe("standalone A4 printing", () => {
  it("builds an isolated Arabic print document, preserves print cards, and removes controls", () => {
    const { element, clone } = createReportElement();

    const markup = buildPrintDocument(element, 'مدرسة <الاختبار>', "<style>.source { color: black; }</style>");

    expect(clone.classList.add).toHaveBeenCalledWith("pdf-export-mode", "pdf-break-before-indicators", "pdf-break-before-plans", "native-print-document");
    expect(clone.querySelectorAll).toHaveBeenCalledWith(".no-print, .print-hidden");
    expect(markup).toContain('<html class="pdf-export-mode" lang="ar" dir="rtl">');
    expect(markup).toContain("مدرسة &lt;الاختبار&gt;");
    expect(markup).toContain("@page { size: A4 portrait; margin: 12mm 12mm 14mm; }");
    expect(markup).toContain(".print-plan + .print-plan");
  });

  it("opens a dedicated print window and waits for its printable content", () => {
    const { element } = createReportElement();
    const popup = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn(), readyState: "complete" },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
    };
    const open = vi.fn(() => popup);
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });
    vi.stubGlobal("window", { open, setTimeout: (callback: () => void) => { callback(); return 1; } });

    expect(printReport(element, "تقرير الاختبار")).toBe("opened");
    expect(open).toHaveBeenCalledWith("", "_blank", "popup=yes,width=960,height=740");
    expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining("تقرير الاختبار"));
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(popup.print).toHaveBeenCalledOnce();
  });

  it("returns unavailable when a browser blocks the print window", () => {
    const { element } = createReportElement();
    vi.stubGlobal("window", { open: vi.fn(() => null) });

    expect(printReport(element, "تقرير")).toBe("unavailable");
  });

  it("returns unavailable and closes an unfinished popup if writing fails", () => {
    const { element } = createReportElement();
    const popup = {
      document: { open: vi.fn(), write: vi.fn(() => { throw new Error("blocked"); }), close: vi.fn(), readyState: "complete" },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("document", { querySelectorAll: vi.fn(() => []) });
    vi.stubGlobal("window", { open: vi.fn(() => popup), setTimeout: vi.fn() });

    expect(printReport(element, "تقرير")).toBe("unavailable");
    expect(popup.close).toHaveBeenCalledOnce();
  });
});

describe("A4 report print styles", () => {
  it("defines A4 paper, page margins, and non-splitting report cards", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toMatch(/@page\s*\{[^}]*size:\s*A4 portrait;/s);
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/\.print-plan[\s\S]*?break-inside:\s*avoid-page/);
    expect(css).toMatch(/\.no-print[\s\S]*?display:\s*none/);
  });

  it("uses page breaks and separated readable fields instead of a continuous cramped text block", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.print-plan \+ \.print-plan \{ break-before:\s*page; page-break-before:\s*always;/);
    expect(css).toMatch(/\.print-plan-field \{ padding:\s*3mm; border:\s*\.6pt solid #dce8ed;/);
    expect(css).toMatch(/\.print-plan-field p, \.print-plan-field li \{ margin:\s*0; font-size:\s*10\.5pt; line-height:\s*1\.85/);
    expect(css).toMatch(/screen-score-progress\s*\{\s*display:\s*none !important;/);
    expect(css).toMatch(/print-score-strip\s*\{\s*display:\s*grid !important;/);
  });

  it("keeps the workspace identity in native print with a navy header and teal score panel", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.report-banner\s*\{[\s\S]*?background:\s*#0b2644 !important;/);
    expect(css).toContain(".report-banner .print-total-score p:last-child { color: #66e3d7 !important; }");
    expect(css).toContain(".plan-form-step");
    expect(css).toContain(".workspace-domain-panel");
  });
});
