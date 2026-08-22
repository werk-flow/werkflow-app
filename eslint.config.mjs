import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
  ]),
  // UI/UX consolidation canon (docs/plans/uiux-consolidation.md): registry
  // components own date/time/number entry, entity selection, and feedback.
  // The migration sessions cleared every call site; since M5 these are hard
  // errors so new violations cannot land.
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    ignores: ["components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
            "Raw number inputs are banned — use QuantityStepper, DurationHoursInput, or Input with inputMode=\"decimal\". See the werkflow-design skill registry.",
        },
        {
          selector: 'JSXOpeningElement[name.name="select"]',
          message:
            "Native <select> is banned — use SearchableSelect or the shadcn Select per the werkflow-design skill registry.",
        },
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
]);

export default eslintConfig;
