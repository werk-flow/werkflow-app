// What the device remembers for a problem report until the button is
// pressed: the last pressed controls with the route template they were on,
// and the client errors since load. It stays in this tab's memory only and
// leaves the device only inside a report the person sends; the dialog then
// keeps a control's label only when it is one of the app's own UI strings
// (capture/context.ts). docs/features/problem-reports.md owns the rule.

/** One pressed control: where, and its label as the page showed it. */
type RecordedAction = { routeTemplate: string; label: string | null };

/** One client error: its kind and codes, never its message. */
type RecordedError = {
  name: string;
  code: string | null;
  digest: string | null;
  routeTemplate: string;
};

export type RecordedActivity = {
  routeTemplate: string;
  actions: RecordedAction[];
  errors: RecordedError[];
};

const MAX_ACTIONS = 30;
const MAX_ERRORS = 10;
const MAX_LABEL_LENGTH = 80;
const TOKEN = /^[A-Za-z0-9_.:+-]{1,64}$/;
const CONTROL = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"]';

let currentRouteTemplate = '/';
const actions: RecordedAction[] = [];
const errors: RecordedError[] = [];

function remember<Entry>(list: Entry[], entry: Entry, limit: number): void {
  list.push(entry);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function tokenOrNull(value: unknown): string | null {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

function readProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/** The text a control reads out: its own text without the parts hidden from assistive technology. */
function spokenText(node: Node): string {
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  return [...node.childNodes].map(spokenText).join('');
}

/** The control's accessible name, whitespace collapsed; null when it has none or a long one. */
function controlLabel(control: Element): string | null {
  const label = (control.getAttribute('aria-label') ?? spokenText(control)).replace(/\s+/gu, ' ').trim();
  return label && label.length <= MAX_LABEL_LENGTH ? label : null;
}

function recordPress(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;
  const control = target.closest(CONTROL);
  if (!control) return;
  remember(actions, { routeTemplate: currentRouteTemplate, label: controlLabel(control) }, MAX_ACTIONS);
}

/** Records a thrown value by its name, code and digest only, never its message. */
function recordError(thrown: unknown): void {
  remember(
    errors,
    {
      name: tokenOrNull(readProperty(thrown, 'name')) ?? 'Error',
      code: tokenOrNull(readProperty(thrown, 'code')),
      digest: tokenOrNull(readProperty(thrown, 'digest')),
      routeTemplate: currentRouteTemplate,
    },
    MAX_ERRORS,
  );
}

/** Follows the page the person is on; the app shell calls it on every navigation. */
export function setRecordedRoute(routeTemplate: string): void {
  if (routeTemplate === currentRouteTemplate) return;
  currentRouteTemplate = routeTemplate;
  remember(actions, { routeTemplate, label: null }, MAX_ACTIONS);
}

/** What was remembered up to now, copied, so the dialog's capture stays as it was at the press. */
export function recordedActivity(): RecordedActivity {
  return { routeTemplate: currentRouteTemplate, actions: [...actions], errors: [...errors] };
}

/** Starts remembering presses and errors in this tab; returns the stop. */
export function startRecording(): () => void {
  const onPress = (event: Event): void => recordPress(event.target);
  const onError = (event: ErrorEvent): void => recordError(event.error);
  const onRejection = (event: PromiseRejectionEvent): void => recordError(event.reason);
  document.addEventListener('click', onPress, { capture: true });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    document.removeEventListener('click', onPress, { capture: true });
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/** What the device says about itself, read at the press. */
export type DeviceFacts = {
  userAgent: string;
  viewport: { width: number; height: number };
  online: boolean;
  /** The build of this bundle, or null when the build named none. */
  appVersion: string | null;
};

/** The device's own facts now: read at the press, so reconnecting or the phone keyboard later changes nothing. */
export function readDeviceFacts(): DeviceFacts {
  return {
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    online: navigator.onLine,
    appVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
  };
}
