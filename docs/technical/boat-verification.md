# Verify on Boat

On a workstation with a Boat key, `bun run test:verify` runs on a short-lived Boat machine instead of the workstation (owner decision 15, werk-flow/werkflow-planning#294). Type-aware lint, the build, the stack and the browsers then load Boat's machine, not the 16 GB PC that agents share. CI stays on GitHub's runners ([decision 0009](../decisions/0009-pull-requests-and-ci.md)).

## How a run picks Boat

`lib/testing/boat/verify-on-boat.ts` owns the choice. A run goes to Boat when the key file exists, unless one of these holds; then it runs locally and prints why:

- CI, or the Boat machine itself.
- `WERKFLOW_VERIFY_LOCAL=1`.
- `--mode release`, or a group under `audit:lab`, `audit:performance`, `audit:visual` or `audit:layout`: they compare against references taken on the workstation.
- `--target cloud`: the canary needs DEV's secrets.
- `.env.local` points elsewhere than the local stack.

The whole plan runs there, static gates included: type-aware lint is the largest local load. A Boat run takes no heavy slot, and holds the workspace lock while the machine runs, so the edit guard works as during a local run.

The machine starts from the saved snapshot `werkflow-verify` and runs `scripts/boat/remote-verify.sh`. It rebuilds the checkout at the same absolute path and in the same form (main checkout or linked worktree) from `HEAD`, the local commits and the working tree, untracked files included, with the evidence history of `.agent-logs/`. It starts a fresh stack at this tree's migrations, serves the build when the plan runs a browser group, runs `bun run test:verify` with the same arguments, and returns every report and run folder the run wrote. So selection, proofs, reports and [failure classification](testing.md#failures) work as for a local run.

A proof records its backend by a digest of `.env.local`, which on a workstation also holds credentials that never leave it. The machine compares its stack's values with the workstation's by digest, value by value, and only then records the workstation's digest (`scripts/boat/check-environment.ts`). So a Boat proof counts locally and a local proof on Boat. A difference falls back to the local run and names the keys.

`static:docs` cannot read the private werkflow-business clone on Boat and leaves its links unchecked, as CI does without its token.

### Tell which ran

- `[verify] Running on Boat machine bx_…` opens a Boat run. Its end names the machine time and cost.
- `[verify] Running locally: <reason>` opens a local run that had a key.
- No such line: the workstation has no key.

### Fallback

Any Boat failure before the results are back runs the plan locally with one line: no ready machine, a start or member limit (at most 10 machines at once), an exhausted plan, a failed setup, a memory kill or a network failure. An expired or rejected key says so and how to renew. A test failure on Boat is a result, never a fallback.

A failed browser group's world is cleaned on its machine before the machine goes; when that fails, the run says so and names `bun run test:runs cleanup <run-key>` for the workstation. Diagnose the failure from the trace and screenshot that came back, and classify it as usual. The one `environment` retry on unchanged inputs needs a diagnostic replay on the retained world or the same build, which a Boat run does not keep; until a Boat replay exists (werk-flow/werkflow-planning#294), repair through a change of the inputs.

## The key contract

| Setting | Value |
| --- | --- |
| Name | `werkflow-pc` on the PC (WSL user), `werkflow-mac` on the Mac |
| Organization | `WerkFlow`; it bills the plan's included $20 a month. The wallet stays empty, so a start past the plan fails and the run falls back. |
| Expiry | 90 days |
| Actions | Custom: exactly `sandbox.create`, `sandbox.read`, `sandbox.stop`, `sandbox.resume`, `sandbox.fork`, `sandbox.delete-own`, `exec`, `file.read`, `file.write`, `snapshot.read`, `snapshot.write`. No environment or sandbox restriction. |
| File | `~/.config/werkflow/boat-api-key`, mode 600, folder mode 700, one line holding the key |
| Expiry file | `~/.config/werkflow/boat-api-key.expires`, one ISO date |

The runner reads the key in its own process and calls Boat's REST API with it. It never writes the key elsewhere and needs no Boat CLI and no SSH. A run refuses a key file or folder others can read, and falls back to local when an untracked file is a dotfile or looks like a credential.

Agents never read the key or the Boat CLI's config, which holds a key in plain text after `boat login`. `.claude/hooks/refuse-boat-key-reads.ts` refuses such a call in Claude Code and Codex, and `permissions.deny` in `.claude/settings.json` covers Claude's file tools. The expiry file stays readable.

Machines get code and the local stack's synthetic data only: no customer data, no PROD or DEV secret, no Claude, Codex or GitHub credential. Each machine is created with `noEnv`, the organization's environment `base` is "Safe for third parties", and the snapshot holds no agent CLI folder.

## Set up a workstation

On the PC inside WSL Ubuntu, on the Mac in Terminal:

1. The owner creates the key under [the key contract](#the-key-contract) in the Boat dashboard and copies it once.
2. Install it without echo. Paste the key when the cursor waits, then press Enter:

   ```sh
   sh -c 'umask 077; mkdir -p ~/.config/werkflow; chmod 700 ~/.config/werkflow; stty -echo; IFS= read -r k; stty echo; printf "%s\n" "$k" > ~/.config/werkflow/boat-api-key'
   ```

3. Record the expiry date the dashboard shows: `echo <YYYY-MM-DD> > ~/.config/werkflow/boat-api-key.expires`.
4. Codex: trust the project hooks once with `/hooks`. Claude Code reads its rules from the repository.
5. Check: `bun run test:verify --group sql:security` prints `Running on Boat machine`.

Never export the key from a shell profile, and never run `boat login` on a workstation. For manual inspection, `bash scripts/boat/install-cli.sh` installs the pinned CLI with a checksum check.

## Rebuild the snapshot

Run `bun run boat:snapshot` after a change to the Bun version, the Playwright version, the Supabase CLI version or `supabase/config.toml`. It prepares a machine with `scripts/boat/prepare-snapshot.sh` at `origin/main` and saves it under the same name; a failed save keeps the last good snapshot. The snapshot holds the stack's images as a file and no stack container: Boat pulls a registry image again at every start, and recreates a snapshot's containers late, which would race the run's own stack. A stale snapshot still works: the run installs and pulls what changed, only slower.

## Renew the key

The key lasts 90 days and cannot be extended. From 14 days before its expiry, every run prints a reminder, and the ci-alert pass in werkflow-planning `ops/` opens `Owner action: Boat key` for the owner, weekly until the new date is written. Create the new key, install it with step 2, write its expiry date, then revoke the old key in the dashboard.

## Residual exposure

The owner accepted these three on 2026-11-08.

- Agents run as the owner's OS user. The guard stops accidental and habitual reads, not a deliberate one.
- The key reaches every machine of the organization, but deletes only its own.
- With monitoring on, Boat keeps a command's output for 90 days. Runs print no secret.
