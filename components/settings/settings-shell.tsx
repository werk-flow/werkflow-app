'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useOrganization } from '@/components/organization/organization-context';
import { AreaNav } from '@/components/shared/area-nav';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Separator } from '@/components/ui/separator';
import {
  DEFAULT_SETTINGS_SECTION_SLUG,
  getSettingsHref,
  getSettingsSectionBySlug,
  getSettingsSectionsByGroup,
} from '@/lib/settings/sections';
import { cn } from '@/lib/utils';

const GROUP_LABELS = {
  account: 'Persönlich',
  organization: 'Organisation',
} as const;

type SettingsShellProps = {
  children: React.ReactNode;
};

export function SettingsShell({ children }: SettingsShellProps) {
  const pathname = usePathname();
  const { activeOrg } = useOrganization();

  const currentSection =
    getSettingsSectionBySlug(pathname.split('/').filter(Boolean)[1] ?? '') ??
    getSettingsSectionBySlug(DEFAULT_SETTINGS_SECTION_SLUG);

  const accountSections = getSettingsSectionsByGroup('account');
  const organizationSections = getSettingsSectionsByGroup('organization');
  const isAdmin = activeOrg?.role === 'admin';
  const isOrganizationSection = currentSection?.scope === 'organization';
  const isReadOnlyForCurrentSection =
    isOrganizationSection && currentSection.adminOnlyWrites && !isAdmin;

  return (
    <PageShell className="bg-background">
      <header className="sticky top-0 z-10 shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              Einstellungen
            </p>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {currentSection?.label ?? 'Einstellungen'}
                </h1>
                <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
                  {currentSection?.description}
                </p>
              </div>

              {currentSection ? (
                <div className="text-sm text-muted-foreground lg:text-right">
                  <p>
                    {currentSection.scope === 'user'
                      ? 'Persönliche Einstellungen'
                      : `Gilt für ${activeOrg?.name ?? 'die aktive Organisation'}`}
                  </p>
                  {isReadOnlyForCurrentSection ? (
                    <p className="text-amber-600 dark:text-amber-400">
                      Du kannst diesen Bereich einsehen, aber nur Admins können ihn später bearbeiten.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {/* Phones: the section list is route navigation, so it is an AreaNav
              strip that scrolls within itself, not a select (thirteen sections
              exceed the raw-Select cap and a select hides the current place). */}
          <div className="md:hidden">
            <AreaNav
              ariaLabel="Einstellungsbereiche"
              items={[...accountSections, ...organizationSections].map((section) => ({
                href: getSettingsHref(section.slug),
                label: section.label,
              }))}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="hidden w-72 shrink-0 border-r bg-card/40 md:block">
          <div className="h-full overflow-y-auto p-4">
            <SettingsNavGroup
              label={GROUP_LABELS.account}
              currentSlug={currentSection?.slug ?? DEFAULT_SETTINGS_SECTION_SLUG}
              slugs={accountSections.map((section) => section.slug)}
            />
            <Separator className="my-4" />
            <SettingsNavGroup
              label={GROUP_LABELS.organization}
              currentSlug={currentSection?.slug ?? DEFAULT_SETTINGS_SECTION_SLUG}
              slugs={organizationSections.map((section) => section.slug)}
            />
          </div>
        </aside>

        <PageBody>
          <div className="mx-auto w-full max-w-5xl">
            {children}
          </div>
        </PageBody>
      </div>
    </PageShell>
  );
}

function SettingsNavGroup({
  label,
  currentSlug,
  slugs,
}: {
  label: string;
  currentSlug: string;
  slugs: string[];
}) {
  return (
    <div className="space-y-2">
      <p className="px-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <nav className="space-y-1">
        {slugs.map((slug) => {
          const section = getSettingsSectionBySlug(slug);

          if (!section) {
            return null;
          }

          const Icon = section.icon;
          const isActive = currentSlug === slug;

          return (
            <Link
              key={section.slug}
              href={getSettingsHref(section.slug)}
              className={cn(
                'flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">{section.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {section.shortDescription}
                </p>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
