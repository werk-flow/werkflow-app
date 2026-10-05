import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { readOwnLatestJoinRequest } from '@/lib/org/join-requests';

import { JoinOrganizationForm } from './join-organization-form';

export const metadata: Metadata = {
  title: 'Organisation beitreten - WerkFlow',
};

export default async function JoinOrganizationPage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect('/login');
  }

  // A failed read must not hide an open request behind an empty form.
  const latest = await readOwnLatestJoinRequest(user.id);
  if (!latest.success) throw new Error('join_request_read_failed');
  const request = latest.request;

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Organisation beitreten</CardTitle>
        <CardDescription>
          Gib den Organisationscode ein, den du von deinem Admin erhalten hast. Ein Admin oder das Büro deiner
          Organisation gibt deine Anfrage frei.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <JoinOrganizationForm
          key={request ? `${request.id}:${request.status}` : 'none'}
          pendingRequest={request?.status === 'pending' ? request : null}
          declinedBy={request?.status === 'declined' ? request.organizationName : null}
        />
      </CardContent>
    </Card>
  );
}
