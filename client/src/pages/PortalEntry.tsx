import { useState } from "react";
import { useLocation } from "wouter";
import { Building2, CheckCircle2, KeyRound, Loader2, LockKeyhole, School, ShieldCheck, UserPlus, UserRound, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

type EntryMode = "school" | "supervisor" | "register";

export default function PortalEntry({ initialMode = "school" }: { initialMode?: EntryMode }) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [supervisorCode, setSupervisorCode] = useState("");
  const [registration, setRegistration] = useState({ schoolName: "", stage: "", principalName: "", mobile: "", username: "", password: "" });
  const [registered, setRegistered] = useState(false);

  const schoolLogin = trpc.portal.schoolLogin.useMutation({
    onSuccess: async () => { await utils.portal.me.invalidate(); setLocation("/"); },
    onError: error => toast.error(error.message),
  });
  const supervisorLogin = trpc.portal.supervisorLogin.useMutation({
    onSuccess: async () => { await utils.portal.me.invalidate(); setLocation("/supervisor"); },
    onError: error => toast.error(error.message),
  });
  const register = trpc.portal.registerSchool.useMutation({
    onSuccess: () => { setRegistered(true); toast.success("تم تسجيل المدرسة وإرسالها إلى المشرف للتفعيل."); },
    onError: error => toast.error(error.message),
  });

  const submitSchool = (event: React.FormEvent) => {
    event.preventDefault();
    schoolLogin.mutate({ username, password });
  };
  const submitSupervisor = (event: React.FormEvent) => {
    event.preventDefault();
    supervisorLogin.mutate({ accessCode: supervisorCode });
  };
  const submitRegistration = (event: React.FormEvent) => {
    event.preventDefault();
    register.mutate(registration);
  };
  const setRegistrationField = (field: keyof typeof registration, value: string) => setRegistration(current => ({ ...current, [field]: value }));

  return <main className="portal-entry-page" dir="rtl">
    <div className="portal-entry-orb portal-entry-orb-one" /><div className="portal-entry-orb portal-entry-orb-two" />
    <section className="portal-entry-intro">
      <div className="portal-entry-mark"><School className="h-8 w-8" /></div>
      <p>بوابة المدارس والمشرف</p>
      <h1>منصة تحليل نتائج التقويم</h1>
      <span>مساحة منظمة لقراءة التقويم المدرسي وبناء خطط تحسين قابلة للمتابعة والاعتماد.</span>
    </section>

    <section className="portal-entry-card">
      {mode !== "register" && <div className="portal-entry-tabs" role="tablist" aria-label="نوع الدخول">
        <button type="button" className={mode === "school" ? "active" : ""} onClick={() => setMode("school")}><Building2 className="h-4 w-4" />دخول المدرسة</button>
        <button type="button" className={mode === "supervisor" ? "active" : ""} onClick={() => setMode("supervisor")}><ShieldCheck className="h-4 w-4" />دخول المشرف</button>
      </div>}

      {mode === "school" && <form onSubmit={submitSchool} className="portal-entry-form">
        <div className="portal-form-heading"><span><UserRound className="h-5 w-5" /></span><div><h2>تسجيل دخول المدرسة</h2><p>أدخلي اسم المستخدم وكلمة المرور المعتمدين للمدرسة.</p></div></div>
        <div className="space-y-2"><Label htmlFor="school-username">اسم المستخدم</Label><Input id="school-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="مثال: school.first" className="portal-entry-input" dir="ltr" /></div>
        <div className="space-y-2"><Label htmlFor="school-password">كلمة المرور</Label><div className="relative"><LockKeyhole className="absolute right-3 top-3 h-4 w-4 text-[#648092]" /><Input id="school-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="كلمة المرور" className="portal-entry-input pr-9" /></div></div>
        <Button type="submit" disabled={schoolLogin.isPending} className="portal-entry-primary">{schoolLogin.isPending ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <KeyRound className="ml-2 h-5 w-5" />}دخول بوابة المدرسة</Button>
        <p className="portal-entry-footnote">لا يظهر الحساب إلا بعد تفعيل المشرف لطلب المدرسة.</p>
        <button type="button" className="portal-entry-link" onClick={() => { setRegistered(false); setMode("register"); }}><UserPlus className="h-4 w-4" />تسجيل مدرسة جديدة</button>
      </form>}

      {mode === "supervisor" && <form onSubmit={submitSupervisor} className="portal-entry-form">
        <div className="portal-form-heading"><span><ShieldCheck className="h-5 w-5" /></span><div><h2>بوابة المشرف</h2><p>تحققي من طلبات المدارس، فعّلي الحسابات، وراجعي حالة البوابات.</p></div></div>
        <div className="space-y-2"><Label htmlFor="supervisor-code">رقم السجل المدني / رمز الدخول</Label><Input id="supervisor-code" value={supervisorCode} onChange={event => setSupervisorCode(event.target.value)} placeholder="أدخلي رقم السجل المدني" inputMode="numeric" className="portal-entry-input" dir="ltr" /></div>
        <Button type="submit" disabled={supervisorLogin.isPending} className="portal-entry-primary">{supervisorLogin.isPending ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="ml-2 h-5 w-5" />}دخول بوابة المشرف</Button>
        <p className="portal-entry-footnote">محاولات الدخول محدودة لحماية بيانات المدارس وحسابات التفعيل.</p>
      </form>}

      {mode === "register" && (registered ? <div className="portal-registration-success"><span><CheckCircle2 className="h-9 w-9" /></span><h2>تم إرسال طلب المدرسة</h2><p>سيراجع المشرف بيانات المدرسة ويفعّل الحساب. بعد التفعيل استخدمي اسم المستخدم وكلمة المرور للدخول إلى البوابة.</p><Button type="button" onClick={() => setMode("school")} className="portal-entry-primary">العودة إلى تسجيل الدخول</Button></div> : <form onSubmit={submitRegistration} className="portal-entry-form portal-registration-form">
        <div className="portal-form-heading"><span><UsersRound className="h-5 w-5" /></span><div><h2>تسجيل مدرسة جديدة</h2><p>تُرسل البيانات للمشرف؛ لا يمكن الدخول أو رفع التقرير قبل التفعيل.</p></div></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="new-school-name">اسم المدرسة</Label><Input id="new-school-name" value={registration.schoolName} onChange={event => setRegistrationField("schoolName", event.target.value)} placeholder="مثال: المدرسة الابتدائية الأولى" className="portal-entry-input" /></div>
          <div className="space-y-2"><Label htmlFor="new-stage">المرحلة التعليمية</Label><Input id="new-stage" value={registration.stage} onChange={event => setRegistrationField("stage", event.target.value)} placeholder="ابتدائية / متوسطة / ثانوية" className="portal-entry-input" /></div>
          <div className="space-y-2"><Label htmlFor="new-principal">اسم مدير المدرسة</Label><Input id="new-principal" value={registration.principalName} onChange={event => setRegistrationField("principalName", event.target.value)} placeholder="الاسم الثلاثي" className="portal-entry-input" /></div>
          <div className="space-y-2"><Label htmlFor="new-mobile">رقم الجوال</Label><Input id="new-mobile" value={registration.mobile} onChange={event => setRegistrationField("mobile", event.target.value)} placeholder="05xxxxxxxx" inputMode="tel" className="portal-entry-input" dir="ltr" /></div>
          <div className="space-y-2"><Label htmlFor="new-username">اسم المستخدم</Label><Input id="new-username" value={registration.username} onChange={event => setRegistrationField("username", event.target.value.toLowerCase())} placeholder="school.first" autoCapitalize="none" className="portal-entry-input" dir="ltr" /></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="new-password">كلمة مرور للبوابة</Label><Input id="new-password" type="password" value={registration.password} onChange={event => setRegistrationField("password", event.target.value)} placeholder="8 أحرف على الأقل" autoComplete="new-password" className="portal-entry-input" /></div>
        </div>
        <Button type="submit" disabled={register.isPending} className="portal-entry-primary">{register.isPending ? <Loader2 className="ml-2 h-5 w-5 animate-spin" /> : <UserPlus className="ml-2 h-5 w-5" />}إرسال طلب التفعيل</Button>
        <button type="button" className="portal-entry-link" onClick={() => setMode("school")}>لدي حساب مدرسة مفعّل</button>
      </form>)}
    </section>
    <p className="portal-entry-copyright">ميزان · منصة آمنة لإدارة نتائج التقويم وخطط التحسين المدرسي</p>
  </main>;
}
