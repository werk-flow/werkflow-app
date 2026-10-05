import { Building2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EntityLinkCard } from '@/components/shared/entity-link-card';
import { type Client, CLIENT_TYPE_LABELS } from '@/lib/jobs/types';

type ProjectDetailClientCardProps = {
  liveClient: Client | null;
  onAssignClient: (() => void) | undefined;
};

export function ProjectDetailClientCard({ liveClient, onAssignClient }: ProjectDetailClientCardProps) {
  if (liveClient) {
    return (
      <EntityLinkCard
        title={liveClient.name}
        href={`/kunden/${liveClient.id}`}
        icon={<Building2 className="size-5" />}
        badge={
          <Badge variant="outline" className="text-xs">
            {CLIENT_TYPE_LABELS[liveClient.clientType]}
          </Badge>
        }
        metadata={[
          ...(liveClient.email ? [{ label: 'E-Mail', value: liveClient.email }] : []),
          ...(liveClient.phone ? [{ label: 'Telefon', value: liveClient.phone }] : []),
        ]}
      />
    );
  }

  return (
    <EntityLinkCard
      title=""
      href=""
      icon={<Building2 className="size-5" />}
      emptyState={{ text: 'Kein Kunde zugewiesen' }}
      onEmptyClick={onAssignClient}
    />
  );
}
