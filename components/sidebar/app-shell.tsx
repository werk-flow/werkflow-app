'use client';

import { useState, useEffect, createContext, useContext, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, Users, Menu, X } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/organization/organization-context';
import { DashboardPageSkeleton } from '@/components/loading-states/dashboard-page-skeleton';
import { MitarbeiterPageSkeleton } from '@/components/loading-states/mitarbeiter-page-skeleton';

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

// Context for sidebar state
type SidebarContextType = {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextType | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within AppShell');
  }
  return context;
}

// Sidebar content component (shared between desktop and mobile)
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
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
    <>
      {/* Logo */}
      <div className="flex items-center justify-center px-4 py-5">
        <Link
          href="/dashboard"
          className="flex items-center"
          onClick={onNavigate}
        >
          {/* Light mode logo */}
          <Image
            src="/logo-text-light.svg"
            alt="WerkFlow"
            width={160}
            height={35}
            className="h-9 w-auto dark:hidden"
            priority
          />
          {/* Dark mode logo */}
          <Image
            src="/logo-text-dark.svg"
            alt="WerkFlow"
            width={160}
            height={35}
            className="hidden h-9 w-auto dark:block"
            priority
          />
        </Link>
      </div>

      <Separator />

      {/* Organization Switcher */}
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
                  onClick={onNavigate}
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
        <p className="text-xs text-muted-foreground">© WerkFlow</p>
      </div>
    </>
  );
}

// Desktop sidebar
function DesktopSidebar() {
  return (
    <aside className="hidden md:flex h-full w-64 shrink-0 flex-col border-r bg-card">
      <SidebarContent />
    </aside>
  );
}

// Mobile drawer overlay
function MobileDrawer({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent body scroll when drawer is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
            className="fixed left-0 top-0 z-50 h-full w-72 flex-col border-r bg-card shadow-xl md:hidden flex"
          >
            {/* Close button */}
            <div className="absolute right-2 top-2 z-10">
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Menü schließen</span>
              </Button>
            </div>

            <SidebarContent onNavigate={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// Mobile header with hamburger menu
function MobileHeader() {
  const { isOpen, setIsOpen } = useSidebar();

  return (
    <header className="flex md:hidden items-center justify-between border-b bg-card px-4 py-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(!isOpen)}
        className="h-9 w-9"
      >
        <Menu className="h-5 w-5" />
        <span className="sr-only">Menü öffnen</span>
      </Button>

      <Link href="/dashboard" className="flex items-center">
        {/* Light mode logo */}
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={120}
          height={26}
          className="h-7 w-auto dark:hidden"
          priority
        />
        {/* Dark mode logo */}
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={120}
          height={26}
          className="hidden h-7 w-auto dark:block"
          priority
        />
      </Link>

      {/* Spacer to center logo */}
      <div className="w-9" />
    </header>
  );
}

// Main app shell component
export function AppShell({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { isSwitchingOrg } = useOrganization();

  // Close drawer on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const currentSkeleton = useMemo(() => {
    if (pathname.startsWith('/mitarbeiter')) {
      return <MitarbeiterPageSkeleton />;
    }

    if (pathname.startsWith('/dashboard')) {
      return <DashboardPageSkeleton />;
    }

    return null;
  }, [pathname]);

  return (
    <SidebarContext.Provider value={{ isOpen, setIsOpen }}>
      <div className="flex h-screen flex-col bg-background md:flex-row">
        {/* Mobile header - only on small screens */}
        <MobileHeader />

        {/* Desktop sidebar */}
        <DesktopSidebar />

        {/* Mobile drawer */}
        <MobileDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />

        {/* Main content */}
        <div className="relative flex-1 overflow-hidden">
          <main className="h-full overflow-auto">{children}</main>
          {isSwitchingOrg && currentSkeleton && (
            <div className="absolute inset-0 z-10 overflow-auto bg-background">
              {currentSkeleton}
            </div>
          )}
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
