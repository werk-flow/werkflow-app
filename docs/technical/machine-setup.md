# Set up a machine

How to make a workstation or a headless Linux host ready for agent work, which background jobs each machine runs, and who removes a finished worktree. [Environments](environments.md) owns the backends, the env files and how to work in a worktree.

## Set up a new machine

1. Install Bun, Node 22, git, the GitHub CLI and Docker. Every machine runs the same Node major. Install no global Supabase CLI: everyone runs the repository's pinned CLI with `bunx supabase`. On Windows, clone and work inside WSL Ubuntu. On Linux, add the working user to the `docker` group (`sudo usermod -aG docker "$USER"`, then sign in again), so agents run Docker without `sudo`.
   In every Claude Code user settings file, deny the claude.ai Supabase connector with `"deniedMcpServers": [{ "serverName": "claude.ai Supabase" }]`. On the PC that means both `~/.claude/settings.json` in WSL and `%USERPROFILE%\.claude\settings.json` on Windows. The repository's MCP hook refuses the connector in any session that runs this repository's hooks. The setting covers the sessions that don't, such as the desktop app outside the repository.
   On an Apple Silicon Mac, run `softwareupdate --install-rosetta` and `brew install colima docker flock`, then `colima start --cpu 4 --memory 6 --disk 40 --vm-type vz --vz-rosetta --mount-type virtiofs` ([why Rosetta](standards-audit.md#keep-accepted-screens-as-visual-references)). Grow the VM only for a measured need. On AC power, `caffeinate -s` keeps the Mac awake for agents.
   After that first start, the launchd agent `app.werk-flow.colima` from `ops/install-mac.py` starts Colima and the local stack at login, without Terminal. Check it with `colima status` and `launchctl print gui/$(id -u)/app.werk-flow.colima | grep state`.
2. Install the machine's [agent keys](#agent-keys). The machine's thread opens one T3 secret card with a field per key, delivered as files, and the owner creates each key for this machine and pastes it in. The thread runs `bun run agent-keys:install -- <NAME>=<file> …` with the card's files: it writes the keys into the key file and refuses one out of its shape.
   The DEV scripts (`migrations:check`, `auth:check`, `advisors:check`, `types:check` and the canary's DEV queries) send `SUPABASE_ACCESS_TOKEN` when the environment sets it, as CI does, and otherwise the key file's `SUPABASE_DEV_ACCESS_TOKEN` (`lib/security/dev-management-api.ts`). `types:check` hands it to the Supabase CLI in the CLI's environment. So no machine keeps a Supabase token in `.env.local` or as the CLI's login. PROD is read only by the [PROD inspection](environments.md#which-tool-reaches-what). Never sign the CLI in with `supabase login` and its browser, which mints a token for the whole account, PROD included, and never with an account token. Never put an account token or a PROD key on an agent machine outside step 3's one exception, and never commit or print a token: `agent-access:check` fails on a Supabase token that does not reach DEV or that reaches PROD.
3. Get the DEV `.env.local` from the owner's password manager and copy it to `.env.dev-backup`, mode 600. `.env.live-backup` holds PROD keys and lives in the owner's password manager: it enters a checkout only for the owner's own [production session](environments.md#work-on-production) and leaves the machine after it ([residual exposure](security.md#known-residual-exposure)).
4. Add the DEV MCP server `supabase` ([which tool reaches what](environments.md#which-tool-reaches-what)) to Claude Code and Codex, the same on every machine. It runs `scripts/mcp/supabase-dev.ts` from the root checkout (`~/code/werkflow-app`, after `bun install --frozen-lockfile` there). The script starts Supabase's MCP server, pinned in `package.json`, on DEV in read-only mode with the key file's `SUPABASE_DEV_ACCESS_TOKEN`. No token sits in a configuration file or an agent's environment, and nobody signs in. It refuses any ref but DEV's; the MCP hook reads the ref from the configuration. First remove an older `supabase` server, such as the hosted one with an OAuth sign-in (`claude mcp remove --scope user supabase`, and its Codex table).
   Both forms name the root checkout's absolute path in place of `<root checkout>`, such as `/home/<user>/code/werkflow-app` on Linux and `/Users/<user>/code/werkflow-app` on macOS, never `~` or `$HOME`: the sign-in hook refuses a `supabase` word followed by a word the shell expands.
   - Claude Code: `claude mcp add --scope user supabase -- bun <root checkout>/scripts/mcp/supabase-dev.ts --project-ref=mbkkzuqjbdvzelqvuzcn`
   - Codex, in `~/.codex/config.toml`:

     ```toml
     [mcp_servers.supabase]
     command = "bun"
     args = ["<root checkout>/scripts/mcp/supabase-dev.ts", "--project-ref=mbkkzuqjbdvzelqvuzcn"]
     ```

   Verify in each tool: `list_tables` and `select 1` answer, and a write fails with SQLSTATE 25006. Never add a server for PROD. Agents reach Vercel only through the Vercel MCP connector: install no Vercel CLI, since a signed-in CLI acts for the whole account, PROD included. After a change to `.codex/hooks.json`, the owner trusts it with `/hooks` in Codex on each machine; Codex skips an untrusted hook.
5. On `main`, run `bunx supabase start` and `bun run stack:sync`. Create `.env.local-stack-backup` from `supabase status`, then run `bun run env:local`.
6. Run `bunx playwright install --with-deps chromium` once.
7. CodeRabbit: `curl -fsSL https://cli.coderabbit.ai/install.sh | sh`. The owner signs in once with `coderabbit auth login`. `bun run review:doctor` confirms both. Agents install CodeRabbit only here.
8. Install the [background jobs](#background-jobs); `bun run room` prints numbers.
9. Verify: `bun run agent-access:check` passes, `bun run migrations:check` passes, `bun run prod:inspect` fails and names the PROD inspection job, `bun scripts/check-r2.ts` passes, and `WERKFLOW_VERIFY_LOCAL=1 bun run test:verify --group golden:gg-00` passes beside `bun run test:server local`.
10. Store the "Setup worktree" action of `t3.json` in this machine's T3 Code settings: T3 Code does not run it from `t3.json` alone, and setting `scripts` through the project API does not start it either. On a headless host, put it in `projectScriptOverrides` and in `projectSettingsOverrides.<project>.defaultProjectScripts` of `~/.t3/userdata/settings.json`, then run `t3 service restart`. Verify: a thread launched there gets `.t3/setup-done` and `.env.local` in its worktree.

### A headless Linux host

- Run T3 Code as the working user, never as root, and run `loginctl enable-linger` for that user, so its services outlive the login.
- T3 Code runs as a systemd user service with the `PATH` `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`. Link `bun`, `bunx`, `codex`, `claude` and `t3` into `/usr/local/bin`. Put the `PATH` export at the top of `~/.bashrc` too: Debian's returns early for a non-interactive shell.
- Docker publishes the local stack on `0.0.0.0`. On a machine with a public address, a firewall outside Docker drops every incoming connection except SSH and the UDP replies from ports 53, 123 and 7844. Without the 7844 rule, T3 Connect falls back to HTTP/2 after three minutes.
- Docker's published ports skip the host's `INPUT` chain, so the same machine also drops new connections from its public interface to every container. Add the rule to the `DOCKER-USER` chain for IPv4 and IPv6, and keep it across reboots and Docker restarts with a oneshot system unit that runs after `docker.service` and is part of it:

  ```sh
  for tool in iptables ip6tables; do
    "$tool" -C DOCKER-USER -i <public interface> -m conntrack --ctstate NEW -j DROP 2>/dev/null ||
      "$tool" -I DOCKER-USER -i <public interface> -m conntrack --ctstate NEW -j DROP
  done
  ```

  Verify after a reboot: `sudo iptables -S DOCKER-USER` and `sudo ip6tables -S DOCKER-USER` each list the rule, `curl -s http://127.0.0.1:54321` still answers on the machine, and a connection to port 54321 from outside fails.

## Agent keys

Agents hold four keys per machine (`pc`, `mac`, `netcup`) for DEV, staging and the Stripe sandbox, never for PROD or live Stripe. Each machine has its own copy of each key, so revoking one machine's key leaves the others working. The keys live in `~/.config/werkflow/staging-agents.env` (on Windows in the WSL home), mode 600 in a 700 folder. `lib/security/staging-agent-keys.ts` owns the names and shapes, and reads the file for the process that uses a key, which never prints it. The owner creates every key ([step 2](#set-up-a-new-machine)); no agent creates, prints or forwards one.

| Variable | Key name | Scope | Used by | Expires | Revoke one machine |
| --- | --- | --- | --- | --- | --- |
| `SUPABASE_DEV_ACCESS_TOKEN` | `werkflow-DEV-agents-<machine>` | Scoped token: project WerkFlow App Dev only, Read on every area except secrets and API keys, no Write | The DEV MCP server ([step 4](#set-up-a-new-machine)) and the DEV scripts ([step 2](#set-up-a-new-machine)) | One year | Account, Access Tokens: the token's row, Revoke |
| `SUPABASE_DEV_SECRET_KEY` | `werkflow_dev_agents_<machine>` | A secret API key of DEV | Staging journeys: DEV test users and their rows | Never | DEV, Project Settings, API Keys: the key's row, Delete |
| `STRIPE_SANDBOX_KEY` | `werkflow-STAGING-agents-<machine>` | Sandbox restricted key (`rk_test_`). Write: Customers, Payment Methods, Setup Intents, Subscriptions, Invoices, Credit Notes, Refunds, Test Clocks. Read: Checkout Sessions, Payment Intents, Charges, Prices, Products, Events, Webhook Endpoints, Balance. Nothing else | Staging journeys in the sandbox | Never | The sandbox's API keys: the key's row, Delete |
| `VERCEL_STAGING_BYPASS_SECRET` | `werkflow-STAGING-agents-<machine>` | An extra Protection Bypass for Automation secret with this note, never the project's `VERCEL_AUTOMATION_BYPASS_SECRET` | The journeys' browser past staging's Vercel Authentication. Vercel accepts it on PROD's deployments too ([residual exposure](security.md#known-residual-exposure)); PROD's data still needs a PROD sign-in | Never | Deployment Protection, Protection Bypass for Automation: the secret's row, Revoke |

- `bun run agent-access:check` proves the file's modes and the keys' shapes, that the access token reaches DEV's project and is refused PROD's and a write, that the secret key reads DEV's Auth, that the Stripe key answers `livemode: false`, and that staging refuses a request without the bypass and passes one with it. Both project probes are reads a project-scoped token can make (`GET /v1/projects/<ref>`); PROD's ref comes from [the cloud-backend table](environments.md#the-two-cloud-backends). A write passes as refused on `403`, or on a read-only transaction (SQLSTATE `25006`) only while the same token reads DEV's [read-only mode](https://supabase.com/docs/guides/platform/database-size#read-only-mode) as off before and after the write (`GET /v1/projects/<ref>/readonly` answers `200` with `enabled` and `override_enabled` both `false`), because that mode refuses any token's write the same way. The same probes run on any `SUPABASE_ACCESS_TOKEN` assignment in the checkout's env files, so an account-wide token fails. It also fails on an env file whose mode is not 600, or that it cannot read. It prints names and `ok`, `failed` or `missing`, never a value.
- Rotate a machine's keys when the machine is lost, reinstalled or handed on, or when a value may have reached a log or a model's context. The owner creates the successor with the same name, the thread installs it through a secret card, `agent-access:check` passes, then the owner revokes the old key. A Stripe key rotates with "Rotate key".
- `.claude/hooks/refuse-boat-key-reads.ts` refuses an agent's read, print, copy or search of a workstation secret file and names who reads it instead: the key file, the Boat key, the hand-out file, the Supabase CLI's login, `~/.werkflow-stripe-sandbox/`, and `.env.live-backup` in any checkout.
- Agents get no Resend, R2 or Vercel API key: none can be limited to staging. They check mail through the app's records on DEV, files through the app's downloads, and Vercel through the Vercel MCP connector.

## Background jobs

The three agent machines (`pc`, `mac`, `netcup`) share one setup. Apart from OS and hardware, they differ only in the jobs below. The `ops/` scripts of `werk-flow/werkflow-planning` run from `~/code/werkflow-planning`, as systemd user timers on Linux and launchd agents on the Mac (`ops/install-mac.py`). `werkflow-uptime` is a system timer (`ops/uptime-install.sh`). The [production watcher](recovery-and-incidents.md#monitoring) runs on GitHub, and no machine holds its token.

| Job | Runs on |
| --- | --- |
| `worktree-cleanup`: removes finished worktrees and their branches, and fast-forwards each root checkout's `main` | Each machine, for itself |
| Load watch (`workstation-load`), [notifier](#keep-the-agents-moving) | Each machine, for itself |
| `boat-starts`: counts Boat's machine starts per day and raises an alert before the plan's limit | Each machine; only the lease holder counts |
| [CodeRabbit queue](coderabbit.md#the-coderabbit-queue), `ci-alert`, which also starts a late [production watcher](recovery-and-incidents.md#monitoring) run | The PC and the Mac; only the lease holder acts |
| [Recovery rehearsal](recovery-and-incidents.md#recovery-rehearsal) | The PC, beside the stack |
| `report-dispatch`: starts one report thread per waiting [problem report](../features/problem-reports.md#current-product-baseline), blockers first; does nothing while the hand-out is off | The netcup VM, the one machine with the hand-out [file](environments.md#credentials). The Mac's installer and the Linux unit skip a machine without it |
| `werkflow-uptime`: every 5 minutes, checks that PROD's and DEV's login pages and Supabase health endpoints answer | The netcup VM |
| `dev-deploy-alert`: opens a `CI alert` issue when `werkflow-uptime` misses twice in a row, and closes it on the next green pass | The netcup VM, beside `werkflow-uptime` |

A root checkout (`~/code/<repository>` of each workspace repository) on another branch, with changes, or with commits that `origin/main` lacks keeps its state, and `~/.local/state/worktree-cleanup.log` names it. A thread started at a project's root runs that checkout's hooks and skills, so leave each root on a clean `main`.

A lease is the ref `refs/leases/<job>` (`ops/lease.py`): its holder renews it every pass; another machine takes over once it lapses. A lease is read with `git fetch` and swapped with `git push --force-with-lease`, so it costs no GitHub API call.

## Keep the agents moving

T3 Code wakes a thread when something it watches changes: a check or comment on a pull request it watches, an answered question, a finished child. It fails in known ways. A merge ends the watch without a wake. A watch stops after 10 comment-only wakes. A child's hand-back after its own review round never reaches its lead.

The notifier, `ops/notifier.py`, closes those gaps. It runs every 2 minutes on every machine and uses no AI. It reads the T3 state of its own machine read-only, and one GitHub snapshot that one machine reads for all of them every 10 minutes. Every message it sends starts with `[notifier]`.

A thread with a run active or queued gets no message until its runs end. Then its notices arrive as one message, without those whose reason passed meanwhile:

- a merge or close, once a turn that started after it has ended;
- a hand-back, once T3 delivered it;
- an Owner queue nudge, once a question is open in T3;
- a stall, once the work moved or got a reason.

A thread busy for 30 minutes gets its notices anyway, but never while a `[notifier]` message already waits in its queue. The notifier never edits or cancels a queued message.

1. **It repairs what T3 dropped.** A thread hears once that a pull request it links merged, or that an issue or pull request it left a `Waiting: <threadId>` comment on closed. A child's hand-back that T3 never delivered reaches the lead with the child's final message.
2. **Every 10 minutes it checks the outcome.** Every open pull request and every lead that is not settled must be moving or have a reason to wait that T3 or GitHub shows. Moving means a thread of the lead's tree ran in the last 20 minutes, not started by the notifier. A reason is a question to the owner still open, the thread snoozed, a `Waiting:` comment on an open item, an Actions run in progress, the pull request in the merge queue, or an unanswered CodeRabbit request. A snooze, a `Waiting:` comment, the merge queue or a CodeRabbit request stops counting once its item has not moved for 4 hours; an open owner question and a running Actions job count as long as they last. If nothing holds, the lead gets one message with the facts and "Nothing is moving this. Act now, or record a real reason." The same item wakes at most once an hour. At the third stall in a row, the lead asks the owner through the question tool.
3. **It raises one alert instead of many wakes.** When GitHub Actions has run nothing for 15 minutes while work waits for it, an alert issue goes to its own alert thread, which `ci-alert` starts, and that alert counts as every lead's reason to wait. An open pull request whose threads are all settled wakes their lead, or goes to an alert issue when no lead is left.
4. **It makes sure the owner's decisions reach the owner.** A lead whose "Owner queue" comment has no question open in T3 is told to ask through the question tool.

A lead that waits on purpose records it where T3 sees it: a question through the question tool, a snooze until a set time, or a `Waiting:` comment. The machine that reads GitHub posts one line a day on the coordination issue: wakes, repeat stalls, open owner questions with the oldest's age, and each machine's last pass. `tail ~/.local/state/notifier.log` shows each pass.

## Remove a finished worktree

T3 Code keeps a worktree after its thread is settled or deleted. Whoever settles a thread removes its worktree: a lead settles its finished children after it read their result ([`run-epic`](../../.claude/skills/run-epic/SKILL.md#5-merge-in-order)), and the coordinator settles finished top-level threads. A thread never removes the worktree it runs in.

1. Settle the thread (`t3_thread_organize`, `action: "settle"`). Find its checkout path and branch with `t3_worktree_list` and its `threadId`.
2. Keep the worktree, and say why in your status, while any of these holds:
   - the branch's PR is still open;
   - `git -C <path> status --porcelain` prints anything;
   - `git log <branch> --not --remotes` lists commits, and the PR did not merge;
   - another running thread works in the path.
3. Otherwise run `git worktree remove <absolute path>`, never with `--force`: it refuses a dirty tree.
4. When the PR merged or closed, run `git branch -D <branch>`.

Remove a kept worktree once its reason ends, for example when the PR merges.
