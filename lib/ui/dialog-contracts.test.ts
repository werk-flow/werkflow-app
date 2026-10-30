import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { inspectDialogs, readProductSources, type DialogContract } from './dialog-discovery';

type ExceptionKind = 'command' | 'browser' | 'widget' | 'destructive' | 'multiple-actions' | 'inactive';
type DialogException = { kind: ExceptionKind; reason: string };
// Exact owners/titles make additions and changed responsibilities require review.
// Search, upload, override and multi-operation dialogs must not acquire an accidental default action.
const exceptions: Record<string, DialogException> = {
  "components/clock-fab.tsx#ClockFAB|{isClockedIn ? 'Laufende Zeiterfassung' : 'Zeiterfassung starten'}": {
    kind: 'command',
    reason:
      'A list of next clock actions; each button performs its transition on activation, there is nothing to submit.',
  },
  "components/time-activity-dialog.tsx#TimeActivityDialogForm|{state?.isClockedIn ? 'Aktivität wechseln' : 'Aktivität wählen'}":
    {
      kind: 'multiple-actions',
      reason: 'Starting, switching and recovering activity have separate explicit commands.',
    },
  'components/anfragen/convert-request-to-service-dialog.tsx#ConvertRequestToServiceDialog|Anfrage als Servicefall übernehmen?':
    {
      kind: 'command',
      reason: 'Confirms conversion of existing request data; there are no editable fields.',
    },
  'components/anfragen/request-detail-content.tsx#RequestDetailContent|Kunden zuordnen': {
    kind: 'command',
    reason: 'Enter in the staged customer picker selects a result; assignment is explicit.',
  },
  'components/arbeitsvorlagen/apply-work-template-card.tsx#ApplyWorkTemplateCard|Arbeitsvorlage anwenden': {
    kind: 'command',
    reason:
      'Version selection, preview and additional-application acknowledgement precede explicit application.',
  },
  'components/arbeitsvorlagen/work-template-editor-dialog.tsx#TemplateEditorDialog|Arbeitsvorlage': {
    kind: 'inactive',
    reason: 'Closed placeholder while no draft is available; the real editor owns a form.',
  },
  'components/auftraege/shared/client-assignment-dialog.tsx#ClientAssignmentDialog|{title}': {
    kind: 'command',
    reason: 'Staged customer picker; Enter selects an option instead of confirming assignment.',
  },
  'components/auftraege/job-detail/job-detail-assign-dialog-sections.tsx#JobDetailAssignDialog|Mitarbeiter zuweisen':
    {
      kind: 'command',
      reason: 'Multi-selection is followed by an explicit assignment command.',
    },
  'components/auftraege/job-detail/project-assignment-dialog.tsx#ProjectAssignmentDialog|{title}': {
    kind: 'command',
    reason: 'Staged project picker; Enter selects an option before explicit assignment.',
  },
  'components/auftraege/project-detail/project-jobs-assignment-dialog.tsx#ProjectJobsAssignmentDialog|{title}':
    {
      kind: 'command',
      reason: 'Job multi-selection is followed by an explicit assignment command.',
    },
  'components/auftraege/shared/qualification-warning-dialog.tsx#QualificationWarningDialogContent|Zuweisung prüfen':
    { kind: 'command', reason: 'Reasoned qualification override requires deliberate acknowledgement.' },
  "components/auftraege/artifacts/work-artifacts-section.tsx#WorkArtifactDialog|{detail ? (currentRevision?.title ?? 'Arbeitsnachweis') : 'Arbeitsnachweis erstellen'}":
    {
      kind: 'multiple-actions',
      reason:
        'Review, signature and disposition remain explicit commands; editing-mode submission is enforced separately.',
    },
  'components/dokumente/attach-document-dialog.tsx#AttachDocumentDialog|Vorhandenes Dokument verknüpfen': {
    kind: 'browser',
    reason: 'Search and select existing documents before explicit linking.',
  },
  'components/dokumente/document-move-destination-dialog.tsx#MoveDestinationDialog|{title}': {
    kind: 'browser',
    reason: 'Folder tree navigation precedes an explicit move command.',
  },
  'components/dokumente/document-details-dialog.tsx#DocumentDetailsDialog|Dateidetails': {
    kind: 'widget',
    reason: 'Metadata and version operations commit independently; no dialog-wide submit.',
  },
  'components/dokumente/document-link-dialog.tsx#DocumentLinkDialog|Verknüpfungen verwalten': {
    kind: 'browser',
    reason: 'Search and select targets before explicit linking.',
  },
  'components/dokumente/document-upload-dialog.tsx#DocumentUploadDialog|{title}': {
    kind: 'browser',
    reason: 'Upload queue presents per-file status and explicit upload/retry commands.',
  },
  "components/dokumente/document-viewer-dialog.tsx#DocumentViewerDialog|{document?.displayName ?? 'Dokument'}":
    { kind: 'browser', reason: 'Document viewer owns its media viewport and download controls.' },
  'components/kalender/dispatch-issue-dialog.tsx#DispatchIssueDialog|Einsatz senden': {
    kind: 'command',
    reason: 'Dispatch and readiness overrides require explicit confirmation.',
  },
  'components/kalender/dispatch-panel.tsx#DispatchPanel|Verschiebung prüfen': {
    kind: 'command',
    reason: 'Confirms the reviewed batch move rather than editing a record.',
  },
  'components/kalender/board/shortcuts-help.tsx#ShortcutsHelp|Tastenkürzel': {
    kind: 'widget',
    reason:
      'An informational list of the calendar keyboard shortcuts; nothing is edited or submitted, Escape closes it.',
  },
  'components/kalender/entry-details-dialog.tsx#EntryDetailsDialog|Eintrag Details': {
    kind: 'multiple-actions',
    reason: 'Review and delete remain explicit commands; the ordinary editing form is enforced separately.',
  },
  'components/kalender/planning-warning-dialog.tsx#usePlanningWarningConfirmation|Planungshinweise prüfen': {
    kind: 'command',
    reason: 'Readiness warning overrides need deliberate acknowledgement.',
  },
  'components/kunden/use-communication-contact-guard.tsx#useCommunicationContactGuard|Kontaktvorgabe prüfen':
    { kind: 'command', reason: 'Contact-policy override requires an explicit reasoned confirmation.' },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Organisationszugang steuern':
    {
      kind: 'destructive',
      reason: 'Access authority transitions include suspension and require explicit action selection.',
    },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Beschäftigungsübergang erfassen':
    {
      kind: 'destructive',
      reason: 'Employment transitions include ending employment and require explicit confirmation.',
    },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Geschützte Personalunterlage':
    {
      kind: 'command',
      reason: 'File upload and access-class selection culminate in an explicit upload command.',
    },
  'components/service/maintenance-coverage-documents-dialog.tsx#MaintenanceCoverageDocumentsDialog|Dokumente zu {coverage.coverageNumber}':
    { kind: 'browser', reason: 'Embedded document browser owns separate link/upload/rename operations.' },
  'components/service/maintenance-due-action-dialog.tsx#MaintenanceDueActionDialog|Fälligkeit bearbeiten': {
    kind: 'multiple-actions',
    reason: 'Schedule/create and skipped/cancelled/superseded transitions have different consequences.',
  },
  'components/service/maintenance-plan-action-dialog.tsx#MaintenancePlanActionDialog|{title}': {
    kind: 'destructive',
    reason: 'Lifecycle commands include termination; require deliberate confirmation.',
  },
  'components/settings/profile-avatar-section.tsx#ProfileAvatarSection|Profilbild anpassen': {
    kind: 'widget',
    reason: 'Interactive crop/zoom editor uses an explicit image-save action.',
  },
  'components/settings/responsibility-settings.tsx#ConfigurationDialog|{RESPONSIBILITY_LABELS[responsibility]} ändern':
    {
      kind: 'command',
      reason: 'Preview resolved authority holders before explicitly saving responsibility configuration.',
    },
  'components/zeiterfassung/sickness-section.tsx#SicknessCancelDialog|Krankmeldung stornieren': {
    kind: 'destructive',
    reason: 'Cancellation confirmation has no editable data and must remain explicit.',
  },
  'components/zeiterfassung/time-correction-dialog.tsx#TimeCorrectionDialog|Zeitkorrektur': {
    kind: 'multiple-actions',
    reason: 'Deletion remains an explicit command; non-delete correction forms are enforced separately.',
  },
};

