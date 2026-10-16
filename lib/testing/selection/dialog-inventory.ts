import type { InventoriedRoute, SurfaceRole } from './mobile-route-inventory';

/**
 * Every dialog, destructive confirmation and sheet that the product renders
 * (`lib/ui/dialog-discovery.ts`, keyed `file#Owner|title` like the form
 * contract's pins) with the audit that opens it from an inventoried page, or
 * the reason it cannot be opened in the audit world. The rendered audit opens
 * each one by keyboard at 1280 px, measures it at 1280, 768 and 375 px, runs
 * axe in both themes, walks its Tab order and closes it with Escape without
 * saving. `dialog-inventory.test.ts` fails on a discovered dialog without an
 * entry, an entry without a dialog, and a create or edit dialog without an
 * audit; the opener map in `tests/audit/support/dialog-openers.ts` is a
 * `Record` over the opener ids, so a missing opener does not compile.
 */
type DialogAudit = {
  route: InventoriedRoute;
  role: SurfaceRole;
  /** The opener in `tests/audit/support/dialog-openers.ts`, named `<area>.<dialog>`. */
  opener: string;
  /** The dialog's own tabs by their `value`, opened and measured one after another. */
  tabs?: readonly string[];
};

/**
 * Why a dialog cannot be opened in the audit world. A dialog that opens only
 * after a server warning or with special data is opened with that data; it is
 * never skipped for being hard to reach.
 */
type DialogSkipReason =
  /** It renders only on a page outside the app shell and the route inventory. */
  | 'outside-inventoried-pages'
  /** It is a placeholder whose open state is always false. */
  | 'never-opens';

export type DialogInventoryEntry =
  | { audits: readonly DialogAudit[] }
  | { skip: DialogSkipReason; note: string };

