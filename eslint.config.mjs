import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { playwrightSpecRules } from "./eslint-rules/playwright-spec-rules.mjs";
import { uiRules } from "./eslint-rules/ui-rules.mjs";

// ENFORCEMENT LADDER TIER 2 (docs/decisions/0005-enforcement-ladder.md).
// ESLint flat config does NOT merge `no-restricted-syntax` across blocks: the
// last matching block REPLACES the rule. Every block below therefore composes
// its complete selector list from the shared sets here. When adding a rule,
// add the selector to a set (or a new set) and recheck every block that should
// carry it — never add a lone block with a partial list, it silently disables
// the others for its files.

// Auth session scope: a bare signOut() defaults to GLOBAL and revokes the
// user's sessions on every device. One bare call in a harness helper failed
// four full certifications; the /auth/callback variant was a real cross-device
// logout bug (docs/technical/test-incident-log.md, 2026-08-27).
const authSelectors = [
  {
    selector:
      'CallExpression[callee.property.name="signOut"][arguments.length=0]',
    message:
      "signOut() without an explicit scope defaults to 'global' and revokes the user's sessions on every device. Pass { scope: 'local' } (or a deliberate 'global'/'others' with a comment). See docs/technical/test-incident-log.md (2026-08-27) and decision 0005.",
  },
];

// The strict zod uuid check (RFC 4122 version and variant nibbles) rejects the
// hand-made production organization ids; every Wave 1/2 validator that used it
// returned invalid_input for those tenants without logging (2026-09-03). The
// app-wide validator is uuidSchema in lib/validation/uuid.ts, the one file
// exempt from this rule.
const uuidSelectors = [
  {
    selector:
      'CallExpression[callee.property.name="uuid"][callee.object.type="CallExpression"][callee.object.callee.property.name="string"]',
    message:
      "z.string().uuid() is strict RFC 4122 and rejects real production ids. Import { uuidSchema } from '@/lib/validation/uuid' (incident 2026-09-03).",
  },
  {
    selector: 'CallExpression[callee.object.name="z"][callee.property.name="uuid"]',
    message:
      "z.uuid() is strict RFC 4122 and rejects real production ids. Import { uuidSchema } from '@/lib/validation/uuid' (incident 2026-09-03).",
  },
];

const alwaysOnSelectors = [...authSelectors, ...uuidSelectors];

// The production Supabase project ref must never reach app or test code: a
// leaked ref in the harness would write test data into real customer state.
// scripts/ is exempt (the deliberate one-way auth-config sync reads prod).
const prodRefSelectors = [
  {
    selector: 'Literal[value=/jbgaqpdjauzoocplgdsn/]',
    message:
      "The PRODUCTION Supabase project ref is banned outside scripts/ — dev code and the test harness must only reach the dev project (docs/technical/environments.md).",
  },
  {
    selector: 'TemplateElement[value.raw=/jbgaqpdjauzoocplgdsn/]',
    message:
      "The PRODUCTION Supabase project ref is banned outside scripts/ — dev code and the test harness must only reach the dev project (docs/technical/environments.md).",
  },
];