// Pin long forms already repaired. Short forms without a scrollable content shell
// need no separate body: there is no scrolling region to separate from the footer.
const longDialogOwners = new Set([
  'components/service/equipment-form-dialog.tsx#EquipmentFormDialog',
  'components/service/service-case-form-dialog.tsx#ServiceCaseFormDialog',
  'components/service/maintenance-plan-dialog.tsx#MaintenancePlanDialog',
  'components/service/maintenance-coverage-dialog.tsx#MaintenanceCoverageDialog',
  'components/service/maintenance-coverage-documents-dialog.tsx#MaintenanceCoverageDocumentsDialog',
  'components/service/equipment-detail-content.tsx#EquipmentDetailContent',
  'components/service/service-case-detail-dialogs.tsx#RelationDialog',
  'components/service/service-case-detail-dialogs.tsx#ServiceCaseEvidenceDialog',
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection',
  'components/settings/personnel-onboarding-template-settings.tsx#PersonnelOnboardingTemplateSettings',
  'components/inventar/location-select-with-create.tsx#CreateLocationDialog',
  'components/dokumente/contextual-documents-section.tsx#ContextualDocumentsSection',
]);

type EditingMode = { formId: string; condition: string };
// These dialogs have command-only modes, but their ordinary editing branches
// still require native submission. An exception cannot erase that branch.
const editingModes: Record<string, EditingMode> = {
  'components/kalender/entry-details-dialog.tsx#EntryDetailsDialog': {
    formId: 'editFormId',
    condition: 'isEditing',
  },
  'components/zeiterfassung/time-correction-dialog.tsx#TimeCorrectionDialog': {
    formId: 'correctionFormId',
    condition: "kind !== 'delete'",
  },
  'components/auftraege/artifacts/work-artifacts-section.tsx#WorkArtifactDialog': {
    formId: 'artifactFormId',
    condition: '!readOnly && editing',
  },
};

