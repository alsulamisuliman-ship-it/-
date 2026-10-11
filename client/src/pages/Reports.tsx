import { useState } from "react";
import { useLocation } from "wouter";
import { FileText, Loader2, Plus, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ReportUpload from "@/components/ReportUpload";
import { trpc } from "@/lib/trpc";

const statusText = { completed: "مكتمل", processing: "قيد التحليل", failed: "يحتاج مراجعة" };

function formatScore(value: number) {
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

export default function Reports() {
  const [, setLocation] = useLocation();
  const [showUpload, setShowUpload] = useState(false);
  const [search, setSearch] = useState("");
  const guestSession = trpc.guest.ensureSession.useQuery(undefined, { retry: 2 });
  const reports = trpc.reports.list.useQuery(undefined, { enabled: guestSession.data?.ready === true, retry: false });
  const rows = (reports.data || []).filter(row => row.school.name.includes(search) || row.fileName.includes(search));

  return (
    <div className="workspace-register mx-auto max-w-[1240px] space-y-6">
      <section className="reports-import-hero">
        <div>
          <p>بوابة المدرسة المفعّلة · سجل خاص بالمدرسة</p>
          <h1>استيراد تقرير التقويم وتوليد الخطة</h1>
          <span>التحليل محلي دون خدمات خارجية: ارفعي PDF نصياً يتضمن عنوان المجال ورمز المؤشر واسمه ودرجة واضحة في السطر نفسه. الملفات الممسوحة كصور تحتاج OCR ولا تُحلّل هنا. إجراءات التحسين مقترحات عامة قابلة للتعديل.</span>
        </div>
        <Button onClick={() => setShowUpload(value => !value)} className="h-11 rounded-xl bg-[#0fb7b5] px-5 font-bold text-[#062746] hover:bg-[#27cbc7]">
          <Plus className="ml-2 h-4 w-4" />{showUpload ? "إخفاء نموذج الاستيراد" : "اختيار ملف التقرير"}
        </Button>
      </section>
      {showUpload && <section className="reports-upload-stage"><ReportUpload /></section>}

      <section className="workspace-register-search soft-card rounded-2xl border border-[#d8e8e2] bg-card p-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم المدرسة أو ملف من سجل المدرسة" className="h-11 rounded-xl border-0 bg-[#f5faf8] pr-10 shadow-none" />
        </div>
      </section>

      {guestSession.isLoading || reports.isLoading ? (
        <div className="grid h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : guestSession.error ? (
        <section className="soft-card rounded-[1.6rem] border border-[#f0d1c9] bg-card p-8 text-center">
          <TriangleAlert className="mx-auto h-8 w-8 text-[#b95743]" />
          <h2 className="font-display mt-3 text-2xl font-bold text-[#174e44]">تعذّر بدء جلسة المدرسة</h2>
          <p className="mt-2 text-sm text-muted-foreground">تأكدي من تسجيل الدخول ثم أعيدي تحميل الصفحة.</p>
          <Button onClick={() => guestSession.refetch()} className="mt-4 rounded-xl">إعادة المحاولة</Button>
        </section>
      ) : reports.error ? (
        <section className="soft-card rounded-[1.6rem] border border-[#f0d1c9] bg-card p-8 text-center">
          <TriangleAlert className="mx-auto h-8 w-8 text-[#b95743]" />
          <h2 className="font-display mt-3 text-2xl font-bold text-[#174e44]">تعذّر تحميل السجل</h2>
          <p className="mt-2 text-sm text-muted-foreground">تحققي من الاتصال ثم أعيدي المحاولة.</p>
          <Button onClick={() => reports.refetch()} className="mt-4 rounded-xl">إعادة المحاولة</Button>
        </section>
      ) : rows.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => (
            <button key={row.id} onClick={() => setLocation(`/reports/${row.id}`)} className="soft-card rounded-[1.45rem] border border-[#d8e8e2] bg-card p-5 text-right">
              <div className="flex items-start justify-between gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e6f3ef] text-[#176958]"><FileText className="h-5 w-5" /></span>
                <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${row.status === "completed" ? "bg-[#e4f5ed] text-[#147554]" : row.status === "failed" ? "bg-[#fcebe7] text-[#ad4d3d]" : "bg-[#f8edce] text-[#946719]"}`}>{statusText[row.status]}</span>
              </div>
              <h2 className="mt-5 text-base font-bold text-[#255b50]">{row.school.name}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">{row.fileName}</p>
              <div className="mt-5 flex items-center justify-between border-t border-[#edf3f0] pt-4">
                <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleDateString("ar-SA")}</span>
                <span className="flex flex-col items-end">
                  <span className="font-display text-xl font-bold text-[#176958]">{row.status === "completed" ? formatScore(row.overallScore) : "—"}</span>
                  {row.status === "completed" && <span className={`text-[10px] font-semibold ${row.overallScoreEvidence ? "text-[#147554]" : "text-[#946719]"}`}>{row.overallScoreEvidence ? "قيمة رسمية من التقرير" : "متوسط محسوب · قابل للتدقيق"}</span>}
                </span>
              </div>
            </button>
          ))}
        </section>
      ) : (
        <section className="soft-card rounded-[1.6rem] border border-dashed border-[#b6d5ca] bg-card p-10 text-center">
          <TriangleAlert className="mx-auto h-8 w-8 text-[#a87b25]" />
          <h2 className="font-display mt-3 text-2xl font-bold text-[#174e44]">لا توجد تقارير لهذه المدرسة</h2>
          <p className="mt-2 text-sm text-muted-foreground">ارفعي أول تقرير مدرسي لبدء التحليل وبناء خطة التحسين.</p>
          <Button onClick={() => setShowUpload(true)} className="mt-5 rounded-xl bg-[#0b6b5a]">رفع تقرير الآن</Button>
        </section>
      )}
    </div>
  );
}
