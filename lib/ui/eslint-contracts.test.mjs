import { describe, expect, test } from "bun:test";
import { ESLint } from "eslint";

const eslint = new ESLint();
async function restrictions(
  source,
  filePath = "components/ui-contract-probe.tsx",
) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(
    ({ ruleId }) =>
      ruleId === "no-restricted-syntax" || ruleId?.startsWith("ui/"),
  );
}

describe("effective product UI lint configuration", () => {
  test("rejects both hand-built page column literals", async () => {
    expect(
      await restrictions(
        'export const Probe = () => <main className="h-full flex-col overflow-hidden"><div className="flex-1 overflow-auto p-4 sm:p-6" /></main>',
      ),
    ).toHaveLength(2);
  });

  test("rejects native input attributes in all three static JSX spellings", async () => {
    for (const attribute of ['type="date"', 'type={"date"}', "type={`date`}"]) {
      expect(
        await restrictions(`export const Probe = () => <input ${attribute}/>`),
      ).toHaveLength(1);
    }
  });

  test("rejects functional colour literals in class strings, style values and template strings", async () => {
    for (const source of [
      'export const Probe = () => <div className="bg-[rgba(123,44,191,0.12)]" />',
      'export const Probe = () => <div style={{ color: "rgb(34 197 94 / 0.8)" }} />',
      "export const Probe = () => <div style={{ background: `hsl(160 70% 40%)` }} />",
      "const css = `.cell { border-color: #e5e5e5; }`; export const Probe = () => <style>{css}</style>",
    ]) {
      expect(await restrictions(source), source).toHaveLength(1);
    }
    for (const source of [
      'export const Probe = () => <div className="bg-calendar-today border-calendar-grid" />',
      "export const Probe = () => <a href={`#planning-warning-reason`} />",
    ]) {
      expect(await restrictions(source), source).toHaveLength(0);
    }
  });

  test("requires Field even when a label/input stack already has spacing", async () => {
    expect(
      await restrictions(
        'export const Probe = () => <div className="grid gap-2"><Label>Name</Label><Input /></div>',
      ),
    ).toHaveLength(1);
  });

  test('rejects conditional, fragment, and nested controls beside a raw Label', async () => {
    for (const control of ['{visible && <Input />}', '{visible ? <Input /> : <Textarea />}', '<><Input /></>', '<div><Input /></div>']) {
      expect(await restrictions(`export const Probe = () => <div className="grid gap-2"><Label>Name</Label>${control}</div>`)).toHaveLength(1);
    }
  });

  test('respects Field ownership and standalone or checkbox labels', async () => {
    for (const source of [
      '<Field label="Name"><div><Label>Zusatz</Label><Input /></div></Field>',
      '<div className="space-y-2"><Label>Abschnitt</Label><Field label="Name"><Input /></Field></div>',
      '<div className="flex items-center gap-2"><Checkbox /><Label>Aktiv</Label></div>',
    ]) expect(await restrictions(`export const Probe = () => ${source}`)).toHaveLength(0);
  });

  for (const path of [
    "components/realtime/realtime-provider.tsx",
    "components/shared/page-shell.tsx",
    "app/reset-password/reset-password-form.tsx",
    "hooks/use-business-day-refresh.ts",
  ]) {
    test(`${path} keeps the unrelated transition restriction`, async () => {
      expect(
        await restrictions(
          'import {useTransition} from "react"; export function Probe(){ return useTransition(); }',
          path,
        ),
      ).toHaveLength(1);
    });
  }

  test("named transition owners still reject native inputs and global sign-out", async () => {
    for (const path of [
      "components/organization/organization-context.tsx",
      "components/dokumente/document-library-content.tsx",
    ]) {
      expect(
        await restrictions(
          'export function Probe(){ client.auth.signOut(); return <input type={"date"}/>; }',
          path,
        ),
      ).toHaveLength(2);
    }
  });

  test("rejects a Lucide strokeWidth prop but not an SVG primitive's", async () => {
    const [icon] = await eslint.lintText(
      'import { Check } from "lucide-react"; export const Probe = () => <Check strokeWidth={3} />;',
      { filePath: "components/ui-contract-probe.tsx" },
    );
    expect(icon.messages.map(({ ruleId }) => ruleId)).toContain("ui/no-lucide-stroke-width");
    const [circle] = await eslint.lintText(
      'export const Probe = () => <svg><circle strokeWidth={3} /></svg>;',
      { filePath: "components/ui-contract-probe.tsx" },
    );
    expect(circle.messages.map(({ ruleId }) => ruleId)).not.toContain("ui/no-lucide-stroke-width");
  });

  test("rejects numbered palette classes in product JSX but not the semantic tokens", async () => {
    expect(
      await restrictions('export const Probe = () => <span className="bg-green-100 text-green-800 dark:text-green-300" />'),
    ).toHaveLength(1);
    expect(
      await restrictions('export const Probe = () => <span className={`rounded ${active ? "text-yellow-700" : ""}`} />'),
    ).toHaveLength(1);
    expect(
      await restrictions('export const Probe = () => <span className="bg-success-soft text-success-soft-foreground border-warning/40 text-destructive bg-muted" />'),
    ).toHaveLength(0);
  });

  test("requires explicit boundary types under lib but not in components", async () => {
    const source = "export function probe(value) { return value; }";
    const [library] = await eslint.lintText(source, { filePath: "lib/boundary-probe.ts" });
    expect(library.messages.map(({ ruleId }) => ruleId)).toContain("@typescript-eslint/explicit-module-boundary-types");
    const [component] = await eslint.lintText(source, { filePath: "components/boundary-probe.ts" });
    expect(component.messages.map(({ ruleId }) => ruleId)).not.toContain("@typescript-eslint/explicit-module-boundary-types");
  });

  test("rejects ring offsets in product JSX", async () => {
    expect(
      await restrictions('export const Probe = () => <button className="focus:ring-2 focus:ring-offset-1" />'),
    ).toHaveLength(1);
  });

  test("requires a reason on every lint suppression and rejects stale ones", async () => {
    const [reasonless] = await eslint.lintText(
      '// eslint-disable-next-line no-console\nconsole.log("x");\n',
      { filePath: "lib/comment-probe.ts" },
    );
    expect(reasonless.messages.map(({ ruleId }) => ruleId)).toContain("@eslint-community/eslint-comments/require-description");
    const [stale] = await eslint.lintText(
      '// eslint-disable-next-line no-console -- nothing to suppress here\nexport const value = 1;\n',
      { filePath: "lib/comment-probe.ts" },
    );
    expect(stale.messages.some(({ message }) => message.includes("Unused eslint-disable directive"))).toBe(true);
    const [reasoned] = await eslint.lintText(
      '// eslint-disable-next-line no-console -- deliberate diagnostic\nconsole.log("x");\n',
      { filePath: "lib/comment-probe.ts" },
    );
    expect(reasoned.messages).toHaveLength(0);
  });

  test("registered controls and named transition owner remain usable", async () => {
    expect(
      await restrictions(
        'export const Probe = () => <Field label="Name"><Input /></Field>',
      ),
    ).toHaveLength(0);
    expect(
      await restrictions(
        'import {useTransition} from "react"; export function Probe(){return useTransition();}',
        "components/ui/refresh-button.tsx",
      ),
    ).toHaveLength(0);
  });
});
