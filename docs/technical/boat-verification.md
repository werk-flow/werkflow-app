# Verify on Boat

On a workstation with a Boat key, `bun run test:verify`, each [rendered acceptance capture](#captures-on-boat) and [a migration's types](#types-on-boat) run on a short-lived Boat machine instead of the workstation (owner decision 15, werk-flow/werkflow-planning#294). Type-aware lint, the build, the stack and the browsers then load Boat's machine, not the 16 GB PC that agents share. CI stays on GitHub's runners ([decision 0009](../decisions/0009-pull-requests-and-ci.md)).

## How a run picks Boat

`lib/testing/boat/verify-on-boat.ts` owns the choice. A run goes to Boat unless one of these holds; then it runs locally and prints why. Without a usable key, or when Boat fails, only the cheap groups run locally ([Fallback](#fallback)).

- CI, or the Boat machine itself.
- `WERKFLOW_VERIFY_LOCAL=1`.
- `--mode release`, or a group under `audit:performance` without `--untimed`: their medians measure the workstation's wall clock. Every other audit group runs on Boat. Lab counts repeat on any machine, and layout groups check computed boxes. Visual groups render in the pinned Playwright image on `linux/amd64` ([visual references](standards-audit.md#keep-accepted-screens-as-visual-references)), so a Boat machine compares with the same references as the workstation and CI. A new machine pulls the image once, in about 30 s.
- `--target cloud`: the canary needs DEV's secrets.
- The plan prints `[verify] refused:` (an unclassified failed run): the run ends there, exit 1, nothing run.
- The plan runs no group, or only cheap groups, at most one of them not a SQL group. A Boat run's upload and setup cost more than these groups do here (`CHEAP_HERE`, `verify-on-boat.ts`). `static:lint` goes to Boat even alone, as do `ui:contracts` and the browser groups. A SQL group goes to Boat while the shared stack [drifts](testing.md#recurring-traps).

The whole plan runs there, static gates included: type-aware lint is the largest local load. A Boat run takes no heavy slot, and holds the workspace lock while the machine runs, so the edit guard works as during a local run.

The machine starts from the saved snapshot `werkflow-verify` and runs `scripts/boat/remote-verify.sh`. It rebuilds the checkout at the same absolute path and in the same form (main checkout or linked worktree) from `HEAD`, the local commits and the working tree, untracked files included, with the evidence history of `.agent-logs/`. The machine checks out `HEAD` itself, so only the files that differ from it travel: a machine's file host may accept as little as 0.07 MB/s. Before the stack starts, `scripts/boat/check-tree.ts` checks that git reads the rebuilt checkout as changed since `HEAD` in exactly the paths it reads on the workstation, because a plan without a baseline report selects from those paths. A difference fails the setup and names the paths. It starts a fresh stack at this tree's migrations, serves the build when the plan runs a browser group, runs `bun run test:verify` with the same arguments, and returns every report, log, manifest and archive the run wrote, plus a browser run's traces and screenshots when its group did not pass (`lib/testing/boat/result-files.ts`). So selection, proofs, reports and [failure classification](testing.md#failures) work as for a local run.

A proof records its backend by a digest of `.env.local`, which on a workstation also holds credentials that never leave it. The machine compares its stack's values with the workstation's by digest, value by value, and only then records the workstation's digest (`scripts/boat/check-environment.ts`). So a Boat proof counts locally and a local proof on Boat. A difference fails the setup and names the keys.

`static:docs` cannot read the private werkflow-business clone on Boat and leaves its links unchecked, as CI does without its token.

### Tell which ran

- `[verify] Running on Boat machine bx_…` opens a Boat run. Its end names the machine time and cost.
- `[verify] Running locally: <reason>` opens a whole local run that belongs on the workstation.
- `[verify] BOAT IS UNAVAILABLE: <reason>` in a block after the plan: the heavy groups did not run ([Fallback](#fallback)). A plan without heavy groups prints one line `[verify] Boat is unavailable: <reason>` instead.

### Fallback

When Boat is unavailable, a run never sends its heavy groups to the workstation by default. A heavy local fallback once overloaded the shared PC for hours.

Boat is unavailable when one of these happens before the results are back:

- The workstation has no key, or a key it cannot use: expired, malformed or readable by others.
- Boat refuses: no ready machine, a start or member limit (at most 10 machines at once), an exhausted plan, or a rejected key, which says how to renew.
- The network to Boat fails.
- The run cannot be packed for Boat: an untracked dotfile or a file that looks like a credential, a file git reads as unchanged although it differs, or an `.env.local` that points elsewhere than the local stack.
- The machine fails its setup or runs out of memory.

The run then plans locally and runs only what costs the workstation little: the SQL groups, `unit:all`, the static gates other than `static:lint`, and timed wall-clock groups. `static:lint`, `ui:contracts` and every other browser group are recorded `blocked` with the reason, as [blocked verification](testing.md#failures), not a product failure. A block after the plan names the reason, each held-back group with its usual local cost, and the command that runs them on the workstation deliberately: `WERKFLOW_VERIFY_LOCAL=1 bun run test:verify` with the same arguments. Such a run cannot pass: it exits 1, its report reads `failed`, and its last line starts `NOT A PASS`. The next run selects the blocked groups again. A test failure on Boat is a result, never unavailability. CI and the Boat machine never ask Boat and run their whole plan.

Before a machine exists, a connection that fails on the way to Boat (refused, reset, unreachable, a failed name lookup or a timeout) gets two fresh attempts over 30 s. They send the same idempotency key, so Boat starts one machine at most. Boat's own refusal gets none.

A file transfer retries on a fresh request before it counts as a failure, because the machine still holds the file (`lib/testing/boat/boat-transfer.ts`). Each upload gets one retry after a deadline of 30 s plus 1 s per 256 kB, so a stalled upload does not hold a billed machine for minutes. The results download gets three retries over about 40 s, so a dropped connection never throws away a finished run. The upload and the download each log their size and time.

A failed browser group's world is cleaned on its machine before the machine goes; when that fails, the run says so and names `bun run test:runs cleanup <run-key>` for the workstation. Diagnose the failure from the trace and screenshot that came back, and classify it as usual. The one `environment` retry on unchanged inputs needs a diagnostic replay on the retained world or the same build, which a Boat run does not keep; until a Boat replay exists (werk-flow/werkflow-planning#294), repair through a change of the inputs.

## Machine reuse

Boat counts every create, fork and resume as a start; the plan includes 200 a day, and the wallet pays for more. So a checkout's consecutive runs share one machine (`lib/testing/boat/machine-reuse.ts`):

- **Wipe.** After a run that returned a result, `scripts/boat/wipe-machine.sh` kills every earlier command's cgroup as a unit and checks it is empty, then removes the stack's containers, volumes and network, the checkout and its clones, and every upload, result, log, temporary file and Boat command log. Before its first run, a fresh machine lists every path in the home folder, `/tmp`, `/var/tmp` and `/dev/shm`, copies `~/.supabase` (traces of a run's SQL) and Next.js's `~/.config/nextjs-nodejs`, which builds make, and marks the time. The wipe removes what the run added at the top of the home folder, every path added and file changed since the mark in the temporary folders, and restores both as recorded. It then checks that no path was added and no file changed since the mark in any of those places, outside the Bun package cache, Boat's machine agent, the seed clone and the desktop session's state, and that no container or volume remains. Only the X server's lock and socket folders and root's systemd folders at the top of `/tmp` are left alone. A check that fails or cannot complete deletes the machine.
- **Agent folders.** When Boat hands out a machine, its machine agent writes a `boat` skill and a small mode-600 config into each coding-agent CLI's folder (`~/.claude.json`, `~/.codex`, `~/.pi`, `~/.config/opencode` and others). None holds a file by a CLI's login name, and no run starts an agent. `record` and every wipe remove them, and the wipe checks they are gone, so a kept machine holds none between runs; Boat may write them again during a run.
- **Idle deadline.** The wiped machine waits 15 minutes for the next run in the same checkout on the same workstation, which finds it by a record in `~/.cache/werkflow-boat/idle-machines/` and the machine's `checkout` label, a digest of host and path. A detached reaper deletes it once that window passes; as a reaper can die, every run first deletes this workstation's machines whose window passed. Taking a record is a rename, so a run and the reaper never both get it, and the workspace lock keeps two runs of a checkout apart. The next run starts a fresh stack.
- **Lifetime.** Boat stops a run machine 3 hours after its creation, and a machine without snapshots is erased by that stop, whatever the workstation does. The key may not move that deadline (it has no `sandbox.update`). So a machine takes a run only with an hour of life left.
- **Deletion.** A run deletes its machine instead of keeping it after a Ctrl-C, when Boat became unavailable during the run, after a failed wipe, or with under an hour of life left. A Boat refusal while a run looks for its kept machine makes Boat unavailable for that run, and the run deletes the kept machines whose records it took. Each run deletes every other machine of its checkout, such as one a killed run left behind.

A run that keeps its machine ends `… wiped and kept 15 min for this checkout's next run`; the next opens `… kept from this checkout's last run.`

Most follow-up runs in a checkout start within 15 minutes of the last one's end, and a longer window catches few more. A full window of an idle `large` machine costs about $0.02, less than one paid start.

Idle machines count toward the 10 machines a member may run at once, and toward the plan's limit. When Boat refuses a start at either limit (`429 member_limit_reached` or `limit_reached`), the run deletes this workstation's idle machines, oldest first, through the reaper's rename, never one a run took, and tries once more. Only a second refusal, or one with no idle machine to delete, makes Boat unavailable. `503 out_of_capacity` and `no_ready_machine` are Boat's own shortage and delete nothing.

## Captures on Boat

A rendered acceptance capture, `bun run test:audit:focused --grep "@ACCEPT <set>"`, goes to Boat through the same machinery (`lib/testing/boat/capture-on-boat.ts`): the same snapshot, packing, checks and results import. On the workstation it needs a production build and its server beside the stack and a browser, one of the largest loads on the shared PC. The machine builds and serves the app itself and runs the same command on the same tree. The captures come back, so the images land where a local capture writes them, under `.agent-logs/playwright-runs/<run>/acceptance/<set>/`. Start no test server for a capture.

The images render in the pinned Playwright image on both sides. Measured on one set: a Boat and a local capture of the same commit differ only in the world's run id and in at most 99 other pixels an image, each by 1 of 255. The Boat run took about 3 minutes and cost the workstation 19 s of processor time; the local capture spent about 500 s at up to 3 GB.

A capture runs locally, with a `Running locally:` line, under `WERKFLOW_VERIFY_LOCAL=1`, with `--reuse-run` (the retained world lives on the workstation's stack) or with `--target cloud`. CI and the Boat machine run it locally without a line. Other focused runs and reference updates stay on the workstation.

When Boat is [unavailable](#fallback), the capture does not run: a block names the reason, writes no image and exits 1. To capture on the workstation on purpose, start `bun run test:server local` in a second shell, then run `WERKFLOW_VERIFY_LOCAL=1 bun run test:audit:focused --grep "@ACCEPT <set>"`.

## Types on Boat

`bun run types:generate -- --local` reads the stack on its machine where that stack has the tree's schema: CI, a Boat machine, a shared stack whose ledger matches. Otherwise a Boat machine's fresh stack generates the file, byte for byte what CI's check computes. Without Boat, CI's SQL job uploads it (`database-types`) when the committed types are stale, which the command takes.

## The key contract

| Setting | Value |
| --- | --- |
| Name | `werkflow-pc` on the PC (WSL user), `werkflow-mac` on the Mac, `werkflow-vm` on the headless Linux host |
| Organization | `WerkFlow`; it bills the plan's included $20 a month, then a $20 wallet reserve. Auto top-up stays off, so once both are spent a start fails and Boat is unavailable. |
| Expiry | 90 days |
| Actions | Custom: exactly `sandbox.create`, `sandbox.read`, `sandbox.stop`, `sandbox.resume`, `sandbox.fork`, `sandbox.delete-own`, `exec`, `file.read`, `file.write`, `snapshot.read`, `snapshot.write`. No environment or sandbox restriction. |
| File | `~/.config/werkflow/boat-api-key`, mode 600, folder mode 700, one line holding the key |
| Expiry file | `~/.config/werkflow/boat-api-key.expires`, one ISO date |

The runner reads the key in its own process for Boat's REST API. It never writes the key elsewhere and needs no Boat CLI and no SSH. A run refuses a key file or folder others can read, and counts Boat as unavailable when an untracked file is a dotfile or looks like a credential.

Agents never read the key or the Boat CLI's config, which holds a key in plain text after `boat login`. `.claude/hooks/refuse-boat-key-reads.ts` refuses such a call in Claude Code and Codex, and `permissions.deny` in `.claude/settings.json` covers Claude's file tools. The expiry file stays readable.

Machines get code and the local stack's synthetic data only: no customer data, no PROD or DEV secret, no Claude, Codex or GitHub credential. Each machine is created with `noEnv`, the organization's environment `base` is "Safe for third parties", and the snapshot holds no agent CLI folder. A run machine is created with snapshots and monitoring off: a stop erases it, and Boat keeps none of its command output, process list or memory samples once the run has read them.

## Set up a workstation

On the PC inside WSL Ubuntu, on the Mac in Terminal:

1. The owner creates the key under [the key contract](#the-key-contract) in the Boat dashboard and copies it once.
2. Install it without echo. Paste the key, then press Enter:

   ```sh
   sh -c 'umask 077; mkdir -p ~/.config/werkflow; chmod 700 ~/.config/werkflow; stty -echo; IFS= read -r k; stty echo; printf "%s\n" "$k" > ~/.config/werkflow/boat-api-key'
   ```

3. Record the expiry date the dashboard shows: `echo <YYYY-MM-DD> > ~/.config/werkflow/boat-api-key.expires`.
4. Codex: trust the project hooks once with `/hooks`. Claude Code reads its rules from the repository.
5. Check: `bun run test:verify --group static:lint` prints `Running on Boat machine`. A single SQL group runs locally unless the stack drifts.

Never export the key from a shell profile, and never run `boat login` on a workstation. For manual inspection, `bash scripts/boat/install-cli.sh` installs the pinned CLI with a checksum check.

## Rebuild the snapshot

Run `bun run boat:snapshot` after a change to the Bun version, the Playwright version, the Supabase CLI version or `supabase/config.toml`. It prepares a machine with `scripts/boat/prepare-snapshot.sh` at `origin/main` and saves it under the same name; a failed save keeps the last good snapshot. The snapshot holds the stack's images as a file and no stack container: Boat pulls a registry image again at every start, and recreates a snapshot's containers late, which would race the run's own stack. A stale snapshot still works: the run installs and pulls what changed, only slower.

## Renew the key

The key lasts 90 days and cannot be extended. From 14 days before its expiry, every run prints a reminder, and the ci-alert pass in werkflow-planning `ops/` opens `Owner action: Boat key` for the owner, weekly until the new date is written. Create the new key, install it with step 2, write its expiry date, then revoke the old key in the dashboard.

## Residual exposure

The owner accepts these residual exposures.

- Agents run as the owner's OS user. The guard stops accidental and habitual reads, not a deliberate one.
- The key reaches every machine of the organization, but deletes only its own.
- The snapshot build keeps monitoring on, so Boat keeps its output for 90 days. It prints no secret.
- A machine kept between runs holds no checkout, result, log or stack data, but the package and image caches its runs filled: npm packages Bun installed and the stack images, all public. It holds them until a reaper deletes it, or at most 3 hours after its creation. A run whose workstation process dies leaves its data on the machine for at most as long, as before reuse.
- A run that overwrote a file the snapshot holds in the home folder and set its modification time back before the wipe's mark would pass the check; no step of a run does either. An exact check needs a baseline of change times taken after Boat has copied the snapshot in, which adds about 100 s to every run on a new machine.
- During a run, the coding-agent config files Boat's machine agent writes may be on the machine. Their contents were not read: they may name Boat's per-machine token, which with `noEnv` reaches only that machine's own ports.
