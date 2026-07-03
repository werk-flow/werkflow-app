---
name: werkflow-design
description: WerkFlow's design language and frontend conventions. Use for any UI work in this repo — React/Next.js components, styling, Tailwind, shadcn/ui, layouts, forms, dialogs, colors, dark mode, accessibility, or visual polish.
---

# WerkFlow Design Language

WerkFlow looks calm, professional, and a little "boring" on purpose. It replaces flashy legacy software and paper chaos for non-technical German SHK businesses, so clarity and trust beat visual excitement. The Aufträge and Dokumente tables are the north star: simple, elegant, quiet surfaces where content does the talking.

## Source of truth

All theme values live in `app/globals.css` (`:root` tokens + `@theme inline` mapping). **To change how the app looks, edit the tokens there — never scatter raw hex values or one-off styles in components.** This file describes intent and rules; the tokens carry the values. If tokens and this file ever disagree, tokens win — then update this file.

The generic `frontend-design` skill is useful for craft (typography discipline, states, UI copy). Where its "distinctive, bold, take a risk" direction conflicts with this calm operational language, this file wins.

## Color

- **Orange (`primary`, `--brand-orange`) is the only attention color.** Use it selectively and functionally: primary/submit buttons, focus rings, selection states, important links, step indicators, "current" markers. If orange stops being rare, it stops working.
- **Purple is a soft, desaturated undertone, never a loud accent.** The `--brand-purple*` scale is deliberately muted (grayish purple) and the neutral tokens (`muted`, `accent`, `secondary`, `border`, `input`) carry only a faint purple cast. Do not reintroduce vivid violet (the old `#7b2cbf` family) in UI — only the logo SVGs keep their vivid purple.
- Purple is also the semantic hue for parked/planning entities (`geparkt` badges, calendar job blocks, Parkplatz). Keep that coding, always via `brand-purple` tokens.
- Status colors stay semantic (green success, red destructive, yellow warning) — never rebrand them orange or purple.
- Pairing rules: orange background → white/neutral text; purple background → white/neutral/purple text; neutral background → orange **or** purple text. Never orange text on purple or purple text on orange. Same rules in dark mode.
- Logos: light mode `/logo-*-light.svg`, dark mode `/logo-*-dark.svg`, swapped with `dark:hidden` / `hidden dark:block`.

## Shape, depth, and focus

- Radius scale is deliberately modest (`--radius: 8px`): containers and cards use `rounded-lg` (8px), controls `rounded-md` (6px). Never `rounded-2xl`/`rounded-3xl`; `rounded-full` only for avatars, dots, and count badges.
- Cards and panels: `border` + `shadow-xs`, flat and quiet. Elevation shadows (`shadow-lg`+) are reserved for genuinely floating elements: dialogs, popovers, dropdowns, toasts/banners, drag previews, the clock FAB.
- Focus: 2px ring (`focus-visible:ring-2` with `ring-ring/50`), no ring offsets. Never 3px+ rings — they read as chunky. The orange ring is on-brand and required for keyboard a11y; don't remove it.
- Icons: Lucide only. A global rule in `globals.css` sets all Lucide icons to a sleek 1.75 stroke — don't pass `strokeWidth` props; for a rare intentional exception use a utility class like `[stroke-width:3]`.
- Typography: Geist Sans + Geist Mono. Hierarchy via `font-medium`/`font-semibold` and `text-muted-foreground`, not size jumps. Tabular numbers for time/amount columns.

## Density and layout

- Slim, not chunky: tabs are `h-9`, sidebar nav items `py-1.5`, active nav is a quiet neutral fill (`bg-accent` + `font-medium`), never a loud colored pill.
- Managers (admin/buero) get efficient, scannable density — tables, filters, inline actions. Field workers (employee) get simpler screens with one big, unmissable primary action; touch targets ≥ 44px on their primary flows.
- Don't wrap every block in a card. Prefer sections with headings, spacing, and dividers when hierarchy alone is enough; use cards for genuinely separate objects.
- Keep working patterns (data tables, filters, sidebar) — no marketing aesthetics (heroes, gradients, glass, parallax, scroll effects) on operational screens. Respect `prefers-reduced-motion`; transitions 150–250ms.

## Tailwind v4 + shadcn conventions

- Tailwind CSS v4 only. Single `@import 'tailwindcss';` — no `@tailwind` directives, no `content` array, no v3 plugins. Use `bg-linear-*` (not `bg-gradient-*`), built-in container queries, v4 variants.
- Prefer the shadcn primitives in `components/ui/` and existing shared components over one-off styled divs. Restyle primitives there, not per usage.
- Buttons/inputs/controls inherit their look from `components/ui/` — if a control looks wrong everywhere, fix the primitive, not the call sites.
- UI copy: natural German with umlauts/ß, sentence case, outcome-named buttons ("Speichern", "Auftrag anlegen"). Code, identifiers, comments: English.
- Accessibility: visible focus, German `aria-label`s on icon buttons, sufficient contrast for `muted-foreground`, keyboard-reachable interactions.

## Checklist before shipping UI

- [ ] Values come from tokens/primitives, no ad-hoc hex or radius
- [ ] Orange only on the things that deserve attention; purple stays quiet
- [ ] Hover/focus/disabled/loading/empty/error states covered
- [ ] Dark mode and mobile checked; German copy natural
- [ ] No new dependencies, fonts, or icon libraries; flows and role behavior unchanged

## Tweaking the design later

1. Adjust tokens in `app/globals.css` (colors, radius, dark mode) — this restyles ~80% of the app coherently.
2. For control sizing/feel, adjust the primitives in `components/ui/`.
3. Update this file only when the *intent* changes, and mirror any skill change between `.claude/skills/` and `.agents/skills/` (they must stay identical). Keep `AGENTS.md`'s styling section and `.cursor/rules/styling-and-color-guidelines.mdc` in sync.
