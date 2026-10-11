import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { ArchiveRestore, ArrowRight, BookOpen, CheckCircle2, ChevronDown, CircleAlert, ClipboardList, Download, FileText, FileUp, LayoutList, Loader2, Printer, RefreshCw, Save, ShieldCheck, Sparkles, Target, UserRound } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_PDF_EXPORT_SECTIONS, downloadReportPdf, type PdfExportSections } from "@/lib/pdfExport";
import { buildIndicatorRankings } from "@/lib/indicatorReport";
import { printReport } from "@/lib/print";
import { trpc } from "@/lib/trpc";

type ReportData = NonNullable<inferRouterOutputs<AppRouter>["reports"]["get"]>;
type ImprovementPlan = ReportData["improvementPlans"][number];
type WorkspaceTab = "school" | "summary" | "plan" | "guide";
type PlanForm = {
  targetScore: number;
  needDescription: string;
  improvementActions: string;
  implementationMechanism: string;
  startDate: string;
  endDate: string;
  responsibleName: string;
  status: "planned" | "in_progress" | "completed";
};

const PDF_SECTION_CHOICES: Array<{ key: keyof PdfExportSections; title: string; description: string }> = [
  { key: "summary", title: "ملخص التقرير", description: "المدرسة والنتيجة الكلية والشاهد المرتبط بها." },
  { key: "domains", title: "أداء المجالات", description: "الرسم البياني ودرجات المجالات ومستويات الأداء." },
  { key: "priority", title: "منهجية ترتيب الأولويات", description: "شرح ترتيب المؤشرات وأهداف التحسين المقترحة." },
  { key: "indicators", title: "مؤشرات التقرير", description: "أعلى خمسة مؤشرات وأدنى المؤشرات دون مستوى التميز." },
  { key: "plans", title: "خطط التحسين التفصيلية", description: "الإجراءات والآليات والمدة والمسؤول لكل مؤشر." },
];

const priorityMap = {
  low: ["منخفضة", "bg-[#e3f5ea] text-[#147554]"],
  medium: ["متوسطة", "bg-[#f8edce] text-[#946719]"],
  high: ["عالية", "bg-[#fde7d7] text-[#ad553c]"],
  critical: ["عاجلة", "bg-[#f8d9d4] text-[#a33d31]"],
} as const;
const statusLabels = { planned: "مخطط", in_progress: "قيد التنفيذ", completed: "مكتمل" } as const;
const priorityOrder: Record<ImprovementPlan["priority"], number> = { critical: 0, high: 1, medium: 2, low: 3 };
const priorityLabelFor = (priority: ImprovementPlan["priority"]) => ({ critical: "عاجلة", high: "عالية", medium: "متوسطة", low: "منخفضة" })[priority];
const priorityStyleFor = (priority: ImprovementPlan["priority"]) => ({ critical: "bg-[#fde7d7] text-[#ad553c]", high: "bg-[#fff1d7] text-[#956514]", medium: "bg-[#eaf1ff] text-[#245fc0]", low: "bg-[#e5f5ee] text-[#147554]" })[priority];

