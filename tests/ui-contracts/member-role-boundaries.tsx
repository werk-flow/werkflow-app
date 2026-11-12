// The three places an admin changes a member's role: the list row's menu, the
// detail header's menu and the profile's role field. Each records the role it
// hands to the page's role change, so the contract sees what reaches the server.
import { MemberActionsMenu } from '@/components/mitarbeiter/member-actions-menu';
import { MitarbeiterDetailActionsMenu } from '@/components/mitarbeiter/mitarbeiter-detail-member-actions';
import { MitarbeiterDetailProfileSection } from '@/components/mitarbeiter/mitarbeiter-detail-profile-section';
import { BannerProvider } from '@/components/ui/banner';
import { ROLE_LABELS, type OrgRole } from '@/lib/roles';

declare global {
  interface Window {
    /** Each role change a surface handed on, as "<surface>:<member>:<role>". */
    uiContractRoleChanges: string[];
    /** Settles the held role change, refused with that sentence or saved with `null`; set while one is open. */
    uiContractSettleRoleChange: ((refusal: string | null) => void) | null;
  }
}

const ADMIN_ID = 'contract-admin';
const HANNA = { id: 'contract-hanna', firstName: 'Hanna', lastName: 'Handwerk' };
const BEA = { id: 'contract-bea', firstName: 'Bea', lastName: 'Büro' };

/** Records the change and holds it open until the spec settles it, as the server would. */
function record(surface: string, memberId: string, role: OrgRole): Promise<string | null> {
  window.uiContractRoleChanges.push(`${surface}:${memberId}:${role}`);
  return new Promise((resolve) => {
    window.uiContractSettleRoleChange = (refusal) => {
      window.uiContractSettleRoleChange = null;
      resolve(refusal);
    };
  });
}

function ListRowMenu({ member, role }: { member: typeof HANNA; role: OrgRole }): React.JSX.Element {
  const name = `${member.firstName} ${member.lastName}`;
  return (
    <section aria-label={`Zeile ${name}`}>
      <MemberActionsMenu
        memberId={member.id}
        memberName={name}
        memberFirstName={member.firstName}
        memberLastName={member.lastName}
        memberRole={role}
        currentUserId={ADMIN_ID}
        currentUserRole="admin"
        onRoleChange={(memberId, newRole) => record('list', memberId, newRole)}
      />
    </section>
  );
}

export function MemberRoleContractFixture(): React.JSX.Element {
  window.uiContractRoleChanges ??= [];
  window.uiContractSettleRoleChange ??= null;
  const hannaName = `${HANNA.firstName} ${HANNA.lastName}`;
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <ListRowMenu member={HANNA} role="employee" />
        <ListRowMenu member={BEA} role="buero" />
        <section aria-label="Detailkopf">
          <MitarbeiterDetailActionsMenu
            memberName={hannaName}
            memberRole="employee"
            availableRoles={['buero']}
            isUpdatingRole={false}
            onRoleChange={(role) => record('detail', HANNA.id, role)}
            onRoleChangeFailure={() => undefined}
            onRemoveRequest={() => undefined}
          />
        </section>
        <MitarbeiterDetailProfileSection
          member={{
            userId: HANNA.id,
            firstName: HANNA.firstName,
            lastName: HANNA.lastName,
            email: 'hanna@example.test',
            role: 'employee',
            joinedAt: '2026-01-05T08:00:00.000Z',
          }}
          fullName={hannaName}
          canManage
          roleOptions={(['buero', 'employee'] as const).map((value) => ({
            value,
            label: ROLE_LABELS[value],
          }))}
          onRoleChange={(role) => record('profile', HANNA.id, role)}
        />
      </main>
    </BannerProvider>
  );
}
