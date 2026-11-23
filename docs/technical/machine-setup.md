# Set up a machine

How to make a workstation or a headless Linux host ready for agent work, and which background jobs each machine runs. [Environments](environments.md) owns the backends, the env files and the worktree rules.

## Set up a new machine

1. Install Bun, Node 22 or later, git, the GitHub CLI, Docker and the Supabase CLI. On Windows, clone and work inside WSL Ubuntu.
   On an Apple Silicon Mac, run `softwareupdate --install-rosetta` and `brew install colima docker flock`, then `colima start --cpu 4 --memory 6 --disk 40 --vm-type vz --vz-rosetta --mount-type virtiofs` ([why Rosetta](standards-audit.md#keep-accepted-screens-as-visual-references)). Run the repository's pinned CLI with `bunx supabase`. Grow the VM only for a measured need. On AC power, `caffeinate -s` keeps the Mac awake for agents.
   After that first start, the launchd agent `app.werk-flow.colima` from `ops/install-mac.py` starts Colima and the local stack at login, without Terminal. Check it with `colima status` and `launchctl print gui/$(id -u)/app.werk-flow.colima | grep state`.
2. Export the owner's Supabase personal access token as `SUPABASE_ACCESS_TOKEN`, with a copy in every env backup (a switch overwrites `.env.local`). Never commit or print it.
3. Get the DEV `.env.local` from the owner's password manager and copy it to `.env.dev-backup`. Add `.env.live-backup` only for production sessions.
4. Add the DEV MCP server `supabase` ([which tool reaches what](environments.md#which-tool-reaches-what)) to Claude Code (`claude mcp add --scope user --transport http supabase "<url>"`) and Codex (`[mcp_servers.supabase]` in `~/.codex/config.toml`). The owner signs in once per tool. Never add a server for PROD. Agents reach Vercel only through the Vercel MCP connector: install no Vercel CLI, since a signed-in CLI acts for the whole account, PROD included.
5. On `main`, run `bunx supabase start` and `bun run stack:sync`. Create `.env.local-stack-backup` from `supabase status`, then run `bun run env:local`.
6. Run `bunx playwright install --with-deps chromium` once.
7. CodeRabbit: `curl -fsSL https://cli.coderabbit.ai/install.sh | sh`. The owner signs in once with `coderabbit auth login`. `bun run review:doctor` confirms both. Agents install CodeRabbit only here.
8. Install the [background jobs](#background-jobs); `bun run room` prints numbers.
9. Verify: `bunx supabase projects list` shows both projects, `bun scripts/check-r2.ts` passes, and `WERKFLOW_VERIFY_LOCAL=1 bun run test:verify --group golden:gg-00` passes beside `bun run test:server local`.
10. Store the "Setup worktree" action of `t3.json` in this machine's T3 Code settings: T3 Code does not run it from `t3.json` alone, and setting `scripts` through the project API does not start it either. On a headless host, put it in `projectScriptOverrides` and in `projectSettingsOverrides.<project>.defaultProjectScripts` of `~/.t3/userdata/settings.json`, then run `t3 service restart`. Verify: a thread launched there gets `.t3/setup-done` and `.env.local` in its worktree.

### A headless Linux host

- Run T3 Code as the working user, never as root, and run `loginctl enable-linger` for that user, so its services outlive the login.
- T3 Code runs as a systemd user service with the `PATH` `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`. Link `bun`, `bunx`, `codex`, `claude` and `t3` into `/usr/local/bin`. Put the `PATH` export at the top of `~/.bashrc` too: Debian's returns early for a non-interactive shell.
- Docker publishes the local stack on `0.0.0.0`. On a machine with a public address, a firewall outside Docker drops every incoming connection except SSH and the UDP replies from ports 53, 123 and 7844. Without the 7844 rule, T3 Connect falls back to HTTP/2 after three minutes.

## Background jobs

The `ops/` scripts of `werk-flow/werkflow-planning` run from `~/code/werkflow-planning`, as systemd user timers on Linux and launchd agents on the Mac (`ops/install-mac.py`).

| Job | Runs on |
| --- | --- |
| `worktree-cleanup`, load watch, [notifier](#keep-the-agents-moving) | Each machine, for itself |
| [CodeRabbit queue](coderabbit.md#the-coderabbit-queue), `ci-alert` | The PC and the Mac; only the lease holder acts. A further machine runs only its own `worktree-cleanup` and load watch |
| [Production watcher](recovery-and-incidents.md#monitoring) | Where its [token](environments.md#credentials) is |
| [Recovery rehearsal](recovery-and-incidents.md#recovery-rehearsal) | The PC, beside the stack |
| `report-dispatch`: starts one report thread per waiting [problem report](../features/problem-reports.md#current-product-baseline), blockers first; does nothing while the hand-out is off | The lease holder among the machines with the hand-out [file](environments.md#credentials) |

A lease is the ref `refs/leases/<job>` (`ops/lease.py`): its holder renews it every pass; another machine takes over once it lapses. A lease is read with `git fetch` and swapped with `git push --force-with-lease`, so it costs no GitHub API call.

## Run CI on the owner's machines

The machine runner is CI's `local` profile ([decision 0011](../decisions/0011-ci-profiles.md)); [testing.md](testing.md#ci) owns what a run tests. `scripts/ci/machine-runner.ts` is a user service on the MacBook and on the PC. It claims each ready PR of this repository's people whose head is up to date with `main`, and runs its integration run, browser groups included. It posts `Check` from that run only.

- **Trust.** It runs from a trusted checkout at a reviewed commit, only while `main`'s profile is `local`. It holds the credentials: its `gh` login and the CI App's key. An agent process on the PC can read the App's key, which writes `Check` here: an owner-accepted residual (werk-flow/werkflow-planning#503). A separate runner user would add no boundary, since the agents hold root through passwordless `sudo` and the owner's `gh` login, which reach more. Closing it means taking those away. Every job runs in a container of `ci/image`, by the image's id, on the machine's slot (`scripts/ci/container-executor.ts`). A job gets its inputs only as files, never werkflow-business: the runner checks that sibling itself.
- **The slot.** On the Mac, a Colima profile `ci` without host mounts. On the PC, the rootless Docker of user `cirunner` in the `werkflow-ci` distribution, without Windows drives or interop. The runner starts only after a probe job finds none of its sentinels, no Windows drive or program, and none of `probePorts`.
- **Reset.** After every run the machine's `reset` command wipes the slot: on the Mac it recreates the `ci` VM, on the PC it wipes `cirunner`'s Docker data and home as root (`ci/slot`). It then loads the image from an archive no job can write, and the runner checks the image's id.
- **Ownership.** The ref `refs/leases/ci/<sha>` on GitHub, swapped with `git push --force-with-lease`. `Check` shows the run and its verdict.
- **Windows.** The window file says when the machine runs and at which size. A run is admitted only if it ends before the window turns `off`. A watchdog stops it 7 minutes before that edge, even without the runner or GitHub. Its `Check` then ends cancelled.
- **Alerts** go to the `CI alert: machine runner <machine>` issue ([Failures](testing.md#failures)).

### Install or move the runner

Install the runner, or move it to a new reviewed commit `<commit>`. Run each step on the machine, in a shell with the owner's `gh` login (on the PC, the agents' distribution):

1. Copy the examples to the names the runner reads: `cp ci/machines/<machine>.example.json ~/ci-runner/<machine>.json` and `cp ci/machines/<machine>.windows.example.json ~/ci-runner/windows.json`. In `<machine>.json`, set the paths to your home and `slot.image` to `werkflow-ci:<the commit's full id>`, the tag the build below gives. On the PC, put the agents' distribution's address from `hostname -I` into `probePorts`, and check that `wsl.exe -d werkflow-ci -u cirunner --exec id -u` prints the uid in `slot.dockerHost` and `slot.socket` (1002 in the example); otherwise put the printed uid in both.
2. Put the CI App's private key in `~/ci-runner/key/ci-app.pem`, the one file `appKeyFile` names: `mkdir -m 700 ~/ci-runner/key` and `chmod 600` on the file. The runner refuses a key others can read. On the PC it stays in the agents' distribution, never in `werkflow-ci`.
3. Check out the commit:

   ```bash
   git clone https://github.com/werk-flow/werkflow-app.git ~/ci-runner/werkflow-app   # first install only
   cd ~/ci-runner/werkflow-app && git fetch origin && git checkout --detach <commit>
   bun scripts/ci/trusted-checkout.ts ~/ci-runner/werkflow-app
   ```

   `trusted-checkout.ts` checks that the checkout and `bun.lock` are the commit's, and installs `node_modules` again from the lockfile with an empty package cache. The service runs it before every start.

4. Prepare the slot and build the image there. `$SLOT` is `colima ssh --profile ci --` on the Mac and `wsl.exe -d werkflow-ci -u cirunner --exec` on the PC. `--exec` hands each argument on as it is; `--` would pass them through the distribution's shell, which splits and expands them.
   - **Mac, first install only:** `colima start --profile ci --cpu 4 --memory 6 --mount "$HOME/.colima-ci-empty"` after `mkdir ~/.colima-ci-empty`, so no folder of the Mac is mounted. Then `$SLOT sh -c 'sudo install -d -o "$(id -un)" /var/lib/werkflow-ci'`.
   - **PC, first install only:** `$SLOT mkdir -p /home/cirunner/ci`. Check that arguments arrive intact: `$SLOT sh -c 'printf "<%s>" "$@"' x 'a b' '"q"' '$HOME'` prints `<a b><"q"><$HOME>`.
   - **PC, first install only, no way to Windows:** as root in `werkflow-ci`, write `/etc/wsl.conf` with `[automount]` `enabled=false` and `mountFsTab=false`, and `[interop]` `enabled=false` and `appendWindowsPath=false`. Then run `wsl.exe --terminate werkflow-ci`, never `--shutdown`, which would stop the agents' distribution too. The probe refuses a slot that still reaches `/mnt/c`, `wsl.exe` or interop.
   - **First install only, the stack's ports:** the Supabase stack's ports 54321–54327 must lie outside the range outgoing connections take, in the network the jobs use. The runner's probe checks it and refuses to start otherwise; no job changes it.
     - **Mac:** `$SLOT sudo sh -c 'echo "net.ipv4.ip_local_port_range = 55000 65000" > /etc/sysctl.d/90-werkflow-ci.conf && sysctl --system'`.
     - **PC:** the rootless Docker's own network namespace. Add `~/.config/systemd/user/docker.service.d/ports.conf` for user `cirunner` in `werkflow-ci`, holding `[Service]` and `ExecStartPost=/bin/sh -c 'nsenter -U --preserve-credentials -n -t "$(cat %t/dockerd-rootless/child_pid)" sysctl -w net.ipv4.ip_local_port_range="55000 65000"'`. Then `$SLOT systemctl --user daemon-reload` and `$SLOT systemctl --user restart docker`.
   - Build:

     ```bash
     cd ~/ci-runner/werkflow-app   # HEAD here is <commit>
     git archive HEAD ci/image | $SLOT sh -c 'rm -rf "$HOME/ci-image" && mkdir -p "$HOME/ci-image" && tar -x -C "$HOME/ci-image"'
     $SLOT sh -c 'DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock" exec docker build --build-arg TRUSTED_COMMIT="$1" -t "werkflow-ci:$1" "$HOME/ci-image/ci/image"' build "$(git rev-parse HEAD)"   # PC
     $SLOT sh -c 'exec docker build --build-arg TRUSTED_COMMIT="$1" -t "werkflow-ci:$1" "$HOME/ci-image/ci/image"' build "$(git rev-parse HEAD)"   # Mac
     ```

   - **The reset**, after each build: keep the image as an archive no job can write, and set up `reset` in `<machine>.json` as the example has it.
     - **Mac:** `mkdir -p ~/ci-runner/image && $SLOT docker save "werkflow-ci:$(git rev-parse HEAD)" > ~/ci-runner/image/werkflow-ci.tar`. Each reset deletes the `ci` VM and starts a new one at its size, so each run fetches the repository afresh.
     - **PC:** as root in `werkflow-ci` (`wsl.exe -d werkflow-ci -u root --exec`): install `ci/slot/reset-rootless.sh` as `/usr/local/sbin/werkflow-ci-reset`, mode 755. Copy `cirunner`'s `docker.service`, `docker.service.d/ports.conf` and `daemon.json` into `/etc/werkflow-ci`. On the first install, `git clone --bare https://github.com/werk-flow/werkflow-app.git /var/lib/werkflow-ci/git.git`. Then save the image to `/var/lib/werkflow-ci/image.tar` with `DOCKER_HOST=unix:///run/user/<uid>/docker.sock docker save`. `/var/lib/werkflow-ci` and `/etc/werkflow-ci` stay root's, mode 700 and 755.

5. Start the service:
   - **Mac:** a launchd agent `~/Library/LaunchAgents/app.werkflow.ci-runner.plist`. launchd expands no `~`, so every path in it is absolute. Its `ProgramArguments` are `/bin/sh`, `-c` and `<bun> /Users/<user>/ci-runner/werkflow-app/scripts/ci/trusted-checkout.ts /Users/<user>/ci-runner/werkflow-app && exec <bun> /Users/<user>/ci-runner/werkflow-app/scripts/ci/machine-runner.ts --config /Users/<user>/ci-runner/mac.json`, with `bun`'s absolute path for `<bun>`. Set `KeepAlive` and `RunAtLoad` to true and `StandardOutPath` to `/Users/<user>/ci-runner/runner.log`. Load it with `launchctl bootstrap gui/$(id -u) <plist>`; after a move, `launchctl kickstart -k gui/$(id -u)/app.werkflow.ci-runner`.
   - **PC:** a systemd user unit `~/.config/systemd/user/werkflow-ci-runner.service`. Its `[Service]` holds `WorkingDirectory=%h/ci-runner/werkflow-app`, `ExecStartPre=<bun's absolute path> scripts/ci/trusted-checkout.ts %h/ci-runner/werkflow-app`, `ExecStart=<bun's absolute path> scripts/ci/machine-runner.ts --config %h/ci-runner/pc.json`, `Restart=always`, `RestartSec=30` and `KillMode=process`. `KillMode=process` leaves a run's watchdog alive across a restart. Its `[Install]` holds `WantedBy=default.target`. Run `systemctl --user daemon-reload && systemctl --user enable --now werkflow-ci-runner`. After a move, `systemctl --user restart werkflow-ci-runner`; the run ends as cancelled.
6. Read the log (`~/ci-runner/runner.log`, or `journalctl --user -u werkflow-ci-runner` on the PC). Its first line names the machine, its generation, the commit and the image's id. A failed integrity check, probe or reset, a slot that cannot be emptied or a profile other than `local` stops the runner before its first claim. The log names each reset's duration.

A restart takes a new generation: the runner cancels the older generation's run and empties the slot's daemon of every container and volume before it claims anything.

## Keep the agents moving

T3 Code wakes a thread when something it watches changes: a check or comment on a pull request it watches, an answered question, a finished child. It fails in known ways. A merge ends the watch without a wake. A watch stops after 10 comment-only wakes. A child's hand-back after its own review round never reaches its lead.

The notifier, `ops/notifier.py`, closes those gaps. It runs every 2 minutes on every machine and uses no AI. It reads the T3 state of its own machine read-only, and one GitHub snapshot that one machine reads for all of them every 10 minutes. Every message it sends starts with `[notifier]`.

1. **It repairs what T3 dropped.** A thread hears once that a pull request it links merged, or that an issue or pull request it left a `Waiting: <threadId>` comment on closed. A child's hand-back that T3 never delivered reaches the lead with the child's final message.
2. **Every 10 minutes it checks the outcome.** Every open pull request and every lead that is not settled must be moving or have a reason to wait that T3 or GitHub shows. Moving means a thread of the lead's tree ran in the last 20 minutes, not started by the notifier. A reason is a question to the owner still open, the thread snoozed, a `Waiting:` comment on an open item, an Actions run in progress, the pull request in the merge queue, or an unanswered CodeRabbit request. A snooze, a `Waiting:` comment, the merge queue or a CodeRabbit request stops counting once its item has not moved for 4 hours; an open owner question and a running Actions job count as long as they last. If nothing holds, the lead gets one message with the facts and "Nothing is moving this. Act now, or record a real reason." The same item wakes at most once an hour. At the third stall in a row, the lead asks the owner through the question tool.
3. **It raises one alert instead of many wakes.** When GitHub Actions has run nothing for 15 minutes while work waits for it, an alert issue goes to the CI lead, and that alert counts as every lead's reason to wait. An open pull request whose threads are all settled wakes their lead, or goes to an alert issue when no lead is left.
4. **It makes sure the owner's decisions reach the owner.** A lead whose "Owner queue" comment has no question open in T3 is told to ask through the question tool.

A lead that waits on purpose records it where T3 sees it: a question through the question tool, a snooze until a set time, or a `Waiting:` comment. The machine that reads GitHub posts one line a day on the coordination issue: wakes, repeat stalls, open owner questions with the oldest's age, and each machine's last pass. `tail ~/.local/state/notifier.log` shows each pass.