export const DIALOG_INVENTORY = {
  "components/clock-fab.tsx#ClockFAB|{isClockedIn ? 'Laufende Zeiterfassung' : 'Zeiterfassung starten'}": {
    audits: [{ route: '/dashboard', role: 'employee', opener: 'field.clock' }],
  },
  'components/job-picker-modal.tsx#JobPickerModal|{title}': {
    audits: [{ route: '/dashboard', role: 'employee', opener: 'field.job-picker' }],
  },
  'components/manual-entry-dialog.tsx#ManualEntryDialog|Manuelle Eintragung': {
    audits: [
      { route: '/zeiterfassung', role: 'admin', opener: 'time.manual-entry' },
      { route: '/zeiterfassung', role: 'employee', opener: 'field.manual-entry' },
    ],
  },
  "components/time-activity-dialog.tsx#TimeActivityDialogForm|{state?.isClockedIn ? 'Aktivität wechseln' : 'Aktivität wählen'}":
    {
      audits: [{ route: '/dashboard', role: 'employee', opener: 'field.time-activity' }],
    },
  'components/anfragen/close-request-dialog.tsx#CloseRequestDialog|Anfrage ohne Auftrag schließen': {
    audits: [{ route: '/anfragen/[requestId]', role: 'admin', opener: 'requests.close' }],
  },
  'components/anfragen/convert-request-dialog.tsx#ConvertRequestDialog|Anfrage umwandeln': {
    audits: [
      { route: '/anfragen/[requestId]', role: 'admin', opener: 'requests.convert', tabs: ['job', 'project'] },
    ],
  },
  'components/anfragen/convert-request-to-service-dialog.tsx#ConvertRequestToServiceDialog|Anfrage als Servicefall übernehmen?':
    {
      audits: [{ route: '/anfragen/[requestId]', role: 'admin', opener: 'requests.convert-to-service' }],
    },
  'components/anfragen/create-request-dialog.tsx#CreateRequestDialog|Neue Anfrage erfassen': {
    audits: [{ route: '/anfragen', role: 'admin', opener: 'requests.create' }],
  },
  'components/anfragen/edit-request-dialog.tsx#EditRequestDialog|Anfrage bearbeiten': {
    audits: [{ route: '/anfragen/[requestId]', role: 'admin', opener: 'requests.edit' }],
  },
  'components/anfragen/request-detail-content.tsx#RequestDetailContent|Kunden zuordnen': {
    audits: [{ route: '/anfragen/[requestId]', role: 'admin', opener: 'requests.assign-customer' }],
  },
  'components/arbeitsvorlagen/apply-work-template-card.tsx#ApplyWorkTemplateCard|Arbeitsvorlage anwenden': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'templates.apply' }],
  },
  'components/arbeitsvorlagen/create-work-template-dialog.tsx#CreateTemplateDialog|Arbeitsvorlage erstellen':
    {
      audits: [{ route: '/arbeitsvorlagen', role: 'admin', opener: 'templates.create' }],
    },
  'components/arbeitsvorlagen/work-template-capabilities-editor.tsx#CreateCapabilityDialog|Qualifikation erstellen':
    {
      audits: [{ route: '/arbeitsvorlagen', role: 'admin', opener: 'templates.create-capability' }],
    },
  'components/arbeitsvorlagen/work-template-editor-dialog.tsx#TemplateEditorDialog|Arbeitsvorlage': {
    skip: 'never-opens',
    note: 'The closed placeholder the editor renders while no draft is loaded; its open state is always false, so no user can see it.',
  },
  'components/arbeitsvorlagen/work-template-editor-dialog.tsx#TemplateEditorDialog|{editable ? `Entwurf · Version ${detail.versionNumber}` : `${detail.name} · Version ${detail.versionNumber}`}':
    {
      audits: [{ route: '/arbeitsvorlagen', role: 'admin', opener: 'templates.editor' }],
    },
  'components/arbeitsvorlagen/work-template-materials-editor.tsx#CreateMaterialDialog|Artikel erstellen': {
    audits: [{ route: '/arbeitsvorlagen', role: 'admin', opener: 'templates.create-material' }],
  },
  'components/dokumente/attach-document-dialog.tsx#AttachDocumentDialog|Vorhandenes Dokument verknüpfen': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'documents.attach' }],
  },
  'components/dokumente/contextual-documents-delete-dialog.tsx#ContextualDocumentsDeleteDialog|Datei in Papierkorb verschieben?':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'documents.contextual-delete' }],
    },
  'components/dokumente/contextual-documents-section.tsx#ContextualDocumentsSection|Datei umbenennen': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'documents.contextual-rename' }],
  },
  'components/dokumente/document-confirm-dialog.tsx#DocumentConfirmDialog|{confirmDialog?.title}': {
    audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.confirm' }],
  },
  'components/dokumente/document-details-dialog.tsx#DocumentDetailsDialog|Dateidetails': {
    audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.details' }],
  },
  'components/dokumente/document-link-dialog.tsx#DocumentLinkDialog|Verknüpfungen verwalten': {
    audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.link' }],
  },
  'components/dokumente/document-move-destination-dialog.tsx#MoveDestinationDialog|{title}': {
    audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.move' }],
  },
  "components/dokumente/document-name-dialogs.tsx#DocumentRenameDialog|{renameDialog?.kind === 'folder' ? 'Ordner umbenennen' : 'Datei umbenennen'}":
    {
      audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.rename' }],
    },
  'components/dokumente/document-name-dialogs.tsx#DocumentCreateFolderDialog|Ordner erstellen': {
    audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.create-folder' }],
  },
  'components/dokumente/document-upload-dialog.tsx#DocumentUploadDialog|{title}': {
    audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.upload' }],
  },
  "components/dokumente/document-viewer-dialog.tsx#DocumentViewerDialog|{document?.displayName ?? 'Dokument'}":
    {
      audits: [{ route: '/dokumente', role: 'admin', opener: 'documents.viewer' }],
    },
  'components/inventar/inventory-import-dialog.tsx#ImportDialog|CSV importieren': {
    audits: [{ route: '/inventar', role: 'admin', opener: 'inventory.import' }],
  },
  "components/inventar/inventory-item-dialog.tsx#ItemDialog|{form.id ? 'Artikel bearbeiten' : 'Artikel anlegen'}":
    {
      audits: [{ route: '/inventar', role: 'admin', opener: 'inventory.item' }],
    },
  'components/inventar/inventory-location-dialog.tsx#LocationDialog|Lager anlegen': {
    audits: [{ route: '/inventar', role: 'admin', opener: 'inventory.location' }],
  },
  'components/inventar/inventory-stock-adjustment-dialog.tsx#StockAdjustmentDialog|Bestand ändern': {
    audits: [{ route: '/inventar', role: 'admin', opener: 'inventory.stock-adjustment' }],
  },
  'components/inventar/job-material-selection-dialog.tsx#MaterialSelectionDialog|{title}': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'inventory.job-materials' }],
  },
  'components/inventar/location-select-with-create.tsx#CreateLocationDialog|Lager erstellen': {
    audits: [{ route: '/inventar', role: 'admin', opener: 'inventory.create-location' }],
  },
  'components/inventar/supplier-quick-create-dialog.tsx#SupplierQuickCreateDialog|Neuen Lieferanten anlegen':
    {
      audits: [{ route: '/inventar', role: 'admin', opener: 'inventory.create-supplier' }],
    },
  'components/kalender/calendar-entry-dialog.tsx#CalendarEntryDialog|Kalendereintrag erstellen': {
    audits: [
      {
        route: '/kalender',
        role: 'admin',
        opener: 'calendar.entry-create',
        tabs: ['planning', 'job', 'entry'],
      },
    ],
  },
  'components/kalender/calendar-time-correction-dialog.tsx#CalendarTimeCorrectionDialog|Arbeitszeit korrigieren':
    {
      audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.time-correction' }],
    },
  'components/kalender/dispatch-issue-dialog.tsx#DispatchIssueDialog|Einsatz senden': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.dispatch-issue' }],
  },
  'components/kalender/dispatch-panel-commitment-dialog.tsx#CommitmentDialog|Kundenzusage erfassen': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.dispatch-commitment' }],
  },
  'components/kalender/dispatch-panel-reason-dialog.tsx#DispatchReasonDialog|{title}': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.dispatch-reason' }],
  },
  'components/kalender/dispatch-panel.tsx#DispatchPanel|Verschiebung prüfen': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.dispatch-review' }],
  },
  'components/kalender/entry-details-dialog.tsx#EntryDetailsDialog|Eintrag Details': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.entry-details' }],
  },
  'components/kalender/entry-details-footer-actions.tsx#EntryDetailsManageActions|Arbeitsblock löschen?': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.entry-delete' }],
  },
  'components/kalender/parking-context-dialog.tsx#ParkingContextDialog|Parkplatz-Kontext': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.parking-context' }],
  },
  'components/kalender/planning-occurrence-edit-dialog.tsx#PlanningOccurrenceEditDialog|Geplanten Termin bearbeiten':
    {
      audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.occurrence-edit' }],
    },
  'components/kalender/planning-warning-dialog.tsx#usePlanningWarningConfirmation|Planungshinweise prüfen': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.planning-warning' }],
  },
  'components/kalender/schedule-parked-dialog.tsx#ScheduleParkedDialog|Auftrag einplanen': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.schedule-parked' }],
  },
  'components/kunden/client-actions-menu.tsx#ClientActionsMenu|Kunde löschen?': {
    audits: [{ route: '/kunden', role: 'admin', opener: 'customers.list-delete' }],
  },
  "components/kunden/client-contact-dialog.tsx#ClientContactDialog|{contactDialog?.contactId ? 'Ansprechpartner bearbeiten' : 'Ansprechpartner hinzufügen'}":
    {
      audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'customers.contact' }],
    },
  "components/kunden/client-site-dialog.tsx#ClientSiteDialog|{siteDialog?.siteId ? 'Einsatzort bearbeiten' : 'Einsatzort hinzufügen'}":
    {
      audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'customers.site' }],
    },
  'components/kunden/communication-preference-dialog.tsx#CommunicationPreferenceDialog|Kontaktpräferenz festhalten':
    {
      audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'customers.preference' }],
    },
  'components/kunden/communication-settings-dialog.tsx#CommunicationSettingsDialog|Allgemeine Kontaktvorgaben':
    {
      audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'customers.communication-settings' }],
    },
  'components/kunden/create-client-dialog.tsx#CreateClientDialog|Neuen Kunden anlegen': {
    audits: [{ route: '/kunden', role: 'admin', opener: 'customers.create' }],
  },
  "components/kunden/customer-follow-up-dialog.tsx#CustomerFollowUpDialog|{followUpDraft?.id ? 'Nachfassaktion bearbeiten' : 'Nachfassaktion anlegen'}":
    {
      audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'customers.follow-up' }],
    },
  'components/kunden/delete-client-dialog.tsx#DeleteClientDialog|Kunde löschen?': {
    audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'customers.delete' }],
  },
  'components/kunden/edit-client-dialog.tsx#EditClientDialog|Kunde bearbeiten': {
    audits: [{ route: '/kunden', role: 'admin', opener: 'customers.edit' }],
  },
  'components/kunden/use-communication-contact-guard.tsx#useCommunicationContactGuard|Kontaktvorgabe prüfen':
    {
      audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'customers.contact-guard' }],
    },
  'components/mitarbeiter/create-personnel-dialog.tsx#CreatePersonnelDialog|Personalakte anlegen': {
    audits: [{ route: '/mitarbeiter', role: 'admin', opener: 'people.create-personnel' }],
  },
  "components/mitarbeiter/employment-condition-dialog.tsx#EmploymentConditionDialog|{condition ? 'Kondition bearbeiten' : 'Kondition hinzufügen'}":
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.condition' }],
    },
  'components/mitarbeiter/invite-actions-menu-dialogs.tsx#InviteCancelConfirmDialog|Einladung stornieren?': {
    audits: [{ route: '/mitarbeiter', role: 'admin', opener: 'people.invite-cancel' }],
  },
  'components/mitarbeiter/invite-actions-menu-dialogs.tsx#InviteDeleteConfirmDialog|Einladung löschen?': {
    audits: [{ route: '/mitarbeiter', role: 'admin', opener: 'people.invite-delete' }],
  },
  'components/mitarbeiter/invite-dialog.tsx#InviteDialog|Mitarbeiter einladen': {
    audits: [{ route: '/mitarbeiter', role: 'admin', opener: 'people.invite' }],
  },
  "components/mitarbeiter/member-actions-menu-remove-dialog.tsx#MemberRemoveConfirmDialog|{removalBlockedMessage ? 'Mitglied kann noch nicht entfernt werden' : 'Mitglied entfernen?'}":
    {
      audits: [{ route: '/mitarbeiter', role: 'admin', opener: 'people.member-remove' }],
    },
  'components/mitarbeiter/personnel-invite-dialog.tsx#PersonnelInviteDialog|Zugang für {personName} einladen':
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.personnel-invite' }],
    },
  'components/mitarbeiter/personnel-lifecycle-onboarding-dialogs.tsx#PersonnelLifecyclePlanDialog|Onboardingplan anlegen':
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.onboarding-plan' }],
    },
  'components/mitarbeiter/personnel-lifecycle-onboarding-dialogs.tsx#PersonnelLifecycleRequirementDialog|Anforderung ergänzen':
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.onboarding-requirement' }],
    },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Organisationszugang steuern':
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.lifecycle-access' }],
    },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Beschäftigungsübergang erfassen':
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.lifecycle-transition' }],
    },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Geschützte Personalunterlage':
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.lifecycle-document' }],
    },
  'components/mitarbeiter/personnel-own-actions-section.tsx#PersonnelEvidenceUploadDialog|Gesundheitsnachweis hochladen':
    {
      audits: [{ route: '/aufgaben', role: 'employee', opener: 'field.evidence-upload' }],
    },
  'components/mitarbeiter/sickness-report-correct-dialog.tsx#CorrectSicknessDialog|Krankmeldung korrigieren':
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.sickness-correct' }],
    },
  'components/mitarbeiter/sickness-report-manager-dialogs.tsx#ManagerEndDialog|Enddatum setzen': {
    audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.sickness-end' }],
  },
  'components/mitarbeiter/sickness-report-manager-dialogs.tsx#EvidenceDialog|Nachweis verwalten': {
    audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.sickness-evidence' }],
  },
  'components/mitarbeiter/sickness-report-manager-dialogs.tsx#ManagerCancelDialog|Krankmeldung stornieren': {
    audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.sickness-cancel' }],
  },
  'components/mitarbeiter/sickness-report-record-dialog.tsx#RecordSicknessDialog|Krankmeldung erfassen': {
    audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.sickness-record' }],
  },
  'components/mitarbeiter/team-management-dissolve-dialog.tsx#TeamManagementDissolveDialog|Team auflösen?': {
    audits: [{ route: '/mitarbeiter', role: 'admin', opener: 'people.team-dissolve' }],
  },
  'components/mitarbeiter/version-delete-dialog.tsx#VersionDeleteDialog|{title}': {
    audits: [
      { route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.condition-delete' },
      { route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.schedule-delete' },
    ],
  },
  "components/mitarbeiter/work-schedule-dialog.tsx#WorkScheduleDialog|{schedule ? 'Wochenplan bearbeiten' : 'Wochenplan hinzufügen'}":
    {
      audits: [{ route: '/mitarbeiter/[userId]', role: 'admin', opener: 'people.schedule' }],
    },
  'components/onboarding/delete-account-button.tsx#DeleteAccountButton|Konto löschen?': {
    skip: 'outside-inventoried-pages',
    note: 'Opens only on the onboarding start page of a user without an organization, which sits outside the app shell and the route inventory.',
  },
  'components/org/delete-org-dialog.tsx#DeleteOrgDialog|Organisation löschen': {
    audits: [{ route: '/einstellungen/organisation', role: 'admin', opener: 'settings.delete-org' }],
  },
  'components/organization/create-org-dialog.tsx#CreateOrgDialog|Neue Organisation erstellen': {
    audits: [{ route: '/dashboard', role: 'admin', opener: 'settings.create-org' }],
  },
  'components/organization/join-org-dialog.tsx#JoinOrgDialog|Organisation beitreten': {
    audits: [{ route: '/dashboard', role: 'employee', opener: 'settings.join-org' }],
  },
  'components/service/equipment-detail-content.tsx#EquipmentDetailContent|': {
    audits: [
      { route: '/service/anlagen/[equipmentNumber]', role: 'admin', opener: 'service.equipment-state' },
    ],
  },
  'components/service/equipment-form-dialog.tsx#EquipmentFormDialog|{title}': {
    audits: [{ route: '/service/anlagen', role: 'admin', opener: 'service.equipment-form' }],
  },
  'components/service/equipment-reason-confirm-dialogs.tsx#EquipmentCorrectionDialog|Abschlussaktion korrigieren?':
    {
      audits: [
        {
          route: '/service/anlagen/[equipmentNumber]',
          role: 'admin',
          opener: 'service.equipment-correction',
        },
      ],
    },
  "components/service/equipment-reason-confirm-dialogs.tsx#EquipmentArchiveDialog|{item.archivedAt ? 'Anlage wiederherstellen?' : 'Anlage archivieren?'}":
    {
      audits: [
        { route: '/service/anlagen/[equipmentNumber]', role: 'admin', opener: 'service.equipment-archive' },
      ],
    },
  'components/service/equipment-source-dialog.tsx#EquipmentSourceDialog|Herkunftsnachweis verknüpfen': {
    audits: [
      { route: '/service/anlagen/[equipmentNumber]', role: 'admin', opener: 'service.equipment-source' },
    ],
  },
  'components/service/equipment-work-link-dialog.tsx#EquipmentWorkLinkDialog|Arbeit verknüpfen': {
    audits: [
      { route: '/service/anlagen/[equipmentNumber]', role: 'admin', opener: 'service.equipment-work-link' },
    ],
  },
  'components/service/maintenance-coverage-dialog.tsx#MaintenanceCoverageDialog|Operative Abdeckung erfassen':
    {
      audits: [{ route: '/service/wartung', role: 'admin', opener: 'service.coverage' }],
    },
  'components/service/maintenance-coverage-documents-dialog.tsx#MaintenanceCoverageDocumentsDialog|Dokumente zu {coverage.coverageNumber}':
    {
      audits: [{ route: '/service/wartung', role: 'admin', opener: 'service.coverage-documents' }],
    },
  'components/service/maintenance-coverage-follow-up-dialog.tsx#MaintenanceCoverageFollowUpDialog|Nachfassaktion anlegen':
    {
      audits: [{ route: '/service/wartung', role: 'admin', opener: 'service.coverage-follow-up' }],
    },
  'components/service/maintenance-due-action-dialog.tsx#MaintenanceDueActionDialog|Fälligkeit bearbeiten': {
    audits: [{ route: '/service/wartung', role: 'admin', opener: 'service.due-action' }],
  },
  'components/service/maintenance-plan-action-dialog.tsx#MaintenancePlanActionDialog|{title}': {
    audits: [{ route: '/service/wartung', role: 'admin', opener: 'service.plan-action' }],
  },
  "components/service/maintenance-plan-dialog.tsx#MaintenancePlanDialog|{initial ? 'Wartungsplan überarbeiten' : 'Wartungsplan anlegen'}":
    {
      audits: [{ route: '/service/wartung', role: 'admin', opener: 'service.plan' }],
    },
  'components/service/service-case-detail-dialogs.tsx#RelationDialog|Servicefälle verknüpfen': {
    audits: [{ route: '/service/faelle/[caseNumber]', role: 'admin', opener: 'service.case-relation' }],
  },
  'components/service/service-case-detail-dialogs.tsx#ServiceCaseEvidenceDialog|Arbeitsnachweis verknüpfen': {
    audits: [{ route: '/service/faelle/[caseNumber]', role: 'admin', opener: 'service.case-evidence' }],
  },
  'components/service/service-case-detail-dialogs.tsx#FollowUpDialog|Nachfassaktion anlegen': {
    audits: [{ route: '/service/faelle/[caseNumber]', role: 'admin', opener: 'service.case-follow-up' }],
  },
  "components/service/service-case-form-dialog.tsx#ServiceCaseFormDialog|{initial ? 'Servicefall bearbeiten' : 'Servicefall erfassen'}":
    {
      audits: [{ route: '/service/faelle', role: 'admin', opener: 'service.case-form' }],
    },
  'components/settings/personnel-onboarding-template-settings.tsx#PersonnelOnboardingTemplateSettings|Onboardingvorlage veröffentlichen':
    {
      audits: [
        { route: '/einstellungen/mitarbeiter', role: 'admin', opener: 'settings.onboarding-template' },
      ],
    },
  'components/settings/profile-avatar-section.tsx#ProfileAvatarSection|Profilbild anpassen': {
    audits: [{ route: '/einstellungen/profil', role: 'admin', opener: 'settings.avatar' }],
  },
  'components/settings/responsibility-delegation-dialog.tsx#DelegationDialog|Vertretung für {RESPONSIBILITY_LABELS[responsibility]}':
    {
      audits: [{ route: '/einstellungen/mitarbeiter', role: 'admin', opener: 'settings.delegation' }],
    },
  'components/settings/responsibility-settings.tsx#ConfigurationDialog|{RESPONSIBILITY_LABELS[responsibility]} ändern':
    {
      audits: [{ route: '/einstellungen/mitarbeiter', role: 'admin', opener: 'settings.responsibility' }],
    },
  'components/shared/metadata-section.tsx#MetadataSection|Ungespeicherte Änderungen verwerfen?': {
    audits: [{ route: '/kunden/[clientId]', role: 'admin', opener: 'shared.metadata-discard' }],
  },
  'components/shared/metadata-section.tsx#MetadataSection|{pendingSaveConfirmation?.title}': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'shared.metadata-confirm' }],
  },
  'components/zeiterfassung/pending-approvals-header.tsx#PendingApprovalsHeader|Alle Zeiteinträge genehmigen?':
    {
      audits: [{ route: '/zeiterfassung', role: 'admin', opener: 'time.approve-all' }],
    },
  'components/zeiterfassung/sickness-section-end-dialog.tsx#OwnSicknessEndDialog|Enddatum setzen': {
    audits: [{ route: '/zeiterfassung', role: 'employee', opener: 'field.sickness-end' }],
  },
  'components/zeiterfassung/sickness-section-report-dialog.tsx#OwnSicknessReportDialog|Krank melden': {
    audits: [{ route: '/zeiterfassung', role: 'employee', opener: 'field.sickness-report' }],
  },
  'components/zeiterfassung/sickness-section.tsx#SicknessCancelDialog|Krankmeldung stornieren': {
    audits: [{ route: '/zeiterfassung', role: 'employee', opener: 'field.sickness-cancel' }],
  },
  'components/zeiterfassung/time-correction-dialog.tsx#TimeCorrectionDialog|Zeitkorrektur': {
    audits: [
      { route: '/zeiterfassung', role: 'admin', opener: 'time.correction' },
      { route: '/zeiterfassung', role: 'employee', opener: 'field.time-correction' },
    ],
  },
  'components/zeiterfassung/vacation-approvals.tsx#VacationDecisionReasonDialog|{title}': {
    audits: [{ route: '/zeiterfassung', role: 'admin', opener: 'time.vacation-reason' }],
  },
  'components/zeiterfassung/vacation-section-request-dialog.tsx#OwnVacationRequestDialog|Urlaub beantragen': {
    audits: [{ route: '/zeiterfassung', role: 'employee', opener: 'field.vacation-request' }],
  },
  "components/auftraege/artifacts/work-artifacts-section.tsx#WorkArtifactDialog|{detail ? (currentRevision?.title ?? 'Arbeitsnachweis') : 'Arbeitsnachweis erstellen'}":
    {
      audits: [
        { route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.artifact' },
        { route: '/auftraege/[jobNumber]', role: 'employee', opener: 'field.artifact' },
      ],
    },
  'components/auftraege/forms/create-auftrag-project-dialog.tsx#CreateAuftragProjectDialog|Neuen Auftrag oder Projekt erstellen':
    {
      audits: [{ route: '/auftraege', role: 'admin', opener: 'work.create', tabs: ['job', 'project'] }],
    },
  'components/auftraege/forms/create-job-dialog.tsx#CreateJobDialog|Neuen Auftrag erstellen': {
    audits: [
      { route: '/auftraege/projekt/[projectNumber]', role: 'admin', opener: 'work.create-job-in-project' },
    ],
  },
  'components/auftraege/forms/edit-job-dialog.tsx#EditJobDialog|Auftrag bearbeiten': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.edit-job' }],
  },
  'components/auftraege/forms/edit-project-dialog.tsx#EditProjectDialog|Projekt bearbeiten': {
    audits: [{ route: '/auftraege/projekt/[projectNumber]', role: 'admin', opener: 'work.edit-project' }],
  },
  'components/auftraege/forms/park-confirmation-dialog.tsx#ParkConfirmationDialog|{dialogTitle}': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.park-confirm' }],
  },
  'components/auftraege/instructions/job-instruction-item-details-dialog.tsx#InstructionItemDetailsDialog|Eintragsdetails bearbeiten':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.instruction-details' }],
    },
  'components/auftraege/job-detail/job-detail-assign-dialog-sections.tsx#JobDetailAssignDialog|Mitarbeiter zuweisen':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.assign-employees' }],
    },
  'components/auftraege/job-detail/job-detail-delete-dialog.tsx#JobDetailDeleteDialog|Auftrag löschen?': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.delete-job' }],
  },
  'components/auftraege/job-detail/job-dispatch-challenge-dialog.tsx#JobDispatchChallengeDialog|Rückfrage zum Einsatz':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.dispatch-challenge' }],
    },
  'components/auftraege/job-detail/project-assignment-dialog.tsx#ProjectAssignmentDialog|{title}': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.assign-project' }],
  },
  'components/auftraege/lifecycle/work-lifecycle-artifact-approval-dialog.tsx#ArtifactApprovalDependencyDialog|Freigabe verknüpfen':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.lifecycle-approval' }],
    },
  "components/auftraege/lifecycle/work-lifecycle-blocker-dialog.tsx#WorkBlockerDialog|{kind === 'parking' ? 'Arbeit parken' : blocker ? 'Blocker bearbeiten' : 'Blocker erfassen'}":
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.lifecycle-blocker' }],
    },
  'components/auftraege/lifecycle/work-lifecycle-dependency-dialog.tsx#WorkDependencyDialog|Voraussetzung hinzufügen':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.lifecycle-dependency' }],
    },
  'components/auftraege/lifecycle/work-lifecycle-reason-dialog.tsx#ReasonDialog|{title}': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.lifecycle-reason' }],
  },
  'components/auftraege/lifecycle/work-lifecycle-transition-dialog.tsx#WorkTransitionDialog|{workTransitionActionLabel(snapshot.executionState, transition)}':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.lifecycle-transition' }],
    },
  'components/auftraege/list/filter-bar.tsx#FilterBar|Filter': {
    audits: [{ route: '/auftraege', role: 'admin', opener: 'work.filter-sheet' }],
  },
  'components/auftraege/list/job-actions-menu.tsx#JobActionsMenu|Auftrag löschen?': {
    audits: [{ route: '/auftraege', role: 'admin', opener: 'work.list-delete-job' }],
  },
  'components/auftraege/list/project-actions-menu.tsx#ProjectActionsMenu|Projekt löschen?': {
    audits: [{ route: '/auftraege', role: 'admin', opener: 'work.list-delete-project' }],
  },
  'components/auftraege/project-detail/project-detail-dialogs.tsx#ProjectDetailDeleteDialog|Projekt löschen?':
    {
      audits: [{ route: '/auftraege/projekt/[projectNumber]', role: 'admin', opener: 'work.delete-project' }],
    },
  'components/auftraege/project-detail/project-jobs-assignment-dialog.tsx#ProjectJobsAssignmentDialog|{title}':
    {
      audits: [{ route: '/auftraege/projekt/[projectNumber]', role: 'admin', opener: 'work.project-jobs' }],
    },
  'components/auftraege/shared/client-assignment-dialog.tsx#ClientAssignmentDialog|{title}': {
    audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.assign-client' }],
  },
  'components/auftraege/shared/qualification-warning-dialog.tsx#QualificationWarningDialogContent|Zuweisung prüfen':
    {
      audits: [{ route: '/auftraege/[jobNumber]', role: 'admin', opener: 'work.qualification-warning' }],
    },
  'components/kalender/board/shortcuts-help.tsx#ShortcutsHelp|Tastenkürzel': {
    audits: [{ route: '/kalender', role: 'admin', opener: 'calendar.shortcuts' }],
  },
} as const satisfies Readonly<Record<string, DialogInventoryEntry>>;

type DialogKey = keyof typeof DIALOG_INVENTORY;

type AuditedEntry = Extract<(typeof DIALOG_INVENTORY)[DialogKey], { audits: unknown }>;

/** Every opener id the inventory names; the opener map must implement each one. */
export type DialogOpenerId = AuditedEntry['audits'][number]['opener'];

/** One audit of one dialog, with the dialog's key. */
export type DialogAuditTarget = DialogAudit & { key: DialogKey; opener: DialogOpenerId };

/** Every audit of every dialog, in inventory order. */
export function dialogAuditTargets(): DialogAuditTarget[] {
  return (Object.entries(DIALOG_INVENTORY) as [DialogKey, DialogInventoryEntry][]).flatMap(([key, entry]) =>
    'audits' in entry
      ? entry.audits.map((audit) => ({ ...audit, key, opener: audit.opener as DialogOpenerId }))
      : [],
  );
}
