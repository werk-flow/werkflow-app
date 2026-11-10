// A membership refresh that finds the active organization gone falls back to
// the next one, and nothing the former organization's day held stays on the
// device (decision record 0010, "Device data"). The fallback never writes
// its cookie over an organization the person chose meanwhile. The provider
// renders once on the server renderer; the test then calls the refresh and
// the switch from its context. The file spawns itself: module mocks stay in
// the child.
import 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import { expect, mock, test } from 'bun:test';

const FIXTURE_FLAG = 'ORGANIZATION_MEMBERSHIP_FALLBACK_FIXTURE';

const USER = '9a000000-0000-4000-8000-000000000001';
const FORMER = '9a000000-0000-4000-8000-0000000000a1';
const REMAINING = '9a000000-0000-4000-8000-0000000000b1';
const CHOSEN = '9a000000-0000-4000-8000-0000000000c1';
const MORNING = new Date('2026-11-09T06:42:00.000Z');

async function runFixture(): Promise<void> {
  const { TODAY_HOLDER_KEY, TODAY_WIPE_KEY } = await import('@/lib/field-sync/device/today-wipe');

  /** localStorage, whose wipe signal can run a person's click while the wipe is under way. */
  let duringWipe: (() => void) | null = null;
  class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();
    get length(): number {
      return this.values.size;
    }
    clear(): void {
      this.values.clear();
    }
    getItem(key: string): string | null {
      return this.values.get(key) ?? null;
    }
    key(index: number): string | null {
      return [...this.values.keys()][index] ?? null;
    }
    removeItem(key: string): void {
      this.values.delete(key);
    }
    setItem(key: string, value: string): void {
      this.values.set(key, value);
      const click = key === TODAY_WIPE_KEY ? duringWipe : null;
      duringWipe = null;
      click?.();
    }
  }
  globalThis.localStorage = new MemoryStorage();

  let membershipRows: unknown[] = [];
  const cookieWrites: string[] = [];
  mock.module('@/lib/supabase/client', () => ({
    createSupabaseBrowserClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: USER } } }, error: null }) },
      from: () => ({ select: () => ({ eq: async () => ({ data: membershipRows, error: null }) }) }),
    }),
  }));
  mock.module('@/lib/org/actions', () => ({
    setActiveOrgCookie: async (orgId: string) => {
      cookieWrites.push(orgId);
      return { success: true };
    },
  }));

  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime');
  const { BannerProvider } = await import('@/components/ui/banner');
  const { OrganizationProvider, useOrganization } = await import(
    '@/components/organization/organization-context'
  );
  const { readTodayOnDevice, saveTodayOnDevice } = await import('@/lib/field-sync/device/today-store');

  type OrgContextValue = ReturnType<typeof useOrganization>;

  function membership(orgId: string) {
    return {
      organization_id: orgId,
      role: 'employee' as const,
      joined_at: '2026-01-05T08:00:00.000Z',
      organizations: { name: `Musterbetrieb ${orgId.slice(-2)}`, unique_code: `MB${orgId.slice(-2)}` },
    };
  }

  /** The provider of a person whose active organization is FORMER, with the former day on the device. */
  async function providerOfFormerOrganization(): Promise<OrgContextValue> {
    localStorage.clear();
    // The former organization's start page claimed the device, so its day would show.
    localStorage.setItem(TODAY_HOLDER_KEY, `${USER}:${FORMER}`);
    cookieWrites.length = 0;
    await saveTodayOnDevice(
      {
        version: 'v1',
        berlinDate: '2026-11-09',
        validUntil: '2026-11-09T23:00:00.000Z',
        userId: USER,
        organizationId: FORMER,
        assignments: [],
      },
      MORNING,
    );
    const captured: { value: OrgContextValue | null } = { value: null };
    function Capture({ onRender }: { onRender: (value: OrgContextValue) => void }): null {
      onRender(useOrganization());
      return null;
    }
    const inertRouter = {
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => undefined,
      bfcacheId: '_b_0_',
    };
    renderToStaticMarkup(
      <AppRouterContext.Provider value={inertRouter}>
        <BannerProvider>
          <OrganizationProvider
            initialMemberships={[
              {
                orgId: FORMER,
                name: 'Musterbetrieb a1',
                uniqueCode: 'MBa1',
                role: 'employee',
                joinedAt: '2026-01-05T08:00:00.000Z',
              },
            ]}
            initialActiveOrgId={FORMER}
            initialActiveOrgCookieNeedsSync={false}
          >
            <Capture
              onRender={(value) => {
                captured.value = value;
              }}
            />
          </OrganizationProvider>
        </BannerProvider>
      </AppRouterContext.Provider>,
    );
    assert.ok(await readTodayOnDevice(MORNING), 'the former organization’s day shows before the refresh');
    assert.ok(captured.value, 'the provider rendered its context');
    return captured.value;
  }

  // The fallback wipes the former day and then writes the remaining organization's cookie.
  let organization = await providerOfFormerOrganization();
  membershipRows = [membership(REMAINING)];
  await organization.refreshMemberships();
  assert.equal(await readTodayOnDevice(MORNING), null, 'the former organization’s day is gone');
  assert.deepEqual(cookieWrites, [REMAINING]);

  // The last membership is gone: no cookie to write, and still no day of the former organization.
  organization = await providerOfFormerOrganization();
  membershipRows = [];
  await organization.refreshMemberships();
  assert.equal(
    await readTodayOnDevice(MORNING),
    null,
    'a person without any organization keeps no day of the former one',
  );
  assert.deepEqual(cookieWrites, []);

  // The person chooses an organization while the fallback wipes: only that choice reaches the cookie.
  organization = await providerOfFormerOrganization();
  membershipRows = [membership(REMAINING), membership(CHOSEN)];
  const chosen = organization;
  let switching: Promise<void> | null = null;
  duringWipe = () => {
    switching = chosen.setActiveOrg(CHOSEN);
  };
  await organization.refreshMemberships();
  assert.ok(switching, 'the choice was made while the fallback wiped');
  await switching;
  assert.deepEqual(cookieWrites, [CHOSEN], 'the stale fallback wrote no cookie over the newer choice');
}

if (process.env[FIXTURE_FLAG] === '1') {
  await runFixture();
} else {
  test('a lost membership leaves no day of the former organization, and a stale fallback never overrides a newer choice', async () => {
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
