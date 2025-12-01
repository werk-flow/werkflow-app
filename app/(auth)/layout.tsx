import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/20 px-4 py-12">
      {/* Logo */}
      <Link href="/" className="mb-8">
        {/* Light mode logo */}
        <Image
          src="/logo-text-light.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="h-10 w-auto dark:hidden"
          priority
        />
        {/* Dark mode logo */}
        <Image
          src="/logo-text-dark.svg"
          alt="WerkFlow"
          width={180}
          height={40}
          className="hidden h-10 w-auto dark:block"
          priority
        />
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
