# Verify on Boat

On a workstation with a Boat key, `bun run test:verify` and each [rendered acceptance capture](#captures-on-boat) run on a short-lived Boat machine instead of the workstation (owner decision 15, werk-flow/werkflow-planning#294). Type-aware lint, the build, the stack and the browsers then load Boat's machine, not the 16 GB PC that agents share. CI stays on GitHub's runners ([decision 0009](../decisions/0009-pull-requests-and-ci.md)).

## How a run picks Boat

`lib/testing/boat/verify-on-boat.ts` owns the choice. A run goes to Boat unless one of these holds; then it runs locally and prints why. Without a usable key, or when Boat fails, only the cheap groups run locally ([Fallback](#fallback)).

- CI, or the Boat machine itself.
- `WERKFLOW_VERIFY_LOCAL=1`.
- `--mode release`, or a group under `audit:performance`: their medians measure the workstation's wall clock. Every other audit group runs on Boat. Lab counts repeat on any machine, and layout groups check computed boxes. Visual groups render in the pinned Playwright image on `linux/amd64` ([visual references](standards-audit.md#keep-accepted-screens-as-visual-references)), so a Boat machine compares with the same references as the workstation and CI. A new machine pulls the image once, in about 30 s.
- `--target cloud`: the canary needs DEV's secrets.
- The plan runs no group, or only cheap groups, at most one of them not a SQL group. A Boat run's upload and setup cost about 95 s of machine time; here a SQL group takes about 1 s against the shared stack, `unit:all` 60 to 90 s and a static gate up to 35 s. `static:lint` takes 170 to 370 s and 3 to 4 GB, so it goes to Boat even alone, as do `ui:contracts` and the browser groups. The line reads `Running locally: a single <group> is cheaper here.`
- A cheap plan that runs a SQL group still goes to Boat when the shared stack's migrations drift from this tree's: a migration only on the stack, one only in the tree, or one name with other statements (`lib/testing/local-stack/migration-drift.ts`). Versions, comments and layout never count, so a migration renamed before merge is no drift. Boat starts a fresh stack at this tree's migrations, so the plan tests this tree's schema. The line reads `The shared stack's migrations drift from this tree's: N migrations only on the shared stack (…), M only in this tree (…).` A local run that reads the stack, such as one [without Boat](#fallback), `WERKFLOW_VERIFY_LOCAL=1` or a wall-clock group, prints the same line before its SQL and browser groups run. An unreachable stack counts as no drift.

The whole plan runs there, static gates included: type-aware lint is the largest local load. A Boat run takes no heavy slot, and holds the workspace lock while the machine runs, so the edit guard works as during a local run.

The machine starts from the saved snapshot `werkflow-verify` and runs `scripts/boat/remote-verify.sh`. It rebuilds the checkout at the same absolute path and in the same form (main checkout or linked worktree) from `HEAD`, the local commits and the working tree, untracked files included, with the evidence history of `.agent-logs/`. The machine checks out `HEAD` itself, so only the files that differ from it travel: a machine's file host may accept as little as 0.07 MB/s. On macOS, tar packs no extended attribute and no AppleDouble `._` file. Before the stack starts, `scripts/boat/check-tree.ts` checks that git reads the rebuilt checkout as changed since `HEAD` in exactly the paths it reads on the workstation, because a plan without a baseline report selects from those paths. A difference fails the setup and names the paths. It starts a fresh stack at this tree's migrations, serves the build when the plan runs a browser group, runs `bun run test:verify` with the same arguments, and returns every report and run folder the run wrote. So selection, proofs, reports and [failure classification](testing.md#failures) work as for a local run.

A proof records its backend by a digest of `.env.local`, which on a workstation also holds credentials that never leave it. The machine compares its stack's values with the workstation's by digest, value by value, and only then records the workstation's digest (`scripts/boat/check-environment.ts`). So a Boat proof counts locally and a local proof on Boat. A difference fails the setup and names the keys.

`static:docs` cannot read the private werkflow-business clone on Boat and leaves its links unchecked, as CI does without its token.

### Tell which ran

- `[verify] Running on Boat machine bx_…` opens a Boat run. Its end names the machine time and cost.
- `[verify] Running locally: <reason>` opens a whole local run that belongs on the workstation.
- `[verify] BOAT IS UNAVAILABLE: <reason>` in a block after the plan: the heavy groups did not run ([Fallback](#fallback)). A plan without heavy groups prints one line `[verify] Boat is unavailable: <reason>` instead.

### Fallback

When Boat is unavailable, a run never sends its heavy groups to the workstation by default. A heavy local fallback once overloaded the shared PC: one refused connection sent a whole plan there, type-aware lint included, and with the other worktrees' work the lint ran for three hours with swap full.

Boat is unavailable when one of these happens before the results are back:

- The workstation has no key, or a key it cannot use: expired, malformed or readable by others.
- Boat refuses: no ready machine, a start or member limit (at most 10 machines at once), an exhausted plan, or a rejected key, which says how to renew.
- The network to Boat fails.
- The run cannot be packed for Boat: an untracked dotfile or a file that looks like a credential, a file git reads as unchanged although it differs, or an `.env.local` that points elsewhere than the local stack.
- The machine fails its setup or runs out of memory.

The run then plans locally and runs only what costs the workstation little: the SQL groups, `unit:all`, the static gates other than `static:lint`, and the wall-clock groups. `static:lint`, `ui:contracts` and every other browser group are recorded `blocked` with the reason, as [blocked verification](testing.md#failures), not a product failure. A block after the plan names the reason, each held-back group with its usual local cost, and the command that runs them on the workstation deliberately: `WERKFLOW_VERIFY_LOCAL=1 bun run test:verify` with the same arguments. Such a run cannot pass: it exits 1, its report reads `failed`, and its last line starts `NOT A PASS`. The next run selects the blocked groups again. A test failure on Boat is a result, never unavailability. CI and the Boat machine never ask Boat and run their whole plan.

Before a machine exists, a connection that fails on the way to Boat (refused, reset, unreachable, a failed name lookup or a timeout) gets two fresh attempts over 30 s. They send the same idempotency key, so Boat starts one machine at most. Boat's own refusal gets none.

A file transfer retries on a fresh request before it counts as a failure, because the machine still holds the file (`lib/testing/boat/boat-transfer.ts`). Each upload gets one retry after a deadline of 30 s plus 1 s per 256 kB, so a stalled upload does not hold a billed machine for minutes. The results download gets three retries over about 40 s, so a dropped connection never throws away a finished run. `Uploaded the run (… MB) in … s.` records each upload's size and time.

A failed browser group's world is cleaned on its machine before the machine goes; when that fails, the run says so and names `bun run test:runs cleanup <run-key>` for the workstation. Diagnose the failure from the trace and screenshot that came back, and classify it as usual. The one `environment` retry on unchanged inputs needs a diagnostic replay on the retained world or the same build, which a Boat run does not keep; until a Boat replay exists (werk-flow/werkflow-planning#294), repair through a change of the inputs.

## Captures on Boat

A rendered acceptance capture, `bun run test:audit:focused --grep "@ACCEPT <set>"`, goes to Boat through the same machinery (`lib/testing/boat/capture-on-boat.ts`): the same snapshot, packing, checks and results import. On the workstation it needs a production build and its server beside the stack and a browser, one of the largest loads on the shared PC. The machine builds and serves the app itself and runs the same command on the same tree. The run folder comes back, so the images land where a local capture writes them, under `.agent-logs/playwright-runs/<run>/acceptance/<set>/`. Start no test server for a capture.

The images render in the pinned Playwright image on both sides. Measured on one set: a Boat capture and a local capture of the same commit differ only in the world's run id, which every run changes, and in at most 99 other pixels an image, each by 1 of 255. The Boat run took about 3 minutes and 180 s of machine time, and the workstation spent 19 s of processor time and 0.26 GB on it. The local capture spent about 500 s of processor time at up to 3 GB, most of it the build.

A capture runs locally, with a `Running locally:` line, under `WERKFLOW_VERIFY_LOCAL=1`, with `--reuse-run` (the retained world lives on the workstation's stack) or with `--target cloud`. CI and the Boat machine run it locally without a line. Other focused runs and reference updates stay on the workstation.

When Boat is [unavailable](#fallback), the capture does not run: a block names the reason, writes no image and exits 1. To capture on the workstation on purpose, start `bun run test:server local` in a second shell, then run `WERKFLOW_VERIFY_LOCAL=1 bun run test:audit:focused --grep "@ACCEPT <set>"`.

## The key contract

| Setting | Value |
| --- | --- |
| Name | `werkflow-pc` on the PC (WSL user), `werkflow-mac` on the Mac |
| Organization | `WerkFlow`; it bills the plan's included $20 a month, then a $20 wallet reserve. Auto top-up stays off, so once both are spent a start fails and Boat is unavailable. |
| Expiry | 90 days |
| Actions | Custom: exactly `sandbox.create`, `sandbox.read`, `sandbox.stop`, `sandbox.resume`, `sandbox.fork`, `sandbox.delete-own`, `exec`, `file.read`, `file.write`, `snapshot.read`, `snapshot.write`. No environment or sandbox restriction. |
| File | `~/.config/werkflow/boat-api-key`, mode 600, folder mode 700, one line holding the key |
| Expiry file | `~/.config/werkflow/boat-api-key.expires`, one ISO date |

The runner reads the key in its own process and calls Boat's REST API with it. It never writes the key elsewhere and needs no Boat CLI and no SSH. A run refuses a key file or folder others can read, and counts Boat as unavailable when an untracked file is a dotfile or looks like a credential.

Agents never read the key or the Boat CLI's config, which holds a key in plain text after `boat login`. `.claude/hooks/refuse-boat-key-reads.ts` refuses such a call in Claude Code and Codex, and `permissions.deny` in `.claude/settings.json` covers Claude's file tools. The expiry file stays readable.

Machines get code and the local stack's synthetic data only: no customer data, no PROD or DEV secret, no Claude, Codex or GitHub credential. Each machine is created with `noEnv`, the organization's environment `base` is "Safe for third parties", and the snapshot holds no agent CLI folder. A run machine is created with snapshots and monitoring off: a stop erases it, and Boat keeps none of its command output, process list or memory samples once the run has read them.

## Set up a workstation

On the PC inside WSL Ubuntu, on the Mac in Terminal:

1. The owner creates the key under [the key contract](#the-key-contract) in the Boat dashboard and copies it once.
2. Install it without echo. Paste the key when the cursor waits, then press Enter:

   ```sh
   sh -c 'umask 077; mkdir -p ~/.config/werkflow; chmod 700 ~/.config/werkflow; stty -echo; IFS= read -r k; stty echo; printf "%s\n" "$k" > ~/.config/werkflow/boat-api-key'
   ```

3. Record the expiry date the dashboard shows: `echo <YYYY-MM-DD> > ~/.config/werkflow/boat-api-key.expires`.
4. Codex: trust the project hooks once with `/hooks`. Claude Code reads its rules from the repository.
5. Check: `bun run test:verify --group static:lint` prints `Running on Boat machine`. A single SQL group runs locally while the shared stack matches the tree's migrations.

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
