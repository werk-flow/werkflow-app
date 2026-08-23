import type { ReactElement } from 'react'

import { WorkTemplatesPageSkeleton } from '@/components/loading-states/work-templates-page-skeleton'

export default function Loading(): ReactElement {
  return <WorkTemplatesPageSkeleton />
}
