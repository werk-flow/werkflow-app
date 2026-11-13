'use client';

import dynamic from 'next/dynamic';

import { downloadWorkBillingPartiesSection } from './work-billing-parties-download';

// The job, project and Servicefall pages load the office-only section in its
// own chunk group, in the browser only. A page's entry chunks hold every
// client module the page reaches, and the field worker's job list prefetches
// the job route's, so a static import put billing code into every field cold
// start (audit:lab:field). Rendered on the server, the page could not hydrate
// before the chunk arrived, and a press right after the page showed was lost
// (audit:wave-2:p1-19); the job page hands in its parties read, so the section
// opens without a read of its own once its chunk is there. The office's job
// list downloads the chunk on intent (work-billing-parties-download.ts).
export const WorkBillingPartiesSection = dynamic(downloadWorkBillingPartiesSection, { ssr: false });
