// An employee's settings render no manager section, so no read their role is
// refused can fail there: the Mitarbeiter page skips the onboarding templates,
// and a manager-only section sends the employee to their profile. The file
// spawns itself: module mocks stay in the child.
import assert from 'node:assert/strict';
import { expect, mock, test } from 'bun:test';
import { Children, isValidElement, type ReactNode } from 'react';

const FIXTURE_FLAG = 'SETTINGS_SECTION_ACCESS_FIXTURE';

class RedirectProbe extends Error {
  constructor(readonly target: string) {
    super(`redirect ${target}`);
  }
}

async function runFixture(): Promise<void> {
  let role: 'admin' | 'buero' | 'employee' = 'employee';
  let templateReads = 0;
  mock.module('server-only', () => ({}));
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
  const navigation = await import('next/navigation');
  mock.module('next/navigation', () => ({
    ...navigation,
    redirect: (target: string) => {
      throw new RedirectProbe(target);
    },
  }));
  mock.module('@/lib/data/cached', () => ({
    getAuthenticatedUser: async () => ({ id: 'user' }),
    getCachedMemberships: async () => [
      { orgId: 'organization', name: 'Organisation', uniqueCode: 'ABC123', role, joinedAt: '2026-01-01' },
    ],
  }));
  mock.module('@/lib/responsibilities/server', () => ({
    getResponsibilitySettingsData: async () => ({ success: true, data: { currentUserRole: role } }),
  }));
  mock.module('@/lib/personnel/onboarding-actions', () => ({
    getPersonnelOnboardingTemplates: async () => {
      templateReads += 1;
      return role === 'employee' ? { success: false, error: 'not_authorized' } : { success: true, data: [] };
    },
  }));
  mock.module('@/components/settings/personnel-onboarding-template-settings', () => ({
    PersonnelOnboardingTemplateSettings: function OnboardingTemplates() {
      return null;
    },
  }));
  mock.module('@/components/settings/responsibility-settings', () => ({
    ResponsibilitySettings: function Responsibilities() {
      return null;
    },
  }));
  const { readSettingsSectionMembership } = await import('./section-access');
  const { default: EmployeesSettingsPage } = await import('@/app/(app)/einstellungen/mitarbeiter/page');

  const renderedBlocks = async (): Promise<string[]> => {
    const page = await EmployeesSettingsPage();
    if (!isValidElement<{ children?: ReactNode }>(page)) return [];
    return Children.toArray(page.props.children).flatMap((child) =>
      isValidElement(child) && typeof child.type === 'function' ? [child.type.name] : [],
    );
  };
  const redirectOf = async (read: () => Promise<unknown>): Promise<string | null> => {
    try {
      await read();
      return null;
    } catch (error) {
      if (error instanceof RedirectProbe) return error.target;
      throw error;
    }
  };

  // The employee's Mitarbeiter section shows their responsibilities only and
  // never asks for the templates.
  assert.deepEqual(await renderedBlocks(), ['Responsibilities']);
  assert.equal(templateReads, 0);

  // A manager-only section sends the employee to the default section.
  for (const slug of ['organisation', 'zeiterfassung', 'abonnement-abrechnung', 'kunden'] as const) {
    assert.equal(await redirectOf(() => readSettingsSectionMembership(slug)), '/einstellungen/profil', slug);
  }
  assert.equal(await redirectOf(() => readSettingsSectionMembership('auftraege-projekte')), null);

  // Büro manages people: the templates render above the responsibilities.
  role = 'buero';
  assert.deepEqual(await renderedBlocks(), ['OnboardingTemplates', 'Responsibilities']);
  assert.equal(templateReads, 1);
  assert.equal(await redirectOf(() => readSettingsSectionMembership('organisation')), null);
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('an employee settings page renders no manager section and asks for no read the role is refused', async () => {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, [FIXTURE_FLAG]: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  });
}
