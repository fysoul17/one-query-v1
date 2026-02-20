'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const matchesExact = pathname === item.href;
        const matchesPrefix = item.href !== '/' && pathname.startsWith(`${item.href}/`);
        const hasMoreSpecificMatch =
          matchesPrefix &&
          items.some(
            (other) =>
              other.href !== item.href &&
              other.href.startsWith(`${item.href}/`) &&
              (pathname === other.href || pathname.startsWith(`${other.href}/`)),
          );
        const isActive =
          item.href === '/' ? pathname === '/' : matchesExact || (matchesPrefix && !hasMoreSpecificMatch);

        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={isActive}>
              <Link
                href={item.href}
                className={
                  isActive
                    ? 'text-primary text-glow-cyan border-l-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}