function editingViolations(contract: DialogContract, mode: EditingMode): string[] {
  const condition = mode.condition.replace(/\s/g, '');
  const forms = contract.formBoundaries.filter((form) => form.id === mode.formId);
  const submits = contract.associatedSubmits.filter((submit) => submit.id === mode.formId);
  const failures: string[] = [];
  if (forms.length === 0) failures.push('editable mode lost its owned submitting form');
  if (submits.length === 0) failures.push('editable mode lost its associated footer submit');
  if ([...forms, ...submits].some((boundary) => !boundary.conditions.includes(condition))) {
    failures.push('editing form or associated submit escapes its non-destructive mode');
  }
  return failures;
}

function violations(contract: DialogContract, exception?: DialogException, requiresBody = false): string[] {
  const failures: string[] = [];
  if (!exception && contract.forms === 0)
    failures.push('missing owned native submitting form or reviewed exception');
  if (!exception && contract.uncoveredControls.length)
    failures.push(
      `editable controls outside owned form: ${[...new Set(contract.uncoveredControls)].join(', ')}`,
    );
  if (contract.contentScrolls) failures.push('DialogContent scrolls; move the scroll region into DialogBody');
  if (requiresBody && contract.bodies === 0) failures.push('long dialog lost its owned DialogBody');
  if (
    contract.associatedSubmits.some(
      (submit) => !contract.formBoundaries.some((form) => form.id === submit.id),
    )
  ) {
    failures.push('footer submit does not reference an owned submitting form');
  }
  return failures;
}

// This whole-repository AST census measured 5.3 s on Windows; it is not a latency contract.
test('every application dialog has an owned form or a reasoned interaction exception', () => {
  // The form contract covers DialogContent; confirmations and sheets have their own rules.
  const dialogs = inspectDialogs(readProductSources(resolve(import.meta.dir, '../..'))).filter(
    (dialog) => dialog.kind === 'dialog',
  );
  const failures = dialogs.flatMap((dialog) => {
    const editingMode = editingModes[dialog.owner];
    return [
      ...violations(dialog, exceptions[dialog.key], longDialogOwners.has(dialog.owner)),
      ...(editingMode ? editingViolations(dialog, editingMode) : []),
    ].map((message) => `${dialog.key}: ${message}`);
  });
  for (const [key, exception] of Object.entries(exceptions)) {
    if (!dialogs.some((dialog) => dialog.key === key)) failures.push(`stale dialog exception: ${key}`);
    expect(exception.reason.length).toBeGreaterThan(30);
  }
  for (const owner of longDialogOwners) {
    if (!dialogs.some((dialog) => dialog.owner === owner)) failures.push(`stale long-dialog owner: ${owner}`);
  }
  for (const owner of Object.keys(editingModes)) {
    if (!dialogs.some((dialog) => dialog.owner === owner))
      failures.push(`stale editable-mode owner: ${owner}`);
  }
  expect(dialogs.length).toBeGreaterThan(0);
  expect(failures).toEqual([]);
});

