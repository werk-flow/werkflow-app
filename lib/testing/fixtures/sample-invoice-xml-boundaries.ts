// The real Musterrechnung route handler over the action world: only Admin and
// Büro of the active organization get the e-invoice XML; a signed-out caller
// and an employee get a refusal and no XML. The seller is the caller's own
// organization's profile, never one the cookie names without a membership,
// and XML the EN 16931 rules refuse is never sent: the office reads the
// profile fields to fix instead.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { companyProfileRow } from './company-profile-rows';

const world = installActionWorld({
  company_document_profiles: [
    companyProfileRow(ORGANIZATION_A, 'Haustechnik Sonnenberg GmbH', 'DE00 1111 1111 1111 1111 11', {
      vatId: 'DE123456789',
      registerNumber: 'HRB 12345',
    }),
    // Without USt-IdNr., Steuernummer and Handelsregisternummer: the rules refuse its invoice.
    companyProfileRow(ORGANIZATION_B, 'Fremde Haustechnik GmbH', 'DE00 2222 2222 2222 2222 22'),
  ],
});
const { GET } = await import('@/app/api/musterrechnung/route');

async function expectRefusal(status: number): Promise<void> {
  const response = await GET();
  assert.equal(response.status, status);
  assert.ok(!(await response.text()).includes('CrossIndustryInvoice'), 'a refused caller gets no XML');
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
  const xml = await response.text();
  assert.equal(response.status, 200, `${role}: ${xml}`);
  assert.equal(response.headers.get('Content-Type'), 'application/xml; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(response.headers.get('Content-Disposition') ?? '', /Muster-E-Rechnung\.xml/);
  assert.ok(xml.includes('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>'), 'the EN 16931 profile');
  // The seller is the caller's own organization's profile, never another's.
  assert.ok(xml.includes('Haustechnik Sonnenberg GmbH'), role);
  assert.ok(xml.includes('<ram:IBANID>DE00111111111111111111</ram:IBANID>'), role);
  assert.ok(!xml.includes('Fremde Haustechnik') && !xml.includes('2222'), role);
}

// B's profile lacks every tax identifier: B's Admin gets the fields to fix, never the XML.
signInAs(world, 'admin', ORGANIZATION_B);
const refused = await GET();
const text = await refused.text();
assert.equal(refused.status, 422);
assert.equal(refused.headers.get('Content-Type'), 'text/plain; charset=utf-8');
assert.ok(!text.includes('CrossIndustryInvoice'));
assert.ok(text.includes('USt-IdNr. oder Steuernummer (Regel BR-S-02)'), text);
