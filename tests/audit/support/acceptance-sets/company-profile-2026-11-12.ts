import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { putStorageObject } from '../../../../lib/storage/r2';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from '../../../golden/support/db/shared';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';
import type { SurfaceDestination } from '../surface-routes';

const ROUTE = '/einstellungen/dokumente';

/** A made-up company's details, every field the form has. */
const FILLED_PROFILE = {
  company_name: 'Haustechnik Sonnenberg GmbH',
  street: 'Sonnenweg 1',
  postal_code: '01234',
  city: 'Sonnenstadt',
  phone: '0123 456789',
  email: 'info@sonnenberg.example',
  website: 'sonnenberg.example',
  register_court: 'Amtsgericht Sonnenstadt',
  register_number: 'HRB 00000',
  managing_directors: 'Geschäftsführerin: Erika Musterfrau',
  tax_number: '000/000/00000',
  vat_id: 'DE000000000',
  bank_name: 'Musterbank',
  iban: 'DE00 0000 0000 0000 0000 00',
  bic: 'MUSTDEXXXXX',
  offer_opening_text: 'Guten Tag,\nvielen Dank für die Anfrage. Gerne bieten wir an:',
  offer_closing_text: 'Wir freuen uns auf den Auftrag.\n\nViele Grüße\nHaustechnik Sonnenberg GmbH',
  offer_validity_days: 30,
  standard_tax_rate_basis_points: 1900,
  stationery_first_top_mm: 45,
  stationery_first_right_mm: 20,
  stationery_first_bottom_mm: 25,
  stationery_first_left_mm: 25,
  stationery_following_top_mm: 30,
  stationery_following_right_mm: 20,
  stationery_following_bottom_mm: 25,
  stationery_following_left_mm: 25,
};

/** The details of an organization that saved none: every text empty, every number its default. */
const EMPTY_PROFILE = Object.fromEntries(
  Object.entries(FILLED_PROFILE).map(([field, value]) => [field, typeof value === 'string' ? '' : value]),
);

type ProfileState = { details: Record<string, string | number>; stationery: boolean };

/**
 * Brings the organization's profile to the state a capture shows, through the
 * functions the actions call: its details, and first-page stationery or none.
 * Each capture sets its own state when it opens, so the captures share one
 * world without depending on their order.
 */
async function showProfile(world: TestWorld, wanted: ProfileState): Promise<SurfaceDestination> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('company_document_profiles')
    .select('*')
    .eq('organization_id', world.orgId)
    .maybeSingle();
  if (error) throw new Error(`company profile read failed: ${error.message}`);
  const saved: Record<string, unknown> = row ?? EMPTY_PROFILE;
  if (Object.entries(wanted.details).some(([field, value]) => saved[field] !== value)) {
    const { error: saveError } = await admin.rpc('save_company_document_profile', {
      p_actor_id: world.users.buero.id,
      p_organization_id: world.orgId,
      p_expected_version: row?.version ?? 0,
      p_values: wanted.details,
      p_attempt_key: randomUUID(),
    });
    if (saveError) throw new Error(`company profile seed failed: ${saveError.message}`);
  }
  const first = row?.stationery_first_storage_path ?? null;
  if (wanted.stationery && first === null) await storeStationery(world);
  if (!wanted.stationery && first !== null) {
    const { error: removeError } = await admin.rpc(
      'replace_company_document_file',
      rpcArgs('replace_company_document_file', {
        p_actor_id: world.users.buero.id,
        p_organization_id: world.orgId,
        p_kind: 'stationery_first',
        p_expected_storage_path: first,
        p_expected_following_storage_path: row?.stationery_following_storage_path ?? null,
        p_storage_path: null,
        p_mime_type: null,
        p_size_bytes: null,
        p_attempt_key: randomUUID(),
      }),
    );
    if (removeError) throw new Error(`stationery removal failed: ${removeError.message}`);
  }
  return { route: ROUTE };
}

/** A first-page stationery: the company's letterhead at the top and its footer line at the bottom. */
async function stationeryPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const page = pdf.addPage([595.28, 841.89]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const blue = rgb(0.1, 0.3, 0.5);
  page.drawText('Haustechnik Sonnenberg GmbH', { x: 71, y: 790, size: 16, font: bold, color: blue });
  page.drawText('Heizung, Sanitär, Klima', { x: 71, y: 772, size: 9, font: regular });
  page.drawLine({ start: { x: 71, y: 60 }, end: { x: 524, y: 60 }, color: blue });
  page.drawText('Sonnenweg 1, 01234 Sonnenstadt - Amtsgericht Sonnenstadt HRB 00000', {
    x: 71,
    y: 46,
    size: 7,
    font: regular,
  });
  return pdf.save();
}

/** First-page stationery, stored as an upload's finalize stores it. */
async function storeStationery(world: TestWorld): Promise<void> {
  const path = `${world.orgId}/briefpapier/${randomUUID()}/stationery_first`;
  const body = await stationeryPdf();
  await putStorageObject({ organizationId: world.orgId, path, body, contentType: 'application/pdf' });
  const { error } = await createAdminClient().rpc(
    'replace_company_document_file',
    rpcArgs('replace_company_document_file', {
      p_actor_id: world.users.buero.id,
      p_organization_id: world.orgId,
      p_kind: 'stationery_first',
      // Stored only while the profile shows no first-page stationery.
      p_expected_storage_path: null,
      p_expected_following_storage_path: null,
      p_storage_path: path,
      p_mime_type: 'application/pdf',
      p_size_bytes: body.byteLength,
      p_attempt_key: randomUUID(),
    }),
  );
  if (error) throw new Error(`stationery seed failed: ${error.message}`);
}

const empty = (world: TestWorld) => showProfile(world, { details: EMPTY_PROFILE, stationery: false });
const filled = (world: TestWorld) => showProfile(world, { details: FILLED_PROFILE, stationery: false });
const withStationery = (world: TestWorld) =>
  showProfile(world, { details: FILLED_PROFILE, stationery: true });

/**
 * werk-flow/werkflow-planning#378 of 2026-11-12: „Dokumente & Briefpapier“
 * with the company profile, empty, filled and with stationery, loading and
 * with a failed read, for Admin and Büro; the employee's settings keep the
 * section out. Every capture sets the profile it shows, so none depends on
 * the captures before it.
 */
function companyProfileCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'company-profile-2026-11-12',
    captures: [
      { id: 'admin-dokumente-leer', role: 'admin', route: ROUTE, view: page, destination: empty, ...both },
      {
        id: stateCaptureId('admin-dokumente-leer', 'loading'),
        role: 'admin',
        route: ROUTE,
        view: page,
        destination: empty,
        state: 'loading',
        ...both,
      },
      {
        id: stateCaptureId('admin-dokumente-leer', 'error'),
        role: 'admin',
        route: ROUTE,
        view: page,
        destination: empty,
        state: 'error',
        ...both,
      },
      {
        id: 'buero-dokumente-ausgefuellt',
        role: 'buero',
        route: ROUTE,
        view: page,
        destination: filled,
        ...both,
      },
      {
        id: 'buero-dokumente-briefpapier',
        role: 'buero',
        route: ROUTE,
        view: page,
        destination: withStationery,
        reveal: 'Ränder bei Briefpapier',
        ...both,
      },
      {
        id: 'employee-einstellungen-profil',
        role: 'employee',
        route: '/einstellungen/profil',
        view: page,
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(companyProfileCaptures());
