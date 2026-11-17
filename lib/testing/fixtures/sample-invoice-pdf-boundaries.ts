// The real Musterrechnung route handler over the action world: only Admin and
// Büro of the active organization get the ZUGFeRD PDF; a signed-out caller
// and an employee get a refusal and no bytes. The seller and the letterhead
// are the caller's own organization's profile, never one the cookie names
// without a membership, and XML the EN 16931 rules refuse is never sent: the
// office reads the profile fields to fix instead.
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
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
const route = await import('@/app/api/musterrechnung/route');
const GET = () => route.GET(new Request('http://localhost/api/musterrechnung'));

async function expectRefusal(status: number): Promise<void> {
  const response = await GET();
  assert.equal(response.status, status);
  assert.notEqual(response.headers.get('Content-Type'), 'application/pdf');
  const body = await response.text();
  assert.ok(
    !body.startsWith('%PDF') && !body.includes('CrossIndustryInvoice'),
    'a refused caller gets no invoice',
  );
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
  assert.equal(response.status, 200, `${role}: ${response.status === 200 ? '' : await response.text()}`);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.match(
    response.headers.get('Content-Disposition') ?? '',
    /^inline; filename="Muster-E-Rechnung\.pdf"$/,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  const xml = await readEmbeddedInvoiceXml(bytes);
  assert.ok(xml.includes('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>'), 'the EN 16931 profile');
  // Seller and letterhead are the caller's own organization's profile, never another's.
  assert.ok(xml.includes('Haustechnik Sonnenberg GmbH'), role);
  assert.ok(xml.includes('<ram:IBANID>DE00111111111111111111</ram:IBANID>'), role);
  assert.ok(!xml.includes('Fremde Haustechnik') && !xml.includes('2222'), role);
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  assert.ok(text.includes('Rechnung MUSTER-1') && text.includes('Haustechnik Sonnenberg GmbH'), role);
  assert.ok(!text.includes('Fremde Haustechnik') && !text.includes('2222'), role);
}

// B's profile lacks every tax identifier: B's Admin gets the fields to fix, never the PDF.
signInAs(world, 'admin', ORGANIZATION_B);
const refused = await GET();
const text = await refused.text();
assert.equal(refused.status, 422);
assert.equal(refused.headers.get('Content-Type'), 'text/plain; charset=utf-8');
assert.ok(!text.startsWith('%PDF') && !text.includes('CrossIndustryInvoice'));
assert.ok(text.includes('USt-IdNr. oder Steuernummer (Regel BR-S-02)'), text);
