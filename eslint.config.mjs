import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    "Realtime channels are owned by components/realtime/realtime-provider.tsx (client freshness contract rule 1). Consume useRealtimeEvent() or use-realtime-router-refresh.ts instead of opening a channel.",
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
const realtimeSelectors = [
  channelSelector,
  authListenerSelector,
  visibilitySelector,
  focusSelector,
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
    ".agent-logs/**",
  ]),
  // Everything (scripts and tests included): auth scope discipline.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...authSelectors],
    },
  },
  // Tests: auth scope + prod-ref quarantine (scripts stay exempt from the
  // prod-ref rule for the deliberate one-way auth-config sync).
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...authSelectors, ...prodRefSelectors],
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
        ...authSelectors,
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
    rules: {
      "no-restricted-syntax": [
        "error",
        ...authSelectors,
        ...prodRefSelectors,
        ...realtimeSelectors,
        ...stylingSelectors,
        ...registrySelectors,
      ],
    },
  },
  // FROZEN legacy allowlist for the freshness contract (may shrink during the
  // Realtime consolidation, never grow): these pre-contract surfaces keep
  // their own visibility catch-up; everything else stays banned for them.
  {
    files: [
      "components/realtime/attention-count-provider.tsx",
      "components/organization/organization-context.tsx",
      "hooks/use-active-jobs.ts",
      "hooks/use-business-day-refresh.ts",
      "hooks/use-member-status-polling.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...authSelectors,
        ...prodRefSelectors,
        channelSelector,
        authListenerSelector,
        focusSelector,
        ...stylingSelectors,
        ...registrySelectors,
      ],
    },
  },
  // The provider itself owns channels, auth listeners, and catch-up.
  {
    files: ["components/realtime/realtime-provider.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...authSelectors,
        ...prodRefSelectors,
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
        ...authSelectors,
        ...prodRefSelectors,
        channelSelector,
        visibilitySelector,
        focusSelector,
        ...stylingSelectors,
        ...registrySelectors,
      ],
    },
  },
]);

export default eslintConfig;
