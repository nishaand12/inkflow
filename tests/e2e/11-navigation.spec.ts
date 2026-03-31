import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

// Navigation items: [display name pattern, expected URL fragment]
const NAV_ITEMS: [RegExp, string][] = [
  [/^dashboard$/i, '/dashboard'],
  [/^calendar$/i, '/calendar'],
  [/^appointments$/i, '/appointments'],
  [/^customers$/i, '/customers'],
  [/^artists$/i, '/artists'],
  [/^locations$/i, '/locations'],
  [/^work\s+stations$/i, '/workstations'],   // sidebar text is "Work Stations" (two words)
  [/^appointment\s+types$/i, '/appointment-types'],
  [/^studio\s+settings$/i, '/studio-settings'],
];

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-NAV-1: All expected sidebar nav links are present after login', async ({ page }) => {
    for (const [labelPattern] of NAV_ITEMS) {
      const link = page.getByRole('link', { name: labelPattern });
      await expect(link).toBeVisible({ timeout: 8000 });
    }
  });

  for (const [labelPattern, urlFragment] of NAV_ITEMS) {
    test(`HP-NAV-2: Clicking "${labelPattern.source}" navigates to ${urlFragment}`, async ({ page }) => {
      const link = page.getByRole('link', { name: labelPattern });
      await expect(link).toBeVisible({ timeout: 8000 });
      await link.click();
      await page.waitForURL(`**${urlFragment}**`, { timeout: 10000 });
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(urlFragment);
      // Page should render content (not blank)
      await expect(page.locator('main, [class*="content"], #root').first()).toBeVisible();
    });
  }

  test('HP-NAV-3: Sign Out returns user to /auth', async ({ page }) => {
    // Find the Sign Out button in the sidebar
    const signOutBtn = page.getByRole('button', { name: /sign out/i });
    await expect(signOutBtn).toBeVisible({ timeout: 8000 });
    await signOutBtn.click();

    // Should redirect to /auth
    await page.waitForURL('**/auth', { timeout: 10000 });
    expect(page.url()).toContain('/auth');

    // Auth form should be visible
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });
});
