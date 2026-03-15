import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getSupabaseServerSession } from "@/lib/supabase/server";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeRedirect />
    </Suspense>
  );
}

async function HomeRedirect() {
  const { session } = await getSupabaseServerSession();
  redirect(session ? "/dashboard" : "/login");
  return null;
}
