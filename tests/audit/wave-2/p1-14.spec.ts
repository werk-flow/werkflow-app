import { workTransitionActionLabel } from '../../../lib/work-lifecycle/types';
import { expect, test } from '../support/fixtures';
import { getAppliedWorkTemplateState, getWorkLifecycleState } from '../../golden/support/db/work';
import {
  documentsRegion,
  documentsRegionUploadInput,
  documentUploadCompleted,
} from '../../golden/support/steps/documents';
import { SHARED_COPY, textInDom, visibleText } from '../../golden/support/steps/shared';
import {
  addDeclaredWorkDependency,
  addWorkBlocker,
  addWorkDependency,
  changeWorkDependency,
  confirmLifecycleReason,
  createAndPublishWorkTemplate,
  createJob,
  createProject,
  handoverAction,
  handoverField,
  handoverMessage,
  jobInstructionItem,
  jobInstructionToggle,
  lifecycleAction,
  lifecycleBadge,
  lifecycleCardActionName,
  lifecycleDialogRefusal,
  lifecycleNextStep,
  lifecycleNoMaterialDemand,
  lifecycleReadinessTitle,
  lifecycleRefusalBanner,
  lifecycleRemoteUpdateHint,
  lifecycleState,
  openResolvedBlockers,
  parkWork,
  selectAllHandoverSources,
  transitionWork,
  workDependencyRow,
  workDependencyState,
  workHandoverSection,
  workLifecycleDialog,
  workLifecycleDialogCancel,
  workListStateFilter,
  workTransitionSave,
} from '../../golden/support/steps/work';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { representativeReadinessState } from '../support/p1-14-steps';
import { observeRouteRenders } from '../../golden/support/route-renders';

function digits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

