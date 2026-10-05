import { expect, type Locator, type Page } from '@playwright/test';
import { ROLE_LABELS } from '../../../../lib/roles';
import { confirmTestUserEmail } from '../seed';
import { pressKey } from './interaction';
import { openMemberDetailFromList } from './personnel';
import { SHARED_COPY, openDialogWithRetry, pendingRow, visibleText } from './shared';

/** Copy of accounts, organizations, membership and the member list. */
const ORGANIZATION_COPY = {
  signup: {
    firstName: 'Vorname',
    lastName: 'Nachname',
    email: 'E-Mail',
    password: 'Passwort',
    submit: 'Registrieren',
  },
  login: {
    email: /^E-Mail/,
    password: /^Passwort/,
    submit: 'Anmelden',
  },
  signOut: 'Abmelden',
  accountMenu: 'Kontomenü öffnen',
  simulatePayment: 'Zahlung simulieren / Fortfahren',
  organizationName: 'Name der Organisation',
  createOrganization: 'Organisation erstellen',
  joinOrganization: 'Organisation beitreten',
  joinCode: 'Organisationscode',
  requestJoin: 'Beitritt anfragen',
  withdrawJoinRequest: 'Anfrage zurückziehen',
  joinDialogDone: 'Fertig',
  joinRequests: /Beitrittsanfragen/,
  foreignAdminJoinRefused:
    'Du kannst keiner Organisation beitreten, die nicht vom gleichen Admin stammt wie deine bestehenden Organisationen.',
  memberJoinedSignal: 'ist jetzt Mitglied',
  invite: {
    open: 'Mitarbeiter hinzufügen',
    title: 'Mitarbeiter einladen',
    send: 'Einladung senden',
    invitationsTab: /^Einladungen/,
    cancel: SHARED_COPY.action.cancelRecord,
    pending: 'Ausstehend',
    cancelled: 'Storniert',
  },
  memberMenu: {
    actions: 'Aktionen',
    details: 'Details anzeigen',
    remove: SHARED_COPY.action.remove,
    changeRole: 'Rolle ändern',
    removeTitle: 'Mitglied entfernen?',
  },
  workSchedule: /Arbeitszeitmodell/,
  memberDetailProgress: 'Tagesfortschritt',
} as const;

/** The clock state a member row shows in the member list (components/mitarbeiter/status-badge.tsx). */
export const MEMBER_CLOCK_STATUS = {
  working: 'Arbeitet',
  onBreak: 'Macht Pause',
  notClockedIn: 'Nicht eingestempelt',
} as const;

/** Any clock state of a member row. */
export const ANY_MEMBER_CLOCK_STATUS = new RegExp(Object.values(MEMBER_CLOCK_STATUS).join('|'));

/** The status of a row in the invitations tab. */
export const INVITATION_STATUS = {
  pending: ORGANIZATION_COPY.invite.pending,
  cancelled: ORGANIZATION_COPY.invite.cancelled,
} as const;

/** The refusal a code of an organization under another admin produces. */
export const FOREIGN_ADMIN_JOIN_REFUSAL = ORGANIZATION_COPY.foreignAdminJoinRefused;

/** The progress label of a member's detail page that proves the detail opened. */
export const MEMBER_DETAIL_PROGRESS = ORGANIZATION_COPY.memberDetailProgress;

/** The roles an invitation grants. */
type InvitedRole = Exclude<keyof typeof ROLE_LABELS, 'admin'>;

type SignupAccount = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

/** The waiting state of a join request, on the join page and in the join dialog. */
export function joinRequestPendingMessage(organizationName: string): string {
  return `Deine Anfrage wartet auf Freigabe durch ${organizationName}.`;
}

/** The banner after the office approves a join request. */
export function memberJoinedMessage(memberName: string): string {
  return `${memberName} ${ORGANIZATION_COPY.memberJoinedSignal} deiner Organisation.`;
}

/** The login form's submit button. */
export function loginSubmitButton(page: Page): Locator {
  return page.getByRole('button', { name: ORGANIZATION_COPY.login.submit, exact: true });
}

