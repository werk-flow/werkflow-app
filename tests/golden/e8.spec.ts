import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { REQUEST_CLOSE_REASON_LABELS } from '../../lib/requests/types';
import { expect, test } from './support/fixtures';
import { berlinDateAtOffset } from './support/date-ownership';
import { seedCustomer } from './support/db/customers';
import { seedStoredImageDocument } from './support/db/documents';
import { getRequestById, seedRequest } from './support/db/requests';
import { seedEquipmentJobLink, seedInstalledEquipment } from './support/db/service';
import { seedJob, seedJobAssignment } from './support/db/work';
import {
  aufgabenSidebarBadge,
  callbackTaskLink,
  expectBadgeCount,
  expectStartPageRead,
  openAufgaben,
  startPageRegion,
} from './support/steps/attention';
import { openPage } from './support/streamed-content';
import { customerDocumentsRegion, customerSiteSourceNumber } from './support/steps/customers';
import { documentOpenButton, documentViewer, expectDocumentImageShown } from './support/steps/documents';
import { dismissDialog, hydratedAndSettled } from './support/steps/interaction';
import { closeRequestOnDetail } from './support/steps/requests';
import { globalSearchDialog, searchEverywhere, searchFoundNothing, searchHit } from './support/steps/search';
import { openFieldEquipmentRecord } from './support/steps/service';
import { documentTimeOrigin, expectGone, openDashboardInApp, testData } from './support/steps/shared';
import type { TestWorld } from './support/world';

// E8 — Find work and act from role starts (@E8): the epic's acceptance
// journeys, each one person's connected path through the header search, the
// start page and Aufgaben. lib/search/global-search-boundaries.test.ts proves
// that search fails closed across organizations and roles; the unit, SQL and
// component tests of lib/search/, lib/attention/ and components/dashboard/ own
// the rules and states below the browser. Every test seeds its own run-scoped
// customers, so the journeys pass alone and in any order.

