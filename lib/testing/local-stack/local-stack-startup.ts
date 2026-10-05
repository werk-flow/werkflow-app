import { setTimeout as delay } from 'node:timers/promises';
import { runSessionCommand } from './local-stack-lease';

/** Docker auto-restarts these containers before their services can answer requests. */
export async function waitForLocalStackHealth(signal: AbortSignal): Promise<void> {
  const startupSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let lastStates = 'not inspected';
  try {
    while (true) {
      startupSignal.throwIfAborted();
      let output = '';
      const code = await runSessionCommand(
        [
          'wsl.exe',
          '--exec',
          'docker',
          'inspect',
          '--format',
          '{{if not .State.Running}}{{.State.Status}}{{else if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
          'supabase_db_werkflow-app',
          'supabase_auth_werkflow-app',
          'supabase_kong_werkflow-app',
        ],
        {
          signal: startupSignal,
          onStdout: (chunk) => {
            output += chunk.toString();
          },
          onStderr: () => {},
        },
      );
      if (code !== 0)
        throw new Error(
          'Cannot inspect the local database, Auth and gateway. Start the configured Supabase stack before preparing the app server.',
        );
      const states = output.trim().split(/\r?\n/);
      lastStates = states.join(', ');
      if (states.length === 3 && states.every((state) => state === 'healthy')) return;
      if (
        states.length !== 3 ||
        states.some((state) => !['healthy', 'starting', 'unhealthy', 'restarting'].includes(state))
      ) {
        throw new Error(
          `Local services cannot finish startup: ${lastStates}. Inspect the containers before retrying.`,
        );
      }
      await delay(2_000, undefined, { signal: startupSignal });
    }
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    if (startupSignal.aborted)
      throw new Error(`Local services did not become healthy within 120 seconds: ${lastStates}.`, {
        cause: error,
      });
    throw error;
  }
}