/** Fills the signup form on the current page and submits it once. */
export async function submitSignupForm(page: Page, account: SignupAccount): Promise<void> {
  await page.getByLabel(ORGANIZATION_COPY.signup.firstName).fill(account.firstName);
  await page.getByLabel(ORGANIZATION_COPY.signup.lastName).fill(account.lastName);
  await page.getByLabel(ORGANIZATION_COPY.signup.email).fill(account.email);
  await page
    .getByRole('textbox', { name: ORGANIZATION_COPY.signup.password, exact: true })
    .fill(account.password);
  await page.getByRole('button', { name: ORGANIZATION_COPY.signup.submit }).click();
}

/**
 * Registers a new account through the signup page. When the environment asks
 * for email verification, confirms the address and signs in; either way the
 * account ends on the upgrade or onboarding route.
 */
export async function signUpViaUi(page: Page, account: SignupAccount): Promise<void> {
  await page.goto('/signup');
  await submitSignupForm(page, account);
  await expect(page).toHaveURL(/\/(verify|upgrade|onboarding)/, { timeout: 30_000 });
  if (!/\/verify/.test(page.url())) return;
  await confirmTestUserEmail(account.email);
  await page.goto('/login');
  await page.getByRole('textbox', { name: ORGANIZATION_COPY.login.email }).fill(account.email);
  await page.getByRole('textbox', { name: ORGANIZATION_COPY.login.password }).fill(account.password);
  await loginSubmitButton(page).click();
  await expect(page).toHaveURL(/\/(upgrade|onboarding)/, { timeout: 30_000 });
}

/** The upgrade page's payment simulation that continues to the organization form. */
export function simulatedPaymentButton(page: Page): Locator {
  return page.getByRole('button', { name: ORGANIZATION_COPY.simulatePayment });
}

/** Creates the account's first organization on the onboarding form and lands on the dashboard. */
export async function createOrganizationInOnboarding(page: Page, organizationName: string): Promise<void> {
  await page.getByLabel(ORGANIZATION_COPY.organizationName).fill(organizationName);
  await page.getByRole('button', { name: ORGANIZATION_COPY.createOrganization }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

/** Creates a further organization through the switcher's dialog and lands on its dashboard. */
export async function createAdditionalOrganization(page: Page, organizationName: string): Promise<void> {
  await page.getByRole('button', { name: ORGANIZATION_COPY.createOrganization }).click();
  await page.getByLabel(ORGANIZATION_COPY.organizationName).fill(organizationName);
  await page.getByRole('button', { name: SHARED_COPY.action.create, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?created=/, { timeout: 30_000 });
}

/** The organization switcher while it shows this organization. */
export function organizationSwitcher(page: Page, organizationName: string): Locator {
  return page.getByRole('combobox').filter({ hasText: organizationName });
}

/** Opens the join dialog from the dashboard and returns it. */
export async function openJoinOrganizationDialog(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog');
  await openDialogWithRetry({
    trigger: page.getByRole('button', { name: ORGANIZATION_COPY.joinOrganization }),
    dialog,
  });
  return dialog;
}

/** The one submit of a join code, on the join page and in the join dialog. */
function joinRequestButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: ORGANIZATION_COPY.requestJoin, exact: true });
}

/** Enters an organization code and asks to join with it. */
export async function requestJoinWithCode(scope: Page | Locator, code: string): Promise<void> {
  await scope.getByLabel(ORGANIZATION_COPY.joinCode).fill(code);
  await joinRequestButton(scope).click();
}

export function withdrawJoinRequestButton(page: Page): Locator {
  return page.getByRole('button', { name: ORGANIZATION_COPY.withdrawJoinRequest, exact: true });
}

export function joinDialogDoneButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: ORGANIZATION_COPY.joinDialogDone, exact: true });
}

/** The office's list of open join requests on the member page. */
export function joinRequestsRegion(page: Page): Locator {
  return page.getByRole('region', { name: ORGANIZATION_COPY.joinRequests });
}

