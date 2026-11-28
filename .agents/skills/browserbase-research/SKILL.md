---
name: browserbase-research
description: Use for deep or large web research for WerkFlow (market, competitors, SHK trade rules, standards, subsidies, vendor docs) that needs more than a few searches or pages. Covers `bun run browserbase` (Search, Fetch, a local browser), the shared monthly quota, and what must never be searched or opened.
---

# Browserbase research

Browserbase is the default tool for deep WerkFlow research: a run of many searches and pages. Its free plan has a monthly quota that all three agent machines share, so spend it in this order: Search, then Fetch, then the local browser, which spends nothing.

`bun run browserbase -- <command>` is the only way in. It sends Search and Fetch itself with the [agent key](../../../docs/technical/machine-setup.md#agent-keys), and runs the `browse` CLI pinned in `package.json` as the local browser driver, without the key. Never run `browse` or `bunx browse` yourself, and never pass a key: the wrapper refuses `--api-key` and `--base-url`.

## Fit beside other tools

- **A quick lookup** of one fact or one page: your built-in web search and fetch tools are fine.
- **Deep research**, such as the `deep-research` skill's runs: use this skill for the searching and reading. Give each research subagent this skill's commands and rules, and a share of the call budget.
- **The built-in browser pane and Claude in Chrome** carry the owner's sign-ins. Never use them for research. Use them only when the owner asks you to work in their browser.

## Never send or open

Every query, URL and page goes to a third party and into model context.

- Open public pages only. Never open staging, PROD, a preview deployment, a WerkFlow app URL, a page behind our credentials, or a page with customer or personal data. WerkFlow's public website is fine.
- Write queries from public facts only. A query never holds a customer, a person, an address, a phone number, a price we quoted, a beta partner detail, or an unpublished plan or number. Ask "Heizlastberechnung Software Vergleich", never a question that names the beta partner or a customer.
- The wrapper refuses some of this: WerkFlow, Supabase, R2, local and IP hosts, and e-mail addresses, phone numbers and IBANs in a query or a domain filter. It checks only the address you name: a redirect or a link you click is yours to judge. Its check is a backstop. The rule above is wider, and it is yours to keep.

## Before a large run

1. Run `bun run browserbase -- quota`. It prints this machine's Search and Fetch calls left: 300 of each per 31 days, so the three machines stay inside the plan's 1,000.
2. Estimate the run's calls. If it needs more than is left, narrow it before you start: fewer queries, fewer results per query, fewer pages.
3. Stop when the wrapper refuses a call for quota. Report what you found and what is left undone. Never switch to another machine or another tool to finish the same run.

## Search

```sh
bun run browserbase -- search "Wärmepumpe Förderung BEG 2026" --num-results 10
bun run browserbase -- search "Wartungsvertrag Heizung Pflichten" --include-domains zvshk.de,bafa.de
```

One query per call, in quotes. Each call spends one of the month's searches, whatever `--num-results` is, so ask for up to 25 results rather than repeating a query. Other filters: `--exclude-domains` (public hosts, comma-separated), `--start-published-date YYYY-MM-DD` and `--output <file>`.

## Fetch

```sh
bun run browserbase -- fetch https://www.bafa.de/DE/Energie/Effiziente_Gebaeude/effiziente_gebaeude_node.html
bun run browserbase -- fetch https://www.zvshk.de/ --output ~/scratch/zvshk.html
```

Fetch returns a page's raw HTML without running JavaScript, up to 5 MB. The free plan has no markdown or JSON extraction, so the wrapper always asks for `raw`. It never follows a redirect: on a 301 or 302 it prints the destination when the URL guard allows it and it carries no query, and you fetch that address yourself. HTML is long: write it to a file with `--output` and search it there instead of reading it into context. For a readable text view of one page, open it with `drive` and take a `snapshot`, which spends nothing.

## A browser

Use a browser only for a page that Fetch cannot read: one that renders with JavaScript or needs a click.

`drive` runs Playwright's Chromium on this machine, with a throwaway profile and no sign-ins:

```sh
bun run browserbase -- drive open https://example.com --session research
bun run browserbase -- drive snapshot --session research
bun run browserbase -- drive click @0-35 --session research
bun run browserbase -- drive stop --session research
```

`open` takes a full URL. Stop the session when you have the page.

There is no cloud browser: the pinned CLI takes a cloud session's connect URL only as a process argument, which the [security rules](../../../docs/technical/security.md) forbid for a credential. If a site blocks the local browser, use Search and Fetch, or report the page as unreachable.

`drive` refuses `--remote`, `--cdp`, `--auto-connect` and the Chrome flags, and every command that is not a page action, `eval` and `status` included.

## When it fails

- "no BROWSERBASE_API_KEY in shape": run `bun run agent-access:check`. A missing key is the machine thread's install step ([agent keys](../../../docs/technical/machine-setup.md#agent-keys)), never yours.
- "the pinned CLI is not installed": run `bun install --frozen-lockfile`.
- Browserbase answers 401: the key was regenerated. Report it; the machine needs the new key.
- Browserbase answers 402: the plan's allocation for that kind of call is spent, or the call is a paid kind. Stop the run and report it.
- Browserbase answers 429: you exceeded the rate limit (2 searches or 5 fetches a second). Run calls one after another.
