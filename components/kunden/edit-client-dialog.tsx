'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { updateClient, type UpdateClientInput } from '@/lib/clients/actions';
import { CLIENT_TYPE_LABELS, type Client, type ClientType } from '@/lib/jobs/types';

const CLIENT_TYPE_OPTIONS: { value: ClientType; label: string }[] = [
  { value: 'privat', label: CLIENT_TYPE_LABELS.privat },
  { value: 'gewerblich', label: CLIENT_TYPE_LABELS.gewerblich }
];

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
  no_active_org: 'Keine Organisation ausgewählt.',
  not_authorized: 'Du bist nicht berechtigt, Kunden zu verwalten.',
  name_required: 'Bitte gib einen Namen ein.',
  client_not_found: 'Kunde nicht gefunden.',
  no_changes: 'Keine Änderungen vorgenommen.',
  update_failed: 'Fehler beim Aktualisieren des Kunden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

interface EditClientDialogProps {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditClientDialog({
  client,
  open,
  onOpenChange
}: EditClientDialogProps) {
  const [name, setName] = useState(client.name);
  const [clientType, setClientType] = useState<ClientType>(client.clientType);
  const [email, setEmail] = useState(client.email ?? '');
  const [phone, setPhone] = useState(client.phone ?? '');
  const [address, setAddress] = useState(client.address ?? '');
  const [notes, setNotes] = useState(client.notes ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setName(client.name);
      setClientType(client.clientType);
      setEmail(client.email ?? '');
      setPhone(client.phone ?? '');
      setAddress(client.address ?? '');
      setNotes(client.notes ?? '');
      setError(null);
      setNameError(null);
      setSuccess(false);
      setHasAttemptedSubmit(false);
    }
  }, [open, client]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    setError(null);
    setNameError(null);

    if (!name.trim()) {
      setNameError('Bitte gib einen Namen ein.');
      return;
    }

    setIsLoading(true);
    setSuccess(false);

    try {
      const input: UpdateClientInput = {
        name: name.trim(),
        clientType,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined
      };

      const result = await updateClient(client.id, input);

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onOpenChange(false);
          setSuccess(false);
          router.refresh();
        }, 1500);
      } else {
        setError(
          ERROR_MESSAGES[result.error] || result.error || 'Unbekannter Fehler'
        );
      }
    } catch {
      setError('Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setIsLoading(false);
    }
  };

  const showNameError = hasAttemptedSubmit && nameError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Kunde bearbeiten</DialogTitle>
          <DialogDescription>
            Ändere die Daten des Kunden.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-client-name">Name *</Label>
              <Input
                id="edit-client-name"
                placeholder="Kundenname"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(null);
                }}
                disabled={isLoading || success}
                aria-invalid={showNameError ? true : undefined}
              />
              {showNameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-client-type">Typ</Label>
              <Select
                value={clientType}
                onValueChange={(value) => setClientType(value as ClientType)}
                disabled={isLoading || success}
              >
                <SelectTrigger id="edit-client-type">
                  <SelectValue placeholder="Typ auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-client-email">E-Mail</Label>
              <Input
                id="edit-client-email"
                type="text"
                inputMode="email"
                placeholder="kunde@beispiel.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-client-phone">Telefon</Label>
              <Input
                id="edit-client-phone"
                type="tel"
                placeholder="+49 123 456789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-client-address">Adresse</Label>
              <Input
                id="edit-client-address"
                placeholder="Straße, PLZ Ort"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-client-notes">Notizen</Label>
              <Textarea
                id="edit-client-notes"
                placeholder="Optionale Notizen zum Kunden..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && (
              <p className="text-sm text-green-600">
                Kunde erfolgreich aktualisiert!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading || success || !name.trim()}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
