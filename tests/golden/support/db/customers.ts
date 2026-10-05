import { randomUUID } from 'node:crypto';
import { createAdminClient } from './shared';

export interface SeedCustomerContact {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

export interface SeedCustomerSite {
  name: string;
  street?: string;
  postalCode?: string;
  city?: string;
  accessNotes?: string;
  notes?: string;
  primaryContactName?: string;
  isPrimary?: boolean;
}

export interface SeededCustomer {
  clientId: string;
  /** Contact ids by contact name. */
  contactIds: ReadonlyMap<string, string>;
  /** Site ids by site name. */
  siteIds: ReadonlyMap<string, string>;
}

/**
 * Inserts a customer with its contacts and work sites as the given actor. A
 * test that claims a later customer flow prepares its customer here instead of
 * walking the creation dialogs another test already proves.
 */
export async function seedCustomer(input: {
  orgId: string;
  actorId: string;
  name: string;
  clientType?: 'privat' | 'gewerblich';
  address?: string;
  contacts?: readonly SeedCustomerContact[];
  sites?: readonly SeedCustomerSite[];
}): Promise<SeededCustomer> {
  const admin = createAdminClient();
  const clientId = randomUUID();
  await admin
    .from('clients')
    .insert({
      id: clientId,
      organization_id: input.orgId,
      name: input.name,
      client_type: input.clientType ?? 'privat',
      address: input.address ?? null,
    })
    .throwOnError();
  const contactIds = new Map<string, string>();
  for (const contact of input.contacts ?? []) {
    const contactId = randomUUID();
    await admin
      .from('client_contacts')
      .insert({
        id: contactId,
        organization_id: input.orgId,
        client_id: clientId,
        created_by: input.actorId,
        name: contact.name,
        role: contact.role ?? null,
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        is_primary: contact.isPrimary ?? false,
      })
      .throwOnError();
    contactIds.set(contact.name, contactId);
  }
  const siteIds = new Map<string, string>();
  for (const site of input.sites ?? []) {
    const siteId = randomUUID();
    const primaryContactId = site.primaryContactName ? contactIds.get(site.primaryContactName) : undefined;
    if (site.primaryContactName && !primaryContactId) {
      throw new Error(`seedCustomer: site ${site.name} names unknown contact ${site.primaryContactName}`);
    }
    await admin
      .from('client_sites')
      .insert({
        id: siteId,
        organization_id: input.orgId,
        client_id: clientId,
        created_by: input.actorId,
        name: site.name,
        street: site.street ?? null,
        postal_code: site.postalCode ?? null,
        city: site.city ?? null,
        access_notes: site.accessNotes ?? null,
        notes: site.notes ?? null,
        primary_contact_id: primaryContactId ?? null,
        is_primary: site.isPrimary ?? false,
      })
      .throwOnError();
    siteIds.set(site.name, siteId);
  }
  return { clientId, contactIds, siteIds };
}

// P1-10: authoritative relationship records and their append-only histories.
// The browser proves visible behavior; these observations prove actor/history
// facts. supabase/tests/customer_relationships.sql owns the manager-only RLS boundary.
export async function getCustomerRelationshipState(
  orgId: string,
  customerName: string,
): Promise<{
  clientId: string;
  followUps: Array<{
    id: string;
    title: string;
    status: string;
    ownerUserId: string;
    completedBy: string | null;
    cancelledBy: string | null;
    sourceType: string | null;
    sourceId: string | null;
  }>;
  followUpEventTypes: string[];
  preferenceEventTypes: string[];
  communicationSettings: {
    preferredContactId: string | null;
    preferredChannel: string | null;
    doNotContactInstruction: string | null;
    contactTimeNote: string | null;
    languageNote: string | null;
    accessibilityNote: string | null;
  } | null;
  communicationPreferences: Array<{
    contactId: string | null;
    channel: string;
    purpose: string;
    state: string;
  }>;
}> {
  const admin = createAdminClient();
  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', customerName)
    .single();
  if (clientError || !client) {
    throw new Error(`Customer ${customerName} not found: ${clientError?.message}`);
  }
  const [followUps, followUpEvents, preferenceEvents, settings, preferences] = await Promise.all([
    admin
      .from('client_follow_ups')
      .select('id,title,status,owner_user_id,completed_by,cancelled_by,source_type,source_id')
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: true }),
    admin
      .from('client_follow_up_events')
      .select('event_type')
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: true }),
    admin
      .from('client_communication_preference_events')
      .select('event_type')
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: true }),
    admin
      .from('client_communication_settings')
      .select(
        'preferred_contact_id,preferred_channel,do_not_contact_instruction,contact_time_note,language_note,accessibility_note',
      )
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .maybeSingle(),
    admin
      .from('client_communication_preferences')
      .select('contact_id,channel,purpose,state,created_at')
      .eq('organization_id', orgId)
      .eq('client_id', client.id)
      .order('created_at', { ascending: true }),
  ]);
  const firstError =
    followUps.error ?? followUpEvents.error ?? preferenceEvents.error ?? settings.error ?? preferences.error;
  if (firstError) {
    throw new Error(`Customer relationship observation failed: ${firstError.message}`);
  }
  return {
    clientId: client.id as string,
    followUps: (followUps.data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      status: row.status as string,
      ownerUserId: row.owner_user_id as string,
      completedBy: (row.completed_by as string | null) ?? null,
      cancelledBy: (row.cancelled_by as string | null) ?? null,
      sourceType: (row.source_type as string | null) ?? null,
      sourceId: (row.source_id as string | null) ?? null,
    })),
    followUpEventTypes: (followUpEvents.data ?? []).map((row) => row.event_type as string),
    preferenceEventTypes: (preferenceEvents.data ?? []).map((row) => row.event_type as string),
    communicationSettings: settings.data
      ? {
          preferredContactId: (settings.data.preferred_contact_id as string | null) ?? null,
          preferredChannel: (settings.data.preferred_channel as string | null) ?? null,
          doNotContactInstruction: (settings.data.do_not_contact_instruction as string | null) ?? null,
          contactTimeNote: (settings.data.contact_time_note as string | null) ?? null,
          languageNote: (settings.data.language_note as string | null) ?? null,
          accessibilityNote: (settings.data.accessibility_note as string | null) ?? null,
        }
      : null,
    communicationPreferences: (preferences.data ?? []).map((row) => ({
      contactId: (row.contact_id as string | null) ?? null,
      channel: row.channel as string,
      purpose: row.purpose as string,
      state: row.state as string,
    })),
  };
}
