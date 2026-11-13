import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { HoursDisplay } from '@/components/mitarbeiter/hours-display';
import {
  memberStatusVisibility,
  type StatusVisibility,
} from '@/components/mitarbeiter/member-status-visibility';
import { StatusBadge } from '@/components/mitarbeiter/status-badge';
import type { OrgRole } from '@/lib/roles';

// werk-flow/werkflow-planning#54: a Büro member saw „Nicht verfügbar“ for the
// Admin and the other Büro members, which a planning office reads as absent.
// The status is only hidden from them, so the list says that and names why;
// a status read that failed says it was not loaded.

const HINT = 'Den Arbeitsstatus von Büro und Admin sehen nur Admins.';

function renderStatus(visibility: StatusVisibility): string {
  return renderToStaticMarkup(
    <>
      <StatusBadge isClockedIn visibility={visibility} />
      <HoursDisplay isClockedIn statusStartedAt={null} workMinutes={60} visibility={visibility} />
    </>,
  );
}

describe('who sees a member’s clock status', () => {
  const visibilityFor = (viewer: OrgRole, member: OrgRole, own = false) =>
    memberStatusVisibility(
      { userId: 'viewer', role: viewer },
      { userId: own ? 'viewer' : 'member', role: member, hasStatus: true },
      false,
    );

  test('Admin sees everyone', () => {
    expect((['admin', 'buero', 'employee'] as const).map((role) => visibilityFor('admin', role))).toEqual([
      'visible',
      'visible',
      'visible',
    ]);
  });

  test('Büro sees itself and the employees, never the Admin or a peer', () => {
    expect(visibilityFor('buero', 'buero', true)).toBe('visible');
    expect(visibilityFor('buero', 'employee')).toBe('visible');
    expect(visibilityFor('buero', 'admin')).toBe('hidden');
    expect(visibilityFor('buero', 'buero')).toBe('hidden');
  });

  test('a failed read is not loaded only for a visible member without a last-known status', () => {
    const viewer = { userId: 'viewer', role: 'buero' } as const;
    expect(memberStatusVisibility(viewer, { userId: 'w', role: 'employee', hasStatus: false }, true)).toBe(
      'not_loaded',
    );
    expect(memberStatusVisibility(viewer, { userId: 'w', role: 'employee', hasStatus: true }, true)).toBe(
      'visible',
    );
    expect(memberStatusVisibility(viewer, { userId: 'a', role: 'admin', hasStatus: false }, true)).toBe(
      'hidden',
    );
  });
});

describe('the status badge and hours display', () => {
  test('a hidden status reads „Status nicht sichtbar“ with the reason, never „Nicht verfügbar“', () => {
    const markup = renderStatus('hidden');
    expect(markup).toContain('Status nicht sichtbar');
    expect(markup.split(`title="${HINT}"`)).toHaveLength(3);
    expect(markup).toContain(`<span class="sr-only">. ${HINT}</span>`);
    expect(markup).toContain('aria-label="Tagesfortschritt nicht sichtbar"');
    expect(markup.toLowerCase()).not.toContain('nicht verfügbar');
    expect(markup).not.toContain('Arbeitet');
  });

  test('a status that was not loaded says so, without a permission reason', () => {
    const markup = renderStatus('not_loaded');
    expect(markup).toContain('Status nicht geladen');
    expect(markup).toContain('aria-label="Tagesfortschritt nicht geladen"');
    expect(markup).not.toContain(HINT);
    expect(markup).not.toContain('Arbeitet');
  });

  test('a visible status shows the state', () => {
    expect(renderStatus('visible')).toContain('Arbeitet');
  });
});