// Realtime ownership (client freshness contract, docs/technical/
// realtime-and-caching.md): the central provider is the only subscription,
// auth-listener, and focus/visibility catch-up owner.
const channelSelector = {
  selector: 'CallExpression[callee.property.name="channel"]',
  message:
    "Realtime channels are owned by components/realtime/realtime-provider.tsx (client freshness contract rule 1). Consume useLiveView() or useRealtimeRouterRefresh() instead of opening a channel.",
};
const authListenerSelector = {
  selector: 'CallExpression[callee.property.name="onAuthStateChange"]',
  message:
    "Auth-state listeners are owned by the Realtime provider. Ad-hoc listeners created duplicate catch-up races in the P1-16 cycle (client freshness contract rule 2).",
};
const visibilitySelector = {
  selector:
    'CallExpression[callee.property.name="addEventListener"][arguments.0.value="visibilitychange"]',
  message:
    "Visibility catch-up is a Realtime-provider concern (client freshness contract rule 2). New surfaces inherit the provider's coalesced catch-up instead of registering their own listener.",
};
const focusSelector = {
  selector:
    'CallExpression[callee.property.name="addEventListener"][arguments.0.value="focus"]',
  message:
    "Window-focus catch-up is a Realtime-provider concern (client freshness contract rule 2); for element focus use the React onFocus prop.",
};
// Pending state binds to the awaited server call, never a router transition
// (client freshness contract rule 6; the P1-16 MetadataSection defect).
// useServerAction (hooks/use-server-action.ts) is the sanctioned submit path.
const asyncTransitionSelectors = [
  {
    selector:
      'CallExpression[callee.name="startTransition"] > ArrowFunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
  {
    selector:
      'CallExpression[callee.name="startTransition"] > FunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
  {
    selector:
      'CallExpression[callee.property.name="startTransition"] > ArrowFunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
  {
    selector:
      'CallExpression[callee.property.name="startTransition"] > FunctionExpression[async=true]',
    message:
      'Async startTransition callbacks entangle pending state with router transitions. Use useServerAction (hooks/use-server-action.ts) for the server call and keep router.refresh() fire-and-forget (client freshness contract rule 6).',
  },
];

// No polling: live data comes from Realtime through the live-view primitive.
// Config-level exception: hooks/use-business-day-refresh.ts (a local Berlin
// date comparison on an interval — wall-clock, not server polling). Pure
// render ticks (elapsed counters, calendar now-lines) carry reasoned inline
// disables instead of config entries.
const pollingSelectors = [
  {
    selector: 'CallExpression[callee.name="setInterval"]',
    message:
      'No polling — live data comes from Realtime via useLiveView (docs/technical/realtime-and-caching.md). The only named exception is the wall-clock tick in hooks/use-business-day-refresh.ts.',
  },
  {
    selector: 'CallExpression[callee.property.name="setInterval"]',
    message:
      'No polling — live data comes from Realtime via useLiveView (docs/technical/realtime-and-caching.md). The only named exception is the wall-clock tick in hooks/use-business-day-refresh.ts.',
  },
];

const realtimeSelectors = [
  channelSelector,
  authListenerSelector,
  visibilitySelector,
  focusSelector,
  ...asyncTransitionSelectors,
  ...pollingSelectors,
];

// UI/UX consolidation canon (werkflow-design skill): registry components own
// date/time/number entry, entity selection, disclosure, and feedback. The
// migration sessions cleared every call site; these are hard errors so new
// violations cannot land.
const registrySelectors = [
  {
    selector: 'JSXAttribute[name.name="type"][value.value="date"]',
    message:
      "Native date inputs are banned — use DatePicker (components/ui/date-picker). See the werkflow-design skill registry.",
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="datetime-local"]',
    message:
      "Native datetime inputs are banned — use DatePicker + TimeInput (components/ui). See the werkflow-design skill registry.",
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="time"]',
    message:
      "Native time inputs are banned — use TimeInput (components/ui/time-input). See the werkflow-design skill registry.",
  },
  {
    selector: 'JSXAttribute[name.name="type"][value.value="number"]',
    message:
      'Raw number inputs are banned — use QuantityStepper, DurationHoursInput, or Input with inputMode="decimal". See the werkflow-design skill registry.',
  },
  {
    selector: 'JSXOpeningElement[name.name="select"]',
    message:
      "Native <select> is banned — use SearchableSelect or the shadcn Select per the werkflow-design skill registry.",
  },
  {
    selector: 'JSXOpeningElement[name.name="details"]',
    message:
      "Native <details> is banned — use FormDisclosure (components/ui/form-disclosure) per the werkflow-design skill registry.",
  },
  {
    selector: 'JSXOpeningElement[name.name="summary"]',
    message:
      "Native <summary> is banned — use FormDisclosure (components/ui/form-disclosure) per the werkflow-design skill registry.",
  },
];

// Styling canon (werkflow-design skill): the radius scale stops at rounded-lg
// (rounded-full stays legitimate for avatars/dots), colors come from tokens in
// app/globals.css, and gradients use the Tailwind v4 syntax if ever sanctioned.
const stylingSelectors = [
  {
    selector: 'Literal[value=/rounded-(2xl|3xl)/]',
    message:
      "The radius scale stops at rounded-lg for containers (werkflow-design skill: shape and depth). rounded-2xl+ is off-canon.",
  },
  {
    selector: 'TemplateElement[value.raw=/rounded-(2xl|3xl)/]',
    message:
      "The radius scale stops at rounded-lg for containers (werkflow-design skill: shape and depth). rounded-2xl+ is off-canon.",
  },
  {
    selector: 'Literal[value=/(bg|text|border|ring|fill|stroke)-\\[#/]',
    message:
      "Arbitrary hex color classes are banned — use the tokens in app/globals.css (werkflow-design skill: color system).",
  },
  {
    selector: 'TemplateElement[value.raw=/(bg|text|border|ring|fill|stroke)-\\[#/]',
    message:
      "Arbitrary hex color classes are banned — use the tokens in app/globals.css (werkflow-design skill: color system).",
  },
  {
    selector: 'Literal[value=/bg-gradient-/]',
    message:
      "Tailwind v3 gradient syntax — this app is Tailwind v4 (bg-linear-*), and gradients are off-canon anyway (werkflow-design skill).",
  },
];

// Spec-lint set (Stage C of the platform hardening, 2026-08-29; testing.md
// conventions). Spec files compose named steps and semantically scoped
// locators; the banned patterns below are the recurring flake classes from
// the incident log. The full Playwright API stays available to the shared
// support modules (tests/golden/support/**), which own the bounded,
// documented exceptions.
const specSelectors = [
  {
    selector:
      'CallExpression[callee.object.name="test"][callee.property.name="setTimeout"]',
    message:
      "Per-test timeout overrides hide regressions and make target budgets meaningless. Use the measured target-keyed default in the Playwright config and fix or classify tests that exceed it.",
  },
  {
    selector:
      'CallExpression[callee.object.name="test"][callee.property.name="slow"]',
    message:
      "test.slow() silently triples the configured timeout and bypasses the measured scenario budget. Keep the shared target-keyed budget honest and fix or classify tests that exceed it.",
  },
  {
    selector:
      'CallExpression[callee.object.name="test"][callee.property.name=/^(fixme|only|skip)$/]',
    message:
      "Committed test.only/test.skip/test.fixme silently removes evidence from certification. Keep the test runnable and use the runner's focused or diagnostic mode when narrowing locally.",
  },
  {
    selector:
      'CallExpression[callee.object.object.name="test"][callee.object.property.name="describe"][callee.property.name=/^(only|skip)$/]',
    message:
      "Committed test.describe.only/test.describe.skip silently removes evidence from certification. Keep the suite runnable and use the runner's focused or diagnostic mode when narrowing locally.",
  },
  {
    selector: 'CallExpression[callee.property.name="first"][arguments.length=0]',
    message:
      "Positional locators (.first/.last/.nth) break when the full serial run adds rows a focused run never sees (testing.md: scope locators semantically). Tighten the locator (exact name, owning row/section) or assert order explicitly with toHaveText([...]); a genuinely positional need belongs in a documented support helper.",
  },
  {
    selector: 'CallExpression[callee.property.name="last"][arguments.length=0]',
    message:
      "Positional locators (.first/.last/.nth) break when the full serial run adds rows a focused run never sees (testing.md: scope locators semantically). Tighten the locator (exact name, owning row/section) or assert order explicitly with toHaveText([...]); a genuinely positional need belongs in a documented support helper.",
  },
  {
    selector: 'CallExpression[callee.property.name="nth"]',
    message:
      "Positional locators (.first/.last/.nth) break when the full serial run adds rows a focused run never sees (testing.md: scope locators semantically). Tighten the locator (exact name, owning row/section) or assert order explicitly with toHaveText([...]); a genuinely positional need belongs in a documented support helper.",
  },
  {
    selector: 'CallExpression[callee.property.name="waitForTimeout"]',
    message:
      "Fixed sleeps hide races and stretch runs — wait on a real app signal instead (visible persisted state, a response, a dialog close). A bounded debounce-drain belongs in a documented support helper.",
  },
  {
    selector: 'Literal[value=/werkflow-golden\\.test|Golden Test SHK|Fremde Firma/]',
    message:
      "Golden cleanup markers are minted only by tests/golden/support/seed.ts (goldenTestEmail / goldenTestOrganizationName) so every cleanable identity matches the leftover sweep by construction.",
  },
  {
    selector: 'TemplateElement[value.raw=/werkflow-golden\\.test|Golden Test SHK|Fremde Firma/]',
    message:
      "Golden cleanup markers are minted only by tests/golden/support/seed.ts (goldenTestEmail / goldenTestOrganizationName) so every cleanable identity matches the leftover sweep by construction.",
  },
];

const productFiles = [
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "hooks/**/*.{ts,tsx}",
  "lib/**/*.{ts,tsx}",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright writes generated report/trace bundles on every golden-gate
    // run; without these ignores, lint walks thousands of generated files.
    "tests/golden/.report/**",
    "tests/golden/.results/**",
    "tests/golden/.artifacts/**",
    "tests/audit/.report/**",
    "tests/audit/.results/**",
    "tests/canary/.report/**",
    "tests/canary/.results/**",
    ".agent-logs/**",
  ]),
  // Everything (scripts and tests included): auth scope discipline.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...alwaysOnSelectors],
    },
  },
  // The one home of the permissive uuid validator may use zod's primitives.
  {
    files: ["lib/validation/uuid.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...authSelectors],
    },
  },
  // Tests: auth scope + prod-ref quarantine (scripts stay exempt from the
  // prod-ref rule for the deliberate one-way auth-config sync).
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...alwaysOnSelectors, ...prodRefSelectors],
    },
  },
  // Spec files additionally carry the spec-lint set; the shared support
  // modules keep the full Playwright API for bounded, documented exceptions.
  {
    files: ["tests/**/*.spec.ts"],
    plugins: { "playwright-spec": playwrightSpecRules },
    rules: {
      "playwright-spec/no-unscoped-page-selectors": "error",
      "playwright-spec/no-visible-text-zero-count": "error",
      "no-restricted-syntax": [
        "error",
        ...alwaysOnSelectors,
        ...prodRefSelectors,
        ...specSelectors,
      ],
    },
  },
  // Product code: auth + prod-ref + Realtime ownership + styling canon; no
  // console.log left behind (warn/error stay allowed).
  {
    files: productFiles,
    rules: {
      // console.log signals leftover debugging; deliberate diagnostics use
      // info/warn/error (the Realtime provider's dev-gated logs are info).
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
      "no-restricted-syntax": [
        "error",
        ...alwaysOnSelectors,
        ...prodRefSelectors,
        ...realtimeSelectors,
        ...stylingSelectors,
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "sonner",
              message:
                "Toasts are removed by the UI/UX consolidation — use the Banner primitive (components/ui/banner) per the feedback policy matrix.",
            },
          ],
        },
      ],
    },
  },
  // Product JSX outside the registry itself additionally carries the registry
  // bans (the ui/ primitives legitimately implement what others must not).
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["components/ui/**"],
    plugins: { ui: uiRules },
    rules: {
      "ui/label-in-spaced-container": "error",
      "no-restricted-syntax": [
        "error",
        ...alwaysOnSelectors,
        ...prodRefSelectors,
        ...realtimeSelectors,
        ...stylingSelectors,
        ...registrySelectors,
      ],
    },
  },
  // The Stage B consolidation ended the frozen visibility/focus allowlist at
  // zero (decision D5): no product surface registers its own catch-up
  // listeners anymore. Named exception — the wall-clock day-rollover tick.
  {
    files: ["hooks/use-business-day-refresh.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...alwaysOnSelectors,
        ...prodRefSelectors,
        channelSelector,
        authListenerSelector,
        visibilitySelector,
        focusSelector,
        ...asyncTransitionSelectors,
        ...stylingSelectors,
      ],
    },
  },
  // The provider itself owns channels, auth listeners, and catch-up.
  {
    files: ["components/realtime/realtime-provider.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...alwaysOnSelectors,
        ...prodRefSelectors,
        ...asyncTransitionSelectors,
        ...pollingSelectors,
        ...stylingSelectors,
        ...registrySelectors,
      ],
    },
  },
  // Deliberate exception: the recovery form must react to PASSWORD_RECOVERY.
  {
    files: ["app/**/reset-password-form.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...alwaysOnSelectors,
        ...prodRefSelectors,
        channelSelector,
        visibilitySelector,
        focusSelector,
        ...asyncTransitionSelectors,
        ...pollingSelectors,
        ...stylingSelectors,
        ...registrySelectors,
      ],
    },
  },
  // Surfaces consume Realtime through the live-view family, not the raw
  // event hook: useLiveView / useRealtimeRouterRefresh own the refetch
  // discipline. The named exceptions are the two family members (they build
  // on useRealtimeSubscribe) and the one payload-consuming navigation
  // watcher (leaving a deleted project's page needs the event, not a
  // refetch).
  {
    files: productFiles,
    ignores: [
      "hooks/use-live-view.ts",
      "hooks/use-realtime-router-refresh.ts",
      "components/realtime/realtime-provider.tsx",
      "components/auftraege/project-detail-content.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "sonner",
              message:
                "Toasts are removed by the UI/UX consolidation — use the Banner primitive (components/ui/banner) per the feedback policy matrix.",
            },
            {
              name: "@/components/realtime/realtime-provider",
              importNames: ["useRealtimeEvent", "useRealtimeSubscribe"],
              message:
                "Consume Realtime through useLiveView (hooks/use-live-view.ts) or useRealtimeRouterRefresh — they own debounce, generation guards, keep-last-known, dialog suspension, and catch-up (client freshness contract).",
            },
          ],
          // The paths entry matches only the alias specifier; a relative
          // import (./realtime-provider) must carry the same ban (owner-audit
          // depth item, 2026-08-29).
          patterns: [
            {
              group: ["**/realtime-provider"],
              importNames: ["useRealtimeEvent", "useRealtimeSubscribe"],
              message:
                "Consume Realtime through useLiveView (hooks/use-live-view.ts) or useRealtimeRouterRefresh — they own debounce, generation guards, keep-last-known, dialog suspension, and catch-up (client freshness contract).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
