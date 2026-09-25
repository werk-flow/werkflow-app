import { expect, type Page } from "@playwright/test";
import { openMemberDetailFromList } from './personnel';
import { visibleText } from './shared';

export async function inviteMember(
  page: Page,
  email: string,
  roleLabel: "Büro" | "Handwerker/in",
): Promise<void> {
  await page.goto("/mitarbeiter");
  await page.getByRole("button", { name: "Mitarbeiter hinzufügen" }).click();
  await expect(
    page.getByRole("heading", { name: "Mitarbeiter einladen" }),
  ).toBeVisible();
  await page.locator("#email").fill(email);
  // Role picker is a Radix select; its options render with role "option".
  await page.locator("#role").click();
  await page.getByRole("option", { name: roleLabel, exact: true }).click();
  await page.getByRole("button", { name: "Einladung senden" }).click();
  // Phase 5 closes the dialog after validation and lets the list own the
  // pending row. The email-specific banner confirms the server action; the
  // marker clearing confirms the refreshed server list replaced the draft.
  await expect(page.getByText(`Einladung an ${email} wurde gesendet.`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "Mitarbeiter einladen" }),
  ).toBeHidden({
    timeout: 10_000,
  });
  await page.getByRole("tab", { name: /^Einladungen/ }).click();
  await expect(
    page.locator("[data-pending-row]").filter({ hasText: email }),
  ).toHaveCount(0, { timeout: 15_000 });
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
  const confirmationUrl = new RegExp(
    `/dashboard\\?(joined|already_member)=${expectedOrgId}`,
  );

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
    if (!page.url().includes("/login")) {
      continue;
    }

    // Same pre-hydration caution as the global setup's login helper.
    await page.waitForLoadState("networkidle");
    await page.locator('input[autocomplete="email"]').fill(credentials.email);
    await page
      .locator('input[autocomplete="current-password"]')
      .fill(credentials.password);
    await page.getByRole("button", { name: "Anmelden" }).click();
    joined = await page
      .waitForURL(confirmationUrl, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!joined) {
    throw new Error(
      `Invited user ${credentials.email} did not reach /dashboard?joined=${expectedOrgId}`,
    );
  }
}

export async function removeMemberFromDetail(
  page: Page,
  name: string,
): Promise<void> {
  await openMemberDetailFromList(page, name);
  await page.getByRole("button", { name: "Aktionen" }).click();
  await page.getByRole("menuitem", { name: "Entfernen" }).click();
  await expect(
    page.getByRole("heading", { name: "Mitglied entfernen?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Entfernen", exact: true }).click();
  await page.waitForURL(/\/mitarbeiter\?removed_member=/, { timeout: 20_000 });
}

export async function expectRedirectedAway(
  page: Page,
  path: string,
): Promise<void> {
  await page.goto(path);
  await expect(page).not.toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`), {
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
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator('input[autocomplete="email"]').fill(credentials.email);
    await page
      .locator('input[autocomplete="current-password"]')
      .fill(credentials.password);
    await page.getByRole("button", { name: "Anmelden" }).click();
    loggedIn = await page
      .waitForURL("**/dashboard**", { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!loggedIn) {
    throw new Error(
      `Login did not reach the dashboard for ${credentials.email}`,
    );
  }
}

export async function signOutViaUi(page: Page): Promise<void> {
  await page.goto("/dashboard");
  const directButton = page.getByRole("button", { name: "Abmelden" });
  if (await directButton.isVisible().catch(() => false)) {
    await directButton.click();
  } else {
    // The sign-out control sits in the sidebar profile card menu.
    const accountMenuButton = page
      .getByRole("button", { name: "Kontomenü öffnen" })
      .filter({ visible: true })
      .first();
    await expect(accountMenuButton).toBeVisible();
    const menuItem = page
      .getByRole("menuitem", { name: "Abmelden" })
      .filter({ visible: true })
      .first();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await accountMenuButton.click();
      const menuOpened = await menuItem
        .waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (!menuOpened) {
        await page.keyboard.press("Escape");
        continue;
      }
      const reachedLogin = page
        .waitForURL("**/login", { timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      await menuItem
        .click({ force: true, timeout: 2_000 })
        .catch(() => undefined);
      if (await reachedLogin) return;
      await page.keyboard.press("Escape");
    }
    throw new Error(
      "Sign-out menu did not navigate to login after three attempts.",
    );
  }
  await page.waitForURL("**/login", { timeout: 20_000 });
}
