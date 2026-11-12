import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { UnsentWorkHost } from '@/components/shared/unsent-work-host';
import { getOptionalSupabaseUrl } from '@/lib/env/public';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'WerkFlow',
  description: 'WerkFlow Dashboard-Zugriff',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabaseUrl = getOptionalSupabaseUrl();

  return (
    // The font variables sit on <html>: Tailwind declares --font-sans on :root, where
    // var(--font-geist-sans) must already resolve, or every element falls back to system-ui.
    <html lang="de" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        {supabaseUrl && (
          <>
            <link rel="dns-prefetch" href={supabaseUrl} />
            <link rel="preconnect" href={supabaseUrl} crossOrigin="anonymous" />
          </>
        )}
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
        <UnsentWorkHost />
      </body>
    </html>
  );
}