function fixture(source: string, additional: Record<string, string> = {}): DialogContract {
  const dialog = inspectDialogs(
    new Map([['components/example.tsx', source], ...Object.entries(additional)]),
  )[0];
  if (!dialog) throw new Error('Fixture must declare a dialog');
  return dialog;
}

test('a short owned form does not need a separate scrolling body', () => {
  const dialog = fixture(
    'function Edit(){ return <DialogContent><form onSubmit={save}><Input/><button type="submit">Save</button></form></DialogContent> }',
  );
  expect(violations(dialog)).toEqual([]);
});

test('a form outside the portal and a nested dialog form cannot claim outer inputs', () => {
  const dialog = fixture(
    'function Edit(){ return <form onSubmit={save}><DialogContent><Input/><Dialog><DialogContent><form onSubmit={save}><DialogBody><Input/></DialogBody></form></DialogContent></Dialog></DialogContent></form> }',
  );
  expect(dialog.forms).toBe(0);
  expect(dialog.bodies).toBe(0);
  expect(violations(dialog)).toHaveLength(2);
});

test('a sibling form does not cover another editable field', () => {
  const dialog = fixture(
    'function Edit(){ return <DialogContent><form onSubmit={save}><Input/></form><Textarea/></DialogContent> }',
  );
  expect(dialog.forms).toBe(1);
  expect(dialog.uncoveredControls).toEqual(['Textarea']);
});

test('FormDisclosure and a non-submitting native form are not submission boundaries', () => {
  const dialog = fixture(
    'function Edit(){ return <DialogContent><FormDisclosure><Input/></FormDisclosure><form><Textarea/></form></DialogContent> }',
  );
  expect(dialog.forms).toBe(0);
  expect(dialog.uncoveredControls).toEqual(['Input', 'Textarea']);
});

test('imported delegated forms are verified from their rendered implementation', () => {
  const dialog = fixture(
    'import { Editor as Fields } from "./fields"; function Edit(){ return <DialogContent><Fields/></DialogContent> }',
    {
      'components/fields.tsx':
        'export function Editor(){ const unrelated = () => <Input/>; return <form action={save}><DialogBody><Input/></DialogBody></form> }',
    },
  );
  expect(dialog.forms).toBe(1);
  expect(dialog.bodies).toBe(1);
  expect(violations(dialog, undefined, true)).toEqual([]);
});

test('component names containing Form do not count as delegated forms', () => {
  const dialog = fixture(
    'function FakeForm(){ return <Input/> } function Edit(){ return <DialogContent><FakeForm/></DialogContent> }',
  );
  expect(dialog.forms).toBe(0);
  expect(dialog.uncoveredControls).toEqual(['Input']);
});

test('a delegated component nested portal cannot satisfy the outer form or body', () => {
  const dialog = fixture(
    'function Fields(){ return <DialogPortal><form onSubmit={save}><DialogBody><Input/></DialogBody></form></DialogPortal> } function Edit(){ return <DialogContent><Fields/><Input/></DialogContent> }',
  );
  expect(dialog.forms).toBe(0);
  expect(dialog.bodies).toBe(0);
});

test('an owned wrapper form covers its rendered children', () => {
  const dialog = fixture(
    'const Shell = ({children}) => <form onSubmit={save}><DialogBody>{children}</DialogBody></form>; function Edit(){ return <DialogContent><Shell><Input/></Shell></DialogContent> }',
  );
  expect(dialog.forms).toBe(1);
  expect(dialog.uncoveredControls).toEqual([]);
});

test('aliased dialog imports remain discoverable', () => {
  const dialog = fixture(
    'import { DialogContent as Modal } from "@/components/ui/dialog"; function Edit(){ return <Modal><Input/></Modal> }',
  );
  expect(dialog.uncoveredControls).toEqual(['Input']);
});

