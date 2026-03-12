'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { sendOrgInvite, type InviteRole } from '@/lib/invites/actions';
import { cn } from '@/lib/utils';

// Role labels for the dropdown (using gender-inclusive German format)
const ROLE_OPTIONS: { value: InviteRole; label: string }[] = [
  { value: 'manager', label: 'Manager/in' },
  { value: 'accountant', label: 'Buchhalter/in' },
  { value: 'secretary', label: 'Sekretär/in' },
  { value: 'employee', label: 'Handwerker/in' }
];

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  org_not_found: 'Organisation nicht gefunden.',
  not_authorized: 'Du bist nicht berechtigt, Einladungen zu senden.',
  invalid_email: 'Bitte gib eine gültige E-Mail-Adresse ein.',
  invalid_role: 'Ungültige Rolle ausgewählt.',
  already_member: 'Diese Person ist bereits Mitglied dieser Organisation.',
  invite_already_pending:
    'Es gibt bereits eine ausstehende Einladung für diese E-Mail-Adresse.',
  insert_failed: 'Fehler beim Erstellen der Einladung.',
  email_send_failed: 'Fehler beim Senden der Einladungs-E-Mail.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

// Email validation regex (same as signup form)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<InviteRole>('employee');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setEmailError(null);

    // Validate email format
    if (!EMAIL_REGEX.test(email)) {
      setEmailError('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }

    setIsLoading(true);
    setSuccess(false);

    try {
      const result = await sendOrgInvite(email, selectedRole);

      if (result.success) {
        setSuccess(true);
        setEmail('');
        setSelectedRole('employee'); // Reset role to default
        setHasAttemptedSubmit(false);
        // Close dialog after a short delay
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
          router.refresh();
        }, 2000);
      } else {
        setError(
          ERROR_MESSAGES[result.error || 'unexpected_error'] ||
            result.error ||
            'Unbekannter Fehler'
        );
      }
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset state when closing
      setEmail('');
      setSelectedRole('employee');
      setError(null);
      setEmailError(null);
      setSuccess(false);
      setHasAttemptedSubmit(false);
    }
  };

  // Determine if we should show the email error (only after submit attempt)
  const showEmailError = hasAttemptedSubmit && emailError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="default" className="gap-2">
          <UserPlus className="size-4" />
          <span className="hidden sm:inline">Mitarbeiter hinzufügen</span>
          <span className="sm:hidden">Hinzufügen</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Mitarbeiter einladen</DialogTitle>
          <DialogDescription>
            Gib die E-Mail-Adresse des Mitarbeiters ein, den du einladen
            möchtest. Er erhält eine E-Mail mit einem Einladungslink.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">E-Mail-Adresse</Label>
              <Input
                id="email"
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
                disabled={isLoading || success}
                aria-invalid={showEmailError ? true : undefined}
                className={cn(
                  showEmailError &&
                    'border-destructive ring-destructive/20 dark:ring-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40'
                )}
              />
              {showEmailError && (
                <p className="text-sm text-destructive">{emailError}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Rolle</Label>
              <Select
                value={selectedRole}
                onValueChange={(value) => setSelectedRole(value as InviteRole)}
                disabled={isLoading || success}
              >
                <SelectTrigger id="role">
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
              <p className="text-xs text-muted-foreground">
                Die Rolle, die der Mitarbeiter nach Annahme der Einladung
                erhält.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && (
              <p className="text-sm text-green-600">
                Einladung erfolgreich gesendet!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading || success || !email}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird gesendet...' : 'Einladung senden'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
