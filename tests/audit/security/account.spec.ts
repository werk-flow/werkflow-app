import { createClient } from '@supabase/supabase-js';
import { expect, test } from '../support/fixtures';
import { requireEnv } from '../../golden/support/env';
import { testSupabaseClientOptions } from '../../golden/support/client-options';
import { visibleText } from '../../golden/support/steps/shared';
import { loadWorld, registerTestUserEmail, saveWorld } from '../../golden/support/world';
import { attachWorldToRun, archiveActiveState } from '../../golden/support/run-state';
import {
  deleteOwnedMailpitMessages, findOwnedMailpitMessages, localMailpitUrl, readOwnedMailpitOtp,
} from '../../../lib/testing/local-mailpit';

test('both mailbox confirmations change the account once @AUDIT-SECURITY-ACCOUNT', async ({ adminPage, world }) => {
  const backendUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const localMailbox = localMailpitUrl(backendUrl);
  if (!localMailbox) throw new Error('The account-security browser group requires the local Mailpit stack');
  const mailbox: URL = localMailbox;
  const originalEmail = world.users.admin.email;
  const previousAddresses = (loadWorld().additionalUserEmails ?? []).filter((email) => email.startsWith('account-email-'));
  const newEmail = registerTestUserEmail(`account-email-${previousAddresses.length + 1}`, world.runId);
  const ownership = loadWorld();
  ownership.additionalUserEmails = [...(ownership.additionalUserEmails ?? []), originalEmail];
  saveWorld(ownership);
  archiveActiveState();
  const recipients = [originalEmail, newEmail];
  const observedMessageIds = new Set<string>();
  const admin = createClient(backendUrl, requireEnv('SUPABASE_SECRET_KEY'), testSupabaseClientOptions);

  async function receivedCode(recipient: string): Promise<string> {
    let code: string | null = null;
    await expect.poll(async () => {
      for (const message of await findOwnedMailpitMessages(mailbox, [recipient])) {
        observedMessageIds.add(message.ID);
        code = await readOwnedMailpitOtp(mailbox, message.ID, recipient);
        if (code) return true;
      }
      return false;
    }, { message: 'The exact owned recipient receives its OTP mail' }).toBe(true);
    if (!code) throw new Error('Owned OTP mail did not contain its dedicated code block');
    return code;
  }

  try {
    await adminPage.goto('/einstellungen/konto-sicherheit');
    const start = adminPage.getByRole('button', { name: 'E-Mail-Adresse ändern', exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    const currentCodeInput = adminPage.getByRole('textbox', { name: 'Bestätigungscode', exact: true });
    await expect(currentCodeInput).toBeEditable();
    await currentCodeInput.fill(await receivedCode(originalEmail));
    await adminPage.getByRole('button', { name: 'Code bestätigen', exact: true }).click();

    const newAddressInput = adminPage.getByRole('textbox', { name: 'Neue E-Mail-Adresse', exact: true });
    await expect(newAddressInput).toBeEditable();
    await newAddressInput.fill(newEmail);
    await adminPage.getByRole('button', { name: 'Weiter zur Bestätigung', exact: true }).click();
    const newCodeInput = adminPage.getByRole('textbox', { name: 'Bestätigungscode', exact: true });
    await expect(newCodeInput).toBeEditable();
    await newCodeInput.fill(await receivedCode(newEmail));
    await adminPage.getByRole('button', { name: 'Neue E-Mail-Adresse bestätigen', exact: true }).click();
    await expect(visibleText(adminPage, 'E-Mail-Adresse erfolgreich aktualisiert', true)).toBeVisible();

    // Preserve replay identity before any independent verification can fail.
    const updatedWorld = loadWorld();
    updatedWorld.users.admin.email = newEmail;
    saveWorld(updatedWorld);
    attachWorldToRun(updatedWorld);
    archiveActiveState();

    const { data, error } = await admin.auth.admin.getUserById(world.users.admin.id);
    if (error) throw new Error('Could not observe the owned account after email confirmation');
    expect(data.user?.email).toBe(newEmail);
    expect(data.user?.email_confirmed_at).toBeTruthy();
    const challenge = await admin.from('email_change_challenges').select('user_id').eq('user_id', world.users.admin.id);
    expect(challenge.error).toBeNull();
    expect(challenge.data).toHaveLength(0);

    await adminPage.reload();
    await expect(start).toBeEnabled();
    await expect(visibleText(adminPage.getByRole('main'), newEmail, true)).toBeVisible();
  } finally {
    await deleteOwnedMailpitMessages(mailbox, recipients, [...observedMessageIds]);
  }
});
