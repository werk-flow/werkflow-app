'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';

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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { createClient, type CreateClientInput } from '@/lib/clients/actions';
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
  create_failed: 'Fehler beim Erstellen des Kunden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.'
};

interface CreateClientDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClientCreated?: (client: Client) => void;
}

export function CreateClientDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onClientCreated,
}: CreateClientDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => controlledOnOpenChange?.(v) : setInternalOpen;

  const [name, setName] = useState('');
  const [clientType, setClientType] = useState<ClientType>('privat');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

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
      const input: CreateClientInput = {
        name: name.trim(),
        clientType,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined
      };

      const result = await createClient(input);

      if (result.success) {
        setSuccess(true);
        onClientCreated?.(result.client);
        resetForm();
        setTimeout(() => {
          setOpen(false);
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

  const resetForm = () => {
    setName('');
    setClientType('privat');
    setEmail('');
    setPhone('');
    setAddress('');
    setNotes('');
    setHasAttemptedSubmit(false);
    setNameError(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
      setError(null);
      setSuccess(false);
    }
  };

  const showNameError = hasAttemptedSubmit && nameError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            <span className="hidden sm:inline">Kunde hinzufügen</span>
            <span className="sm:hidden">Hinzufügen</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="sm:max-w-[425px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Neuen Kunden anlegen</DialogTitle>
          <DialogDescription>
            Erstelle einen neuen Kunden für deine Organisation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.stopPropagation(); handleSubmit(e); }} noValidate>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="client-name">Name *</Label>
              <Input
                id="client-name"
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
              <Label htmlFor="client-type">Typ</Label>
              <Select
                value={clientType}
                onValueChange={(value) => setClientType(value as ClientType)}
                disabled={isLoading || success}
              >
                <SelectTrigger id="client-type">
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
              <Label htmlFor="client-email">E-Mail</Label>
              <Input
                id="client-email"
                type="text"
                inputMode="email"
                placeholder="kunde@beispiel.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-phone">Telefon</Label>
              <Input
                id="client-phone"
                type="tel"
                placeholder="+49 123 456789"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-address">Adresse</Label>
              <Input
                id="client-address"
                placeholder="Straße, PLZ Ort"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="client-notes">Notizen</Label>
              <Textarea
                id="client-notes"
                placeholder="Optionale Notizen zum Kunden..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isLoading || success}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && (
              <p className="text-sm text-green-600">
                Kunde erfolgreich erstellt!
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading || success || !name.trim()}>
              {isLoading && <Loader2 className="size-4 animate-spin" />}
              {isLoading ? 'Wird erstellt...' : 'Kunde erstellen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
