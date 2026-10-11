import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { FileText, Loader2, UploadCloud } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("تعذّر قراءة الملف."));
  reader.onload = () => resolve(String(reader.result));
  reader.readAsDataURL(file);
});

export default function ReportUpload() {
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [educationOffice, setEducationOffice] = useState("");
  const [city, setCity] = useState("");
  const [stage, setStage] = useState("المرحلة الابتدائية");
  const portal = trpc.portal.me.useQuery(undefined, { retry: false });
  const guestSession = trpc.guest.ensureSession.useQuery(undefined, { retry: 2 });
  useEffect(() => {
    if (portal.data?.authenticated && portal.data.role === "school") {
      setSchoolName(portal.data.school.name);
      setStage(portal.data.school.stage || "");
    }
  }, [portal.data]);
  const upload = trpc.reports.uploadAndAnalyze.useMutation({
    onSuccess: result => {
      toast.success("اكتمل التحليل وحُفظ التقرير في سجل المدرسة.");
      setLocation(`/reports/${result.reportId}`);
    },
    onError: error => toast.error(error.message || "تعذّر تحليل التقرير. تأكدي من الملف وحاولي مجدداً."),
  });

  const handleUpload = async () => {
    if (!file || !schoolName.trim()) {
      toast.error("أدخلي اسم المدرسة واختاري ملف التقرير أولاً.");
      return;
    }
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("يُرجى اختيار تقرير بصيغة PDF فقط.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast.error("الحد الأقصى لحجم التقرير هو 12 ميغابايت.");
      return;
    }
    const fileData = await readAsDataUrl(file);
    upload.mutate({ schoolName: schoolName.trim(), educationOffice: educationOffice.trim() || undefined, city: city.trim() || undefined, stage: stage.trim() || undefined, fileName: file.name, mimeType: "application/pdf", fileData });
  };

  return (
    <section className="soft-card rounded-[1.6rem] border border-[#d8e8e2] bg-card p-5 md:p-7">
      <div className="mb-6 flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e6f3ef] text-[#0b6b5a]"><UploadCloud className="h-5 w-5" /></span><div><h2 className="font-display text-xl font-bold text-[#174e44]">رفع تقرير المدرسة</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">سيُحفظ التقرير ضمن سجل مدرستك المفعّلة، ولا يظهر لحساب مدرسة أخرى.</p></div></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="schoolName">اسم المدرسة <span className="text-[#bd5e3f]">*</span></Label><Input id="schoolName" value={schoolName} onChange={e => setSchoolName(e.target.value)} readOnly={portal.data?.authenticated && portal.data.role === "school"} placeholder="مثال: المدرسة الابتدائية الأولى" className="h-11 rounded-xl bg-[#fcfefd]" /></div>
        <div className="space-y-2"><Label htmlFor="stage">المرحلة التعليمية</Label><Input id="stage" value={stage} onChange={e => setStage(e.target.value)} readOnly={portal.data?.authenticated && portal.data.role === "school"} className="h-11 rounded-xl bg-[#fcfefd]" /></div>
        <div className="space-y-2"><Label htmlFor="office">إدارة أو مكتب التعليم</Label><Input id="office" value={educationOffice} onChange={e => setEducationOffice(e.target.value)} placeholder="اختياري" className="h-11 rounded-xl bg-[#fcfefd]" /></div>
        <div className="space-y-2"><Label htmlFor="city">المدينة</Label><Input id="city" value={city} onChange={e => setCity(e.target.value)} placeholder="اختياري" className="h-11 rounded-xl bg-[#fcfefd]" /></div>
      </div>
      <label className="mt-5 flex min-h-28 cursor-pointer items-center justify-center rounded-2xl border border-dashed border-[#a8cfc2] bg-[#f8fcfa] px-4 text-center transition hover:border-[#0b6b5a] hover:bg-[#f0f8f5]">
        <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={e => setFile(e.target.files?.[0] || null)} />
        {file ? <span className="flex items-center gap-2 text-sm font-bold text-[#176958]"><FileText className="h-5 w-5" />{file.name}<small className="font-normal text-muted-foreground">({(file.size / 1024 / 1024).toFixed(1)} MB)</small></span> : <span><UploadCloud className="mx-auto mb-2 h-6 w-6 text-[#4b9e8c]" /><span className="block text-sm font-bold text-[#285d54]">اختاري تقرير التقويم الذاتي بصيغة PDF</span><small className="mt-1 block text-xs text-muted-foreground">حتى 12 ميغابايت — اسم الملف لا يؤثر؛ تُقرأ المجالات والمؤشرات من محتواه</small></span>}
      </label>
      {upload.isPending && <p className="mt-4 text-sm leading-6 text-muted-foreground" role="status">قراءة التقارير المصورة قد تستغرق عدة دقائق. أبقي الصفحة مفتوحة حتى اكتمال التحليل، ثم راجعي الدرجات مقابل ملف التقرير.</p>}
      <Button onClick={handleUpload} disabled={upload.isPending || guestSession.isLoading || guestSession.isError} className="mt-5 h-11 w-full rounded-xl bg-[#0b6b5a] text-sm font-bold hover:bg-[#095a4c]">
        {upload.isPending ? <><Loader2 className="ml-2 h-4 w-4 animate-spin" />يجري حفظ التقرير وتحليل محتواه…</> : <><FileText className="ml-2 h-4 w-4" />ابدأ التحليل واحفظ النتيجة</>}
      </Button>
      {upload.isPending && <p className="mt-3 text-center text-xs text-[#487a70]">قد تستغرق العملية دقائق قليلة وفقاً لحجم التقرير وعدد صفحاته. لا تغلقي الصفحة حتى تكتمل النتيجة.</p>}
      <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">تقارير المدرسة محمية بحساب المدرسة المفعّل، ولا تظهر في بوابة مدرسة أخرى.</p>
    </section>
  );
}
