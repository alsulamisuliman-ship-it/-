import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => {
  const worker = { set: vi.fn(), from: vi.fn(), save: vi.fn() };
  worker.set.mockReturnValue(worker);
  worker.from.mockReturnValue(worker);
  worker.save.mockResolvedValue(undefined);
  const factory = Object.assign(vi.fn(), { Worker: vi.fn(() => worker) });
  return { worker, factory };
});

vi.mock("html2pdf.js", () => ({ default: pdfMocks.factory }));

import { DEFAULT_PDF_EXPORT_SECTIONS, downloadReportPdf, getPdfCanvasScale, sanitizePdfFilename } from "./pdfExport";

beforeEach(() => {
  vi.clearAllMocks();
  pdfMocks.worker.set.mockReturnValue(pdfMocks.worker);
  pdfMocks.worker.from.mockReturnValue(pdfMocks.worker);
  pdfMocks.worker.save.mockResolvedValue(undefined);
});

describe("direct PDF download", () => {
  it("creates an A4 portrait PDF with safe margins and downloads it directly", async () => {
    const element = {
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      scrollHeight: 8_000,
      offsetHeight: 8_000,
    } as unknown as HTMLElement;

    await downloadReportPdf(element, "مدرسة/الاختبار.PDF");

    expect(element.classList.add).toHaveBeenCalledWith("pdf-export-mode");
    expect(pdfMocks.worker.set).toHaveBeenCalledWith(expect.objectContaining({
      margin: [12, 12, 14, 12],
      filename: "مدرسة الاختبار.pdf",
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait", compress: true },
      pagebreak: expect.objectContaining({ mode: ["css", "legacy"] }),
    }));
    expect(pdfMocks.worker.from).toHaveBeenCalledWith(element);
    expect(pdfMocks.worker.save).toHaveBeenCalledWith("مدرسة الاختبار.pdf");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-export-mode");
    expect(element.classList.add).toHaveBeenCalledWith("pdf-break-before-indicators");
    expect(element.classList.add).toHaveBeenCalledWith("pdf-break-before-plans");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-break-before-indicators");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-break-before-plans");
  });

  it("includes the indicators page in the full-report preset", () => {
    expect(DEFAULT_PDF_EXPORT_SECTIONS).toEqual({ summary: true, domains: true, priority: true, indicators: true, plans: true });
  });

  it("hides only unselected sections and restores temporary exclusions", async () => {
    const element = {
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      scrollHeight: 4_000,
      offsetHeight: 4_000,
    } as unknown as HTMLElement;

    await downloadReportPdf(element, "summary", {
      summary: true,
      domains: false,
      priority: false,
      indicators: false,
      plans: false,
    });

    expect(element.classList.add).toHaveBeenCalledWith("pdf-hide-domains");
    expect(element.classList.add).toHaveBeenCalledWith("pdf-hide-priority");
    expect(element.classList.add).toHaveBeenCalledWith("pdf-hide-indicators");
    expect(element.classList.add).toHaveBeenCalledWith("pdf-hide-plans");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-hide-domains");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-hide-priority");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-hide-indicators");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-hide-plans");
    expect(element.classList.add).not.toHaveBeenCalledWith("pdf-break-before-indicators");
    expect(element.classList.add).not.toHaveBeenCalledWith("pdf-break-before-plans");
  });

  it("does not insert a blank page before a standalone indicators export", async () => {
    const element = {
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      scrollHeight: 2_000,
      offsetHeight: 2_000,
    } as unknown as HTMLElement;

    await downloadReportPdf(element, "indicators", {
      summary: false,
      domains: false,
      priority: false,
      indicators: true,
      plans: false,
    });

    expect(element.classList.add).not.toHaveBeenCalledWith("pdf-break-before-indicators");
    expect(element.classList.add).not.toHaveBeenCalledWith("pdf-break-before-plans");
  });

  it("starts a selected plan page after the summary but not before a plan-only export", async () => {
    const element = {
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      scrollHeight: 2_000,
      offsetHeight: 2_000,
    } as unknown as HTMLElement;

    await downloadReportPdf(element, "summary-and-plans", {
      summary: true,
      domains: false,
      priority: false,
      indicators: false,
      plans: true,
    });

    expect(element.classList.add).not.toHaveBeenCalledWith("pdf-break-before-indicators");
    expect(element.classList.add).toHaveBeenCalledWith("pdf-break-before-plans");
  });

  it("does not add a leading page break for a plan-only export", async () => {
    const element = {
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      scrollHeight: 2_000,
      offsetHeight: 2_000,
    } as unknown as HTMLElement;

    await downloadReportPdf(element, "plans", {
      summary: false,
      domains: false,
      priority: false,
      indicators: false,
      plans: true,
    });

    expect(element.classList.add).not.toHaveBeenCalledWith("pdf-break-before-indicators");
    expect(element.classList.add).not.toHaveBeenCalledWith("pdf-break-before-plans");
  });

  it("sanitizes empty and unsafe filenames", () => {
    expect(sanitizePdfFilename("../school:name?.pdf")).toBe("school name.pdf");
    expect(sanitizePdfFilename(" / ")).toBe("mizan-report.pdf");
  });

  it("reduces capture scale for long reports to avoid oversized canvases", () => {
    expect(getPdfCanvasScale(10_000)).toBe(2);
    expect(getPdfCanvasScale(40_000)).toBe(0.75);
    expect(getPdfCanvasScale(0)).toBe(2);
  });

  it("removes PDF-only styles even if the renderer fails", async () => {
    const element = {
      classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
      scrollHeight: 2_000,
      offsetHeight: 2_000,
    } as unknown as HTMLElement;
    pdfMocks.worker.save.mockRejectedValueOnce(new Error("render failed"));

    await expect(downloadReportPdf(element, "report")).rejects.toThrow("render failed");
    expect(element.classList.remove).toHaveBeenCalledWith("pdf-export-mode");
  });
});
