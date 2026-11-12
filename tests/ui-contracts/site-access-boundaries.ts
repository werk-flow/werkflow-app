import { unexpectedWrite } from './held-write-boundary';

// Stand-ins for lib/site-access-proposals/actions.ts: no UI contract decides
// or sends an access proposal, so each call fails as an unexpected write.
export const proposeSiteAccess = unexpectedWrite;
export const acceptSiteAccessProposal = unexpectedWrite;
export const rejectSiteAccessProposal = unexpectedWrite;
