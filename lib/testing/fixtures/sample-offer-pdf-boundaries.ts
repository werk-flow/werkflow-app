// The real Musterangebot route handler over the action world: only Admin and
// Büro of the active organization get the PDF; a signed-out caller and an
// employee get a refusal and no bytes, and the sender and its company profile
// are the caller's own organization's, never one the cookie names without a
// membership.
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';

/** A saved company profile row without files, as the table holds it. */
const profileRow = (organizationId: string, companyName: string, iban: string) => ({
  organization_id: organizationId,
  company_name: companyName,
  street: 'Sonnenweg 1',
  postal_code: '01234',
  city: 'Sonnenstadt',
  phone: '',
  email: '',
  website: '',
  register_court: '',
  register_number: '',
  managing_directors: '',
  tax_number: '',
  vat_id: '',
  bank_name: 'Musterbank',
  iban,
  bic: '',
  offer_opening_text: '',
  offer_closing_text: '',
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
  logo_storage_path: null,
  logo_mime_type: null,
  stationery_first_storage_path: null,
  stationery_first_mime_type: null,
  stationery_following_storage_path: null,
  stationery_following_mime_type: null,
  version: 1,
  updated_at: '2026-11-12T08:00:00.000Z',
  updated_by: null,
});

const world = installActionWorld({
  company_document_profiles: [
    profileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', 'DE00 1111 1111 1111 1111 11'),
    profileRow(ORGANIZATION_B, 'Fremde Haustechnik GmbH', 'DE00 2222 2222 2222 2222 22'),
  ],
});
const { GET } = await import('@/app/api/musterangebot/route');

async function expectRefusal(status: number): Promise<void> {
  const response = await GET();
  assert.equal(response.status, status);
  assert.notEqual(response.headers.get('Content-Type'), 'application/pdf');
  assert.ok(!(await response.text()).startsWith('%PDF'), 'a refused caller gets no PDF bytes');
}

world.callerId = null;
await expectRefusal(401);

signInAs(world, 'employee');
await expectRefusal(403);

// An employee of A who names B in the cookie stays an employee of A.
signInAs(world, 'employee');
world.activeOrganizationCookie = ORGANIZATION_B;
await expectRefusal(403);

for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role, ORGANIZATION_A);
  const response = await GET();
  assert.equal(response.status, 200, role);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  // The letterhead is the caller's own organization's profile, never another's.
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  assert.ok(text.includes('Haustechnik Sonnenberg GmbH'), role);
  assert.ok(text.includes('IBAN DE00 1111 1111 1111 1111 11'), role);
  assert.ok(!text.includes('Fremde Haustechnik') && !text.includes('2222'), role);
}
