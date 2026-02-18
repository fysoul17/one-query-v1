import { AppSidebar } from '@/components/layout/app-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { isAuthEnabled } from '@/lib/auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = isAuthEnabled();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar authEnabled={authEnabled} />
        <main className="flex-1 overflow-auto">{children}</main>
      </SidebarProvider>
    </TooltipProvider>
  );
}
