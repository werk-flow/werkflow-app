# AGENTS.md

Reach every other doc through [the docs index](docs/README.md). Do not glob the docs tree.

## Workspace

Three independent Git repositories share the parent `Code` directory.

| Repository | Owns | Read when |
| --- | --- | --- |
| [werkflow-app](docs/README.md) | The product, its tests, infrastructure and releases | App work |
| [werkflow-business](../werkflow-business/docs/README.md) | Offer, avatar, acquisition, beta partner, customer research | Business decisions, commercial promises |
| [werkflow-website](../werkflow-website/AGENTS.md) | Public website and campaign pages | Marketing pages |

- Work in the repository that owns the task. Read a sibling's `AGENTS.md` and index before you use its context; reading never authorizes a change there. Report missing context, never invent it. The [workspace workflow](../werkflow-business/docs/workflow.md) owns source freshness and machine setup.
- Business work uses the [Hormozi advisor](../werkflow-business/.agents/skills/hormozi-advisor/SKILL.md) and its [baseline](../werkflow-business/docs/library/baseline.md); customer-facing copy adds [copywriting](../werkflow-business/.agents/skills/copywriting/SKILL.md) and the [copy standard](../werkflow-business/docs/copy-standard.md). Routine engineering loads neither.

## Product

WerkFlow is the operations backbone for German SHK businesses (`Sanitär-Heizungs-Klima`): a TypeScript web app, with a React Native app planned.

- The buyer is the owner of a medium-to-large SHK business. The users are the whole company. Field workers (`Handwerker/in`) set the bar: clear, forgiving, hard to misuse.
- It answers in one place: what work is due, for whom, who does it when, in which state, with how much time, documents and material.
- Phase 1 builds the operational core, Phase 2 AI on its data ([capability map](docs/product/product-capability-map.md)). A feature spec's **Current Product Baseline** owns implemented behavior; a planned capability is not a feature.
- A new feature must cut paperwork, organize the work, or save employees or the owner time. If it does none, raise it with the owner as likely bloat.

## The six virtues

Each rule has a tier ([decision 0005](docs/decisions/0005-enforcement-ladder.md)):

- **Tier 1** makes the mistake unwritable. **Tier 2** is a check that fails on it. Both are hard rules; change one only with its mechanism and the owner.
- **Tier 3** is a default a reviewer judges. Diverge when it clearly does not fit, and record in the commit body the default, why, what you did instead, and whether the default should change; if so, change the owner doc too.
- Every security rule is hard, except the two Tier 3 defaults of virtue 3.

Before you write, read "How to work" and "Never" in each owner doc your task touches. A change is done when its "Verify your work" commands pass and each Tier 3 point has a recorded answer.

When a rule is missing, wrong or too costly, raise it with the owner and change rule and mechanism together. A new rule takes the highest reachable tier; existing breaches are fixed now or get a [backlog](docs/technical/enforcement-ladder-backlog.md) row. A fixed defect or kept review finding names the tier of its prevention.

### 1. UI and UX

