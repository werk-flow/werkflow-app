import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSupabaseServerSession } from "@/lib/supabase/server";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Registrieren",
};

export default async function SignupPage() {
  const { session } = await getSupabaseServerSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Erstelle dein Konto
        </CardTitle>
        <CardDescription>
          Werde Teil von WerkFlow und verwalte deine Arbeitsbereiche nahtlos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-muted-foreground">
          Bereits ein Konto?{" "}
          <Link
            href="/login"
            className="text-primary underline-offset-4 hover:underline"
          >
            Anmelden
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
