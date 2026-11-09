import { expect, test } from 'bun:test';
import { submitProblemReportInputSchema } from '@/lib/problem-reports/schemas';
import { buildProblemReportContext } from './context';
import type { DeviceFacts } from './recorder';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1';

const device: DeviceFacts = {
  userAgent: ANDROID_CHROME,
  viewport: { width: 412.4, height: 915 },
  online: true,
  appVersion: 'a1b2c3d4e5f6',
};
const activity = {
  routeTemplate: '/kunden/[clientId]',
  actions: [
    { routeTemplate: '/kunden', label: 'Musterbau Nord GmbH' },
    { routeTemplate: '/kunden/[clientId]', label: 'Speichern' },
    { routeTemplate: '/kunden/[clientId]', label: null },
  ],
  errors: [{ name: 'TypeError', code: null, digest: '4711', routeTemplate: '/kunden/[clientId]' }],
};

test("a control label stays only when it is one of the app's own UI strings", () => {
  const context = buildProblemReportContext(activity, new Set(['Speichern']), device);
  expect(context.recentActions.map((action) => action.controlLabel)).toEqual([null, 'Speichern', null]);
});

test('the context names device families, the build and the offline state, and passes the action schema', () => {
  const context = buildProblemReportContext(activity, new Set(), { ...device, online: false });
  expect(context.device).toEqual({
    platform: 'android',
    browser: 'chrome',
    viewport: { width: 412, height: 915 },
  });
  expect(context.offline).toBe(true);
  expect(context.appVersion).toBe('a1b2c3d4e5f6');
  const parsed = submitProblemReportInputSchema.safeParse({
    organizationId: '33100000-0000-4000-8000-000000000001',
    description: 'Die Liste bleibt leer.',
    context,
  });
  expect(parsed.success).toBe(true);
});

test('an iPhone reads as iOS Safari, and a build without a version reads as unknown', () => {
  const context = buildProblemReportContext(activity, new Set(), {
    ...device,
    userAgent: IPHONE_SAFARI,
    appVersion: null,
  });
  expect(context.device.platform).toBe('ios');
  expect(context.device.browser).toBe('safari');
  expect(context.appVersion).toBe('unbekannt');
});
