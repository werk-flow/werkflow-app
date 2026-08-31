"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/service/faelle", label: "Servicefälle" },
  { href: "/service/anlagen", label: "Anlagen & Geräte" },
  { href: "/service/wartung", label: "Wartung" },
] as const;

export function ServiceNavigation(): ReactElement {
  const pathname = usePathname();
  return (
    <nav aria-label="Servicebereiche" className="border-b">
      <div className="flex h-9 gap-1">
        {ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center border-b-2 px-3 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
