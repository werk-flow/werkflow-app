import type { LucideIcon } from 'lucide-react';

import { isManagerRole, type OrgRole } from '@/lib/roles';
import {
  Archive,
  Briefcase,
  Building2,
  Calendar,
  Clock,
  CreditCard,
  FileText,
  LayoutDashboard,
  Shield,
  User,
  Users,
} from 'lucide-react';

export type SettingsSectionGroup = 'account' | 'organization';
type SettingsSectionScope = 'user' | 'organization';

export type SettingsSectionSlug =
  | 'profil'
  | 'konto-sicherheit'
  | 'auftraege-projekte'
  | 'abonnement-abrechnung'
  | 'dashboard'
  | 'organisation'
  | 'dokumente'
  | 'kalender'
  | 'zeiterfassung'
  | 'mitarbeiter'
  | 'kunden'
  | 'datenexport';

export type SettingsSection = {
  slug: SettingsSectionSlug;
  label: string;
  shortDescription: string;
  description: string;
  icon: LucideIcon;
  group: SettingsSectionGroup;
  scope: SettingsSectionScope;
  adminOnlyWrites?: boolean;
  /**
   * Organization settings only Admin and Büro see. An employee's settings hold
   * their own profile, account, Aufträge columns and responsibilities; the
   * nav hides the rest and its pages send an employee to the default section.
   */
  managersOnly?: boolean;
  /** Sections only Admin sees: Büro and employees neither see them nor open their pages. */
  adminOnly?: boolean;
  implemented: boolean;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    slug: 'profil',
    label: 'Profil',
    shortDescription: 'Name und Profilbild',
    description: 'Persönliche Angaben, die appweit als Anzeigename verwendet werden.',
    icon: User,
    group: 'account',
    scope: 'user',
    implemented: true,
  },
  {
    slug: 'konto-sicherheit',
    label: 'Konto & Sicherheit',
    shortDescription: 'E-Mail und Passwort',
    description: 'Kontobezogene Informationen sowie sicherheitsrelevante Einstellungen.',
    icon: Shield,
    group: 'account',
    scope: 'user',
    implemented: true,
  },
  {
    slug: 'auftraege-projekte',
    label: 'Aufträge & Projekte',
    shortDescription: 'Persönliche Tabellenansicht',
    description:
      'Steuert, welche Spalten du in der Aufträge-Ansicht innerhalb der aktiven Organisation sehen möchtest.',
    icon: Briefcase,
    group: 'account',
    scope: 'user',
    implemented: true,
  },
  {
    slug: 'abonnement-abrechnung',
    label: 'Abonnement & Abrechnung',
    shortDescription: 'Plan und Abrechnung',
    description: 'Vertrags-, Rechnungs- und Abonnementinformationen für die Organisation.',
    icon: CreditCard,
    group: 'account',
    scope: 'organization',
    adminOnlyWrites: true,
    managersOnly: true,
    implemented: false,
  },
  {
    slug: 'dashboard',
    label: 'Dashboard',
    shortDescription: 'Startansicht und Widgets',
    description: 'Steuert, welche Informationen auf der Startseite priorisiert angezeigt werden.',
    icon: LayoutDashboard,
    group: 'organization',
    scope: 'organization',
    adminOnlyWrites: true,
    managersOnly: true,
    implemented: false,
  },
  {
    slug: 'organisation',
    label: 'Organisation',
    shortDescription: 'Allgemeine Organisationsdaten',
    description: 'Organisationweite Grundeinstellungen und Standardwerte.',
    icon: Building2,
    group: 'organization',
    scope: 'organization',
    adminOnlyWrites: true,
    managersOnly: true,
    implemented: true,
  },
  {
    slug: 'dokumente',
    label: 'Dokumente & Briefpapier',
    shortDescription: 'Angebote als PDF',
    description: 'Zeigt am Musterangebot, wie deine Angebote als PDF bei deinen Kunden ankommen.',
    icon: FileText,
    group: 'organization',
    scope: 'organization',
    managersOnly: true,
    implemented: true,
  },
  {
    slug: 'kalender',
    label: 'Kalender',
    shortDescription: 'Kalenderansichten und Regeln',
    description: 'Legt fest, wie Termine, Einsätze und Planungsansichten funktionieren.',
    icon: Calendar,
    group: 'organization',
    scope: 'organization',
    adminOnlyWrites: true,
    managersOnly: true,
    implemented: false,
  },
  {
    slug: 'zeiterfassung',
    label: 'Zeiterfassung',
    shortDescription: 'Arbeitszeiten und Freigaben',
    description: 'Definiert Regeln für Zeitbuchungen, Pausen und Freigabeprozesse.',
    icon: Clock,
    group: 'organization',
    scope: 'organization',
    adminOnlyWrites: true,
    managersOnly: true,
    implemented: true,
  },
  {
    slug: 'mitarbeiter',
    label: 'Mitarbeiter',
    shortDescription: 'Freigaben und Vertretungen',
    description: 'Zeigt, wer Freigaben verantwortet und wer diese Verantwortung zeitlich begrenzt vertritt.',
    icon: Users,
    group: 'organization',
    scope: 'organization',
    adminOnlyWrites: true,
    implemented: true,
  },
  {
    slug: 'kunden',
    label: 'Kunden',
    shortDescription: 'Kundenverwaltung und Defaults',
    description: 'Umschließt Einstellungen für Kundenstammdaten und Kundenprozesse.',
    icon: Building2,
    group: 'organization',
    scope: 'organization',
    adminOnlyWrites: true,
    managersOnly: true,
    implemented: false,
  },
  {
    slug: 'datenexport',
    label: 'Datenexport',
    shortDescription: 'Alle Daten herunterladen',
    description:
      'Lädt jeden Datensatz und jede Originaldatei der Organisation herunter, für einen Wechsel, eine Prüfung oder dein eigenes Archiv.',
    icon: Archive,
    group: 'organization',
    scope: 'organization',
    adminOnly: true,
    implemented: true,
  },
];

export const DEFAULT_SETTINGS_SECTION_SLUG: SettingsSectionSlug = 'profil';

export function getSettingsHref(slug: SettingsSectionSlug): string {
  return `/einstellungen/${slug}`;
}

export function getSettingsSectionBySlug(slug: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((section) => section.slug === slug) ?? null;
}

/** Whether a member with this role sees the section in the nav and may open its page. */
export function isSettingsSectionOpenTo(section: SettingsSection, role: OrgRole): boolean {
  if (section.adminOnly) return role === 'admin';
  return !section.managersOnly || isManagerRole(role);
}

/** The sections of a nav group that a member with this role sees, in nav order. */
export function getSettingsSectionsByGroup(group: SettingsSectionGroup, role: OrgRole): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(
    (section) => section.group === group && isSettingsSectionOpenTo(section, role),
  );
}
