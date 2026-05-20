## Cursor Rule: Language & Coding Standards (German UI, English Code)

- **Scope**: Applies to all applications and the website in this repository (Next.js + TypeScript). Covers all UI copy, examples, code, and developer communication.
- **Mandate**: You are an expert Next.js and TypeScript developer. The product is for German users, so any UI text and example copy must be written in natural, neutral German. All reasoning, code, identifiers, APIs, comments, commit messages, and commands must remain in English. Write clean, production-ready code and explain decisions briefly if needed.

### Language policy
- **UI copy (including examples)**: Neutral German (e.g., “Anmelden”, “Abbrechen”, “Einstellungen”, “Weiter”, “Zurück”). Avoid slang or region-specific phrasing.
- **German umlauts in UI copy**: Always use real German characters like `ä`, `ö`, `ü`, `Ä`, `Ö`, `Ü` and `ß` in user-facing German text. Do not transliterate them as `ae`, `oe`, or `ue` unless the text must stay ASCII for technical reasons such as identifiers, slugs, env vars, or URLs.
- **Code and engineering artifacts**: English for identifiers, comments, commit messages, PR titles/descriptions, and any documentation embedded in code.
- **User-facing error messages, labels, aria-labels**: German.
- **Developer-facing logs and error details**: English.

### Clarifying questions protocol (must-follow before coding)
- If any requirement is ambiguous, **ask concise clarifying questions** before writing code. Do not proceed until key details are confirmed.
- Always confirm: scope, inputs/outputs, acceptance criteria, edge cases, performance/security constraints, UI states, i18n/a11y expectations, and integration points.
- For non-trivial tasks, restate the intended solution in 2–3 sentences and request a quick confirmation if uncertainty remains.

### Coding guidelines (readability, maintainability, safety)
- **Naming**
  - Use descriptive, full-word names. Avoid abbreviations and 1–2 letter identifiers.
  - Functions are verbs/verb-phrases; variables are clear nouns/noun-phrases.
  - Example: prefer `generateInvoicePdf` over `genInv`.
- **Types (TypeScript)**
  - Explicitly type function signatures and public APIs. Avoid `any`.
  - Prefer precise types, discriminated unions, and utility types over casts.
- **Control flow**
  - Prefer guard clauses and early returns. Avoid deep nesting (>2–3 levels).
  - Do not wrap large sections in try/catch. Catch only where meaningful handling exists.
- **Comments**
  - Keep comments concise and purposeful. Avoid obvious or redundant commentary.
  - Capture non-obvious rationale, invariants, edge cases, and security/performance caveats.
- **Formatting**
  - Match project conventions. Wrap long lines. Prefer multi-line over dense one-liners.
  - Keep related logic close together; extract helpers for clarity.
- **Testing & linting**
  - Do not commit code with linter or type errors. Add unit/integration tests where risk is non-trivial.
- **Accessibility (a11y)**
  - Provide ARIA attributes and keyboard/focus management. Visible focus states. Sufficient color contrast.
  - Localize aria-labels/tooltips in German for user-facing strings.
- **Internationalization (i18n)**
  - Centralize UI text for future translation management. Avoid hardcoded strings deep in logic.
- **Security & privacy**
  - Validate inputs at boundaries. Avoid leaking PII in logs. Follow least-privilege for keys/tokens.
- **Performance**
  - Memoize expensive computations in React. Avoid unnecessary renders and large client bundles.
  - Prefer streaming/Suspense patterns where appropriate.

### Framework/library alignment
- **Tailwind CSS**: Follow the Tailwind v4 rule in this workspace. Do not reintroduce v3 patterns.
- **ShadCN**: Use ShadCN components through the MCP server. Keep classNames and styles v4-compatible.

### Review checklist (must-pass)
- UI strings and examples are in neutral German; code, comments, and commits are in English.
- Ambiguities were clarified before implementation when needed.
- Code is readable, typed, lint-clean, and tested where appropriate.
- A11y and i18n considerations are respected (German user-facing text, proper aria).
- Tailwind v4 and ShadCN usage aligns with project rules.

### Minimal example (German UI, English code)

```tsx
// Example Next.js component (TSX)
export function LoginButton() {
  return (
    <button
      type="button"
      className="h-10 rounded-lg bg-zinc-900 px-4 text-white transition starting:opacity-0"
      aria-label="Anmelden" // user-facing => German
      title="Anmelden" // user-facing => German
    >
      Anmelden
    </button>
  );
}
```

```tsx
// Example: clear naming and short rationale in English
/**
 * Validates whether a password meets minimal security requirements.
 * Keep aligned with backend policy (length + character classes).
 */
export function isPasswordStrong(password: string): boolean {
  const MIN_LENGTH = 12;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  return password.length >= MIN_LENGTH && hasLetter && hasDigit && hasSymbol;
}
```


