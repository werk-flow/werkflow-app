'use client';

import { INVITE_ROLE_OPTIONS } from '@/lib/roles';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MailPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useServerAction } from '@/hooks/use-server-action';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describeFailure } from '@/lib/action-messages';
import { sendPersonnelInvite } from '@/lib/personnel/actions';
import type { InviteRole } from '@/lib/invites/actions';
import { SEND_INVITE_MESSAGES } from './invite-messages';

/** `sendPersonnelInvite` returns the organization invite's codes and its own. */
const PERSONNEL_INVITE_MESSAGES: Readonly<Record<string, string>> = {
  ...SEND_INVITE_MESSAGES,
  already_has_login: 'Diese Personalakte ist bereits mit einem Zugang verknüpft.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
};
const PERSONNEL_INVITE_FALLBACK = 'Die Einladung konnte nicht gesendet werden.';
const INVALID_EMAIL_MESSAGE = 'Bitte gib eine gültige E-Mail-Adresse ein.';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PersonnelInviteDialogProps {
  recordId: string;
  personName: string;
}

/**
 * Connects a personnel record without login to a future account: sends the
 * regular organization invite and remembers it on the record, so redeeming the
 * invite links the login instead of creating a duplicate record.
 */
export function PersonnelInviteDialog({ recordId, personName }: PersonnelInviteDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('employee');
  const { run: runSend, isPending: isSending } = useServerAction(sendPersonnelInvite);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setEmail('');
      setRole('employee');
      setError(null);
      setEmailError(null);
      setSuccess(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending || success) return;
    setError(null);

    if (!EMAIL_REGEX.test(email)) {
      setEmailError(INVALID_EMAIL_MESSAGE);
      document.getElementById('personnel-invite-email')?.focus();
      return;
    }

    let result: Awaited<ReturnType<typeof sendPersonnelInvite>>;
    try {
      result = await runSend(recordId, email, role);
    } catch {
      setError(PERSONNEL_INVITE_FALLBACK);
      return;
    }

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        setOpen(false);
        setSuccess(false);
        setEmail('');
        setRole('employee');
        router.refresh();
      }, 1500);
    } else {
      setError(describeFailure(result.error ?? '', PERSONNEL_INVITE_MESSAGES, PERSONNEL_INVITE_FALLBACK));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} pending={isSending}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <MailPlus className="size-4" />
          Zugang einladen
        </Button>
      </DialogTrigger>
      <DialogContent size="md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Zugang für {personName} einladen</DialogTitle>
          <DialogDescription>
            Nach Annahme der Einladung wird der neue Zugang automatisch mit dieser Personalakte verknüpft.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <Field label="E-Mail-Adresse" htmlFor="personnel-invite-email" required error={emailError}>
              <Input
                type="text"
                inputMode="email"
                autoComplete="email"
                placeholder="mitarbeiter@firma.de"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailError(null);
                  if (error) setError(null);
                }}
                disabled={isSending || success}
              />
            </Field>
            <Field label="Rolle" htmlFor="personnel-invite-role">
              <Select
                value={role}
                onValueChange={(value) => setRole(value as InviteRole)}
                disabled={isSending || success}
              >
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
            <ErrorText>{error}</ErrorText>
            {success && <p className="text-sm text-success-text">Einladung erfolgreich gesendet!</p>}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              // eslint-disable-next-line ui/submit-disabled-only-while-pending -- the invitation is sent; the dialog confirms it and closes
              disabled={isSending || success}
            >
              {isSending && <Loader2 className="size-4 animate-spin" />}
              {isSending ? 'Wird gesendet…' : 'Einladung senden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
