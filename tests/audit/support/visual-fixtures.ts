import type { TestRole, TestWorld } from '../../golden/support/world';
import { seedCustomer } from '../../golden/support/db/customers';
import {
  seedJob,
  seedJobAssignment,
  seedProject,
  seedPublishedWorkTemplate,
} from '../../golden/support/db/work';
import { seedRequest } from '../../golden/support/db/requests';
import { seedInstalledEquipment, seedServiceCase } from '../../golden/support/db/service';
import { seedOrganizationCertification } from '../../golden/support/db/qualifications';
import { createAdminClient } from '../../golden/support/db/shared';

// The visual reference world: constant, realistic SHK data, so that every
// reference image shows the same names and numbers on every run. Rows are
// inserted one by one in a fixed order, so lists sorted by creation time keep
// their order. Nothing here is dated relative to the run day: the references
// normalize the dates the app derives from the clock (visual-references.ts).

const VISUAL_ORGANIZATION = 'Haustechnik Krämer GmbH';

const VISUAL_PEOPLE: Readonly<Record<TestRole | 'removable', readonly [string, string, string]>> = {
  admin: ['Martin', 'Krämer', 'martin.kraemer@haustechnik-kraemer.de'],
  buero: ['Sabine', 'Vogel', 'sabine.vogel@haustechnik-kraemer.de'],
  employee: ['Kevin', 'Schmid', 'kevin.schmid@haustechnik-kraemer.de'],
  removable: ['Jonas', 'Becker', 'jonas.becker@haustechnik-kraemer.de'],
};

export const VISUAL_NAMES = {
  housingCompany: 'Wohnungsbaugenossenschaft Neckartal eG',
  family: 'Familie Hoffmann',
  bakery: 'Bäckerei Sommer GmbH',
  practice: 'Praxis Dr. Wolf',
  project: 'Sanierung Wohnanlage Uferweg',
  projectNumber: 'P-2026-0007',
  projectJob: 'Heizungsverteilung Haus B erneuern',
  projectJobNumber: 'A-2026-0201',
  job: 'Gastherme warten und Abgasmessung',
  jobNumber: 'A-2026-0101',
  request: 'Heizung im Dachgeschoss bleibt kalt',
  requestNumber: 'ANF-2026-0301',
  equipment: 'Gas-Brennwerttherme',
  serviceCase: 'Therme zeigt Störung F.28',
  template: 'Jährliche Thermenwartung',
  // The last row the seed writes; its presence means the world is complete.
  lastDocument: 'Wartungsvertrag Wohnanlage Uferweg.pdf',
} as const;

export type VisualDetails = {
  familyClientId: string;
  requestId: string;
  equipmentNumber: string;
  caseNumber: string;
};

const DOCUMENTS = [
  'Wartungsprotokoll Therme Hoffmann.pdf',
  'Angebot Badsanierung Praxis Dr. Wolf.pdf',
  'Foto Heizungsraum Haus B.jpg',
  VISUAL_NAMES.lastDocument,
] as const;

/** Seeds the constant reference data once per world and returns the ids the routes need. */
export async function prepareVisualWorld(world: TestWorld): Promise<VisualDetails> {
  if (world.auditGroup !== 'visual/references.spec.ts')
    throw new Error('Visual reference fixtures require their owning audit world.');
  const admin = createAdminClient();
  const { data: marker } = await admin
    .from('documents')
    .select('id')
    .eq('organization_id', world.orgId)
    .eq('display_name', VISUAL_NAMES.lastDocument)
    .maybeSingle()
    .throwOnError();
  if (!marker) await seedVisualWorld(world);
  return readVisualDetails(world);
}