export function approveJoinRequestButton(joinRequests: Locator, requesterName: string): Locator {
  return joinRequests.getByRole('button', { name: `${requesterName} freigeben`, exact: true });
}

/** The banner that confirms an approved join request. */
export function memberJoinedBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: ORGANIZATION_COPY.memberJoinedSignal });
}

/** A row of the member list or the invitations tab, by member name or invited email. */
export function memberRow(page: Page, nameOrEmail: string): Locator {
  return page.getByRole('row').filter({ hasText: nameOrEmail });
}

export function memberRowActionsButton(row: Locator): Locator {
  return row.getByRole('button', { name: SHARED_COPY.action.openActions });
}

/** The work schedule indicator of a member row. */
export function memberRowWorkSchedule(row: Locator): Locator {
  return row.getByLabel(ORGANIZATION_COPY.workSchedule);
}

/** The open actions menu of a member or invitation row. */
export function memberActionsMenu(page: Page): Locator {
  return page.getByRole('menu');
}

export function memberMenuItem(page: Page, item: 'details' | 'remove' | 'cancelInvitation'): Locator {
  const names = {
    details: ORGANIZATION_COPY.memberMenu.details,
    remove: ORGANIZATION_COPY.memberMenu.remove,
    cancelInvitation: ORGANIZATION_COPY.invite.cancel,
  } as const;
  return page.getByRole('menuitem', { name: names[item] });
}

/** The copy of the role change entry, for absence checks across the whole DOM. */
export const MEMBER_CHANGE_ROLE_ACTION = ORGANIZATION_COPY.memberMenu.changeRole;

export function invitationsTab(page: Page): Locator {
  return page.getByRole('tab', { name: ORGANIZATION_COPY.invite.invitationsTab });
}

/** Cancels a pending invitation from its row menu and confirms the cancellation. */
export async function cancelInvitationFromRow(page: Page, row: Locator): Promise<void> {
  await memberRowActionsButton(row).click();
  await memberMenuItem(page, 'cancelInvitation').click();
  await page.getByRole('alertdialog').getByRole('button', { name: ORGANIZATION_COPY.invite.cancel }).click();
}

/** Asks to remove the member of the row and confirms; the alert dialog stays open on a refusal. */
export async function requestMemberRemovalFromRow(page: Page, row: Locator): Promise<Locator> {
  await memberRowActionsButton(row).click();
  await memberMenuItem(page, 'remove').click();
  const removalDialog = page.getByRole('alertdialog');
  await removalDialog.getByRole('button', { name: SHARED_COPY.action.remove }).click();
  return removalDialog;
}

export async function inviteMember(page: Page, email: string, role: InvitedRole): Promise<void> {
  await page.goto('/mitarbeiter');
  await page.getByRole('button', { name: ORGANIZATION_COPY.invite.open }).click();
  await expect(page.getByRole('heading', { name: ORGANIZATION_COPY.invite.title })).toBeVisible();
  await page.locator('#email').fill(email);
  // Role picker is a Radix select; its options render with role "option".
  await page.locator('#role').click();
  await page.getByRole('option', { name: ROLE_LABELS[role], exact: true }).click();
  await page.getByRole('button', { name: ORGANIZATION_COPY.invite.send }).click();
  // Phase 5 closes the dialog after validation and lets the list own the
  // pending row. The email-specific banner confirms the server action; the
  // marker clearing confirms the refreshed server list replaced the draft.
  await expect(page.getByText(`Einladung an ${email} wurde gesendet.`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: ORGANIZATION_COPY.invite.title })).toBeHidden({
    timeout: 10_000,
  });
  await invitationsTab(page).click();
  await expect(pendingRow(page, email)).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(visibleText(page, email)).toBeVisible({ timeout: 15_000 });
}

