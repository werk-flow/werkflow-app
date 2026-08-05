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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [success, setSuccess] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSending) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setEmail('');
      setRole('employee');
      setError(null);
      setSuccess(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending || success) return;
    setError(null);

    if (!EMAIL_REGEX.test(email)) {
      setError(ERROR_MESSAGES.invalid_email);
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
            <div className="grid gap-2">
              <Label htmlFor="personnel-invite-email">E-Mail-Adresse</Label>
              <Input
                id="personnel-invite-email"
                type="text"
                inputMode="email"
                autoComplete="email"
                placeholder="mitarbeiter@firma.de"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isSending || success}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="personnel-invite-role">Rolle</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as InviteRole)}
                disabled={isSending || success}
              >
                <SelectTrigger id="personnel-invite-role">
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
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p className="text-sm text-green-600">
                Einladung erfolgreich gesendet!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSending || success || !email}>
              {isSending && <Loader2 className="size-4 animate-spin" />}
              {isSending ? 'Wird gesendet...' : 'Einladung senden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
