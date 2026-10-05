import {
  LayoutDashboard,
  Users,
  Calendar,
  Clock,
  Building2,
  Briefcase,
  FileText,
  Boxes,
  Inbox,
  ListTodo,
  Award,
  ClipboardList,
  Wrench,
} from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** If true, only admins and managers can see this item */
  managerOrAbove?: boolean;
  /** The route section this item stays active in when it is wider than `href`. */
  activePrefix?: string;
};

export const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
  },
  {
    href: '/aufgaben',
    label: 'Aufgaben',
    icon: ListTodo,
  },
  {
    href: '/kalender',
    label: 'Kalender',
    icon: Calendar,
  },
  {
    href: '/zeiterfassung',
    label: 'Zeiterfassung',
    icon: Clock,
  },
  {
    href: '/qualifikationen',
    label: 'Qualifikationen',
    icon: Award,
  },
  {
    href: '/anfragen',
    label: 'Anfragen',
    icon: Inbox,
    managerOrAbove: true,
  },
  {
    href: '/auftraege',
    label: 'Aufträge',
    icon: Briefcase,
  },
  {
    href: '/dokumente',
    label: 'Dokumente',
    icon: FileText,
    managerOrAbove: true,
  },
  {
    href: '/inventar',
    label: 'Inventar',
    icon: Boxes,
    managerOrAbove: true,
  },
  {
    href: '/service/faelle',
    activePrefix: '/service',
    label: 'Service',
    icon: Wrench,
    managerOrAbove: true,
  },
  {
    href: '/arbeitsvorlagen',
    label: 'Arbeitsvorlagen',
    icon: ClipboardList,
    managerOrAbove: true,
  },
  {
    href: '/mitarbeiter',
    label: 'Mitarbeiter',
    icon: Users,
    managerOrAbove: true,
  },
  {
    href: '/kunden',
    label: 'Kunden',
    icon: Building2,
    managerOrAbove: true,
  },
];

/** Whether the item is the highlighted sidebar entry for `pathname`. */
export function isNavItemActive(item: Pick<NavItem, 'href' | 'activePrefix'>, pathname: string): boolean {
  const section = item.activePrefix ?? item.href;
  return pathname === section || pathname.startsWith(section + '/');
}
