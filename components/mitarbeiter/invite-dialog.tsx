'use client';

import { INVITE_ROLE_OPTIONS } from '@/lib/roles';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBanner } from '@/components/ui/banner';
import { createOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { sendOrgInvite, type InviteRole } from '@/lib/invites/actions';
import type { Invite } from './invitations-table';
import { SEND_INVITE_MESSAGES } from './invite-messages';

// Email validation regex (same as signup form)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The invitations list (`MitarbeiterTabs`) subscribes here: the page header
 * mounts this dialog outside the list's Suspense boundary, so the optimistic
 * row travels over a channel instead of a callback.
 */
export const inviteCreations = createOptimisticChannel<Invite>();

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<InviteRole>('employee');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const router = useRouter();
  const { showBanner } = useBanner();

  const resetForm = () => {
    setEmail('');
    setSelectedRole('employee');
    setEmailError(null);
    setHasAttemptedSubmit(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setEmailError(null);

    // Validate email format
    if (!EMAIL_REGEX.test(email)) {
      setEmailError('Bitte gib eine gültige E-Mail-Adresse ein.');
      document.getElementById('email')?.focus();
      return;
    }

    // The dialog closes at once; the invitations list shows the draft as a
    // pending row until the server confirms (feedback canon). The expiry is
    // server-assigned, so the row keeps a placeholder for it until then.
    const invitedEmail = email.trim().toLowerCase();
    const role = selectedRole;
    const tempId = crypto.randomUUID();
    const now = new Date().toISOString();
    const draft: Invite = {
      id: tempId,
      email: invitedEmail,
      status: 'pending',
      invited_role: role,
      created_at: now,
      expires_at: now,
      accepted_at: null,
    };
    inviteCreations.publish({ kind: 'insert', tempId, draft });
    resetForm();
    setOpen(false);

    const result = await sendOrgInvite(invitedEmail, role).catch(() => null);
    if (!result || !result.success) {
      inviteCreations.publish({ kind: 'rollback', tempId });
      const reason = describeFailure(
        result?.error ?? 'unexpected_error',
        SEND_INVITE_MESSAGES,
        SHARED_FAILURE_MESSAGES.unexpected_error,
      );
      showBanner({
        variant: 'error',
        message: `Einladung an ${invitedEmail} konnte nicht gesendet werden: ${reason}`,
      });
      return;
    }
    inviteCreations.publish({
      kind: 'commit',
      tempId,
      confirmed: { ...draft, id: result.inviteId ?? tempId },
    });
    showBanner({
      variant: 'success',
      message: `Einladung an ${invitedEmail} wurde gesendet.`,
    });
    router.refresh();
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) resetForm();
  };

  // Determine if we should show the email error (only after submit attempt)
  const showEmailError = hasAttemptedSubmit && emailError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="default" className="gap-2">
          <UserPlus className="size-4" />
          <span className="sr-only sm:not-sr-only">Mitarbeiter hinzufügen</span>
          <span className="sm:hidden" aria-hidden="true">
            Hinzufügen
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent size="md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Mitarbeiter einladen</DialogTitle>
          <DialogDescription>
            Gib die E-Mail-Adresse des Mitarbeiters ein, den du einladen möchtest. Er erhält eine E-Mail mit
            einem Einladungslink.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <Field label="E-Mail-Adresse" htmlFor="email" required error={showEmailError ? emailError : null}>
              <Input
                type="text"
                inputMode="email"
                autoComplete="email"
                placeholder="mitarbeiter@firma.de"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // Clear email error when user types
                  if (emailError) setEmailError(null);
                }}
              />
            </Field>
            <Field
              label="Rolle"
              htmlFor="role"
              description="Die Rolle, die der Mitarbeiter nach Annahme der Einladung erhält."
            >
              <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as InviteRole)}>
                <SelectTrigger>
                  <SelectValue placeholder="Rolle auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit">Einladung senden</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
