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
