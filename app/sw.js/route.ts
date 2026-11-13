// The service worker at the root scope. next.config.ts composed its script at
// build time (lib/offline/service-worker-script.ts), with the build's shell
// version in front. The route reads no request, cookie or session and sets
// no cookie; proxy.ts does not run here. `no-cache` makes every update check
// ask the server, so a phone sees a new build's worker on its next check.

const SCRIPT = process.env.WERKFLOW_SERVICE_WORKER;

export function GET(): Response {
  if (!SCRIPT) throw new Error('The build did not compose the service worker script (next.config.ts).');
  return new Response(SCRIPT, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
