import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MetadataRoute } from 'next';

/** The light theme's page background token, read from app/globals.css when the manifest is built. */
function lightBackground(): string {
  const stylesheet = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const value = stylesheet.match(/:root\s*\{[^}]*--background:\s*(#[\da-f]{6});/i)?.[1];
  if (!value) throw new Error('app/globals.css declares no light --background token.');
  return value;
}

// The installed app opens at `/`, which sends each role to its own start page
// (lib/auth/redirects.ts) and a signed-out device to the login.
export default function manifest(): MetadataRoute.Manifest {
  const background = lightBackground();
  return {
    id: '/',
    name: 'WerkFlow',
    short_name: 'WerkFlow',
    description: 'Aufträge, Einsätze und Zeiten deines SHK-Betriebs',
    lang: 'de',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: background,
    theme_color: background,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
