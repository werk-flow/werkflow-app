import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// Component contract: these views retain server props, so each must refresh
// when a scheduled co-holder access step takes effect without a row write.
for (const view of ['mitarbeiter-tabs', 'mitarbeiter-detail-content']) {
  test(`${view} passes the nullable ISO deadline to the shared refresh hook`, () => {
    const source = readFileSync(resolve(import.meta.dir, `../../components/mitarbeiter/${view}.tsx`), 'utf8');
    expect(source).toContain("import { useDeadlineRefresh } from '@/hooks/use-business-day-refresh'");
    expect(source).toContain('const router = useRouter()');
    expect(source).toContain('useDeadlineRefresh(deadlineMs, () => router.refresh())');
    const deadlineExpression = source.match(/const deadlineMs = ([^;]+);/)?.[1];
    expect(deadlineExpression).toBeDefined();
    if (!deadlineExpression) throw new Error('Missing deadline value passed to useDeadlineRefresh');
    const deadlines: unknown[] = [];
    let refreshes = 0;
    for (const nextHolderAccessChangeAt of ['2026-08-10T12:00:00.000Z', null]) {
      runInNewContext(
        `const deadlineMs = ${deadlineExpression}; useDeadlineRefresh(deadlineMs, () => router.refresh());`,
        {
          nextHolderAccessChangeAt,
          router: {
            refresh: () => {
              refreshes++;
            },
          },
          useDeadlineRefresh: (deadline: unknown, refresh: () => void) => {
            deadlines.push(deadline);
            refresh();
          },
        },
      );
    }
    expect(deadlines).toEqual([Date.parse('2026-08-10T12:00:00.000Z'), null]);
    expect(refreshes).toBe(2);
    expect(source).toContain(
      view === 'mitarbeiter-tabs'
        ? 'nextHolderAccessChangeAt,'
        : 'const nextHolderAccessChangeAt = responsibilitySettings?.nextHolderAccessChangeAt ?? null',
    );
  });
}
