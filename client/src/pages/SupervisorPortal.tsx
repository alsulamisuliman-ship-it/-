import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Building2, CheckCircle2, Clock3, Loader2, LogOut, ShieldCheck, SlidersHorizontal, TriangleAlert, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type StatusFilter = "all" | "pending" | "active" | "suspended";
const statusLabel = { pending: "بانتظار التفعيل", active: "مفعّلة", suspended: "موقوفة" } as const;
const statusStyle = { pending: "bg-[#fff1d6] text-[#96610e]", active: "bg-[#e0f5ec] text-[#137258]", suspended: "bg-[#fde8e5] text-[#b54f40]" } as const;

export default function SupervisorPortal() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const schools = trpc.portal.supervisor.schools.useQuery(undefined, { retry: false });
  const setStatus = trpc.portal.supervisor.setSchoolStatus.useMutation({
    onSuccess: async result => { await schools.refetch(); toast.success(`${result.schoolName}: تم تحديث حالة الحساب.`); },
    onError: error => toast.error(error.message),
  });
  const logout = trpc.portal.logout.useMutation({
    onSuccess: async () => { await utils.portal.me.invalidate(); setLocation("/"); },
  });
  const visible = useMemo(() => (schools.data || []).filter(item => (filter === "all" || item.status === filter) && `${item.schoolName} ${item.principalName} ${item.username}`.toLowerCase().includes(search.toLowerCase())), [schools.data, filter, search]);
  const summary = useMemo(() => ({ all: schools.data?.length || 0, pending: schools.data?.filter(item => item.status === "pending").length || 0, active: schools.data?.filter(item => item.status === "active").length || 0, suspended: schools.data?.filter(item => item.status === "suspended").length || 0 }), [schools.data]);

  return <main className="supervisor-page" dir="rtl">
    <header className="supervisor-header"><div className="supervisor-header-inner"><div className="supervisor-brand"><span><ShieldCheck className="h-6 w-6" /></span><div><p>بوابة المشرف</p><h1>منصة تحليل نتائج التقويم</h1></div></div><Button onClick={() => logout.mutate()} variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/15 hover:text-white"><LogOut className="ml-2 h-4 w-4" />تسجيل الخروج</Button></div></header>
    <div className="supervisor-content">
      <section className="supervisor-hero"><div><p>إدارة تفعيل البوابات</p><h2>مراجعة طلبات المدارس واعتماد الوصول</h2><span>لا تدخل المدرسة إلى تقاريرها أو أدوات التحليل إلا بعد تفعيل حسابها من هذه البوابة.</span></div><ShieldCheck className="h-14 w-14" /></section>
      <section className="supervisor-metrics"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><Building2 /><strong>{summary.all}</strong><span>كل المدارس</span></button><button className={filter === "pending" ? "active pending" : ""} onClick={() => setFilter("pending")}><Clock3 /><strong>{summary.pending}</strong><span>طلبات بانتظار التفعيل</span></button><button className={filter === "active" ? "active green" : ""} onClick={() => setFilter("active")}><CheckCircle2 /><strong>{summary.active}</strong><span>مدارس مفعّلة</span></button><button className={filter === "suspended" ? "active red" : ""} onClick={() => setFilter("suspended")}><XCircle /><strong>{summary.suspended}</strong><span>حسابات موقوفة</span></button></section>
      <section className="supervisor-table-card"><div className="supervisor-table-tools"><div><p><SlidersHorizontal className="h-4 w-4" />سجل المدارس</p><h2>{filter === "pending" ? "طلبات تحتاج قرار التفعيل" : "حسابات المدارس"}</h2></div><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحثي باسم المدرسة أو المدير أو المستخدم" className="h-10 max-w-sm rounded-xl bg-[#f7fafb]" /></div>
        {schools.isLoading ? <div className="grid h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#0b8e98]" /></div> : schools.error ? <div className="grid h-64 place-items-center text-center"><TriangleAlert className="mb-3 h-7 w-7 text-[#b54f40]" /><p>تعذّر تحميل حسابات المدارس.</p><Button onClick={() => schools.refetch()} className="mt-3">إعادة المحاولة</Button></div> : visible.length ? <div className="overflow-x-auto"><table className="supervisor-table"><thead><tr><th>المدرسة</th><th>المرحلة</th><th>مدير المدرسة</th><th>الجوال</th><th>اسم المستخدم</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td><strong>{item.schoolName}</strong><small>سجّل: {new Date(item.createdAt).toLocaleDateString("ar-SA")}</small></td><td>{item.stage}</td><td><span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{item.principalName}</span></td><td dir="ltr">{item.mobile}</td><td dir="ltr">{item.username}</td><td><span className={`supervisor-status ${statusStyle[item.status]}`}>{statusLabel[item.status]}</span></td><td>{item.status !== "active" ? <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ accountId: item.id, status: "active" })} className="bg-[#0b958e] text-white hover:bg-[#087b76]"><CheckCircle2 className="ml-1.5 h-4 w-4" />تفعيل</Button> : <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ accountId: item.id, status: "suspended" })} className="border-[#efcbc3] text-[#b54f40]"><XCircle className="ml-1.5 h-4 w-4" />إيقاف</Button>}</td></tr>)}</tbody></table></div> : <div className="supervisor-empty"><Building2 className="h-8 w-8" /><h3>لا توجد مدارس في هذا العرض</h3><p>غيّري مرشح الحالة أو انتظري وصول طلب تسجيل جديد.</p></div>}</section>
    </div>
  </main>;
}
