import type { Locator, Page } from '@playwright/test';

import { usableContentTarget } from '../../golden/support/browser-observation';
import { createAdminClient } from '../../golden/support/db/shared';
import { confirmed } from '../../golden/support/steps/shared';
import { customerCountPattern } from '../../golden/support/steps/customers';
import { workListSection } from '../../golden/support/steps/work';
import type { TestWorld } from '../../golden/support/world';

// Locators and setup of the lab journeys (lib/testing/journeys.ts). The lab
// specs pass data; the copy, the structure hooks and the setup live here.

/**
 * A job in the Aufträge list as the user opens it: the desktop row, which
 * navigates on a click, or the phone card's title link, whichever is shown.
 */
export function jobListEntry(page: Page, title: string): Locator {
  const section = workListSection(page);
  return confirmed(
    section
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: title, exact: true }) })
      .or(section.getByRole('link', { name: title, exact: true }))
      .filter({ visible: true }),
  );
}

/** The job list once its rows are read. */
export function jobListReady(page: Page): Locator {
  return usableContentTarget(page, 'auftraege').locator;
}

/** The office job detail once its content is read. */
export function jobDetailReady(page: Page): Locator {
  return usableContentTarget(page, 'auftrag').locator;
}

/** The field work pack once its overview has read the job and joined the live shell. */
export function fieldWorkPackReady(page: Page): Locator {
  return page
    .getByRole('main')
    .locator('[data-testid="field-work-pack-overview"][data-realtime-ready="true"]');
}

/** The customer list's count once it shows exactly `count` results. */
export function customerResultCount(page: Page, count: number): Locator {
  return page.getByRole('main').getByText(customerCountPattern(count)).filter({ visible: true }).first();
}

/** A sidebar destination of the app shell (desktop sidebar). */
export function appSidebarLink(page: Page, href: '/aufgaben' | '/kunden'): Locator {
  return page.locator(`aside a[href="${href}"]`);
}

/** The task list once its tasks are read. */
export function taskListReady(page: Page): Locator {
  return usableContentTarget(page, 'aufgaben').locator;
}

/** A settings section in the settings navigation. */
export function settingsSectionLink(page: Page, href: '/einstellungen/mitarbeiter'): Locator {
  return page.getByRole('main').locator(`a[href="${href}"]`).filter({ visible: true });
}

/** The time-approval responsibility card of the employee settings, which renders once its data is read. */
export function responsibilitySettingsReady(page: Page): Locator {
  return page.getByRole('main').getByTestId('responsibility-time_approval');
}

/** The approve control of one open submission card. */
export function approveSubmission(card: Locator): Locator {
  return card.getByTitle('Genehmigen - Eintrag bleibt erhalten');
}

/** The person row beside the measured visit's row on the Plantafel: both share the viewport. */
export async function neighbourBoardRow(
  page: Page,
  card: Locator,
): Promise<{ source: string; target: string }> {
  const source = await card.evaluate(
    (element) => element.closest('[data-board-row]')?.getAttribute('data-board-row') ?? '',
  );
  const rows = await page
    .getByRole('main')
    .locator('[data-plantafel] [data-board-row]')
    .evaluateAll((elements) => elements.map((row) => row.getAttribute('data-board-row') ?? ''));
  const index = rows.indexOf(source);
  const target = [rows[index + 1], rows[index - 1]].find((row) => Boolean(row) && row !== 'unassigned');
  if (!source || !target) throw new Error('The Plantafel needs a person row beside the measured visit.');
  return { source, target };
}

/** The measured visit's title as the board card shows it. */
export async function boardCardTitle(card: Locator): Promise<string> {
  const title = ((await card.textContent()) ?? '').match(/Auftrag \d+: (?:Heizung warten|Bad sanieren)/)?.[0];
  if (!title) throw new Error('The measured board card shows no job title.');
  return title;
}

/** Whether the stored checklist point is done. */
export async function checklistPointDone(input: {
  world: TestWorld;
  jobNumber: string;
  content: string;
}): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('job_instruction_items')
    .select('is_completed, jobs!inner(job_number)')
    .eq('organization_id', input.world.orgId)
    .eq('jobs.job_number', input.jobNumber)
    .eq('content', input.content)
    .single();
  if (error) throw new Error(`The checklist point could not be read: ${error.message}`);
  return data.is_completed;
}

/** Checklist points on the job the profile assigned to the employee, written as an office manager would. */
export async function seedChecklistPoints(input: {
  world: TestWorld;
  jobNumber: string;
  contents: readonly string[];
}): Promise<void> {
  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from('jobs')
    .select('id')
    .eq('organization_id', input.world.orgId)
    .eq('job_number', input.jobNumber)
    .single();
  if (error) throw new Error(`The assigned job ${input.jobNumber} could not be read: ${error.message}`);
  const { error: insertError } = await admin.from('job_instruction_items').insert(
    input.contents.map((content, index) => ({
      organization_id: input.world.orgId,
      job_id: job.id,
      content,
      created_by: input.world.users.admin.id,
      sort_order: index,
    })),
  );
  if (insertError) throw new Error(`The checklist points could not be seeded: ${insertError.message}`);
}

/** A control once it accepts input again: a row action is usable only after its save was confirmed. */
export function enabledControl(control: Locator): Locator {
  return control.and(control.page().locator(':enabled'));
}
