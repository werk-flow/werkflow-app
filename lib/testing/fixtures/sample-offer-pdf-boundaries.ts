// The real Musterangebot route handler over the action world: only Admin and
// Büro of the active organization get the PDF; a signed-out caller and an
// employee get a refusal and no bytes, and the sender and its company profile
// are the caller's own organization's, never one the cookie names without a
// membership.
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { companyProfileRow as profileRow } from './company-profile-rows';

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
