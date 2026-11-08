import { useEffect, useState } from 'react';

import { ResetPasswordForm } from '@/app/(auth)/reset-password/reset-password-form';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export type AuthUrlFixtureName = 'auth-url-session' | 'auth-url-reset-form';

/** Shows which account the real browser client holds once it has read the page URL. */
function StoredSessionProbe(): React.JSX.Element {
  const [account, setAccount] = useState('Wird gelesen');
  useEffect(() => {
    createSupabaseBrowserClient()
      .auth.getSession()
      .then(({ data }) => setAccount(data.session?.user.id ?? 'keines'))
      .catch(() => setAccount('Fehler'));
  }, []);
  return <output aria-label="Angemeldetes Konto">{account}</output>;
}

export function AuthUrlContractFixture({ name }: { name: AuthUrlFixtureName }): React.JSX.Element {
  return (
    <main>
      <h1>Komponentenverträge</h1>
      {name === 'auth-url-session' ? <StoredSessionProbe /> : <ResetPasswordForm />}
    </main>
  );
}
