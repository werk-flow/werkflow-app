import { redirect } from 'next/navigation'
import type { ReactElement } from 'react'

import { WorkTemplatesContent } from '@/components/arbeitsvorlagen/work-templates-content'
import { getInventoryPickerOptions } from '@/lib/inventory/actions'
import { getQualificationWorkspace } from '@/lib/qualifications/actions'
import { getWorkTemplates } from '@/lib/work-templates/actions'

export default async function WorkTemplatesPage(): Promise<ReactElement> {
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
