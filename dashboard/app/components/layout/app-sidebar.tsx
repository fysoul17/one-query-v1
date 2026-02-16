'use client';

import {
  Bot,
  Brain,
  Cpu,
  Home,
  MessageSquare,
  Radio,
  Settings,
  Terminal,
  Timer,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
} from '@/components/ui/sidebar';
import { NavLinks } from './nav-links';

const mainNav = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/memory', label: 'Memory', icon: Brain },
];

const systemNav = [
  { href: '/automation', label: 'Automation', icon: Timer },
  { href: '/activity', label: 'Debug Console', icon: Terminal },
  { href: '/channels', label: 'Channels', icon: Radio },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar() {
  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 glow-cyan">
            <Cpu className="h-4 w-4 text-primary text-glow-cyan" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-wide text-primary text-glow-cyan">
              AUTONOMY
            </h2>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Runtime v0.0.0
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Core
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLinks items={mainNav} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">
            System
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <NavLinks items={systemNav} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-4 py-3 border-t border-sidebar-border">
        <p className="text-[10px] text-muted-foreground text-center">Powered by Claude</p>
      </SidebarFooter>
    </Sidebar>
  );
}
