import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

// The studio email Input has no id or type="email" attribute.
// It is only rendered when studio.subscription_tier === "plus".
// Use placeholder text as the selector.
const EMAIL_INPUT = 'input[placeholder="studio@example.com"]';

test.describe('Studio Settings', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/studio-settings');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-SS-1: /studio-settings loads without error', async ({ page }) => {
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/something went wrong|uncaught error/i)).not.toBeVisible();
  });

  test('HP-SS-2: Stripe section shows connected status', async ({ page }) => {
    const connectedBadge = page.getByText(/connected/i).first();
    await expect(connectedBadge).toBeVisible({ timeout: 10000 });
  });

  test('HP-SS-3: Go to Stripe Dashboard link points to stripe.com', async ({ page }) => {
    const stripeDashboardLink = page.getByRole('link', { name: /stripe dashboard|go to stripe/i });
    await expect(stripeDashboardLink).toBeVisible({ timeout: 10000 });
    const href = await stripeDashboardLink.getAttribute('href');
    expect(href).toMatch(/stripe\.com/);
  });

  test('HP-SS-4: Studio email input is visible (Plus tier required)', async ({ page }) => {
    const emailInput = page.locator(EMAIL_INPUT);
    const isVisible = await emailInput.isVisible({ timeout: 10000 }).catch(() => false);

    if (!isVisible) {
      // Studio is not on Plus tier — verify the upgrade message is shown instead
      await expect(page.getByText(/plus tier|upgrade/i)).toBeVisible({ timeout: 5000 });
      test.skip(true, 'Studio is not on Plus tier — email settings section is not shown. Upgrade to test this.');
      return;
    }

    await expect(emailInput).toBeVisible();
  });

  test('HP-SS-5: Update studio email and save shows success indicator', async ({ page }) => {
    const emailInput = page.locator(EMAIL_INPUT);
    const isVisible = await emailInput.isVisible({ timeout: 10000 }).catch(() => false);

    if (!isVisible) {
      test.skip(true, 'Studio email input not visible — Plus tier required.');
      return;
    }

    await emailInput.clear();
    await emailInput.fill(email);

    const saveBtn = page.getByRole('button', { name: /save|update/i }).first();
    await saveBtn.click();

    await expect(
      page.getByText(/saved|success|updated/i).first()
    ).toBeVisible({ timeout: 10000 });
  });
});
