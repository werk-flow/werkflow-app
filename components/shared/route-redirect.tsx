'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface RouteRedirectProps {
  href: string;
  children?: React.ReactNode;
}

export function RouteRedirect({ href, children = null }: RouteRedirectProps) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [href, router]);

  return <>{children}</>;
}