async function seedVisualWorld(world: TestWorld): Promise<void> {
  const admin = createAdminClient();
  const orgId = world.orgId;
  const actorId = world.users.admin.id;
  // Display names only; cleanup stays id-based (tests/golden/support/seed.ts).
  await admin.from('organizations').update({ name: VISUAL_ORGANIZATION }).eq('id', orgId).throwOnError();
  for (const [role, user] of [
    ['admin', world.users.admin],
    ['buero', world.users.buero],
    ['employee', world.users.employee],
    ['removable', world.removableEmployee],
  ] as const) {
    const [firstName, lastName] = VISUAL_PEOPLE[role];
    await admin
      .from('profiles')
      .update({ first_name: firstName, last_name: lastName })
      .eq('id', user.id)
      .throwOnError();
    await admin
      .from('employee_records')
      .update({ first_name: firstName, last_name: lastName })
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .throwOnError();
  }
  await admin
    .from('inventory_items')
    .update({ name: 'Kupferrohr 15 mm' })
    .eq('id', world.inventory.itemId)
    .throwOnError();
  await admin
    .from('inventory_locations')
    .update({ name: 'Hauptlager' })
    .eq('id', world.inventory.locationId)
    .throwOnError();

  const housing = await seedCustomer({
    orgId,
    actorId,
    name: VISUAL_NAMES.housingCompany,
    clientType: 'gewerblich',
    address: 'Uferweg 12, 70190 Stuttgart',
    contacts: [{ name: 'Petra Berger', role: 'Hausverwaltung', phone: '0711 4300187', isPrimary: true }],
    sites: [
      {
        name: 'Wohnanlage Uferweg',
        street: 'Uferweg 12',
        postalCode: '70190',
        city: 'Stuttgart',
        primaryContactName: 'Petra Berger',
        isPrimary: true,
      },
    ],
  });
  const family = await seedCustomer({
    orgId,
    actorId,
    name: VISUAL_NAMES.family,
    address: 'Lindenstraße 4, 71032 Böblingen',
    contacts: [{ name: 'Jürgen Hoffmann', phone: '07031 228190', isPrimary: true }],
    sites: [
      {
        name: 'Einfamilienhaus',
        street: 'Lindenstraße 4',
        postalCode: '71032',
        city: 'Böblingen',
        primaryContactName: 'Jürgen Hoffmann',
        accessNotes: 'Heizungsraum im Keller, Schlüssel bei den Nachbarn (Nr. 6).',
        isPrimary: true,
      },
    ],
  });
  const bakery = await seedCustomer({
    orgId,
    actorId,
    name: VISUAL_NAMES.bakery,
    clientType: 'gewerblich',
    address: 'Marktplatz 3, 71634 Ludwigsburg',
    contacts: [{ name: 'Claudia Neumann', role: 'Inhaberin', phone: '07141 902233', isPrimary: true }],
    sites: [
      {
        name: 'Backstube',
        street: 'Marktplatz 3',
        postalCode: '71634',
        city: 'Ludwigsburg',
        isPrimary: true,
      },
    ],
  });
  const practice = await seedCustomer({
    orgId,
    actorId,
    name: VISUAL_NAMES.practice,
    clientType: 'gewerblich',
    address: 'Königstraße 28, 70173 Stuttgart',
    contacts: [{ name: 'Dr. Katharina Wolf', role: 'Praxisinhaberin', isPrimary: true }],
    sites: [
      {
        name: 'Praxisräume 2. OG',
        street: 'Königstraße 28',
        postalCode: '70173',
        city: 'Stuttgart',
        isPrimary: true,
      },
    ],
  });
  const site = (customer: Awaited<ReturnType<typeof seedCustomer>>, name: string): string => {
    const id = customer.siteIds.get(name);
    if (!id) throw new Error(`Visual seed: no site ${name}.`);
    return id;
  };

  const projectId = await seedProject({
    orgId,
    actorId,
    projectNumber: VISUAL_NAMES.projectNumber,
    name: VISUAL_NAMES.project,
    clientId: housing.clientId,
    siteId: site(housing, 'Wohnanlage Uferweg'),
  });
  const jobs = [
    {
      jobNumber: VISUAL_NAMES.projectJobNumber,
      title: VISUAL_NAMES.projectJob,
      customer: housing,
      siteName: 'Wohnanlage Uferweg',
      projectId,
      assigned: true,
    },
    {
      jobNumber: 'A-2026-0202',
      title: 'Strangsanierung Trinkwasser Haus A',
      customer: housing,
      siteName: 'Wohnanlage Uferweg',
      projectId,
      assigned: false,
    },
    {
      jobNumber: VISUAL_NAMES.jobNumber,
      title: VISUAL_NAMES.job,
      customer: family,
      siteName: 'Einfamilienhaus',
      assigned: true,
    },
    {
      jobNumber: 'A-2026-0102',
      title: 'Abluft der Backstube prüfen',
      customer: bakery,
      siteName: 'Backstube',
      assigned: false,
    },
    {
      jobNumber: 'A-2026-0103',
      title: 'Waschtisch im Behandlungsraum tauschen',
      customer: practice,
      siteName: 'Praxisräume 2. OG',
      assigned: false,
    },
  ];
  for (const job of jobs) {
    const jobId = await seedJob({
      orgId,
      actorId,
      jobNumber: job.jobNumber,
      title: job.title,
      clientId: job.customer.clientId,
      siteId: site(job.customer, job.siteName),
      ...(job.projectId ? { projectId: job.projectId } : {}),
    });
    if (job.assigned) await seedJobAssignment({ orgId, actorId, jobId, userId: world.users.employee.id });
  }

  await seedRequest({
    orgId,
    actorId: world.users.buero.id,
    summary: VISUAL_NAMES.request,
    requestNumber: VISUAL_NAMES.requestNumber,
    clientId: family.clientId,
    siteId: site(family, 'Einfamilienhaus'),
    callerName: 'Jürgen Hoffmann',
    callerPhone: '07031 228190',
    details: 'Die Heizkörper im Dachgeschoss werden nicht warm. Unten ist alles in Ordnung.',
    urgency: 'hoch',
  });
  await seedRequest({
    orgId,
    actorId: world.users.buero.id,
    summary: 'Angebot für ein barrierefreies Bad',
    requestNumber: 'ANF-2026-0302',
    callerName: 'Helga Schneider',
    callerPhone: '0711 5503321',
    callerAddress: 'Birkenweg 9, 70597 Stuttgart',
  });
  await seedRequest({
    orgId,
    actorId: world.users.buero.id,
    summary: 'Wasserfleck an der Decke im Flur',
    requestNumber: 'ANF-2026-0303',
    clientId: practice.clientId,
    siteId: site(practice, 'Praxisräume 2. OG'),
    outcome: { status: 'in_klaerung' },
  });

  const therme = await seedInstalledEquipment({
    orgId,
    actorId,
    clientId: family.clientId,
    siteId: site(family, 'Einfamilienhaus'),
    name: VISUAL_NAMES.equipment,
    manufacturer: 'Vaillant',
    model: 'ecoTEC plus VC 206/5-5',
    serialNumber: 'VA-21-448812',
  });
  await seedInstalledEquipment({
    orgId,
    actorId,
    clientId: housing.clientId,
    siteId: site(housing, 'Wohnanlage Uferweg'),
    name: 'Pufferspeicher 800 l',
    category: 'storage_and_hot_water',
    manufacturer: 'Buderus',
  });
  await seedServiceCase({
    orgId,
    actorId: world.users.buero.id,
    clientId: family.clientId,
    siteId: site(family, 'Einfamilienhaus'),
    summary: VISUAL_NAMES.serviceCase,
    statement: 'Die Therme geht nach dem Zünden wieder aus und zeigt F.28 an.',
    accessInstructions: 'Bitte vorher anrufen, tagsüber ist niemand zu Hause.',
    equipmentIds: [therme.id],
  });

  const gas = await seedOrganizationCertification(orgId, actorId, 'Gas-Konzessionsschein');
  await seedOrganizationCertification(orgId, actorId, 'Elektrofachkraft für festgelegte Tätigkeiten');
  await seedPublishedWorkTemplate({
    orgId,
    actorId,
    name: VISUAL_NAMES.template,
    targetType: 'job',
    items: [
      { content: 'Brenner und Wärmetauscher reinigen', groupLabel: 'Wartung' },
      { content: 'Abgasmessung durchführen', groupLabel: 'Messung', evidenceDescription: 'Messprotokoll' },
      { content: 'Anlage dem Kunden übergeben', itemKind: 'checklist', requirementState: 'optional' },
    ],
    material: { itemId: world.inventory.itemId, locationId: world.inventory.locationId, plannedQuantity: 2 },
    capability: { capabilityId: gas, requireConfirmation: true },
  });

  for (const [index, name] of DOCUMENTS.entries()) {
    await admin
      .from('documents')
      .insert({
        organization_id: orgId,
        display_name: name,
        original_file_name: name,
        mime_type: name.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf',
        size_bytes: 184_320 + index * 52_731,
        storage_path: `${orgId}/visual/${index + 1}-${name.endsWith('.jpg') ? 'foto.jpg' : 'dokument.pdf'}`,
        uploaded_by: actorId,
      })
      .throwOnError();
  }
}

