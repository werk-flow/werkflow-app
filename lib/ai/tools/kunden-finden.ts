import 'server-only';

import { untrustedText } from '@/lib/ai/context';
import { defineTool } from '@/lib/ai/tools/define-tool';
import { readCustomerPage } from '@/lib/clients/list-page-server';
import { formatSiteAddress } from '@/lib/clients/types';
import { z } from '@/lib/zod';

/** The customers one call returns; each carries at most the list's three matched Einsatzorte. */
const RESULT_LIMIT = 10;

const record = (text: string | null) => (text ? untrustedText('record_text', text) : null);

/**
 * Active customers and their matched Einsatzorte through the reader of
 * `/kunden`, which leaves the role check to its caller: `defineTool` refuses
 * every role but Admin and Büro before it runs.
 */
export const kundenFinden = defineTool({
  name: 'kunden_finden',
  label: 'Kunden und Einsatzorte finden',
  description:
    'Findet aktive Kunden nach Name, Kundennummer, Telefon, Adresse, Ansprechpartner oder Einsatzort. Gibt höchstens 10 Kunden mit Kundennummer, Adresse, Telefon, passenden Einsatzorten, Link und Kunden-ID zurück.',
  input: z.strictObject({
    suche: z.string().trim().min(1).max(100).describe('Name, Nummer, Telefon, Adresse oder Einsatzort'),
  }),
  roles: ['admin', 'buero'],
  control: 'read',
  audit: 'ledger',
  idempotency: 'not_needed',
  dataClasses: ['customer'],
  writesMemory: false,
  async execute(input, ctx) {
    const page = await readCustomerPage(
      { organizationId: ctx.orgId, page: 1, search: input.suche, view: 'aktiv' },
      RESULT_LIMIT,
    );
    const kunden = page.clients.map((client) => ({
      kundeId: client.id,
      name: record(client.name),
      kundennummer: record(client.customerNumber),
      adresse: record(client.address),
      telefon: record(client.phone),
      einsatzorte: client.matchedSites.map((site) => ({
        name: record(site.name),
        adresse: record(formatSiteAddress(site) || null),
      })),
      link: `/kunden/${client.id}`,
    }));
    return { status: 'ok', value: { kunden, gesamt: page.total } };
  },
});
