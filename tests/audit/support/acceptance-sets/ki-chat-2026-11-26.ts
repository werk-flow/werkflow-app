import { kiOrganizationFor, seedKiThread, type KiRole } from '../../../golden/support/db/ki';
import type { TestWorld } from '../../../golden/support/world';
import { stateCaptureId } from '../acceptance-state-plan';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#530 of 2026-11-26: the WerkFlow KI chat page in
 * the run's KI organization, which the local test server releases
 * (lib/testing/ai-test-organization.ts): a new chat for each role, a thread
 * with a long answer, and the page loading. The world's own organization is
 * not released, so its admin sees the notice. A thread that cannot load is a
 * client read's failure, which a capture's state plan cannot hold; the chat's
 * contract shows it (tests/ui-contracts/ki-chat.spec.ts).
 */
const LONG_ANSWER = [
  '# Heizkörper entlüften',
  'Du brauchst einen **Entlüftungsschlüssel**, ein Tuch und einen kleinen Eimer.',
  '1. Schalte die Umwälzpumpe aus und warte etwa eine Stunde.\n2. Öffne das Ventil eine Vierteldrehung, bis Wasser kommt.\n3. Schließe es und prüfe den Anlagendruck am Manometer.',
  '> Liegt der Druck unter 1,0 bar, füll Wasser nach, bevor du die Pumpe wieder einschaltest.',
  'Den Wartungstermin findest du in deinen [Aufgaben](/aufgaben). Die Herstellerseite www.example.org/anleitung zeige ich nur als Text.',
  '```\nDruck vorher: 0,8 bar\nDruck nachher: 1,5 bar\n```',
  'Wenn ein Heizkörper danach noch gluckert, wiederhole das bei den Heizkörpern im obersten Stockwerk.',
].join('\n\n');

const account = (role: KiRole) => async (world: TestWorld) => {
  const ki = await kiOrganizationFor(world);
  return { user: ki.users[role], organizationId: ki.organizationId };
};

async function threadWithLongAnswer(world: TestWorld): Promise<{ route: string }> {
  const ki = await kiOrganizationFor(world);
  const threadId = await seedKiThread(ki, 'admin', [
    { role: 'user', text: 'Wie entlüfte ich einen Heizkörper richtig?' },
    { role: 'assistant', text: LONG_ANSWER },
  ]);
  return { route: `/ki?chat=${threadId}` };
}

function kiChatCaptures(): OpenSet {
  const both = { widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  const page = { kind: 'page' } as const;
  return {
    id: 'ki-chat-2026-11-26',
    captures: [
      ...(['admin', 'buero', 'employee'] as const).map((role) => ({
        id: `${role}-ki-neuer-chat`,
        role,
        route: '/ki' as const,
        view: page,
        account: account(role),
        ...both,
      })),
      {
        id: 'admin-ki-lange-antwort',
        role: 'admin',
        route: '/ki',
        view: page,
        account: account('admin'),
        destination: threadWithLongAnswer,
        ...both,
      },
      {
        id: stateCaptureId('admin-ki-neuer-chat', 'loading'),
        role: 'admin',
        route: '/ki',
        view: page,
        state: 'loading',
        account: account('admin'),
        ...both,
      },
      { id: 'admin-ki-nicht-freigeschaltet', role: 'admin', route: '/ki', view: page, ...both },
    ],
    standalone: [],
  };
}

acceptanceSet(kiChatCaptures());