test('whole-content responsive and conditional scrolling fails even with an owned body', () => {
  const dialog = fixture(
    'function Edit(){ return <DialogContent className={cn("overflow-hidden", long && "md:overflow-y-auto")}><form onSubmit={save}><DialogBody><Input/></DialogBody></form></DialogContent> }',
  );
  expect(violations(dialog)).toEqual(['DialogContent scrolls; move the scroll region into DialogBody']);
});

test('local class constants cannot hide a whole-content scroller', () => {
  const dialog = fixture(
    'const shell = "overflow-y-scroll"; function Edit(){ return <DialogContent className={shell}><form onSubmit={save}><Input/></form></DialogContent> }',
  );
  expect(dialog.contentScrolls).toBe(true);
});

test('exceptions classify interaction semantics without exempting whole-content scroll', () => {
  const dialog = fixture(
    'function Browser(){ return <DialogContent className="overflow-auto"><Input/></DialogContent> }',
  );
  expect(
    violations(dialog, {
      kind: 'browser',
      reason: 'Search picks a document before an explicit linking command.',
    }),
  ).toEqual(['DialogContent scrolls; move the scroll region into DialogBody']);
});

test('conditional editing resolves composed fields and external footer form ownership', () => {
  const dialog = fixture(
    'function Edit(){ const content = <Input/>; return <DialogContent>{editing ? <form id="edit" onSubmit={save}>{content}</form> : <p>Read only</p>}<DialogFooter>{editing && <Button type="submit" form="edit">Save</Button>}</DialogFooter></DialogContent> }',
  );
  expect(dialog.uncoveredControls).toEqual([]);
  expect(violations(dialog)).toEqual([]);
  expect(editingViolations(dialog, { formId: 'edit', condition: 'editing' })).toEqual([]);
});

test('a command exception cannot hide removal of its editing form', () => {
  const dialog = fixture('function Edit(){ return <DialogContent><Input/></DialogContent> }');
  expect(editingViolations(dialog, { formId: 'edit', condition: 'editing' })).toEqual([
    'editable mode lost its owned submitting form',
    'editable mode lost its associated footer submit',
  ]);
});

test('a footer submit cannot target a sibling or nested-portal form', () => {
  const dialog = fixture(
    'function Edit(){ return <DialogContent><form id="edit" onSubmit={save}><Input/></form><Dialog><DialogContent><form id="other" onSubmit={save}/></DialogContent></Dialog><DialogFooter><Button type="submit" form="other">Save</Button></DialogFooter></DialogContent> }',
  );
  expect(violations(dialog)).toEqual(['footer submit does not reference an owned submitting form']);
});

test('delete-mode confirmation must not become an implicit editing submit', () => {
  const dialog = fixture(
    'function Edit(){ return <DialogContent>{kind !== "delete" ? <form id="edit" onSubmit={save}><Input/></form> : <Button type="button" onClick={remove}>Delete</Button>}<DialogFooter>{kind !== "delete" ? <Button type="submit" form="edit">Save</Button> : <Button type="submit" form="edit">Delete</Button>}</DialogFooter></DialogContent> }',
  );
  expect(editingViolations(dialog, { formId: 'edit', condition: 'kind !== "delete"' })).toEqual([
    'editing form or associated submit escapes its non-destructive mode',
  ]);
});

test('the alternate branch of an explicit delete command is the non-delete submit mode', () => {
  const dialog = fixture(
    'function Edit(){ return <DialogContent>{kind !== "delete" ? <form id="edit" onSubmit={save}><Input/></form> : null}<DialogFooter>{kind === "delete" ? <Button type="button" onClick={remove}>Delete</Button> : <Button type="submit" form="edit">Save</Button>}</DialogFooter></DialogContent> }',
  );
  expect(editingViolations(dialog, { formId: 'edit', condition: 'kind !== "delete"' })).toEqual([]);
});

// Rule test: a confirmation shows a failed confirm in its sticky footer (`AlertDialogFooter error`):
// as content right before the footer, a long confirmation on a phone scrolls the message out of view.
test('no confirmation renders its error as content right before AlertDialogFooter', () => {
  const beforeFooter = /<ErrorText\b[^]*?<\/ErrorText>\s*(?:\{\/\*[^]*?\*\/\}\s*)?<AlertDialogFooter\b/;
  const offenders = [...readProductSources(resolve(import.meta.dir, '../..'))]
    .filter(([, source]) => beforeFooter.test(source))
    .map(([file]) => file);
  expect(offenders).toEqual([]);
});