function formatScore(value: number) {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

function domainColor(score: number) {
  return score >= 90 ? "#159469" : score >= 75 ? "#2673d8" : score >= 50 ? "#d68a13" : "#c7513d";
}

function scoreBand(score: number) {
  if (score >= 90) return "التميز";
  if (score >= 75) return "التقدم";
  if (score >= 50) return "الانطلاق";
  return "التهيئة";
}

function formatPlanDate(value: string | null) {
  if (!value) return "لم يحدد";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("ar-SA");
}

function PrintField({ label, value, asList = false }: { label: string; value: string; asList?: boolean }) {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return (
    <div className="print-plan-field">
      <h4>{label}</h4>
      {asList && lines.length > 1 ? <ol>{lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol> : <p>{value || "لم يحدد"}</p>}
    </div>
  );
}

function PrintablePlanCard({ plan, index }: { plan: ImprovementPlan; index: number }) {
  const [priorityLabel] = priorityMap[plan.priority];
  const gap = Math.max(0, plan.targetScore - plan.score);

  return (
    <article className="print-plan" dir="rtl">
      <header className="print-plan-header">
        <div>
          <p className="print-plan-kicker">المؤشر {index + 1} · {plan.criterionCode} · أولوية {priorityLabel} · {plan.classification === "strength" ? "عنصر قوة" : "فرصة تحسين"}</p>
          <h3 className="print-plan-title">{plan.criterionName}</h3>
          <p className="print-plan-domain">{plan.domainName}</p>
        </div>
        <div className="print-plan-score">
          <div><span>الدرجة الحالية</span><strong>{plan.score.toFixed(1)}%</strong></div>
          <div><span>الدرجة المستهدفة</span><strong>{plan.targetScore.toFixed(1)}%</strong></div>
          <div><span>الفجوة</span><strong>{gap.toFixed(1)}%</strong></div>
        </div>
      </header>
      <p className="print-plan-evidence"><strong>الدليل المستخرج: </strong>{plan.evidence || "لا يوجد دليل مرفق"}</p>
      <div className="print-plan-fields">
        <PrintField label="وصف الاحتياج" value={plan.needDescription} />
        <PrintField label="إجراءات التحسين" value={plan.improvementActions} asList />
        <PrintField label="آليات التنفيذ" value={plan.implementationMechanism} />
      </div>
      <footer className="print-plan-meta">
        <span><strong>المدة: </strong>{formatPlanDate(plan.startDate)} – {formatPlanDate(plan.endDate)}</span>
        <span><strong>مسؤول التنفيذ: </strong>{plan.responsibleName || "لم يحدد"}</span>
        <span><strong>الحالة: </strong>{statusLabels[plan.status]}</span>
      </footer>
    </article>
  );
}

function indicatorLevel(score: number) {
  if (score >= 90) return "التميز";
  if (score >= 75) return "التقدم";
  if (score >= 50) return "الانطلاق";
  return "التهيئة";
}

function formatIndicatorScore(score: number) {
  return `${score.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function PrintableIndicatorRow({ indicator }: { indicator: ReportData["criteria"][number] }) {
  const score = Number(indicator.score);
  const color = domainColor(score);
  return (
    <article className="print-indicator-row" dir="rtl">
      <div className="print-indicator-main">
        <strong className="print-indicator-code">{indicator.criterionCode}</strong>
        <p className="print-indicator-name">{indicator.criterionName}</p>
        <strong className="print-indicator-score" style={{ color }}>{formatIndicatorScore(score)}</strong>
      </div>
      <div className="print-indicator-track" role="img" aria-label={`درجة المؤشر ${formatIndicatorScore(score)}`}>
        <span style={{ width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: color }} />
      </div>
      <div className="print-indicator-meta"><span>{indicator.domainName}</span><span style={{ color }}>{indicatorLevel(score)}</span></div>
    </article>
  );
}

function PlanStepTitle({ number, title, hint }: { number: number; title: string; hint: string }) {
  return (
    <div className="plan-step-title">
      <span>{number}</span>
      <div><h3>{title}</h3><p>{hint}</p></div>
    </div>
  );
}

function ImprovementPlanCard({ plan, reportId, index }: { plan: ImprovementPlan; reportId: string; index: number }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<PlanForm>(() => ({
    targetScore: plan.targetScore,
    needDescription: plan.needDescription,
    improvementActions: plan.improvementActions,
    implementationMechanism: plan.implementationMechanism,
    startDate: plan.startDate ?? "",
    endDate: plan.endDate ?? "",
    responsibleName: plan.responsibleName ?? "",
    status: plan.status,
  }));
  useEffect(() => {
    setForm({
      targetScore: plan.targetScore,
      needDescription: plan.needDescription,
      improvementActions: plan.improvementActions,
      implementationMechanism: plan.implementationMechanism,
      startDate: plan.startDate ?? "",
      endDate: plan.endDate ?? "",
      responsibleName: plan.responsibleName ?? "",
      status: plan.status,
    });
  }, [plan.id, plan.updatedAt]);

  const save = trpc.reports.updatePlan.useMutation({
    onSuccess: async () => {
      await utils.reports.get.invalidate({ id: reportId });
      toast.success("تم حفظ خطة التحسين.");
    },
    onError: error => toast.error(error.message || "تعذّر حفظ الخطة."),
  });
  const [priorityLabel, priorityStyle] = priorityMap[plan.priority];
  const gap = Math.max(0, form.targetScore - plan.score);
  const setField = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => setForm(previous => ({ ...previous, [key]: value }));

  return (
    <article className="no-print plan-form-card">
      <header className="plan-form-card-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="plan-criterion-index">{index + 1}</span>
            <span className="rounded-md bg-[#eef7f8] px-2 py-1 font-mono text-[11px] text-[#0d6470]">{plan.criterionCode}</span>
            <Badge className={`border-0 ${priorityStyle}`}>أولوية {priorityLabel}</Badge>
            <Badge className={plan.classification === "strength" ? "border-0 bg-[#e3f5ea] text-[#147554]" : "border-0 bg-[#fff0d9] text-[#ad553c]"}>{plan.classification === "strength" ? "استدامة التميز" : "فرصة تحسين"}</Badge>
          </div>
          <h2>{plan.criterionName}</h2>
          <p>{plan.domainName}</p>
        </div>
        <div className="plan-gap-chip"><span>الفجوة إلى الهدف</span><strong>{gap.toFixed(1)}%</strong></div>
      </header>

      <div className="space-y-0">
        <section className="plan-form-step plan-score-step">
          <PlanStepTitle number={1} title="الدرجة الحالية والمستهدفة" hint="الدرجة الحالية موثقة، والهدف مقترح وقابل للتعديل." />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2"><Label htmlFor={`current-${plan.id}`}>نسبة المؤشر (%)</Label><Input id={`current-${plan.id}`} value={plan.score.toFixed(1)} readOnly className="h-11 rounded-xl bg-[#f5faf9] text-center font-bold text-[#174e44]" dir="ltr" /></div>
            <div className="space-y-2"><Label>المستوى الحالي</Label><div className="plan-static-field">{scoreBand(plan.score)}</div></div>
            <div className="space-y-2"><Label htmlFor={`target-${plan.id}`}>الدرجة المستهدفة (%)</Label><Input id={`target-${plan.id}`} type="number" min="0" max="100" step="0.1" value={form.targetScore} onChange={event => setField("targetScore", Number(event.target.value))} className="h-11 rounded-xl bg-white text-center font-bold" dir="ltr" /></div>
            <div className="space-y-2"><Label>الأولوية</Label><div className="plan-static-field">{priorityLabel}</div></div>
          </div>
        </section>

        <section className="plan-form-step">
          <PlanStepTitle number={2} title="وصف الاحتياج" hint="المشكلة أو الفجوة المستنتجة من نتيجة المؤشر." />
          <Textarea id={`need-${plan.id}`} value={form.needDescription} onChange={event => setField("needDescription", event.target.value)} className="min-h-[104px] rounded-xl bg-white leading-7" />
          <div className="plan-evidence-note"><ShieldCheck className="h-4 w-4" /><span><b>الشاهد الموثق:</b> {plan.evidence}</span></div>
        </section>

        <section className="plan-form-step">
          <PlanStepTitle number={3} title="إجراءات التحسين" hint="الخطوات المباشرة القابلة للتنفيذ لمعالجة الاحتياج." />
          <Textarea id={`actions-${plan.id}`} value={form.improvementActions} onChange={event => setField("improvementActions", event.target.value)} className="min-h-[128px] rounded-xl bg-white leading-7" />
        </section>

        <section className="plan-form-step">
          <PlanStepTitle number={4} title="آليات تنفيذ إجراءات التحسين" hint="آلية العمل والأدوات والمتابعة اللازمة لتنفيذ الإجراءات." />
          <Textarea id={`mechanism-${plan.id}`} value={form.implementationMechanism} onChange={event => setField("implementationMechanism", event.target.value)} className="min-h-[112px] rounded-xl bg-white leading-7" />
        </section>

        <section className="plan-form-step plan-responsibility-step">
          <PlanStepTitle number={5} title="المدة والمسؤولية" hint="حددي الإطار الزمني ومسؤول التنفيذ وحالة الإنجاز." />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2"><Label htmlFor={`start-${plan.id}`}>من</Label><Input id={`start-${plan.id}`} type="date" value={form.startDate} onChange={event => setField("startDate", event.target.value)} className="h-11 rounded-xl bg-white" /></div>
            <div className="space-y-2"><Label htmlFor={`end-${plan.id}`}>إلى</Label><Input id={`end-${plan.id}`} type="date" value={form.endDate} min={form.startDate || undefined} onChange={event => setField("endDate", event.target.value)} className="h-11 rounded-xl bg-white" /></div>
            <div className="space-y-2"><Label htmlFor={`responsible-${plan.id}`}>مسؤول التنفيذ</Label><div className="relative"><UserRound className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[#6d9086]" /><Input id={`responsible-${plan.id}`} value={form.responsibleName} onChange={event => setField("responsibleName", event.target.value)} placeholder="مثال: قائدة المدرسة" className="h-11 rounded-xl bg-white pr-9" /></div></div>
            <div className="space-y-2"><Label htmlFor={`status-${plan.id}`}>حالة التنفيذ</Label><Select value={form.status} onValueChange={value => setField("status", value as PlanForm["status"])}><SelectTrigger id={`status-${plan.id}`} className="h-11 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="planned">مخطط</SelectItem><SelectItem value="in_progress">قيد التنفيذ</SelectItem><SelectItem value="completed">مكتمل</SelectItem></SelectContent></Select></div>
          </div>
        </section>

        <footer className="plan-form-savebar">
          <p><Sparkles className="h-4 w-4" />راجعي المسودة ثم احفظيها قبل إنشاء نسخة PDF.</p>
          <Button onClick={() => save.mutate({
            id: plan.id,
            targetScore: form.targetScore,
            needDescription: form.needDescription,
            improvementActions: form.improvementActions,
            implementationMechanism: form.implementationMechanism,
            startDate: form.startDate || null,
            endDate: form.endDate || null,
            responsibleName: form.responsibleName.trim() || null,
            status: form.status,
          })} disabled={save.isPending} className="h-11 shrink-0 rounded-xl bg-[#0b7580] px-5 text-white hover:bg-[#095f68]">
            {save.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}
            {save.isPending ? "جارٍ الحفظ" : "حفظ خطة التحسين"}
          </Button>
        </footer>
      </div>
    </article>
  );
}

export default function ReportDetail() {
  const [, params] = useRoute("/reports/:id");
  const guestSession = trpc.guest.ensureSession.useQuery(undefined, { retry: 2 });
  const utils = trpc.useUtils();
  const scoreAudit = trpc.reports.reauditScores.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.reports.get.invalidate({ id: params?.id || "" }),
        utils.reports.list.invalidate(),
        utils.analytics.overview.invalidate(),
      ]);
      toast.success(`تم تدقيق الدرجة: ${formatScore(result.overallScore)}${result.overallScoreEvidence ? " كما وردت في التقرير" : " كمتوسط محسوب"}.`);
    },
    onError: error => toast.error(error.message || "تعذّرت إعادة قراءة الدرجات من التقرير."),
  });
  const [domain, setDomain] = useState("all");
  const [classification, setClassification] = useState("all");
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfOptionsOpen, setPdfOptionsOpen] = useState(false);
  const [pdfSections, setPdfSections] = useState<PdfExportSections>(() => ({ ...DEFAULT_PDF_EXPORT_SECTIONS }));
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>("plan");
  const report = trpc.reports.get.useQuery({ id: params?.id || "" }, { enabled: !!params?.id && guestSession.data?.ready === true, retry: false });
  const domains = useMemo(() => Array.from(new Set(report.data?.criteria.map(item => item.domainName) || [])), [report.data?.criteria]);
  const criteria = report.data?.criteria || [];
  const indicatorRankings = useMemo(() => buildIndicatorRankings(criteria), [criteria]);
  const allPlans = report.data?.improvementPlans || [];
  const plans = useMemo(() => allPlans
    .filter(item => (domain === "all" || item.domainName === domain) && (classification === "all" || item.classification === classification)), [allPlans, domain, classification]);
  const planOrder = useMemo(() => new Map(allPlans.map((plan, index) => [plan.id, index + 1])), [allPlans]);
  const planGroups = useMemo(() => {
    const grouped = new Map<string, ImprovementPlan[]>();
    plans.forEach(plan => grouped.set(plan.domainName, [...(grouped.get(plan.domainName) || []), plan]));
    return Array.from(grouped.entries()).map(([name, items]) => {
      const lead = items.reduce((current, item) => priorityOrder[item.priority] < priorityOrder[current.priority] || (priorityOrder[item.priority] === priorityOrder[current.priority] && item.score < current.score) ? item : current, items[0]);
      return { name, items, priority: lead.priority, score: items.reduce((sum, item) => sum + item.score, 0) / items.length };
    }).sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.score - b.score);
  }, [plans]);
  const domainSummary = useMemo(() => {
    const stored = report.data?.domains || [];
    if (stored.length) return stored.map(item => ({
      name: item.domainName,
      displayName: item.scoreEvidence ? item.domainName : `${item.domainName} *`,
      score: Number(item.score),
      scoreEvidence: item.scoreEvidence,
    }));
    return domains.map(name => {
    const group = criteria.filter(item => item.domainName === name);
    return { name, displayName: `${name} *`, score: group.length ? group.reduce((sum, item) => sum + item.score, 0) / group.length : 0, scoreEvidence: null };
    });
  }, [report.data?.domains, domains, criteria]);
  const calculatedIndicatorMean = useMemo(() => criteria.length
    ? criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length
    : 0, [criteria]);

  if (guestSession.isLoading || report.isLoading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!report.data) return <section className="mx-auto max-w-lg rounded-[1.6rem] border border-[#d8e8e2] bg-card p-8 text-center"><FileText className="mx-auto h-9 w-9 text-[#4b9e8c]" /><h1 className="font-display mt-4 text-2xl font-bold text-[#174e44]">التقرير غير متاح</h1><p className="mt-2 text-sm text-muted-foreground">قد تكون الجلسة قد انتهت أو أن التقرير مرفوع من متصفح آخر. عودي إلى سجل تقارير هذا المتصفح.</p><Button asChild className="mt-5 rounded-xl"><Link href="/reports">العودة إلى التقارير</Link></Button></section>;

  const { school, report: reportInfo } = report.data;
  const isComplete = reportInfo.status === "completed";
  const schoolFacts = [
    ["المدرسة", school.name],
    ["الإدارة / مكتب التعليم", school.educationOffice || "غير مدخل"],
    ["المدينة", school.city || "غير مدخلة"],
    ["المرحلة", school.stage || "غير مدخلة"],
  ];
  const handleScoreAudit = () => scoreAudit.mutate({ id: reportInfo.id });
  const handleDownloadPdf = async (sections: PdfExportSections) => {
    const printableReport = document.getElementById("report-print-root");
    if (!printableReport) {
      toast.error("تعذّر العثور على التقرير لإنشاء ملف PDF.");
      return;
    }
    setPdfExporting(true);
    try {
      await downloadReportPdf(printableReport, `${school.name} - تقرير التقويم الذاتي`, sections);
      toast.success("تم تنزيل التقرير بصيغة PDF وورق A4.");
    } catch {
      toast.error("تعذّر إنشاء ملف PDF. جرّبي خيار «طباعة PDF» أو أعيدي المحاولة.");
    } finally {
      setPdfExporting(false);
    }
  };
  const handlePrint = async () => {
    const printableReport = document.getElementById("report-print-root");
    const result = printReport(printableReport, `${school.name} - تقرير التقويم الذاتي`);
    if (result === "opened") {
      toast.success("فُتحت نسخة طباعة A4 مستقلة ومنسقة. اختاري حفظ كملف PDF من نافذة الطباعة.");
      return;
    }

    toast.message("حجب المتصفح نافذة الطباعة؛ يجري تنزيل نسخة PDF المنسقة بدلاً منها.");
    await handleDownloadPdf(DEFAULT_PDF_EXPORT_SECTIONS);
  };
  const handleDownloadSelectedPdf = () => {
    setPdfOptionsOpen(false);
    void handleDownloadPdf(pdfSections);
  };
  const hasPdfSelection = Object.values(pdfSections).some(Boolean);
  const goToWorkspaceSection = (tab: WorkspaceTab, id: string) => {
    setActiveWorkspaceTab(tab);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div id="report-print-root" dir="rtl" className="report-print-root mx-auto max-w-[1300px] space-y-6 pb-24 md:pb-0">
      <header className="no-print plan-workspace-header">
        <div className="plan-workspace-head-main">
          <div className="plan-overall-score"><span>الأداء العام</span><strong>{formatScore(reportInfo.overallScore)}</strong><em>{scoreBand(reportInfo.overallScore)}</em></div>
          <div className="min-w-0 flex-1 text-right">
            <h1>خطة تحسين نتائج التقويم المدرسي</h1>
            <p>{school.name} — التقويم المدرسي ({new Date(reportInfo.createdAt).toLocaleDateString("ar-SA")})</p>
          </div>
          <div className="plan-workspace-actions">
            <Button asChild variant="outline"><Link href="/reports"><ArchiveRestore className="ml-2 h-4 w-4" />تقاريري</Link></Button>
            <Button asChild variant="outline"><Link href="/reports"><FileUp className="ml-2 h-4 w-4" />استيراد تقرير</Link></Button>
            {isComplete && <Button onClick={() => void handlePrint()} disabled={pdfExporting} variant="outline"><Printer className="ml-2 h-4 w-4" />طباعة الخطة</Button>}
            {isComplete && <Button onClick={() => setPdfOptionsOpen(true)} disabled={pdfExporting} aria-busy={pdfExporting} className="bg-[#0fb7b5] text-[#062746] hover:bg-[#26cbc7]">{pdfExporting ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" />جارٍ التصدير</> : <><Download className="ml-2 h-4 w-4" />تخصيص PDF</>}</Button>}
          </div>
        </div>
        <nav aria-label="أقسام خطة التحسين" className="plan-workspace-tabs">
          <button className={activeWorkspaceTab === "school" ? "active" : ""} onClick={() => goToWorkspaceSection("school", "school-data")}><ClipboardList className="h-4 w-4" />بيانات المدرسة</button>
          <button className={activeWorkspaceTab === "summary" ? "active" : ""} onClick={() => goToWorkspaceSection("summary", "report-summary")}><LayoutList className="h-4 w-4" />ملخص التقرير</button>
          <button className={activeWorkspaceTab === "plan" ? "active" : ""} onClick={() => goToWorkspaceSection("plan", "improvement-plan")}><Target className="h-4 w-4" />خطة التحسين</button>
          <button className={activeWorkspaceTab === "guide" ? "active" : ""} onClick={() => goToWorkspaceSection("guide", "plan-guide")}><BookOpen className="h-4 w-4" />دليل التعبئة</button>
        </nav>
      </header>

      <section className="report-banner print-only overflow-hidden rounded-[1.7rem] bg-[#0b2644] p-6 text-white md:p-8">
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="print-only text-xs font-bold">ميزان · خطة تحسين نتائج التقويم المدرسي</div>
            <h1 className="font-display mt-3 text-3xl font-bold">{school.name}</h1>
            <p className="mt-2 text-sm text-[#d7ebe5]">{reportInfo.fileName} · {new Date(reportInfo.createdAt).toLocaleDateString("ar-SA")}</p>
          </div>
          <div data-pdf-section="summary" className="print-total-score rounded-2xl bg-white/10 px-5 py-3 text-center">
            <p className="text-[11px] text-[#cae5dd]">{reportInfo.overallScoreEvidence ? "النتيجة الرسمية في التقرير" : "متوسط المعايير المحسوب"}</p>
            <p className="font-display mt-1 text-3xl font-bold text-[#f0cf77]">{formatScore(reportInfo.overallScore)}</p>
          </div>
        </div>
      </section>

      {isComplete && <section id="school-data" data-pdf-section="summary" className="report-school-info workspace-school-info soft-card rounded-[1.6rem] border border-[#d8e8e2] bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-[#174e44]">بيانات المدرسة</h2>
          <span className="text-xs text-muted-foreground">تاريخ التقرير: {new Date(reportInfo.createdAt).toLocaleDateString("ar-SA")}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {schoolFacts.map(([label, value]) => <div key={label} className="rounded-xl bg-[#f7faf9] px-4 py-3">
            <p className="text-[11px] font-semibold text-[#6c817c]">{label}</p>
            <p className="mt-1 break-words text-sm font-bold text-[#253f39]">{value}</p>
          </div>)}
        </div>
      </section>}

      {!isComplete ? (
        <section className="rounded-[1.6rem] border border-[#eadba9] bg-[#fffaf0] p-7">
          <h2 className="font-display text-2xl font-bold text-[#65491b]">{reportInfo.status === "failed" ? "تعذّر اكتمال التحليل" : "جاري تحليل التقرير"}</h2>
          <p className="mt-2 text-sm text-[#816b42]">{reportInfo.errorMessage || "يتم الآن استخراج المجالات والمعايير والأدلة من التقرير. حدّثي الصفحة بعد قليل."}</p>
        </section>
      ) : (
        <>
          <section id="report-summary" data-pdf-section="summary" className="report-score-summary soft-card rounded-[1.6rem] border border-[#d8e8e2] bg-card p-5 md:p-6">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-bold text-[#174e44]">الأداء العام للمدرسة</h2>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">مؤشر توجيهي لبناء خطط التحسين، وليس تصنيفاً رسمياً للمدرسة.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={reportInfo.overallScoreEvidence ? "w-fit border-0 bg-[#e3f5ea] text-[#147554]" : "w-fit border-0 bg-[#fff4d8] text-[#946719]"}>
                  {reportInfo.overallScoreEvidence ? "قيمة موثقة من التقرير" : "متوسط محسوب · يحتاج تدقيق المصدر"}
                </Badge>
                <Badge variant="outline" className="w-fit border-[#cfe6dd] bg-[#f6fbf8] text-[#176958]"><ShieldCheck className="ml-1 h-3.5 w-3.5" />{criteria.length} مؤشر موثّق بالشاهد</Badge>
                <Badge variant="outline" className="w-fit border-[#d6e4ef] bg-white text-[#275b98]">النطاق الإرشادي: {scoreBand(reportInfo.overallScore)}</Badge>
              </div>
            </header>
            <div className="screen-score-progress mt-5 rounded-xl bg-[#f2f6ff] p-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-bold text-[#285d54]">التقدم</span>
                <strong className="font-display text-xl text-[#1767cf]">{formatScore(reportInfo.overallScore)}</strong>
              </div>
              <div role="progressbar" aria-label="التقدم العام" aria-valuemin={0} aria-valuemax={100} aria-valuenow={reportInfo.overallScore} className="h-3 overflow-hidden rounded-full bg-[#dfe9f4]">
                <div className="h-full rounded-full bg-[#2673d8] transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, reportInfo.overallScore))}%` }} />
              </div>
            </div>
            <div className="print-only print-score-strip">
              <div><span>النتيجة الكلية</span><strong>{formatScore(reportInfo.overallScore)}</strong></div>
              <div className="print-score-track"><span style={{ width: `${Math.max(0, Math.min(100, reportInfo.overallScore))}%` }} /></div>
            </div>
            {reportInfo.overallScoreEvidence ? (
              <blockquote className="mt-4 rounded-xl border-r-4 border-[#159469] bg-[#f4faf7] px-4 py-3 text-sm leading-6 text-[#285d54]">
                <strong>شاهد الدرجة من التقرير: </strong>{reportInfo.overallScoreEvidence}
              </blockquote>
            ) : (
              <div role="alert" className="mt-4 rounded-xl border border-[#efdfb3] bg-[#fffaf0] px-4 py-3 text-xs leading-6 text-[#775d2b]">
                لم تُحفظ درجة إجمالية صريحة من ملف PDF لهذا التقرير بعد. الرقم الحالي متوسط حسابي للمعايير، وقد يختلف عن النتيجة الرسمية. استخدمي «إعادة تدقيق الدرجة» لقراءة القيمة مباشرةً من الملف المحفوظ.
              </div>
            )}
            {reportInfo.overallScoreEvidence && Math.abs(reportInfo.overallScore - calculatedIndicatorMean) >= 0.05 && (
              <p className="mt-3 rounded-xl bg-[#f7f9fc] px-4 py-3 text-xs leading-6 text-[#566b78]">
                للمقارنة فقط: متوسط المعايير غير الموزون هو {formatScore(calculatedIndicatorMean)}؛ الدرجة المعتمدة أعلاه هي القيمة المنقولة من التقرير وليست متوسط المؤشرات.
              </p>
            )}
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#d7e9e2] bg-[#f7fcf9] px-4 py-3 text-xs leading-6 text-[#3d655a]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#176958]" />لا يظهر ضمن المؤشرات وخطط التحسين إلا ما طابق فيه الشاهد المقتبس رمز المؤشر أو اسمه ودرجته؛ وتُستبعد القراءة الناقصة أو المتعارضة بدلاً من تخمين قيمة.</p>
            <div className="no-print mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={handleScoreAudit} disabled={scoreAudit.isPending} variant="outline" className="h-10 rounded-xl border-[#c8ded6] bg-white text-[#176958] hover:bg-[#f4faf7]">
                {scoreAudit.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <RefreshCw className="ml-2 h-4 w-4" />}
                {scoreAudit.isPending ? "جارٍ تدقيق ملف PDF" : "إعادة تدقيق الدرجة من PDF"}
              </Button>
              <p className="text-[11px] text-muted-foreground">يُحدّث الدرجة ورسم المجالات فقط، ولا يغيّر المؤشرات أو خطط التحسين.</p>
            </div>
          </section>

          <section className="print-summary-grid grid gap-4 lg:grid-cols-[.95fr_1.05fr]">
            <article data-pdf-section="domains" className="soft-card min-h-[330px] rounded-[1.6rem] border border-[#d8e8e2] bg-card p-5">
              <h2 className="font-display text-xl font-bold text-[#174e44]">أداء المجالات</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">تُفضّل درجة المجال المكتوبة في التقرير؛ والنجمة * تعني متوسطاً محسوباً من المعايير لغياب درجة صريحة.</p>
              <ResponsiveContainer width="100%" height={265}>
                <BarChart data={domainSummary} margin={{ top: 24, right: 5, left: 4, bottom: 48 }}>
                  <CartesianGrid vertical={false} stroke="#e5eeeb" />
                  <XAxis dataKey="displayName" tick={{ fontSize: 10, fill: "#4e7069" }} interval={0} angle={-18} textAnchor="end" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#6c8982" }} />
                  <Tooltip formatter={(value, _name, item) => [`${formatScore(Number(value))} · ${item.payload?.scoreEvidence ? "من التقرير" : "متوسط محسوب"}`, "درجة المجال"]} />
                  <Bar dataKey="score" radius={[7, 7, 0, 0]}>
                    {domainSummary.map(item => <Cell key={item.name} fill={domainColor(item.score)} />)}
                    <LabelList dataKey="score" position="top" formatter={(value: number | string) => formatScore(Number(value))} fill="#38574f" fontSize={10} fontWeight={700} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold">
                <span className="rounded-full bg-[#e3f5ea] px-2.5 py-1 text-[#147554]">التميز · 90% فأكثر</span>
                <span className="rounded-full bg-[#e8f0ff] px-2.5 py-1 text-[#245fc0]">التقدم · 75% إلى أقل من 90%</span>
                <span className="rounded-full bg-[#fff3d8] px-2.5 py-1 text-[#946719]">الانطلاق · 50% إلى أقل من 75%</span>
                <span className="rounded-full bg-[#fcebe7] px-2.5 py-1 text-[#ad4d3d]">التهيئة · أقل من 50%</span>
              </div>
            </article>
            <article data-pdf-section="priority" className="soft-card rounded-[1.6rem] border border-[#d8e8e2] bg-card p-5">
              <h2 className="font-display text-xl font-bold text-[#174e44]">كيف رُتبت خطة التحسين؟</h2>
              <div className="mt-5 space-y-4">
                <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#fde7d7] text-[#ad553c]"><CircleAlert className="h-4 w-4" /></span><p className="text-xs leading-6 text-muted-foreground"><b className="text-[#285d54]">الأولوية العاجلة أولاً:</b> المؤشرات الأقل من 75%، ثم العالية والمتوسطة والمنخفضة؛ وداخل كل فئة يسبق المؤشر ذو الدرجة الأقل.</p></div>
                <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#fff4d8] text-[#946719]"><Target className="h-4 w-4" /></span><p className="text-xs leading-6 text-muted-foreground"><b className="text-[#285d54]">الهدف المقترح:</b> رفع 10 نقاط للمؤشرات دون 90% أو 5 نقاط للمؤشرات الأعلى، بحد أقصى 100%؛ ويمكن تعديله.</p></div>
                <div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e3f5ea] text-[#147554]"><CheckCircle2 className="h-4 w-4" /></span><p className="text-xs leading-6 text-muted-foreground">لكل مؤشر حقول مستقلة للاحتياج والإجراءات وآلية التنفيذ والمدة والمسؤول وحالة التقدم. المسودة تحتاج اعتماد المدرسة.</p></div>
              </div>
            </article>
          </section>

          <section id="plan-guide" className="no-print workspace-guide">
            <header><div><p>دليل التعبئة</p><h2>كيف تُستكمل خطة التحسين؟</h2><span>تعبأ الحقول بالترتيب نفسه الظاهر في نموذج الخطة، ثم يُحفظ كل مؤشر قبل التصدير.</span></div><BookOpen className="h-8 w-8" /></header>
            <div className="workspace-guide-grid">
              <article><b>1</b><h3>الدرجة الحالية والمستهدفة</h3><p>الدرجة الحالية من التقرير، والهدف مستوى واقعي تريد المدرسة بلوغه.</p></article>
              <article><b>2</b><h3>وصف الاحتياج</h3><p>حددي الفجوة أو المشكلة بعبارة موجزة مرتبطة بنتيجة المؤشر.</p></article>
              <article><b>3</b><h3>إجراءات التحسين</h3><p>اكتبي خطوات محددة ومباشرة وقابلة للمتابعة والتنفيذ.</p></article>
              <article><b>4</b><h3>آليات التنفيذ</h3><p>وضحي أدوات العمل، المتابعة، والشواهد التي تثبت اكتمال الإجراء.</p></article>
              <article><b>5</b><h3>المدة والمسؤولية</h3><p>أكملي تاريخ البداية والنهاية والمسؤول وحالة تنفيذ الإجراء.</p></article>
            </div>
          </section>

          <section id="improvement-plan" className="no-print workspace-plan-toolbar">
            <div><p>خطة التحسين حسب المجالات</p><h2>تبدأ المجالات بالأولوية العاجلة والأقل درجة</h2><span>املئي الحقول، واحفظي كل مؤشر على حدة، ثم أنشئي نسخة PDF للطباعة أو المشاركة.</span></div>
            <Badge className="border-0 bg-[#0b7580] px-3 py-1.5 text-white">{plans.length} مؤشراً في العرض</Badge>
          </section>

          <section className="no-print workspace-filters">
            <div className="grid gap-3 md:grid-cols-2">
              <Select value={domain} onValueChange={setDomain}><SelectTrigger className="h-11 rounded-xl bg-[#fbfdfc]"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="all">كل المجالات</SelectItem>{domains.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
              <Select value={classification} onValueChange={setClassification}><SelectTrigger className="h-11 rounded-xl bg-[#fbfdfc]"><SelectValue /></SelectTrigger><SelectContent dir="rtl"><SelectItem value="all">جميع المؤشرات</SelectItem><SelectItem value="weakness">فرص التحسين أولاً</SelectItem><SelectItem value="strength">مؤشرات القوة والاستدامة</SelectItem></SelectContent></Select>
            </div>
          </section>

          <section className="no-print space-y-4">
            {planGroups.length ? planGroups.map((group, groupIndex) => {
              const style = priorityStyleFor(group.priority);
              return <details key={group.name} className="workspace-domain-panel" open={groupIndex === 0}>
                <summary>
                  <div className="workspace-domain-title"><span>{groupIndex + 1}</span><div><h2>{group.name}</h2><p>{group.items.length} مؤشر · مرتبة داخلياً من الأعلى أولوية إلى الأقل.</p></div></div>
                  <div className="workspace-domain-meta"><strong>{formatScore(group.score)}</strong><em>{scoreBand(group.score)}</em><Badge className={`border-0 ${style}`}>أولوية {priorityLabelFor(group.priority)}</Badge><ChevronDown className="workspace-domain-chevron h-5 w-5" /></div>
                </summary>
                <div className="workspace-domain-content">{group.items.map(plan => <ImprovementPlanCard key={plan.id} plan={plan} reportId={reportInfo.id} index={planOrder.get(plan.id) || 1} />)}</div>
              </details>;
            }) : <div className="rounded-2xl border border-dashed border-[#cbded7] bg-white p-8 text-center text-sm text-muted-foreground">{criteria.length ? "لا توجد مؤشرات تطابق المرشحات الحالية." : "لم تظهر مؤشرات اجتازت تحقق المصدر في هذا التقرير. ارفعي نسخة PDF أوضح أو أعيدي مسح الصفحات التي تحوي الجداول والدرجات."}</div>}
          </section>

          <section data-pdf-section="indicators" className="print-only print-indicators-page">
            <header className="print-section-header">
              <div><p className="print-section-kicker">ميزان · مؤشرات التقرير</p><h2>قراءة سريعة لمستوى المؤشرات</h2></div>
              <span>{criteria.length} مؤشراً</span>
            </header>
            <section className="print-indicator-group">
              <header className="print-indicator-group-header"><h3>أعلى خمسة مؤشرات</h3><p>مرتبة من الدرجة الأعلى إلى الأقل.</p></header>
              {indicatorRankings.topFive.length ? indicatorRankings.topFive.map(indicator => <PrintableIndicatorRow key={`${indicator.domainName}-${indicator.criterionCode}`} indicator={indicator} />) : <p className="print-indicator-empty">لم تُستخرج مؤشرات من التقرير.</p>}
            </section>
            <section className="print-indicator-group">
              <header className="print-indicator-group-header"><h3>أدنى المؤشرات (دون مستوى التميز)</h3><p>كل مؤشر تقل درجته عن 90%، مرتبة من الأدنى إلى الأعلى.</p></header>
              {indicatorRankings.belowExcellence.length ? indicatorRankings.belowExcellence.map(indicator => <PrintableIndicatorRow key={`${indicator.domainName}-${indicator.criterionCode}`} indicator={indicator} />) : <p className="print-indicator-empty">لا توجد مؤشرات دون مستوى التميز في هذا التقرير.</p>}
            </section>
            <footer className="print-indicator-legend" aria-label="مستويات الأداء">
              <span><i className="indicator-legend-dot excellence" />التميز · 90% فأكثر</span>
              <span><i className="indicator-legend-dot progress" />التقدم · 75% إلى أقل من 90%</span>
              <span><i className="indicator-legend-dot start" />الانطلاق · 50% إلى أقل من 75%</span>
              <span><i className="indicator-legend-dot readiness" />التهيئة · أقل من 50%</span>
            </footer>
          </section>

          <section data-pdf-section="plans" className="print-only print-plan-list">
            <header className="print-plan-list-header">
              <h2>خطة التحسين مرتبة حسب الأولوية</h2>
              <p>{school.name} · {allPlans.length} مؤشراً · تبدأ بالأولوية العاجلة، ثم العالية، فالمتوسطة، فالمنخفضة؛ وداخل كل فئة تسبق الدرجة الحالية الأقل.</p>
              <p>تعرض هذه النسخة القيم المحفوظة. احفظي أي تعديل على الخطة قبل إنشاء ملف PDF.</p>
            </header>
            {allPlans.map((plan, index) => <PrintablePlanCard key={plan.id} plan={plan} index={index} />)}
          </section>
        </>
      )}

      {isComplete && <div className="no-print fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 border-t border-[#d7e4ea] bg-[#f4faff]/95 px-4 py-3 shadow-[0_-8px_25px_rgba(20,50,70,.08)] backdrop-blur-xl md:hidden">
        <div className="min-w-0"><p className="text-xs font-bold text-[#173c5b]">جاهز للتصدير</p><p className="text-[10px] text-[#617887]">احفظي الخطط أولاً ثم اختاري أقسام PDF</p></div>
        <div className="flex shrink-0 items-center gap-2"><Button asChild variant="ghost" className="rounded-full text-[#245777]"><Link href="/reports">إغلاق</Link></Button><Button onClick={() => void handlePrint()} disabled={pdfExporting} variant="outline" className="h-10 w-10 rounded-full border-[#b9d6e6] bg-white p-0 text-[#245777]" aria-label="طباعة PDF"><Printer className="h-4 w-4" /></Button><Button onClick={() => setPdfOptionsOpen(true)} disabled={pdfExporting} className="rounded-full bg-[#12365f] px-4 text-white hover:bg-[#0e2c4e]">{pdfExporting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Download className="ml-2 h-4 w-4" />}{pdfExporting ? "جارٍ التصدير" : "تخصيص PDF"}</Button></div>
      </div>}
      <Dialog open={pdfOptionsOpen} onOpenChange={setPdfOptionsOpen}>
        <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto rounded-[1.5rem] border-[#d8e8e2] p-5 sm:p-6">
          <DialogHeader className="text-right">
            <DialogTitle className="font-display text-xl font-bold text-[#174e44]">تحديد أقسام ملف PDF</DialogTitle>
            <DialogDescription className="text-right leading-6">اختاري الأقسام المطلوبة. يبقى اسم المدرسة وعنوان التقرير في رأس كل نسخة للتعريف بها.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Button type="button" variant="outline" className="rounded-xl border-[#d8e8e2]" onClick={() => setPdfSections({ ...DEFAULT_PDF_EXPORT_SECTIONS })}>كل التقرير</Button>
            <Button type="button" variant="outline" className="rounded-xl border-[#d8e8e2]" onClick={() => setPdfSections({ summary: true, domains: false, priority: false, indicators: false, plans: false })}>الملخص فقط</Button>
            <Button type="button" variant="outline" className="rounded-xl border-[#d8e8e2]" onClick={() => setPdfSections({ summary: false, domains: false, priority: false, indicators: true, plans: false })}>المؤشرات فقط</Button>
            <Button type="button" variant="outline" className="rounded-xl border-[#d8e8e2]" onClick={() => setPdfSections({ summary: false, domains: false, priority: false, indicators: false, plans: true })}>خطط التحسين فقط</Button>
          </div>
          <div className="space-y-2" role="group" aria-label="أقسام التقرير">
            {PDF_SECTION_CHOICES.map(section => (
              <label key={section.key} htmlFor={`pdf-section-${section.key}`} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#dfeae5] bg-white p-3 transition-colors hover:bg-[#f5faf7]">
                <Checkbox id={`pdf-section-${section.key}`} checked={pdfSections[section.key]} onCheckedChange={checked => setPdfSections(current => ({ ...current, [section.key]: checked === true }))} className="mt-0.5" />
                <span className="min-w-0"><span className="block text-sm font-bold text-[#255b50]">{section.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{section.description}</span></span>
              </label>
            ))}
          </div>
          {!hasPdfSelection && <p role="alert" className="text-xs font-semibold text-[#ad4d3d]">اختاري قسماً واحداً على الأقل قبل التنزيل.</p>}
          <DialogFooter className="sm:flex-row">
            <Button type="button" variant="outline" className="rounded-xl border-[#d8e8e2]" onClick={() => setPdfOptionsOpen(false)}>إلغاء</Button>
            <Button type="button" disabled={!hasPdfSelection || pdfExporting} onClick={handleDownloadSelectedPdf} className="rounded-xl bg-[#0b6b5a] text-white hover:bg-[#095a4c]">{pdfExporting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Download className="ml-2 h-4 w-4" />}{pdfExporting ? "جارٍ إنشاء PDF" : "تنزيل الأقسام المحددة"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
