"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactElement } from "react";

type SidebarLinkProps = Omit<ComponentProps<typeof Link>, "prefetch" | "href"> & { href: string };

/** Warm only the intended destination; saves must not re-prefetch the whole sidebar. */
export function SidebarLink({ href, onMouseEnter, onFocus, ...props }: SidebarLinkProps): ReactElement {
  const router = useRouter();
  return <Link {...props} href={href} prefetch={false}
    onMouseEnter={(event) => { onMouseEnter?.(event); if (!event.defaultPrevented) router.prefetch(href); }}
    onFocus={(event) => { onFocus?.(event); if (!event.defaultPrevented) router.prefetch(href); }} />;
}