// Simulates the invited existing user clicking the email's invite link:
// /auth/callback?invite_code=... bounces to /login, and a successful login
// redeems the invite and lands on /dashboard?joined=<orgId>.
export async function joinOrganizationViaInviteLink(
  page: Page,
  inviteCode: string,
  credentials: { email: string; password: string },
  expectedOrgId: string,
): Promise<void> {
  // already_member also counts: it means an earlier (slow) attempt already
  // redeemed the invite before the retry re-opened the link.
  const confirmationUrl = new RegExp(`/dashboard\\?(joined|already_member)=${expectedOrgId}`);

  let joined = false;
  for (let attempt = 1; attempt <= 3 && !joined; attempt++) {
    // The invite link itself is idempotent: logged-out users bounce to
    // /login?invite_code=..., logged-in users are redeemed server-side and
    // land directly on the dashboard confirmation URL.
    await page.goto(`/auth/callback?invite_code=${inviteCode}`);
    if (confirmationUrl.test(page.url())) {
      joined = true;
      break;
    }
    if (!page.url().includes('/login')) {
      continue;
    }

    // Same pre-hydration caution as the global setup's login helper.
    await page.waitForLoadState('networkidle');
    await page.locator('input[autocomplete="email"]').fill(credentials.email);
    await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
    await loginSubmitButton(page).click();
    joined = await page
      .waitForURL(confirmationUrl, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!joined) {
    throw new Error(`Invited user ${credentials.email} did not reach /dashboard?joined=${expectedOrgId}`);
  }
}

/** The actions menu trigger of a member detail. */
export function memberDetailActionsButton(page: Page): Locator {
  return page.getByRole('button', { name: ORGANIZATION_COPY.memberMenu.actions, exact: true });
}

export async function removeMemberFromDetail(page: Page, name: string): Promise<void> {
  await openMemberDetailFromList(page, name);
  await memberDetailActionsButton(page).click();
  await page.getByRole('menuitem', { name: ORGANIZATION_COPY.memberMenu.remove }).click();
  await expect(page.getByRole('heading', { name: ORGANIZATION_COPY.memberMenu.removeTitle })).toBeVisible();
  await page.getByRole('button', { name: ORGANIZATION_COPY.memberMenu.remove, exact: true }).click();
  await page.waitForURL(/\/mitarbeiter\?removed_member=/, { timeout: 20_000 });
}

export async function expectRedirectedAway(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).not.toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`), {
    timeout: 15_000,
  });
}

export async function loginViaUi(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  let loggedIn = false;
  // Same pre-hydration retry the global setup uses.
  for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autocomplete="email"]').fill(credentials.email);
    await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
    await loginSubmitButton(page).click();
    loggedIn = await page
      .waitForURL('**/dashboard**', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!loggedIn) {
    throw new Error(`Login did not reach the dashboard for ${credentials.email}`);
  }
}

export async function signOutViaUi(page: Page): Promise<void> {
  await page.goto('/dashboard');
  const directButton = page.getByRole('button', { name: ORGANIZATION_COPY.signOut });
  if (await directButton.isVisible().catch(() => false)) {
    await directButton.click();
  } else {
    // The sign-out control sits in the sidebar profile card menu.
    const accountMenuButton = page
      .getByRole('button', { name: ORGANIZATION_COPY.accountMenu })
      .filter({ visible: true })
      .first();
    await expect(accountMenuButton).toBeVisible();
    const menuItem = page
      .getByRole('menuitem', { name: ORGANIZATION_COPY.signOut })
      .filter({ visible: true })
      .first();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await accountMenuButton.click();
      const menuOpened = await menuItem
        .waitFor({ state: 'visible', timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (!menuOpened) {
        await pressKey(page, 'Escape');
        continue;
      }
      const reachedLogin = page
        .waitForURL('**/login', { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      await menuItem.click({ force: true, timeout: 2_000 }).catch(() => undefined);
      if (await reachedLogin) return;
      await pressKey(page, 'Escape');
    }
    throw new Error('Sign-out menu did not navigate to login after three attempts.');
  }
  await page.waitForURL('**/login', { timeout: 20_000 });
}