async function readVisualDetails(world: TestWorld): Promise<VisualDetails> {
  const admin = createAdminClient();
  const orgId = world.orgId;
  const { data: client } = await admin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', VISUAL_NAMES.family)
    .single()
    .throwOnError();
  const { data: request } = await admin
    .from('client_requests')
    .select('id')
    .eq('organization_id', orgId)
    .eq('request_number', VISUAL_NAMES.requestNumber)
    .single()
    .throwOnError();
  const { data: equipment } = await admin
    .from('installed_equipment')
    .select('equipment_number')
    .eq('organization_id', orgId)
    .eq('name', VISUAL_NAMES.equipment)
    .single()
    .throwOnError();
  const { data: serviceCase } = await admin
    .from('service_cases')
    .select('case_number')
    .eq('organization_id', orgId)
    .eq('summary', VISUAL_NAMES.serviceCase)
    .single()
    .throwOnError();
  return {
    familyClientId: client.id,
    requestId: request.id,
    equipmentNumber: equipment.equipment_number,
    caseNumber: serviceCase.case_number,
  };
}

/** Exact strings the run generates and their constant stand-ins: e-mail addresses and the join code. */
export async function visualReplacements(world: TestWorld): Promise<[string, string][]> {
  const { data } = await createAdminClient()
    .from('organizations')
    .select('unique_code')
    .eq('id', world.orgId)
    .single()
    .throwOnError();
  return [
    [world.users.admin.email, VISUAL_PEOPLE.admin[2]],
    [world.users.buero.email, VISUAL_PEOPLE.buero[2]],
    [world.users.employee.email, VISUAL_PEOPLE.employee[2]],
    [world.removableEmployee.email, VISUAL_PEOPLE.removable[2]],
    [data.unique_code, 'KRH26X'],
  ];
}
