'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { LayoutDashboard, Users } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/organization/organization-context';

const OrganizationSwitcher = dynamic(
  () =>
    import('@/components/organization/organization-switcher').then(
      (mod) => mod.OrganizationSwitcher
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-9 w-full rounded-md border border-input bg-muted animate-pulse" />
    )
  }
);

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** If true, only admins and managers can see this item */
  managerOrAbove?: boolean;
};

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard
  },
  {
    href: '/mitarbeiter',
    label: 'Mitarbeiter',
    icon: Users,
    managerOrAbove: true
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  const { activeOrg } = useOrganization();

  // Check if user is admin or manager of the active organization
  const isAdminOrManager =
    activeOrg?.role === 'admin' || activeOrg?.role === 'manager';

  // Filter nav items based on role
  const visibleNavItems = navItems.filter(
    (item) => !item.managerOrAbove || isAdminOrManager
  );

  return (
    <aside className="flex h-full w-64 flex-col border-r bg-card">
      {/* Organization Switcher at the top */}
      <div className="p-4">
        <OrganizationSwitcher />
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {visibleNavItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer area */}
      <div className="border-t p-4">
        <p className="text-xs text-muted-foreground">WerkFlow</p>
      </div>
    </aside>
  );
}
