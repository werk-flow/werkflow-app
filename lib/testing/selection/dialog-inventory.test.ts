// Rule test: every dialog has an audit entry or a recorded reason why it cannot be opened.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { inspectDialogs, readProductSources, type DialogContract } from '../../ui/dialog-discovery';
import { DIALOG_INVENTORY, type DialogInventoryEntry } from './dialog-inventory';
import {
  DYNAMIC_PHONE_ROUTES,
  EMPLOYEE_PHONE_ROUTES,
  EMPLOYEE_WORK_PACKS,
  MANAGER_PHONE_ROUTES,
} from './mobile-route-inventory';

const ROUTES_BY_ROLE: Readonly<Record<'admin' | 'employee', ReadonlySet<string>>> = {
  admin: new Set<string>([...MANAGER_PHONE_ROUTES, ...DYNAMIC_PHONE_ROUTES]),
  employee: new Set<string>([...EMPLOYEE_PHONE_ROUTES, ...EMPLOYEE_WORK_PACKS]),
};

// The brief's floor (werkflow-design, "Checklist"): every create and edit
// dialog is audited, whatever else may be skipped.
const CREATE_OR_EDIT_TITLE =
  /^(Neue|Neuen|Neuer)\b|(anlegen|erfassen|erstellen|bearbeiten|hinzufügen|ändern|einladen|beantragen|korrigieren|verknüpfen|ergänzen)\b|^Krank melden$/;

// The field worker's own dialogs, audited with the employee session at 375 px.
const FIELD_WORKER_DIALOGS = [
  "components/clock-fab.tsx#ClockFAB|{isClockedIn ? 'Laufende Zeiterfassung' : 'Zeiterfassung starten'}",
  'components/manual-entry-dialog.tsx#ManualEntryDialog|Manuelle Eintragung',
  "components/auftraege/artifacts/work-artifacts-section.tsx#WorkArtifactDialog|{detail ? (currentRevision?.title ?? 'Arbeitsnachweis') : 'Arbeitsnachweis erstellen'}",
  'components/zeiterfassung/sickness-section-report-dialog.tsx#OwnSicknessReportDialog|Krank melden',
  'components/zeiterfassung/vacation-section-request-dialog.tsx#OwnVacationRequestDialog|Urlaub beantragen',
] as const;

/** The title source text without its expression braces, for the create-or-edit floor. */
function titleText(key: string): string {
  return key.slice(key.indexOf('|') + 1);
}

function dialogInventoryProblems(
  dialogs: readonly DialogContract[],
  inventory: Readonly<Record<string, DialogInventoryEntry>>,
): string[] {
  const problems: string[] = [];
  const discovered = new Set(dialogs.map((dialog) => dialog.key));
  for (const dialog of dialogs) {
    const entry = inventory[dialog.key];
    if (!entry) {
      problems.push(`${dialog.key}: no audit entry and no recorded reason in dialog-inventory.ts`);
      continue;
    }
    if ('skip' in entry) {
      if (entry.note.length < 30)
        problems.push(`${dialog.key}: the skip note must explain why (30+ characters)`);
      if (CREATE_OR_EDIT_TITLE.test(titleText(dialog.key)))
        problems.push(`${dialog.key}: a create or edit dialog is audited, never skipped`);
    }
  }
  const openers = new Map<string, string>();
  for (const [key, entry] of Object.entries(inventory)) {
    if (!discovered.has(key)) problems.push(`${key}: stale inventory entry, no such dialog`);
    if (!('audits' in entry)) continue;
    if (entry.audits.length === 0) problems.push(`${key}: an audited entry names at least one audit`);
    for (const audit of entry.audits) {
      if (!ROUTES_BY_ROLE[audit.role].has(audit.route))
        problems.push(`${key}: ${audit.route} is not an inventoried page of the ${audit.role} role`);
      const owner = openers.get(audit.opener);
      if (owner) problems.push(`${key}: opener ${audit.opener} already opens ${owner}`);
      openers.set(audit.opener, key);
    }
  }
  return problems;
}

