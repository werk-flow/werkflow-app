import type { ScrubbedProblemReportContext } from '@/lib/problem-reports/schemas';

// The device capture of a report, on its page and with its original.

/** A token the scrubber removed because it may name a record. */
const REMOVED = 'bei der Bereinigung entfernt';

const DEVICE_LABELS: Record<string, string> = {
  ios: 'iPhone oder iPad',
  android: 'Android',
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  andere: 'anderes Gerät',
};
const BROWSER_LABELS: Record<string, string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  edge: 'Edge',
  samsung: 'Samsung Internet',
  andere: 'anderer Browser',
};

/**
 * What the reporter's device captured: the original capture, or the scrubbed
 * one, where the app version and an error's name may be removed.
 */
export function ReportContext({ context }: { context: ScrubbedProblemReportContext | null }) {
  if (!context)
    return (
      <p className="text-sm text-muted-foreground">
        Telefonisch aufgenommen: Zu dieser Meldung gibt es keine Angaben vom Gerät.
      </p>
    );
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Seite</dt>
      <dd className="break-words font-mono">{context.routeTemplate}</dd>
      <dt className="text-muted-foreground">Gerät</dt>
      <dd>
        {DEVICE_LABELS[context.device.platform]}, {BROWSER_LABELS[context.device.browser]},{' '}
        {context.device.viewport.width} × {context.device.viewport.height}
      </dd>
      <dt className="text-muted-foreground">App-Version</dt>
      <dd className={context.appVersion === null ? 'text-muted-foreground' : 'break-words font-mono'}>
        {context.appVersion ?? REMOVED}
      </dd>
      <dt className="text-muted-foreground">Verbindung</dt>
      <dd>{context.offline ? 'offline' : 'online'}</dd>
      <dt className="text-muted-foreground">Letzte Schritte</dt>
      <dd>
        {context.recentActions.length === 0 ? (
          'keine aufgezeichnet'
        ) : (
          <ol className="list-decimal space-y-0.5 pl-5">
            {context.recentActions.map((action, index) => (
              <li key={index} className="break-words">
                {action.controlLabel ? `„${action.controlLabel}“ auf ` : ''}
                <span className="font-mono">{action.routeTemplate}</span>
              </li>
            ))}
          </ol>
        )}
      </dd>
      <dt className="text-muted-foreground">Fehler</dt>
      <dd>
        {context.clientErrors.length === 0 ? (
          'keine aufgezeichnet'
        ) : (
          <ul className="space-y-0.5">
            {context.clientErrors.map((clientError, index) => (
              <li key={index} className="break-words font-mono">
                {[clientError.name, clientError.code, clientError.digest].filter(Boolean).join(' · ') ||
                  REMOVED}{' '}
                auf {clientError.routeTemplate}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </dl>
  );
}
