import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { getCachedUser } from '@/lib/data/cached';
import { ZeiterfassungHeader } from '@/components/zeiterfassung/zeiterfassung-header';
import { ZeiterfassungContent } from '@/components/zeiterfassung/zeiterfassung-content';
import type { OrgRole } from '@/lib/supabase/database.types';

export default async function ZeiterfassungPage() {
  // Use cached user - deduplicates with layout's call
  const {
    data: { user }
  } = await getCachedUser();

  if (!user) {
    redirect('/login');
  }

  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Zeiterfassung</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  // Get Supabase client for page-specific queries
  const supabase = await createSupabaseServerClient();

  // Check current user's membership and role in this org
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', activeOrgId)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    redirect('/dashboard');
  }

  const currentUserRole = membership.role as OrgRole;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';

  return (
    <div className="flex h-full flex-col">
      <ZeiterfassungHeader />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <ZeiterfassungContent
          organizationId={activeOrgId}
          userId={user.id}
          isAdminOrManager={isAdminOrManager}
        />
      </div>
    </div>
  );
}
