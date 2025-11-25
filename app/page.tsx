import { redirect } from "next/navigation";

import { getSupabaseServerSession } from "@/lib/supabase/server";

export default async function Home() {
  const { session } = await getSupabaseServerSession();

  redirect(session ? "/dashboard" : "/login");
}
