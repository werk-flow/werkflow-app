import { isUiString, type UiStringCatalog } from '@/lib/problem-reports/screenshot/ui-string-catalog';
import type { ProblemReportContext } from '@/lib/problem-reports/schemas';
import type { RecordedActivity } from './recorder';

// The context a report carries, built at the press from what the recorder
// remembered and what the device says about itself. A control's label stays
// only when the whole label is one of the app's own UI strings; any other
// label, such as a customer's name on a row link, becomes null.

/** What the device says about itself at the press. */
export type DeviceFacts = {
  userAgent: string;
  viewport: { width: number; height: number };
  online: boolean;
  /** The build of this bundle, or null when the build named none. */
  appVersion: string | null;
};

type Device = ProblemReportContext['device'];

/** The platform family named by a user agent; never the model or the version. */
function platformOf(userAgent: string): Device['platform'] {
  if (/iPhone|iPad|iPod/u.test(userAgent)) return 'ios';
  if (/Android/u.test(userAgent)) return 'android';
  if (/Windows/u.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/u.test(userAgent)) return 'macos';
  if (/Linux|CrOS/u.test(userAgent)) return 'linux';
  return 'andere';
}

/** The browser family named by a user agent; the order matters, since most name Safari too. */
function browserOf(userAgent: string): Device['browser'] {
  if (/SamsungBrowser/u.test(userAgent)) return 'samsung';
  if (/Edg(?:e|A|iOS)?\//u.test(userAgent)) return 'edge';
  if (/Firefox|FxiOS/u.test(userAgent)) return 'firefox';
  if (/Chrome|CriOS|Chromium/u.test(userAgent)) return 'chrome';
  if (/Safari/u.test(userAgent)) return 'safari';
  return 'andere';
}

const VERSION = /^[A-Za-z0-9_.:+-]{1,64}$/;

/** The context of a report from the recorded activity, with labels kept only from the catalog. */
export function buildProblemReportContext(
  activity: RecordedActivity,
  catalog: UiStringCatalog,
  device: DeviceFacts,
): ProblemReportContext {
  return {
    routeTemplate: activity.routeTemplate,
    recentActions: activity.actions.map((action) => ({
      routeTemplate: action.routeTemplate,
      controlLabel: action.label !== null && isUiString(catalog, action.label) ? action.label : null,
    })),
    clientErrors: activity.errors,
    appVersion:
      device.appVersion !== null && VERSION.test(device.appVersion) ? device.appVersion : 'unbekannt',
    device: {
      platform: platformOf(device.userAgent),
      browser: browserOf(device.userAgent),
      viewport: {
        width: Math.min(Math.max(Math.round(device.viewport.width), 1), 20_000),
        height: Math.min(Math.max(Math.round(device.viewport.height), 1), 20_000),
      },
    },
    offline: !device.online,
  };
}
