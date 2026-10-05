'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { logError } from '@/lib/logging';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { getProfileAvatarUrl } from '@/lib/profile-avatar';

// Types
export type UserProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarPath: string | null;
  avatarUrl: string | null;
};

export type UserProfileContextValue = {
  profile: UserProfile | null;
  isLoading: boolean;
  refreshProfile: () => Promise<void>;
};

// Context
const UserProfileContext = createContext<UserProfileContextValue | null>(null);

// Provider props
type UserProfileProviderProps = {
  children: ReactNode;
  initialProfile?: UserProfile | null;
};

export function UserProfileProvider({ children, initialProfile = null }: UserProfileProviderProps) {
  const [profile, setProfile] = useState<UserProfile | null>(initialProfile);
  const [isLoading, setIsLoading] = useState(initialProfile === null);
  const hydratedRef = useRef(false);

  // A new server profile is adopted during render, never in an effect
  // (realtime-and-caching checklist).
  const [adoptedProfile, setAdoptedProfile] = useState(initialProfile);
  if (initialProfile !== adoptedProfile) {
    setAdoptedProfile(initialProfile);
    if (initialProfile !== null) setProfile(initialProfile);
  }

  // Self-hydration: fetch profile client-side when no server data was provided
  useEffect(() => {
    if (hydratedRef.current || initialProfile !== null) return;
    hydratedRef.current = true;
    refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one self-hydration on mount, guarded by hydratedRef
  }, []);

  // Fetch profile from Supabase (client-side)
  const refreshProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !user.email) {
        setProfile(null);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_path')
        .eq('id', user.id)
        .single();

      if (error) {
        // The provider has no surface of its own; consumers keep their name fallbacks.
        logError('user_profile.read_failed', error);
        return;
      }

      if (data) {
        setProfile({
          id: data.id,
          firstName: data.first_name,
          lastName: data.last_name,
          email: user.email,
          avatarPath: data.avatar_path,
          avatarUrl: getProfileAvatarUrl(data.avatar_path),
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = useMemo<UserProfileContextValue>(
    () => ({
      profile,
      isLoading,
      refreshProfile,
    }),
    [profile, isLoading, refreshProfile],
  );

  return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
}

// Hook
export function useUserProfile() {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileProvider');
  }
  return context;
}
