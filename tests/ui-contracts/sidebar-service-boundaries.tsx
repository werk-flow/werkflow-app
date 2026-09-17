import type { ComponentProps, ReactElement } from "react";

declare global { interface Window { sidebarPrefetches: string[] } }
window.sidebarPrefetches = [];

export function useRouter(): { prefetch: (href: string) => void } {
  return { prefetch: (href) => { window.sidebarPrefetches.push(href); } };
}

export default function Link({ prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }): ReactElement {
  return <a {...props} data-automatic-prefetch={String(prefetch)} />;
}
