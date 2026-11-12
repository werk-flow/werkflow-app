'use client';

import dynamic from 'next/dynamic';

// The project and Servicefall pages load the section in its own chunk group,
// in the browser only. Imported statically there too, its client graph made
// Turbopack regroup the chunks the job route shares with the field worker's
// work pack (audit:lab:field). Rendered on the server, the page could not
// hydrate before the chunk arrived, and a press right after the page showed
// was lost (audit:wave-2:p1-19). Those pages read the parties after mount, so
// the server renders nothing of it either way.
export const WorkBillingPartiesSection = dynamic(
  () => import('./work-billing-parties-section').then((mod) => mod.WorkBillingPartiesSection),
  { ssr: false },
);
