import { Suspense, type ReactElement } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'

import { WorkTemplatesContent } from '@/components/arbeitsvorlagen/work-templates-content'
import { WorkTemplatesContentSkeleton } from '@/components/loading-states/work-templates-page-skeleton'
import { PageActionButton, PageActionProvider } from '@/components/shared/page-action'
import { PageHeader } from '@/components/shared/page-header'
import { PageBody, PageShell } from '@/components/shared/page-shell'
import { getCachedMemberships, getCachedUser } from '@/lib/data/cached'
import { getInventoryPickerOptions } from '@/lib/inventory/actions'
import type { OrgRole } from '@/lib/members/actions'
import { resolveActiveOrgId } from '@/lib/org/cookies'
import { getQualificationWorkspace } from '@/lib/qualifications/actions'
import { getWorkTemplates } from '@/lib/work-templates/actions'

async function WorkTemplatesData(): Promise<ReactElement> {
  // These server actions each resolve the cookie-backed active organization.
  // Keep them sequential so Partial Prerendering cannot finish one cookie
  // scope while a sibling lookup is still suspended.
  const templatesResult = await getWorkTemplates()
  const inventoryResult = await getInventoryPickerOptions()
  const qualificationsResult = await getQualificationWorkspace()
  if (!templatesResult.success) {
    if (templatesResult.error === 'not_authorized') redirect('/dashboard')
    if (['not_authenticated', 'no_active_org', 'not_a_member'].includes(templatesResult.error)) redirect('/login')
    throw new Error(`Failed to load work templates: ${templatesResult.error}`)
  }
  if (!inventoryResult.success) throw new Error(`Failed to load inventory options: ${inventoryResult.error}`)
  if (!qualificationsResult.success) throw new Error(`Failed to load qualifications: ${qualificationsResult.error}`)

  return (
    <WorkTemplatesContent
      initialTemplates={templatesResult.data}
      inventoryItems={inventoryResult.items}
      inventoryLocations={inventoryResult.locations}
      capabilities={qualificationsResult.data.capabilities.filter((capability) => !capability.retiredAt)}
    />
  )
}

export default async function WorkTemplatesPage(): Promise<ReactElement> {
  // The header with the create action paints before the data. Gate it on the
  // role here so the button never shows to someone the data load would redirect
  // away; WorkTemplatesData still enforces authorization itself.
  const [{ data: { user } }, cookieStore] = await Promise.all([getCachedUser(), cookies()])
  if (!user) redirect('/login')
  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ])
  if (!activeOrgId) redirect('/login')
  const currentUserRole = memberships.find((membership) => membership.orgId === activeOrgId)?.role as
    | OrgRole
    | undefined
  if (currentUserRole !== 'admin' && currentUserRole !== 'buero') redirect('/dashboard')

  return (
    <PageActionProvider>
      <PageShell>
        <PageHeader
          title="Arbeitsvorlagen"
          subtitle="Wiederverwendbare Aufgaben, Materialplanung und Anforderungen für Aufträge und Projekte."
          actions={<PageActionButton><Plus className="size-4" />Vorlage erstellen</PageActionButton>}
        />
        <PageBody>
          <Suspense fallback={<WorkTemplatesContentSkeleton />}>
            <WorkTemplatesData />
          </Suspense>
        </PageBody>
      </PageShell>
    </PageActionProvider>
  )
}
