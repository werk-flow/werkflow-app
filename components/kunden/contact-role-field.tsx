'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { CONTACT_ROLE_SUGGESTIONS } from '@/lib/clients/types';

/**
 * A contact's role: free text, with the common roles one pick away. The
 * registry has no free-text combobox, so the field stays an `Input` and the
 * „Vorschläge“ menu beside it only fills the text.
 */
export function ContactRoleField({
  role,
  onRoleChange,
}: {
  role: string;
  onRoleChange: (role: string) => void;
}): React.JSX.Element {
  return (
    <Field label="Rolle" htmlFor="contact-role">
      <div className="flex gap-2">
        <Input
          value={role}
          onChange={(event) => onRoleChange(event.target.value)}
          placeholder="z. B. Hausverwaltung"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              Vorschläge
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {CONTACT_ROLE_SUGGESTIONS.map((suggestion) => (
              <DropdownMenuItem key={suggestion} onSelect={() => onRoleChange(suggestion)}>
                {suggestion}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Field>
  );
}