// The field worker's own blocker and the automatic time start are the journey
// in tests/golden/p1-14.spec.ts. Ledger side effects and the organization
// boundary are database rules in supabase/tests/work_execution_boundaries.sql.
test.describe('P1-14 exhaustive work lifecycle flows @AUDIT-W2-P1-14 @AUDIT-W2', () => {
  test('summary, filters, role transitions, stale recovery, and dialog catch-up', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    // P1-14-F01…F12: explicit facets and next action; canonical list badge/filter;
    // manager and employee transition bounds; reason; stale optimistic version;
    // open-dialog preservation and catch-up.
    const jobNumber = `AUF-${world.runId}-P114-STATE`;
    await createJob(adminPage, {
      jobNumber,
      title: `Audit Arbeitsstand ${world.runId}`,
      plannedDateDigits: digits(ownedBerlinDateAtOffset('p1-14', 75)),
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(lifecycleState(adminPage, 'not_started')).toBeVisible();
    await expect(lifecycleBadge(adminPage, 'planned')).toBeVisible();
    await expect(lifecycleNextStep(adminPage, 'not_started')).toBeVisible();
    await expect(representativeReadinessState(adminPage, 'unknown')).toBeVisible();

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await expect(
      employeePage
        .getByTestId('work-lifecycle-card')
        .getByRole('button', { name: workTransitionActionLabel('not_started', 'cancelled') }),
    ).toHaveCount(0);
    await expect(
      employeePage
        .getByTestId('work-lifecycle-card')
        .getByRole('button', { name: lifecycleCardActionName('park') }),
    ).toHaveCount(0);

    await bueroPage.goto(`/auftraege/${jobNumber}`);
    await lifecycleAction(bueroPage, 'not_started', 'in_progress').click();
    await transitionWork(adminPage, 'not_started', 'in_progress');
    await expect(lifecycleRemoteUpdateHint(bueroPage)).toBeVisible({ timeout: 20_000 });
    await workTransitionSave(workLifecycleDialog(bueroPage)).click();
    // The dialog closes with the click; the refusal names the rule in the banner.
    await expect(lifecycleRefusalBanner(bueroPage, 'work_transition_stale_version')).toBeVisible();
    await expect(workLifecycleDialog(bueroPage)).toHaveCount(0);
    await expect(lifecycleState(bueroPage, 'in_progress')).toBeVisible();

    await adminPage.reload();
    // Each save renders the route once at most (tests/golden/route-renders.json).
    const renders = observeRouteRenders(adminPage, 'p1-14');
    await renders.forSave('lifecycle.interrupt', () =>
      transitionWork(adminPage, 'in_progress', 'interrupted', {
        reason: 'Kunde ist vorübergehend nicht vor Ort.',
      }),
    );
    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.entity).toMatchObject({
      execution_state: 'interrupted',
      execution_version: 2,
    });
    expect(state.executionEvents.map((event) => event.to_state)).toEqual(['in_progress', 'interrupted']);

    await adminPage.goto('/auftraege');
    await workListStateFilter(adminPage, 'interrupted', 1).click();
    await expect(visibleText(adminPage, jobNumber)).toBeVisible();
  });

  test('blockers, owners, review, attention, resolution, and parking stay one model', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-14-F13…F25: multiple blocker facts, required owner/review, employee-self
    // rule, due attention identity, resolution history, parking distinction,
    // legacy-gap honesty, atomic unpark, and no duplicate context system. The
    // employee's own resolution is the golden journey; here the manager resolves.
    const jobNumber = `AUF-${world.runId}-P114-BLOCK`;
    const jobTitle = `Audit Blocker ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title: jobTitle,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await employeePage.goto(`/auftraege/${jobNumber}`);
    await addWorkBlocker(employeePage, {
      reason: 'safety',
      details: 'Arbeitsbereich muss abgesperrt werden.',
    });
    await expect(lifecycleNextStep(employeePage, 'not_started', 'blocker')).toBeVisible();

    await adminPage.goto('/aufgaben');
    await expect(visibleText(adminPage, jobTitle)).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    let dialog = await confirmLifecycleReason(
      adminPage,
      'resolveBlocker',
      'Bereich ist abgesperrt und freigegeben.',
    );
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await adminPage.reload();
    await openResolvedBlockers(adminPage);
    dialog = await confirmLifecycleReason(
      adminPage,
      'reopenBlocker',
      'Die Absperrung wurde vorzeitig entfernt.',
    );
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await adminPage.reload();
    dialog = await confirmLifecycleReason(adminPage, 'resolveBlocker', 'Die Absperrung ist wieder wirksam.');
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await adminPage.reload();
    dialog = await parkWork(adminPage, {
      reason: 'customer',
      details: 'Neuen Ausführungstermin mit Kunde abstimmen.',
      responsibleName: world.users.admin.firstName,
      reviewDate: berlinDateAtOffset(76),
    });
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect(lifecycleBadge(adminPage, 'parked')).toBeVisible();

    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.blockers.map((blocker) => [blocker.kind, blocker.state])).toEqual([
      ['blocker', 'resolved'],
      ['parking', 'open'],
    ]);
    expect(state.blockers[0]?.version).toBe(4);
    expect(state.entity).toMatchObject({
      execution_state: 'not_started',
      status: 'geparkt',
    });
  });

  test('work prerequisites block start, follow predecessor state, reject cycles, and retain history', async ({
    adminPage,
    world,
  }) => {
    // P1-14-F26…F36: work/task/declarative prerequisite kinds, effect vocabulary,
    // same-org target selection, start/completion/warning semantics, cycle/self
    // rejection, derived satisfaction, predecessor reopening, versioned declared
    // resolution, removal, and retained event history.
    const first = `AUF-${world.runId}-P114-DEP-A`;
    const second = `AUF-${world.runId}-P114-DEP-B`;
    await createJob(adminPage, {
      jobNumber: first,
      title: `Abhängiger Auftrag ${world.runId}`,
    });
    await createJob(adminPage, {
      jobNumber: second,
      title: `Vorausgehender Auftrag ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/${first}`);
    await addWorkDependency(adminPage, second);
    let dialog = await addWorkDependency(adminPage, first);
    await expect(lifecycleDialogRefusal(dialog, 'work_dependency_self')).toBeVisible();
    await workLifecycleDialogCancel(dialog).click();
    await transitionWork(adminPage, 'not_started', 'in_progress', { outcome: 'submitted' });
    // The dialog closes with the click; the refusal names the rule in the banner and the start stays offered.
    await expect(lifecycleRefusalBanner(adminPage, 'work_transition_start_blocked')).toBeVisible();
    await expect(workLifecycleDialog(adminPage)).toHaveCount(0);
    await expect(lifecycleAction(adminPage, 'not_started', 'in_progress')).toBeEnabled();

    await adminPage.goto(`/auftraege/${second}`);
    dialog = await addWorkDependency(adminPage, first);
    await expect(lifecycleDialogRefusal(dialog, 'work_dependency_cycle')).toBeVisible();
    await workLifecycleDialogCancel(dialog).click();

    await transitionWork(adminPage, 'not_started', 'in_progress');
    await transitionWork(adminPage, 'in_progress', 'execution_complete');
    await adminPage.goto(`/auftraege/${first}`);
    await expect(workDependencyState(workDependencyRow(adminPage), 'satisfied')).toBeVisible();
    await transitionWork(adminPage, 'not_started', 'in_progress');
    let state = await getWorkLifecycleState(world.orgId, { jobNumber: first });
    expect(state.dependencies[0]).toMatchObject({
      effect: 'blocks_start',
      state: 'open',
      isSatisfied: true,
    });

    await adminPage.goto(`/auftraege/${second}`);
    await transitionWork(adminPage, 'execution_complete', 'in_progress', {
      reason: 'Nacharbeit wurde erforderlich.',
    });
    await adminPage.goto(`/auftraege/${first}`);
    await expect(workDependencyState(workDependencyRow(adminPage), 'open')).toBeVisible();
    state = await getWorkLifecycleState(world.orgId, { jobNumber: first });
    expect(state.dependencies[0]).toMatchObject({
      state: 'open',
      isSatisfied: false,
    });
    await adminPage.goto(`/auftraege/${second}`);
    await transitionWork(adminPage, 'in_progress', 'cancelled', {
      reason: 'Vorausgehender Auftrag wurde storniert.',
    });
    await adminPage.goto(`/auftraege/${first}`);
    await expect(workDependencyState(workDependencyRow(adminPage), 'open')).toBeVisible();

    // Since P1-17 an approval-kind (Freigabe) dependency is satisfied by
    // linking a released Arbeitsnachweis, not by the manual Erfüllt cycle
    // this test exercises; the manual cycle stays sanctioned for the other
    // declared kinds.
    const declaredDescription = 'Bauseitige Freigabe liegt vor.';
    dialog = await addDeclaredWorkDependency(adminPage, {
      kind: 'site_condition',
      description: declaredDescription,
      effect: 'blocks_completion',
    });
    // Bound each step so a lost submit or a Realtime remount fails in seconds
    // with the real cause instead of waiting out the test budget (local-stack
    // finding 2026-08-28).
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const declared = workDependencyRow(adminPage, declaredDescription);
    await expect(declared).toBeVisible({ timeout: 20_000 });
    dialog = await changeWorkDependency(
      adminPage,
      declared,
      'fulfil',
      'Freigabe wurde schriftlich bestätigt.',
    );
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    dialog = await changeWorkDependency(adminPage, declared, 'reopen', 'Freigabe wurde zurückgezogen.');
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    dialog = await changeWorkDependency(adminPage, declared, 'remove', 'Die Bedingung entfällt endgültig.');
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    state = await getWorkLifecycleState(world.orgId, { jobNumber: first });
    expect(state.dependencies).toHaveLength(2);
    expect(
      state.dependencies.find((dependency) => dependency.declared_kind === 'site_condition'),
    ).toMatchObject({
      effect: 'blocks_completion',
      state: 'removed',
      version: 4,
    });
  });

  test('live readiness and authoritative completion gates remain honest through handover', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-14-F37…F48: shared readiness dimensions and unknown/load-failure posture;
    // no-demand material and unassessed tools; instruction/predecessor/time gates;
    // current-fact evaluation, reasoned manager override snapshot/fingerprint;
    // execution-complete versus handover; later-slice facts remain not assessable.
    const templateName = `Audit Lifecycle Vorlage ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P114-GATE`;
    const firstItem = 'Anlage sicher abschalten';
    await createAndPublishWorkTemplate(adminPage, {
      name: templateName,
      targetType: 'job',
      firstItem,
      secondItem: 'Arbeitsstelle räumen',
    });
    await createJob(adminPage, {
      jobNumber,
      title: `Audit Abschluss ${world.runId}`,
      workTemplateName: templateName,
      plannedDateDigits: digits(ownedBerlinDateAtOffset('p1-14', 77)),
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    await expect(lifecycleReadinessTitle(adminPage)).toBeVisible();
    await expect(representativeReadinessState(adminPage, 'unknown')).toBeVisible();
    await expect(lifecycleNoMaterialDemand(adminPage)).toBeVisible();
    await transitionWork(adminPage, 'not_started', 'in_progress');
    await transitionWork(adminPage, 'in_progress', 'execution_complete', { outcome: 'submitted' });
    await expect(
      lifecycleDialogRefusal(workLifecycleDialog(adminPage), 'work_transition_completion_blocked'),
    ).toBeVisible();
    await workLifecycleDialogCancel(workLifecycleDialog(adminPage)).click();

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const firstInstruction = jobInstructionItem(employeePage, firstItem);
    await jobInstructionToggle(firstInstruction, 'done').click();
    await expect(jobInstructionToggle(firstInstruction, 'open')).toBeVisible();
    await expect
      .poll(async () => {
        const applied = await getAppliedWorkTemplateState(world.orgId, {
          jobNumber,
        });
        return applied.instructions[0]?.is_completed;
      })
      .toBe(true);
    await employeePage.reload();
    await expect(jobInstructionToggle(jobInstructionItem(employeePage, firstItem), 'open')).toBeVisible();

    await adminPage.reload();
    await transitionWork(adminPage, 'in_progress', 'execution_complete');
    // Since P1-17, handed_over is reached only through the handover release
    // flow — the pre-P1-17 manual manager transition no longer exists. The
    // full handover section lives on the dedicated Übergabe page and needs at
    // least one releasable source; a run-scoped job document is the cheapest
    // (the shared fixture name would collide with P1-15's upload in the same
    // world and get dedup-renamed).
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const documentsHeading = adminPage.getByRole('heading', {
      name: SHARED_COPY.region.documents,
    });
    await expect(documentsHeading).toBeVisible({
      timeout: 30_000,
    });
    await documentsRegionUploadInput(documentsRegion(adminPage)).setInputFiles({
      name: `p114-uebergabequelle-${world.runId}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nP1-14 Uebergabequelle'),
    });
    await expect(documentUploadCompleted(adminPage, 1, 1)).toBeVisible({
      timeout: 60_000,
    });
    await expect(textInDom(adminPage, SHARED_COPY.upload.failed)).toHaveCount(0);
    const uploadClose = adminPage.getByRole('button', { name: SHARED_COPY.action.close });
    if (await uploadClose.isVisible().catch(() => false)) {
      await uploadClose.click();
    }
    await expect(adminPage.getByRole('dialog')).toHaveCount(0, {
      timeout: 10_000,
    });
    await adminPage.goto(`/auftraege/${jobNumber}/uebergabe`);
    const handoverSection = workHandoverSection(adminPage);
    await selectAllHandoverSources(handoverSection);
    await handoverAction(handoverSection, 'saveDraft').click();
    await expect(handoverMessage(handoverSection, 'draftSaved')).toBeVisible({
      timeout: 20_000,
    });
    const handoverOverride = handoverField(handoverSection, 'exceptionReason');
    if (await handoverOverride.isVisible().catch(() => false)) {
      await handoverOverride.fill('Offene Punkte sind im Übergabepaket transparent ausgewiesen.');
    }
    const previewPromise = adminPage.waitForEvent('popup');
    await handoverAction(handoverSection, 'openPreview').click();
    const handoverPreview = await previewPromise;
    await handoverPreview.waitForLoadState('domcontentloaded');
    await expect(handoverMessage(handoverSection, 'previewCreated')).toBeVisible({
      timeout: 20_000,
    });
    await handoverAction(handoverSection, 'release').click();
    await expect(handoverMessage(handoverSection, 'released')).toBeVisible({
      timeout: 30_000,
    });
    await handoverPreview.close();
    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.entity).toMatchObject({
      execution_state: 'handed_over',
      execution_version: 3,
    });
    const handover = expectDefined(state.executionEvents.at(-1), 'the handover execution event');
    expect(handover).toMatchObject({ to_state: 'handed_over' });
    expect(handover.gate_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(handover.gate_snapshot).toMatchObject({
      incompleteRequiredInstructions: 0,
    });
  });

  test('project derivation, parking cascade, reasoned override, and outsider denial hold', async ({
    adminPage,
    outsiderPage,
    world,
  }) => {
    // P1-14-F49…F63: child-derived/empty/mixed projects, reasoned override and
    // clear; no cascade; project parking reaches its children and unparks them;
    // outsider page denial. The automatic time start is the golden journey;
    // ledger side effects and RLS are in supabase/tests/work_execution_boundaries.sql.
    const projectNumber = `PRJ-${world.runId}-P114`;
    const jobNumber = `AUF-${world.runId}-P114-AUTO`;
    const title = `Audit Automatik ${world.runId}`;
    await createProject(adminPage, {
      projectNumber,
      title: `Audit Projekt ${world.runId}`,
    });
    await createJob(adminPage, {
      jobNumber,
      title,
      projectNumber,
      plannedDateDigits: digits(ownedBerlinDateAtOffset('p1-14', 78)),
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await expect(lifecycleBadge(adminPage, 'derived')).toBeVisible();
    let dialog = await parkWork(adminPage, {
      reason: 'capacity',
      details: 'Projekt wird bis zur neuen Einsatzplanung geparkt.',
      responsibleName: world.users.admin.firstName,
      reviewDate: berlinDateAtOffset(79),
    });
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    let childParkingState = await getWorkLifecycleState(world.orgId, {
      jobNumber,
    });
    expect(childParkingState.blockers[0]).toMatchObject({
      kind: 'parking',
      state: 'open',
    });
    expect(childParkingState.blockers[0]?.parent_project_parking_blocker_id).not.toBeNull();
    expect(childParkingState.entity).toMatchObject({ status: 'geparkt' });
    dialog = await confirmLifecycleReason(
      adminPage,
      'continuePlanning',
      'Projekt wird wieder für die Einsatzplanung geöffnet.',
    );
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    childParkingState = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(childParkingState.blockers[0]).toMatchObject({
      kind: 'parking',
      state: 'resolved',
    });
    expect(childParkingState.entity).toMatchObject({
      status: 'nicht_bearbeitet',
    });
    await transitionWork(adminPage, 'not_started', 'cancelled', {
      reason: 'Projekt pausiert nicht, sondern wurde wirksam storniert.',
    });
    let projectState = await getWorkLifecycleState(world.orgId, {
      projectNumber,
    });
    expect(projectState.entity).toMatchObject({
      execution_state_override: 'cancelled',
      status_override: null,
    });
    const childBefore = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(childBefore.entity).toMatchObject({
      execution_state: 'not_started',
    });
    dialog = await confirmLifecycleReason(
      adminPage,
      'deriveAutomatically',
      'Projekt folgt wieder dem Auftragsstand.',
    );
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    projectState = await getWorkLifecycleState(world.orgId, { projectNumber });
    expect(projectState.entity).toMatchObject({
      execution_state_override: null,
    });

    await outsiderPage.goto(`/auftraege/${jobNumber}`);
    await expect(outsiderPage.getByTestId('work-lifecycle-card')).toHaveCount(0);
  });
});
