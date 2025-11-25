import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type MutableCookies = {
  set?: (
    options:
      | {
          name: string;
          value: string;
          path?: string;
          domain?: string;
          maxAge?: number;
          expires?: Date;
          httpOnly?: boolean;
          secure?: boolean;
          sameSite?: "strict" | "lax" | "none";
        }
      | string,
    value?: string,
    options?: {
      path?: string;
      domain?: string;
      maxAge?: number;
      expires?: Date;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "strict" | "lax" | "none";
    },
  ) => void;
  delete?: (
    name: string | { name: string; path?: string },
    path?: { path?: string },
  ) => void;
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const mutableCookies = cookieStore as unknown as MutableCookies;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          mutableCookies.set?.({ name, value, ...options });
        },
        remove(name, options) {
          mutableCookies.delete?.({ name, ...options });
        },
      },
    },
  );
}

export async function getSupabaseServerSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return { supabase, session };
}
