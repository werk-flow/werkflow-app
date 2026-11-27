// The sending address of the server's mail (lib/delivery/send-email.ts), in
// one place, so a delivery stores the From its every attempt sends
// (lib/delivery/mail-content.ts, `senderHeader`). Pure: no server module.

/** What a local or CI process sends from; its mail stays in the in-memory outbox. */
const LOCAL_SENDER = 'WerkFlow <noreply@werkflow.test>';

/**
 * The sending address of a message without its own From: `FROM_EMAIL`, else
 * the local stand-in outside a hosted deployment; empty when a hosted
 * deployment (`VERCEL_ENV`) has none.
 */
export function configuredSender(environment: Readonly<Record<string, string | undefined>>): string {
  return environment.FROM_EMAIL?.trim() || (environment.VERCEL_ENV ? '' : LOCAL_SENDER);
}