Owner: the `werkflow-design` skill ([How to work](.claude/skills/werkflow-design/SKILL.md#how-to-work)).

- Tier 1 and 2: build from the registry in `components/ui/` and `components/shared/`. No raw `<button>`, text `<input>`, `<h1>` or native select or date control. No hardcoded hex value, radius or palette class.
- Every route has a `loading.tsx` skeleton; a failed region shows a retry.
- A submit stays enabled. Missing input marks the fields and focuses the first (`focusFirstInvalidField`).
- Tier 3: hierarchy, density, natural German and fit for the role ([rendered design acceptance](docs/technical/standards-audit.md#rendered-design-acceptance)).

### 2. Performance and immediate feedback

Owner: [realtime and caching](docs/technical/realtime-and-caching.md#how-to-work) and [performance](docs/technical/performance.md).

- Tier 1 and 2: every action shows feedback in its first frame (`useServerAction`, `useOptimisticList`). A saved result reaches every view and session.
- A list reads completely in pages and reports an overflow (`readAllRows`). No silent truncation, `useTransition`, polling or toast.
- Daily journeys keep lab counts that only fall. Never buy a lower count with staler data, or raise a budget or timeout to pass.
- Tier 3: which flows are journeys, which readers are cached, which wins earn their code.

### 3. Security

Owner: [security](docs/technical/security.md#how-to-work).

- The server establishes identity, organization, role and object permission before every protected operation (`lib/org/action-context.ts`). A test drives the real action with a foreign id.
- Never restrict only in the UI. Never trust an id, organization or role the client sent.
- A migration that creates a table enables RLS, adds policies and grants explicitly. Never grant to `anon`.
- An identity check that cannot complete is a failure, never a sign-out and never access.
- Never export a helper from a `'use server'` module, or send file bytes through a Server Action.
- Never log personal data, codes or provider bodies (`lib/logging.ts`).
- Never write to PROD outside a release the owner requested.
- Tier 3 defaults: whether a permission check fits its operation, and every accepted residual exposure.

### 4. Code quality and maintainability

Owner: [code quality](docs/technical/code-quality.md#how-to-work), with the `typescript-best-practices` skill.

- Tier 1 and 2: no `any`, `!` or `as` assertion. No copied helper or type, dead code or unused export. Rows that change together change in one database function call.
- Tier 3: the smallest clear code for the confirmed outcome, one owner module per domain rule, no abstraction for future scope, a final deletion pass.
- Never remove authorization, validation, audit history or failure visibility to save lines.

### 5. Testing and review

Owner: [testing](docs/technical/testing.md#how-to-work).

- Tier 2: never merge without a green `Check`.
- Put each rule at the cheapest boundary that exposes its failure: unit, SQL, component contract or browser journey. A failing test names the broken invariant.
- Diagnose a failure before you rerun. Never retry until green, weaken an assertion, skip a test, sleep or raise a timeout.
- Tier 3: whether an assertion proves its clause, a failure's classification, and each review finding's disposition.

### 6. Documentation

Owner: [the docs index](docs/README.md#how-to-work), with the `writing-for-agents`, `technical-writing` and `unslop` skills.

- Tier 2: `bun run docs:check`.
- Tier 3: a doc holds what code and the database cannot say, each fact in one home, changed with the behavior. No inventory, count, dated narrative, unrequested report, or repository fact in agent memory.

## Ways to hurt yourself

1. **PROD.** Never push to `main` or `production`, migrate PROD by hand, or run tests or bulk scripts against it. Read it only through read-only tools ([work on production](docs/technical/environments.md#work-on-production)).
2. **The shared local stack.** Every worktree uses one Supabase stack. On Windows it runs in WSL Ubuntu; run every command inside Linux or macOS. `supabase db reset` and `supabase stop` hit all worktrees ([work in a worktree](docs/technical/environments.md#work-in-a-worktree)).
3. **Money and time records.** Recorded time, the Zeitkonto, Perioden, payroll exports and prices are money, so their logic is review level 2. Change recorded time only through an audited correction. Never erase history or write into a closed period.
4. **The public repo.** `werkflow-app` is public. Never commit a secret, customer or personal data, or content from `werkflow-planning` or `werkflow-business`. Cite a planning issue as `werk-flow/werkflow-planning#<n>`.
5. **Deletes after `cd`.** Delete with an explicit absolute path, or inside a fresh `mktemp -d` folder. Never `cd` somewhere and then `rm -rf` a wildcard: Claude Code cannot resolve the target and stops the thread for the owner, even in full access (`.claude/hooks/refuse-delete-after-cd.ts` refuses it).

## Hit every surface

Before UI work is done, check each surface and name in the PR the ones that applied:

- **Roles:** `admin`, `buero` and `employee`. Keep intentional role differences and the organization boundary; the server enforces both. Favor defaults over configuration.
- **Screens:** phone at 375 px and desktop.
- **Themes:** light and dark.
- **States:** empty, loading and error.
- **Copy:** natural German that says "du".
- **Captures:** each changed screen before and after (`@ACCEPT`).

## Decide or ask

- Do whatever your tools can do. The owner supplies only the owner's own passwords, tokens and account settings.
- The owner decides business scope, money and paid services, PROD and releases, analytics or new personal data, and what a virtue demands. Decide everything else as you would recommend, and record why in the commit body, or the owning doc for a lasting rule.
- Ask when scope, acceptance or an edge case is ambiguous; never invent business strategy. Ask through the ask-user tool and end your turn, so T3 Code flags the thread. Never bury an owner action in a status message.
- **The Willert rule.** When a decision would be expensive to rebuild if an SHK assumption is wrong, ask the owner through the question tool and propose a concrete question for a named role at Willert Haustechnik, the beta partner.
- Tamay owns product and offer; John owns sales and customers. A business ambition never adds a feature, entitlement or analytics by itself, and sales positioning stays out of feature logic.

## Pull requests

A task is a worktree, a branch and one small PR per problem ([decision 0009](docs/decisions/0009-pull-requests-and-ci.md)). Never commit to `main`. [Reviews](docs/technical/coderabbit.md) owns the levels, babysitting and the merge gate.

- Level 0, no behavior effect (docs, comments, agent instructions): your own read.
- Level 1, behavior (product code, tests, CI, scripts), the default: `sol-loop`.
- Level 2, security, auth, RLS, a migration, personal data, deletion, time or payroll: `sol-loop`, then one CodeRabbit review from the `needs-coderabbit` queue.

1. Run `bun run check:changed`. For level 1 and 2, run `sol-loop`.
2. Push, and open the PR with the `file-pr` skill, naming the level and its reason.
3. Call `watch_pull_request`, end your turn, and babysit until [the merge gate](docs/technical/coderabbit.md#the-merge-gate) holds.
4. Once the PR meets the merge gate, its own thread squash-merges it. A "full stop" PR, or one that changes `AGENTS.md`, waits for the owner's read and merge.

## Language

- Everything a user sees, aria labels included, is natural German with real umlauts and `ß`.
- Code, comments, commits and developer docs are English. Route names and database values keep the German domain terms.

Domain terms, each defined by its feature spec: `Auftrag` (work order), `Projekt` (several jobs), `Organisation` (the company boundary), `Anfrage` (customer request), `Einsatz` (dispatched work), `Arbeitsnachweis` (site evidence), `Übergabe` (office-reviewed handover), `Aufgaben` (the one task and approval list), `geparkt` (intentionally unscheduled), `buero` (the office role).

## Tools, branches and releases

- Use Bun and `bunx`. Keep `bun.lock`, leave `package-lock.json` as is, add no other lockfile.
- In a worktree, wait for `.t3/setup-done` before you run a script.
- Generated types (`lib/supabase/database.types.ts`) and live Supabase inspection outrank every schema description.
- A schema change follows [the migration rule](docs/technical/environments.md#the-migration-rule): one migration per PR at most, with its regenerated types, expand-only.
- The stack is settled ([decision 0001](docs/decisions/0001-infrastructure-stack.md)). Propose no provider migration without a superseding decision.
- `main` is staging on DEV, `production` is PROD. Release only when the owner or the coordinator thread asks ("release main"): run `gh workflow run release` and `gh run watch`, check production, roll the app back through Vercel if it breaks ([release and rollback](docs/technical/environments.md#release-and-rollback)), and report.
