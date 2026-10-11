import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { Redirect, Route, Switch } from "wouter";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { trpc } from "./lib/trpc";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import PortalEntry from "./pages/PortalEntry";
import ReportDetail from "./pages/ReportDetail";
import Reports from "./pages/Reports";
import SupervisorPortal from "./pages/SupervisorPortal";

function SchoolRouter() {
  return <DashboardLayout><Switch><Route path="/" component={Home} /><Route path="/reports" component={Reports} /><Route path="/reports/:id" component={ReportDetail} /><Route path="/404" component={NotFound} /><Route component={NotFound} /></Switch></DashboardLayout>;
}

function Router() {
  const portal = trpc.portal.me.useQuery(undefined, { retry: false });
  if (portal.isLoading) return <div className="grid min-h-screen place-items-center bg-[#eef5f7]"><Loader2 className="h-7 w-7 animate-spin text-[#0b8e98]" /></div>;
  if (portal.data?.authenticated && portal.data.role === "supervisor") {
    return <Switch><Route path="/supervisor" component={SupervisorPortal} /><Route><Redirect to="/supervisor" /></Route></Switch>;
  }
  if (portal.data?.authenticated && portal.data.role === "school") return <SchoolRouter />;
  return <Switch><Route path="/register"><PortalEntry initialMode="register" /></Route><Route path="/login"><PortalEntry /></Route><Route path="/"><PortalEntry /></Route><Route><Redirect to="/" /></Route></Switch>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster richColors position="top-center" /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
