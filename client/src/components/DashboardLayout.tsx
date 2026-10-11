import { FileUp, LayoutDashboard, LogOut, Scale, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

const menuItems = [
  { icon: LayoutDashboard, label: "لوحة المتابعة", path: "/" },
  { icon: FileUp, label: "استيراد تقرير", path: "/reports" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const portal = trpc.portal.me.useQuery(undefined, { retry: false });
  const logout = trpc.portal.logout.useMutation({ onSuccess: async () => { await utils.portal.me.invalidate(); setLocation("/"); } });
  const isPlanWorkspace = /^\/reports\/[^/]+$/.test(location);

  if (isPlanWorkspace) {
    return <div className="plan-workspace-shell min-h-screen" dir="rtl"><main className="plan-workspace-content">{children}</main></div>;
  }

  return (
    <div className="portal-shell min-h-screen" dir="rtl">
      <header className="portal-header print-hidden">
        <div className="portal-header-inner">
          <button onClick={() => setLocation("/")} className="portal-brand" aria-label="الانتقال إلى لوحة المتابعة">
            <span><Scale className="h-5 w-5" /></span>
            <div><b>ميزان</b><small>تحليل التقويم الذاتي المدرسي</small></div>
          </button>
          <nav className="portal-nav" aria-label="التنقل الرئيسي">
            {menuItems.map(item => {
              const active = location === item.path || (item.path === "/reports" && location.startsWith("/reports"));
              return <button key={item.path} onClick={() => setLocation(item.path)} className={active ? "active" : ""}><item.icon className="h-4 w-4" />{item.label}</button>;
            })}
          </nav>
          <div className="portal-account-actions">
            {portal.data?.authenticated && portal.data.role === "school" && <span className="portal-school-name"><ShieldCheck className="h-3.5 w-3.5" />{portal.data.school.name}</span>}
            <button onClick={() => setLocation("/reports")} className="portal-upload"><FileUp className="h-4 w-4" />رفع تقرير جديد</button>
            <button onClick={() => logout.mutate()} disabled={logout.isPending} className="portal-logout" aria-label="تسجيل الخروج"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="portal-privacy"><ShieldCheck className="h-3.5 w-3.5" />رفع وتحليل خاصان بجلسة هذا المتصفح · بلا حساب أو بريد</div>
      </header>
      <main className="portal-content">{children}</main>
    </div>
  );
}