test.describe('E8 Finden und vom Start aus handeln @E8', () => {
  test('Büro findet beim Anruf das Objekt über die alte Objektnummer, öffnet das Original und erledigt den überfälligen Rückruf', async ({
    bueroPage,
    world,
  }) => {
    const customer = testData`Hausverwaltung Lindenhof ${world.runId}`;
    const site = testData`Wohnanlage Lindenhof ${world.runId}`;
    const objectNumber = `OBJ-${world.runId}-LH`;
    const original = testData`Wartungsvertrag Lindenhof ${world.runId}`;
    const requestNumber = `ANF-${world.runId}-E8-BUERO`;
    const { clientId, siteIds } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      clientType: 'gewerblich',
      sites: [
        {
          name: site,
          street: 'Lindenhofweg 12',
          postalCode: '70173',
          city: 'Stuttgart',
          sourceNumber: objectNumber,
        },
      ],
    });
    const siteId = expectDefined(siteIds.get(site), 'the Lindenhof site');
    await seedStoredImageDocument({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      displayName: original,
      clientId,
      origin: { sourceSystem: 'Sykasoft', sourceReference: `WV-${world.runId}` },
    });
    // Büro promised Erika Musterfrau a callback yesterday; she calls again.
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      assignedTo: world.users.buero.id,
      summary: testData`Heizung im Haus Lindenhof bleibt kalt ${world.runId}`,
      requestNumber,
      clientId,
      siteId,
      callerName: 'Erika Musterfrau',
      callbackDueAt: `${berlinDateAtOffset(-1)}T08:00:00.000Z`,
    });

    await test.step('Büro findet das Objekt über seine Objektnummer im Altsystem und öffnet es', async () => {
      await bueroPage.goto('/dashboard');
      await hydratedAndSettled(bueroPage);
      const search = await searchEverywhere(bueroPage, objectNumber);
      await searchHit(search, 'einsatzorte', site).click();
      await bueroPage.waitForURL(`**/kunden/${clientId}`);
      await expect(customerSiteSourceNumber(bueroPage, objectNumber)).toBeVisible();
    });

    await test.step('Büro öffnet das verknüpfte Original aus dem Altsystem', async () => {
      await documentOpenButton(customerDocumentsRegion(bueroPage), original).click();
      const viewer = documentViewer(bueroPage, original);
      await expectDocumentImageShown(viewer, original);
      await dismissDialog(viewer);
    });

    await test.step('Büro findet den überfälligen Rückruf auf dem Start und erledigt ihn', async () => {
      await openDashboardInApp(bueroPage);
      await callbackTaskLink(startPageRegion(bueroPage, 'office'), requestNumber).click();
      await bueroPage.waitForURL(`**/anfragen/${requestId}`);
      await closeRequestOnDetail(bueroPage, REQUEST_CLOSE_REASON_LABELS.anderweitig_geloest);
      expect((await getRequestById(requestId)).status).toBe('geschlossen');
    });

    await test.step('Der Rückruf verlässt den Start und Aufgaben', async () => {
      await openDashboardInApp(bueroPage);
      await expectStartPageRead(bueroPage);
      await expectGone(callbackTaskLink(startPageRegion(bueroPage, 'office'), requestNumber));
      await openAufgaben(bueroPage);
      await expectGone(callbackTaskLink(bueroPage, requestNumber));
    });
  });

  test('Admin entscheidet eine Ausnahme dort, wo sie entschieden wird, und sieht sie ohne Neuladen überall verschwinden', async ({
    adminPage,
    world,
  }) => {
    const requestNumber = `ANF-${world.runId}-E8-ADMIN`;
    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: testData`Bäckerei Sonnenschein ${world.runId}`,
      clientType: 'gewerblich',
    });
    // Büro's callback, promised a week ago, is overdue past the owner start's threshold.
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      assignedTo: world.users.buero.id,
      summary: testData`Rückruf wegen Warmwasser in der Backstube ${world.runId}`,
      requestNumber,
      clientId,
      callerName: 'Max Mustermann',
      callbackDueAt: `${berlinDateAtOffset(-7)}T08:00:00.000Z`,
    });

    const session =
      await test.step('Admin sieht die Ausnahme in Aufgaben, auf dem Start und am Zähler', async () => {
        // A second tab of the same session holds Aufgaben open; nothing loads it again.
        const aufgaben = await openPage(adminPage.context());
        await openAufgaben(aufgaben);
        await expect(callbackTaskLink(aufgaben, requestNumber)).toBeVisible();
        const badge = aufgabenSidebarBadge(aufgaben);
        await expect(badge).toHaveText(/^\d+$/);
        const openTasks = Number(await badge.textContent());
        await adminPage.goto('/dashboard');
        await hydratedAndSettled(adminPage);
        await expect(callbackTaskLink(startPageRegion(adminPage, 'owner'), requestNumber)).toBeVisible();
        await expect(aufgabenSidebarBadge(adminPage)).toHaveText(String(openTasks));
        return {
          aufgaben,
          openTasks,
          documents: [await documentTimeOrigin(aufgaben), await documentTimeOrigin(adminPage)],
        };
      });

    await test.step('Admin erledigt den Rückruf an der Anfrage, die der Start öffnet', async () => {
      await callbackTaskLink(startPageRegion(adminPage, 'owner'), requestNumber).click();
      await adminPage.waitForURL(`**/anfragen/${requestId}`);
      await closeRequestOnDetail(adminPage, REQUEST_CLOSE_REASON_LABELS.kein_bedarf);
      expect((await getRequestById(requestId)).status).toBe('geschlossen');
    });

    await test.step('Aufgaben, Start und Zähler zeigen ihn nicht mehr, ohne Neuladen', async () => {
      const remaining = session.openTasks - 1;
      await expectGone(callbackTaskLink(session.aufgaben, requestNumber));
      await expectBadgeCount(aufgabenSidebarBadge(session.aufgaben), remaining);
      await openDashboardInApp(adminPage);
      await expectStartPageRead(adminPage);
      await expect(startPageRegion(adminPage, 'owner')).toBeVisible();
      await expectGone(callbackTaskLink(startPageRegion(adminPage, 'owner'), requestNumber));
      await expectGone(callbackTaskLink(startPageRegion(adminPage, 'office'), requestNumber));
      await expectBadgeCount(aufgabenSidebarBadge(adminPage), remaining);
      expect(
        [await documentTimeOrigin(session.aufgaben), await documentTimeOrigin(adminPage)],
        'both tabs kept their documents',
      ).toEqual(session.documents);
    });
  });

  test('Ein Monteur findet die Anlage seines Auftrags über die alte Nummer, öffnet die Bedienungsanleitung und nichts Fremdes', async ({
    employeePage,
    world,
  }) => {
    const oldNumberPrefix = `ALT-${world.runId}-E8`;
    const own = {
      customer: testData`Hausverwaltung Birkenhof ${world.runId}`,
      site: testData`Wohnanlage Birkenhof ${world.runId}`,
      jobNumber: `AUF-${world.runId}-E8-EIGEN`,
      equipment: testData`Brennwertkessel Birkenhof ${world.runId}`,
      manual: testData`Bedienungsanleitung Brennwertkessel ${world.runId}`,
    };
    const foreign = {
      customer: testData`Wohnungsbau Ahornweg ${world.runId}`,
      site: testData`Mehrfamilienhaus Ahornweg ${world.runId}`,
      jobNumber: `AUF-${world.runId}-E8-FREMD`,
      equipment: testData`Wärmepumpe Ahornweg ${world.runId}`,
    };
    const ownEquipmentId = await seedAssignedEquipmentJob(
      world,
      own,
      `${oldNumberPrefix}-1`,
      world.users.employee.id,
    );
    await seedStoredImageDocument({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      displayName: own.manual,
      equipmentId: ownEquipmentId,
    });
    // A colleague's job for another customer, its Anlage under the same old-number prefix.
    await seedAssignedEquipmentJob(world, foreign, `${oldNumberPrefix}-2`, world.users.admin.id);

    await test.step('Die Suche findet nur die Anlage des eigenen Auftrags und nichts eines anderen Kunden', async () => {
      await employeePage.goto('/dashboard');
      await hydratedAndSettled(employeePage);
      const byCustomer = await searchEverywhere(employeePage, foreign.customer);
      await expect(searchFoundNothing(byCustomer)).toBeVisible();
      await dismissDialog(byCustomer);
      const byOldNumber = await searchEverywhere(employeePage, oldNumberPrefix);
      await expect(searchHit(byOldNumber, 'anlagen', own.equipment)).toBeVisible();
      await expectGone(byOldNumber.getByText(foreign.equipment));
    });

    await test.step('Der Monteur öffnet die Anlage aus dem Treffer und ihre Bedienungsanleitung', async () => {
      await searchHit(globalSearchDialog(employeePage), 'anlagen', own.equipment).click();
      await employeePage.waitForURL(`**/auftraege/${own.jobNumber}#anlage-${ownEquipmentId}`);
      const record = await openFieldEquipmentRecord(employeePage, own.equipment);
      await documentOpenButton(record, own.manual).click();
      await expectDocumentImageShown(documentViewer(employeePage, own.manual), own.manual);
    });
  });
});

/** A customer with one site, a job there assigned to one person, and its Anlage with an old number, linked to the job. */
async function seedAssignedEquipmentJob(
  world: TestWorld,
  records: { customer: string; site: string; jobNumber: string; equipment: string },
  sourceNumber: string,
  assigneeId: string,
): Promise<string> {
  const actor = { orgId: world.orgId, actorId: world.users.admin.id };
  const { clientId, siteIds } = await seedCustomer({
    ...actor,
    name: records.customer,
    clientType: 'gewerblich',
    sites: [{ name: records.site, city: 'Stuttgart', isPrimary: true }],
  });
  const siteId = expectDefined(siteIds.get(records.site), `the site ${records.site}`);
  const jobId = await seedJob({
    ...actor,
    jobNumber: records.jobNumber,
    title: testData`Wartung ${records.equipment}`,
    clientId,
    siteId,
  });
  const equipment = await seedInstalledEquipment({
    ...actor,
    clientId,
    siteId,
    name: records.equipment,
    manufacturer: 'Musterwerk Heiztechnik',
    sourceNumber,
  });
  await seedEquipmentJobLink({ ...actor, equipment, jobId });
  await seedJobAssignment({ ...actor, jobId, userId: assigneeId });
  return equipment.id;
}
