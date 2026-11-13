# Set up a machine

How to make a workstation or a headless Linux host ready for agent work, and which background jobs each machine runs. [Environments](environments.md) owns the backends, the env files and the worktree rules.

## Set up a new machine

1. Install Bun, Node 22 or later, git, the GitHub CLI, Docker and the Supabase CLI. On Windows, clone and work inside WSL Ubuntu.
   On an Apple Silicon Mac, run `softwareupdate --install-rosetta` and `brew install colima docker flock`, then `colima start --cpu 4 --memory 6 --disk 40 --vm-type vz --vz-rosetta --mount-type virtiofs` ([why Rosetta](standards-audit.md#keep-accepted-screens-as-visual-references)). Run the repository's pinned CLI with `bunx supabase`. Grow the VM only for a measured need. On AC power, `caffeinate -s` keeps the Mac awake for agents.
2. Export the owner's Supabase personal access token as `SUPABASE_ACCESS_TOKEN`, with a copy in every env backup (a switch overwrites `.env.local`). Never commit or print it.
3. Get the DEV `.env.local` from the owner's password manager and copy it to `.env.dev-backup`. Add `.env.live-backup` only for production sessions.
4. Add the DEV MCP server `supabase` ([which tool reaches what](environments.md#which-tool-reaches-what)) to Claude Code (`claude mcp add --scope user --transport http supabase "<url>"`) and Codex (`[mcp_servers.supabase]` in `~/.codex/config.toml`). The owner signs in once per tool. Never add a server for PROD. The Vercel CLI, signed in as the owner, serves both.
5. Run `supabase start` and `supabase db reset`. Create `.env.local-stack-backup` from `supabase status`, then run `bun run env:local`.
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
| `worktree-cleanup`, load watch | Each machine, for itself |
| [CodeRabbit queue](coderabbit.md#the-coderabbit-queue), `ci-alert` | The PC and the Mac; only the lease holder acts. A further machine runs only its own `worktree-cleanup` and load watch |
| [Production watcher](recovery-and-incidents.md#monitoring) | Where its [token](environments.md#credentials) is |
| [Recovery rehearsal](recovery-and-incidents.md#recovery-rehearsal) | The PC, beside the stack |
| `report-dispatch`: starts one report thread per waiting [problem report](../features/problem-reports.md#current-product-baseline), blockers first; does nothing while the hand-out is off | The lease holder among the machines with the hand-out [file](environments.md#credentials) |

A lease is the ref `refs/leases/<job>` (`ops/lease.py`): its holder renews it every pass; another machine takes over once it lapses.
