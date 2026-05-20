import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  Building2,
  Calendar,
  Clock,
  CreditCard,
  LayoutDashboard,
  Shield,
  User,
  Users,
} from 'lucide-react';

export type SettingsSectionGroup = 'account' | 'organization';
export type SettingsSectionScope = 'user' | 'organization';

export type SettingsSection = {
  slug: string;
  label: string;
  shortDescription: string;
  description: string;
  icon: LucideIcon;
  group: SettingsSectionGroup;
  scope: SettingsSectionScope;
  adminOnlyWrites?: boolean;
  implemented: boolean;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
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
    slug: 'abonnement-abrechnung',
    label: 'Abonnement & Abrechnung',
    shortDescription: 'Plan und Abrechnung',
    description: 'Vertrags-, Rechnungs- und Abonnementinformationen für die Organisation.',
    icon: CreditCard,
    group: 'account',
    scope: 'organization',
    adminOnlyWrites: true,
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
    implemented: true,
  },
  {
    slug: 'auftraege-projekte',
    label: 'Aufträge & Projekte',
    shortDescription: 'Persönliche Tabellenansicht',
    description: 'Steuert, welche Spalten du in der Aufträge-Ansicht innerhalb der aktiven Organisation sehen möchtest.',
    icon: Briefcase,
    group: 'organization',
    scope: 'organization',
    implemented: true,
  },
  {
    slug: 'mitarbeiter',
    label: 'Mitarbeiter',
    shortDescription: 'Mitarbeiterbezogene Regeln',
    description: 'Steuert Berechtigungen, Prozesse und Standards rund um Teammitglieder.',
    icon: Users,
    group: 'organization',
    scope: 'organization',
    adminOnlyWrites: true,
    implemented: false,
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
    implemented: false,
  },
];

export const DEFAULT_SETTINGS_SECTION_SLUG = 'profil';

export function getSettingsHref(slug: string) {
  return `/einstellungen/${slug}`;
}

export function getSettingsSectionBySlug(slug: string) {
  return SETTINGS_SECTIONS.find((section) => section.slug === slug) ?? null;
}

export function getSettingsSectionsByGroup(group: SettingsSectionGroup) {
  return SETTINGS_SECTIONS.filter((section) => section.group === group);
}
