## Cursor Rule: Tailwind CSS v4 Only (with ShadCN)

- **Scope**: Applies to all frontend/UI tasks (Next.js + TypeScript) in this workspace. Especially relevant when using ShadCN components via the ShadCN MCP server.
- **Mandate**: Always target Tailwind CSS v4.0+ APIs and conventions. Treat any Tailwind v3 patterns as bugs to fix immediately.
- **Primary reference**: [Tailwind CSS v4.0 – Blog](https://tailwindcss.com/blog/tailwindcss-v4)

### Core v4 assumptions and setup

- **Import once in CSS**: Replace any v3 `@tailwind base; @tailwind components; @tailwind utilities;` with a single v4 import.

```css
/* app/globals.css */
@import 'tailwindcss';
```

- **PostCSS/Vite integration**:

  - PostCSS (default in Next.js):
    ```js
    // postcss.config.js or postcss.config.mjs
    export default {
      plugins: ['@tailwindcss/postcss']
    };
    ```
  - Vite projects may use the official plugin:

    ```ts
    // vite.config.ts
    import { defineConfig } from 'vite';
    import tailwindcss from '@tailwindcss/vite';

    export default defineConfig({
      plugins: [tailwindcss()]
    });
    ```

- **Auto content detection**: Do not configure a `content` array. v4 discovers templates automatically. When needed, extend scanning via `@source` in CSS:

```css
@import 'tailwindcss';
@source "../node_modules/@acme/ui-lib";
```

- **CSS-first configuration**: Customize via CSS layers and registered custom properties, not JS config:

```css
@layer theme {
  :root {
    --spacing: 0.25rem;
    --brand: oklch(60% 0.15 240);
  }
}
```

### ShadCN usage

- Use ShadCN v4 components from the MCP server. Assume Tailwind v4 is present.
- Keep component classNames strictly v4-compatible. Do not reintroduce v3-only utilities or plugins.
- If component docs mention `tailwind.config.js` changes, translate to v4 CSS-first equivalents under `@layer theme` whenever possible.

#### ShadCN MCP usage policy and workflow (mandatory)

- **Always use the ShadCN MCP server** for any ShadCN-related planning or implementation. Do not handcraft class strings or copy from external sources when the MCP provides official components/blocks.
- **Planning**: When asked to plan with ShadCN, first query the MCP to discover suitable components or blocks and their metadata.
- **Prefer blocks when applicable**: If a full-page or composite block exists (e.g., `login-02`, `calendar-01`, `dashboard-01`), prefer using the block over assembling from primitives.
- **Apply components wherever applicable**: Use the most appropriate component(s) for the UI surface; avoid bespoke one-offs when standard components exist.
- **Implementation protocol (order required)**:
  1. Call the demo tool first to understand canonical usage: `get_component_demo` for components, or reference the block’s demo usage.
  2. Fetch the source via MCP: `get_component` for components, `get_block` for blocks (including related component files when offered).
  3. Integrate into the codebase with Tailwind v4 utilities and project conventions (German UI text, English code).
  4. Keep classNames v4-compatible; avoid reintroducing v3 utilities or plugins.
  5. Validate accessibility (labels in German, keyboard/focus states) and variants.

### v4 features to use (and expect in reviews)

- **Gradients (renamed and expanded)**:
  - Use `bg-linear-*` instead of v3 `bg-gradient-*` (e.g., `bg-linear-to-r`).
  - New: `bg-conic-*`, `bg-radial-*`, plus interpolation modifiers (`/oklch`, `/srgb`, etc.).
- **Container queries**: Use `@container` with `@sm:`, `@lg:`, `@max-*`, and range stacking.
  ```html
  <div class="@container">
    <div class="grid grid-cols-1 @sm:grid-cols-3 @max-md:grid-cols-1">…</div>
  </div>
  ```
- **3D transforms**: `rotate-x-*`, `rotate-y-*`, `translate-z-*`, `scale-z-*`, `transform-3d`.
- **New variants**: `starting:*` (for `@starting-style`), `not-*`, `in-*`, `nth-*`, `descendant:*`, `inert:*`, `open:*`.
- **Dynamic utilities**: Spacing/size accept any numeric scale derived from `--spacing` (e.g., `w-17`, `pr-29`).
- **Modern color system**: Default palette in OKLCH; opacity via `color-mix()` under the hood. Slash opacity on classes like `bg-blue-500/50` remains valid.
- **Data attribute variants**: Use boolean attribute selectors directly (e.g., `data-current:*`).

### v3 patterns that are forbidden in this codebase

- Do not add or rely on `tailwind.config.js` for `content` scanning. Use `@source` if needed.
- Do not write `@tailwind base; @tailwind components; @tailwind utilities;` — use `@import "tailwindcss"`.
- Do not install or configure `postcss-import` for CSS inlining — v4 handles imports natively.
- Do not use v3-only plugin APIs like `@tailwindcss/container-queries` — container queries are built-in.
- Do not use `bg-gradient-to-*` class names in new code — use `bg-linear-*`.
- Do not hardcode sRGB-only color tokens from v3 palettes expecting identical appearance — v4 defaults are OKLCH.

### Quick migration map (when touching legacy code)

- `@tailwind base; @tailwind components; @tailwind utilities;` → `@import "tailwindcss"`
- `content: [...]` in JS config → remove; rely on auto detection; add CSS `@source` if necessary
- `bg-gradient-to-r` → `bg-linear-to-r` (and similar for other directions/angles)
- Container queries plugin → native `@container` + `@min-*`/`@max-*` variants

### Minimal examples (German UI text)

```tsx
// Example React component (Next.js/TSX)
export function HeroCard() {
  return (
    <article className="rounded-xl border border-zinc-200 p-6 bg-linear-45 from-indigo-500/10 to-pink-500/10 transform-3d rotate-x-6">
      <h1 className="text-2xl font-semibold text-zinc-900">
        Schneller Einstieg
      </h1>
      <p className="mt-3 text-zinc-600">
        Starte noch heute mit unserer Plattform.
      </p>
      <div className="@container mt-6">
        <div className="grid grid-cols-1 gap-4 @sm:grid-cols-3">
          <button className="h-10 rounded-lg bg-zinc-900 px-4 text-white transition starting:opacity-0">
            Los geht’s
          </button>
          <button className="h-10 rounded-lg border px-4 text-zinc-900 not-hover:opacity-75">
            Mehr erfahren
          </button>
          <button
            data-current
            className="h-10 rounded-lg px-4 opacity-75 data-current:opacity-100"
          >
            Aktuell
          </button>
        </div>
      </div>
    </article>
  );
}
```

```css
/* app/globals.css */
@import 'tailwindcss';

@layer theme {
  :root {
    --spacing: 0.25rem;
    --brand: oklch(60% 0.15 240);
  }
}
```

```js
// postcss.config.js
export default {
  plugins: ['@tailwindcss/postcss']
};
```

### Review checklist (must-pass)

- New/edited code uses `@import "tailwindcss"` (no v3 `@tailwind` directives).
- No `content` array or v3 scanning in JS config files; `@source` used only when necessary.
- Gradients use `bg-linear-*` (and/or `bg-conic-*`, `bg-radial-*`) — no `bg-gradient-*` in new code.
- Container queries use core `@container` and `@min-*`/`@max-*` variants (no plugin).
- Variant usage aligns with v4 (`starting:*`, `not-*`, `in-*`, `nth-*`, `descendant:*`, etc.).
- ShadCN components/styles remain v4-compatible; no reintroduction of v3-only utilities/plugins.
- ShadCN MCP server was used for discovery and sourcing; demo tool consulted before implementation.
- Prefer whole blocks where available (e.g., login/calendar/dashboard) over assembling primitives.

### Reference

- Tailwind CSS v4.0 announcement and guide: https://tailwindcss.com/blog/tailwindcss-v4
