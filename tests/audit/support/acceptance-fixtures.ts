import type { BrowserContext, Page } from '@playwright/test';
import { createRolePage } from '../../golden/support/sessions';
import type { CaptureSpec } from './acceptance-rounds';
import { test as auditTest } from './fixtures';

/**
 * The audit test with `rolePage`. A capture names its role in data, so its
 * test asks for the session by role instead of naming one page fixture per
 * role. The fixture owns the session and closes it in its teardown, as the
 * page fixtures do.
 */
export const test = auditTest.extend<{ rolePage: (role: CaptureSpec['role']) => Promise<Page> }>({
  rolePage: async ({ browser, baseURL, world }, provide) => {
    const sessions: BrowserContext[] = [];
    await provide(async (role) => {
      const { context, page } = await createRolePage({ browser, baseUrl: baseURL, world, role });
      sessions.push(context);
      return page;
    });
    for (const session of sessions) await session.close();
  },
});
