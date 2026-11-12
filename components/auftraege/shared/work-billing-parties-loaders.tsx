'use client';

import dynamic from 'next/dynamic';

// The project and Servicefall pages load the section in its own chunk group.
// Imported statically there too, its client graph made Turbopack regroup the
// chunks the job route shares with the field worker's work pack, so the field
// worker's job payload grew (audit:lab:field). Those pages read the parties
// after mount anyway.
export const WorkBillingPartiesSection = dynamic(() =>
  import('./work-billing-parties-section').then((mod) => mod.WorkBillingPartiesSection),
);
