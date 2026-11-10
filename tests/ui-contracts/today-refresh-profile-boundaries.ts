import { TODAY_CONTRACT_USER } from './today-refresh-world';

// Stand-in for the browser Supabase client of the user profile context: the profile the app
// shell could not read on the server arrives from the browser's own read, held until the spec
// releases it (today-refresh.spec.ts).

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

export function createSupabaseBrowserClient() {
  return {
    auth: {
      getUser: async () => {
        window.todayRefreshProfile.reads += 1;
        await readReleased;
        return { data: { user: { id: TODAY_CONTRACT_USER, email: 'mia@example.com' } } };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: profileRow, error: null }) }) }),
    }),
  };
}
