// One machine's configuration for the machine runner (lib/testing/ci/machine-runner.ts): a file
// outside the repository, as ci/machines/*.example.json show.
import { z } from 'zod';
import { slotConfigSchema } from './container-slot';

const absolute = z.string().startsWith('/');

/** One machine's configuration: a file outside the repository (ci/machines/*.example.json). */
export const machineConfigSchema = z.strictObject({
  /** The machine's id in its leases: lowercase letters, digits and hyphens. */
  machine: z.string().regex(/^[a-z0-9-]{1,20}$/),
  /** `owner/name` on GitHub. */
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  /** The pinned, reviewed clone the runner runs from; never a PR under test. */
  trustedCheckout: absolute,
  /** The runner's own state: its generation, attempts, run, recorded durations. Outside every slot. */
  stateDir: absolute,
  /** The machine's window file (windows.ts). */
  windowsFile: absolute,
  /** The CI App's private key, PEM, mode 600: one file on the runner's side, never in the slot. */
  appKeyFile: absolute,
  slot: slotConfigSchema,
  /** Addresses the slot's jobs must not reach, `host:port`: the start probe tries each. */
  probePorts: z.array(z.string().regex(/^[\w.-]+:[0-9]{1,5}$/)),
  /**
   * Resets the slot between runs and at start, on this trusted side: the PC's runs ci/slot/reset-rootless.sh
   * as root in werkflow-ci, the Mac's ci/slot/reset-colima.sh, which recreates the `ci` profile.
   */
  reset: z.array(z.string().min(1)).min(1),
  /** The machine's sizes the window file names, each with the command that resizes the slot, or null. */
  sizes: z.record(
    z.string().min(1),
    z.strictObject({ resize: z.array(z.string().min(1)).min(1).nullable() }),
  ),
  /** Seconds a run of each kind takes here, until enough runs are recorded. */
  seedSeconds: z.strictObject({ full: z.number().int().positive(), selected: z.number().int().positive() }),
  /** The lease's time to live; a heartbeat renews it every tick. */
  leaseTtlSeconds: z.number().int().min(300).max(1_800).default(600),
});
export type MachineConfig = z.infer<typeof machineConfigSchema>;
