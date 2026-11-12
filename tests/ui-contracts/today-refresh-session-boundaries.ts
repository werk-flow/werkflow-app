import { TODAY_CONTRACT_ORGANIZATIONS, TODAY_CONTRACT_USER } from './today-refresh-world';

// Stand-in for the browser Supabase client of the user profile context and the organization
// provider in the start page refresh fixtures (today-refresh.spec.ts). The profile the app shell
// could not read on the server arrives from the browser's own read, held until the spec releases
// it. A membership refresh finds only the second organization: the fallback's answer.

declare global {
  interface Window {
    todayRefreshProfile: { reads: number; release: () => void };
  }
}

let releaseRead = (): void => undefined;
const readReleased = new Promise<void>((resolve) => {
  releaseRead = resolve;
});
window.todayRefreshProfile = { reads: 0, release: () => releaseRead() };

const profileRow = { id: TODAY_CONTRACT_USER, first_name: 'Mia', last_name: 'Muster', avatar_path: null };
const remainingMembership = {
  organization_id: TODAY_CONTRACT_ORGANIZATIONS[1],
  role: 'employee',
  joined_at: '2026-09-01T00:00:00Z',
  organizations: { id: TODAY_CONTRACT_ORGANIZATIONS[1], name: 'Musterbetrieb b1', unique_code: 'MBb1' },
};

export function createSupabaseBrowserClient() {
  return {
    auth: {
      getUser: async () => {
        window.todayRefreshProfile.reads += 1;
        await readReleased;
        return { data: { user: { id: TODAY_CONTRACT_USER, email: 'mia@example.com' } } };
      },
      getSession: async () => ({ data: { session: { user: { id: TODAY_CONTRACT_USER } } }, error: null }),
    },
    from: (table: string) =>
      table === 'organization_members'
        ? { select: () => ({ eq: async () => ({ data: [remainingMembership], error: null }) }) }
        : { select: () => ({ eq: () => ({ single: async () => ({ data: profileRow, error: null }) }) }) },
  };
}
