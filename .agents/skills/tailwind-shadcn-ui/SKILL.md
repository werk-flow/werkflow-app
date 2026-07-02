---
name: tailwind-shadcn-ui
description: Use for frontend/UI work in this WerkFlow repo involving React, Next.js, Tailwind CSS, shadcn/ui components, styling, layouts, pages, forms, dashboards, responsive behavior, accessibility, or UI refactors. Enforce Tailwind CSS v4 conventions and prefer shadcn MCP components/blocks when applicable.
---

# Tailwind shadcn UI

Use this workflow for frontend/UI work in WerkFlow. Always target Tailwind CSS v4 and keep shadcn/ui usage compatible with the repo's German UI and English code conventions from `AGENTS.md`.

## Tailwind CSS v4 Rules

- Use Tailwind CSS v4.0+ APIs and conventions. Treat v3 patterns as bugs to fix when touched.
- Use a single CSS import: `@import "tailwindcss";`.
- Do not reintroduce `@tailwind base;`, `@tailwind components;`, or `@tailwind utilities;`.
- Do not add or rely on a `content` array in `tailwind.config.js`; Tailwind v4 discovers templates automatically. Use CSS `@source` only when necessary.
- Prefer CSS-first configuration with `@layer theme` and registered custom properties instead of JS config.
- Do not install or configure `postcss-import` for CSS inlining; Tailwind v4 handles imports natively.
- Do not use v3-only plugin APIs like `@tailwindcss/container-queries`; container queries are built in.

## Utility Conventions

- Use `bg-linear-*` instead of v3 `bg-gradient-*` utilities.
- Use `bg-conic-*`, `bg-radial-*`, and interpolation modifiers such as `/oklch` or `/srgb` when appropriate.
- Use native container query patterns with `@container`, `@sm:`, `@lg:`, `@max-*`, and range stacking.
- Use Tailwind v4 variants such as `starting:*`, `not-*`, `in-*`, `nth-*`, `descendant:*`, `inert:*`, and `open:*` when they fit.
- Keep data attribute variants v4-compatible, such as `data-current:*`.
- Avoid bespoke class patterns when an existing component variant or project convention already fits.

## shadcn Workflow

- Use the shadcn MCP/server guidance for shadcn-related planning or implementation when available.
- Prefer suitable shadcn blocks for full-page or composite UI surfaces before assembling primitives manually.
- For component work, consult canonical demos before integration when the tool is available.
- Fetch/source the relevant component or block through MCP when possible, then integrate it with Tailwind v4 utilities and project conventions.
- Keep labels, aria labels, tooltips, and visible UI copy in natural German. Keep component names, identifiers, comments, and code in English.
- Validate accessibility: labels, keyboard behavior, focus states, contrast, and responsive behavior.

## Review Checklist

- New or edited code uses Tailwind v4 patterns.
- No v3 `@tailwind` directives, v3 content scanning, v3 gradient utilities, or v3-only plugins were introduced.
- shadcn components/styles remain v4-compatible.
- German user-facing text and accessibility strings are correct.
- The UI follows the WerkFlow brand color rules from `AGENTS.md`.
