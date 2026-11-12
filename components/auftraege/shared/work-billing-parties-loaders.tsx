'use client';

import dynamic from 'next/dynamic';

// The sections still render on the server and their chunks still load with
// the page. Imported statically, their client graph made Turbopack regroup
// the chunks the job route shares with the field worker's work pack, so the
// field worker's job payload grew (audit:lab:field). Their own chunk groups
// keep the route's chunks as they were.
export const WorkBillingPartiesSection = dynamic(() =>
  import('./work-billing-parties-section').then((mod) => mod.WorkBillingPartiesSection),
);

export const RequestBillingRows = dynamic(() =>
  import('@/components/anfragen/request-billing-rows').then((mod) => mod.RequestBillingRows),
);
