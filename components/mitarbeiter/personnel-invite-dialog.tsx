'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MailPlus } from 'lucide-react';

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
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sendPersonnelInvite } from '@/lib/personnel/actions';
import type { InviteRole } from '@/lib/invites/actions';

const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: 'buero', label: 'Büro' },
  { value: 'employee', label: 'Handwerker/in' },
];

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  already_member: 'Diese Person ist bereits Mitglied dieser Organisation.',
  already_has_login: 'Diese Personalakte ist bereits mit einem Zugang verknüpft.',
  invite_already_pending:
    'Es gibt bereits eine ausstehende Einladung für diese E-Mail-Adresse.',
  email_send_failed: 'Fehler beim Senden der Einladungs-E-Mail.',
  invite_connect_failed:
    'Die Einladung wurde gesendet, konnte aber nicht mit der Personalakte verknüpft werden.',
  not_authorized: 'Du bist nicht berechtigt, Einladungen zu senden.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
};

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
export function PersonnelInviteDialog({
  recordId,
  personName,
}: PersonnelInviteDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('employee');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSending) return;
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
      setEmailError(ERROR_MESSAGES.invalid_email);
      document.getElementById('personnel-invite-email')?.focus();
      return;
    }

    setIsSending(true);
    const result = await sendPersonnelInvite(recordId, email, role);
    setIsSending(false);

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
      setError(
        ERROR_MESSAGES[result.error ?? ''] ??
          'Die Einladung konnte nicht gesendet werden.'
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <MailPlus className="size-4" />
          Zugang einladen
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Zugang für {personName} einladen</DialogTitle>
          <DialogDescription>
            Nach Annahme der Einladung wird der neue Zugang automatisch mit
            dieser Personalakte verknüpft.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <Field
              label="E-Mail-Adresse"
              htmlFor="personnel-invite-email"
              required
              error={emailError}
            >
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
                  {ROLE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <ErrorText>{error}</ErrorText>
            {success && (
              <p className="text-sm text-green-600">
                Einladung erfolgreich gesendet!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSending || success}>
              {isSending && <Loader2 className="size-4 animate-spin" />}
              {isSending ? 'Wird gesendet...' : 'Einladung senden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