test('every discovered dialog is audited or names why it cannot be opened in the audit world', () => {
  const dialogs = inspectDialogs(readProductSources(resolve(import.meta.dir, '../../..')));
  expect(dialogs.length).toBeGreaterThan(100);
  expect(dialogInventoryProblems(dialogs, DIALOG_INVENTORY)).toEqual([]);
}, 15_000);

test("the field worker's own dialogs are audited with the employee session", () => {
  const inventory: Readonly<Record<string, DialogInventoryEntry>> = DIALOG_INVENTORY;
  for (const key of FIELD_WORKER_DIALOGS) {
    const entry = inventory[key];
    expect(entry && 'audits' in entry && entry.audits.some((audit) => audit.role === 'employee')).toBe(true);
  }
});

// Planted defects: a dialog without an entry, a skipped create dialog, a stale
// entry, a route of the wrong role and a shared opener are each reported.
function fixture(source: string): DialogContract[] {
  return inspectDialogs(new Map([['components/kunden/probe.tsx', source]]));
}

test('a new dialog without an entry is reported by its key', () => {
  const dialogs = fixture(
    'function Probe(){ return <DialogContent><DialogTitle>Neue Probe anlegen</DialogTitle></DialogContent> }',
  );
  expect(dialogInventoryProblems(dialogs, {})).toEqual([
    'components/kunden/probe.tsx#Probe|Neue Probe anlegen: no audit entry and no recorded reason in dialog-inventory.ts',
  ]);
});

test('a create dialog cannot be skipped, and an alert dialog is discovered too', () => {
  const dialogs = fixture(
    'function Probe(){ return <><DialogContent><DialogTitle>Neue Probe anlegen</DialogTitle></DialogContent><AlertDialogContent><AlertDialogTitle>Probe löschen?</AlertDialogTitle></AlertDialogContent></> }',
  );
  expect(dialogs.map((dialog) => dialog.kind)).toEqual(['dialog', 'alert-dialog']);
  expect(
    dialogInventoryProblems(dialogs, {
      'components/kunden/probe.tsx#Probe|Neue Probe anlegen': {
        skip: 'never-opens',
        note: 'A placeholder that the owner never opens at all.',
      },
      'components/kunden/probe.tsx#Probe|Probe löschen?': {
        audits: [{ route: '/kunden', role: 'admin', opener: 'customers.probe-delete' }],
      },
    }),
  ).toEqual([
    'components/kunden/probe.tsx#Probe|Neue Probe anlegen: a create or edit dialog is audited, never skipped',
  ]);
});

test('a stale entry, a route of another role and a shared opener are reported', () => {
  const dialogs = fixture(
    'function Probe(){ return <SheetContent><SheetTitle>Filter</SheetTitle></SheetContent> }',
  );
  expect(dialogs.map((dialog) => dialog.kind)).toEqual(['sheet']);
  expect(
    dialogInventoryProblems(dialogs, {
      'components/kunden/probe.tsx#Probe|Filter': {
        audits: [
          { route: '/kunden', role: 'employee', opener: 'customers.filter' },
          { route: '/kunden', role: 'admin', opener: 'customers.filter' },
        ],
      },
      'components/kunden/gone.tsx#Gone|Weg': {
        audits: [{ route: '/kunden', role: 'admin', opener: 'customers.gone' }],
      },
    }),
  ).toEqual([
    'components/kunden/probe.tsx#Probe|Filter: /kunden is not an inventoried page of the employee role',
    'components/kunden/probe.tsx#Probe|Filter: opener customers.filter already opens components/kunden/probe.tsx#Probe|Filter',
    'components/kunden/gone.tsx#Gone|Weg: stale inventory entry, no such dialog',
  ]);
});
