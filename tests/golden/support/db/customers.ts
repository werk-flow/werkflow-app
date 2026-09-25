import { createAdminClient, withRoleClient } from './shared';

// P1-10: authoritative relationship records and their append-only histories.
// The browser proves visible behavior; these observations prove actor/history
// facts and the manager-only RLS boundary with real credentials.
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
    .from("clients")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", customerName)
    .single();
  if (clientError || !client) {
    throw new Error(
      `Customer ${customerName} not found: ${clientError?.message}`,
    );
  }
  const [followUps, followUpEvents, preferenceEvents, settings, preferences] =
    await Promise.all([
      admin
        .from("client_follow_ups")
        .select(
          "id,title,status,owner_user_id,completed_by,cancelled_by,source_type,source_id",
        )
        .eq("organization_id", orgId)
        .eq("client_id", client.id)
        .order("created_at", { ascending: true }),
      admin
        .from("client_follow_up_events")
        .select("event_type")
        .eq("organization_id", orgId)
        .eq("client_id", client.id)
        .order("created_at", { ascending: true }),
      admin
        .from("client_communication_preference_events")
        .select("event_type")
        .eq("organization_id", orgId)
        .eq("client_id", client.id)
        .order("created_at", { ascending: true }),
      admin
        .from("client_communication_settings")
        .select(
          "preferred_contact_id,preferred_channel,do_not_contact_instruction,contact_time_note,language_note,accessibility_note",
        )
        .eq("organization_id", orgId)
        .eq("client_id", client.id)
        .maybeSingle(),
      admin
        .from("client_communication_preferences")
        .select("contact_id,channel,purpose,state,created_at")
        .eq("organization_id", orgId)
        .eq("client_id", client.id)
        .order("created_at", { ascending: true }),
    ]);
  const firstError =
    followUps.error ??
    followUpEvents.error ??
    preferenceEvents.error ??
    settings.error ??
    preferences.error;
  if (firstError) {
    throw new Error(
      `Customer relationship observation failed: ${firstError.message}`,
    );
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
    followUpEventTypes: (followUpEvents.data ?? []).map(
      (row) => row.event_type as string,
    ),
    preferenceEventTypes: (preferenceEvents.data ?? []).map(
      (row) => row.event_type as string,
    ),
    communicationSettings: settings.data
      ? {
          preferredContactId:
            (settings.data.preferred_contact_id as string | null) ?? null,
          preferredChannel:
            (settings.data.preferred_channel as string | null) ?? null,
          doNotContactInstruction:
            (settings.data.do_not_contact_instruction as string | null) ?? null,
          contactTimeNote:
            (settings.data.contact_time_note as string | null) ?? null,
          languageNote: (settings.data.language_note as string | null) ?? null,
          accessibilityNote:
            (settings.data.accessibility_note as string | null) ?? null,
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

export async function getVisibleCustomerRelationshipStateAs(
  user: { email: string; password: string },
  orgId: string,
): Promise<Record<string, number>> {
  return withRoleClient(user, async (client) => {

    const tableNames = [
      "clients",
      "client_contacts",
      "client_sites",
      "client_follow_ups",
      "client_follow_up_events",
      "client_communication_settings",
      "client_communication_preferences",
      "client_communication_preference_events",
    ] as const;
    const results = await Promise.all(
      tableNames.map(async (tableName) => {
        const { count, error } = await client
          .from(tableName)
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId);
        if (error) {
          throw new Error(
            `Customer relationship RLS query ${tableName} failed for ${user.email}: ${error.message}`,
          );
        }
        return [tableName, count ?? 0] as const;
      }),
    );
    return Object.fromEntries(results);
  });
}
