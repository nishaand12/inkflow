import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const email = process.env.TEST_TESTER_EMAIL!;
const password = process.env.TEST_TESTER_PASSWORD!;

const RID = Date.now().toString().slice(-6);
const E2E_BOOKING_LEAF = `E2E Booking Leaf ${RID}`;

test.describe('Appointment Types', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, email, password);
    await page.goto('/appointment-types');
    await page.waitForLoadState('networkidle');
  });

  // ── Happy Paths ─────────────────────────────────────────────────────────────

  test('HP-APPTYPES-1: /appointment-types page loads', async ({ page }) => {
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(1000);
  });

  test('HP-APPTYPES-2: Add button opens AppointmentTypeDialog', async ({ page }) => {
    await page.getByRole('button', { name: /add|new/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
  });

  test('HP-APPTYPES-3: Create E2E session type under booking hierarchy and verify in list', async ({
    page,
  }) => {
    // Appointment types require a leaf in Booking hierarchy first.
    await page.goto('/reporting-categories');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /booking hierarchy/i }).click();
    await page.getByRole('button', { name: /add category/i }).click();
    const catDialog = page.getByRole('dialog');
    await expect(catDialog).toBeVisible({ timeout: 8000 });
    await catDialog.getByLabel(/^name$/i).fill(E2E_BOOKING_LEAF);
    await catDialog.getByRole('button', { name: /save/i }).click();
    await expect(catDialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    await page.goto('/appointment-types');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /add|new/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    await dialog.getByLabel(/booking hierarchy classification/i).click();
    await page.getByRole('option', { name: E2E_BOOKING_LEAF }).click();

    await dialog.getByLabel(/^name$/i).fill('E2E Tattoo Session');

    const durationField = dialog.getByLabel(/duration/i);
    if (await durationField.isVisible()) {
      await durationField.clear();
      await durationField.fill('2');
    }

    const depositField = dialog.getByLabel(/deposit/i);
    if (await depositField.isVisible()) {
      await depositField.clear();
      await depositField.fill('75');
    }

    await dialog.getByRole('button', { name: /save|create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await page.waitForLoadState('networkidle');

    // Target the card heading specifically to avoid strict-mode violations
    // ("E2E Tattoo Session" appears in both heading and subtitle text of each card)
    await expect(
      page.getByRole('heading', { name: 'E2E Tattoo Session' }).first()
    ).toBeVisible({ timeout: 10000 });
  });

  // ── Non-Happy Paths ─────────────────────────────────────────────────────────

  test('NHP-APPTYPES-4: Save appointment type with no name is blocked', async ({ page }) => {
    await page.getByRole('button', { name: /add|new/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Do not fill the name field
    await dialog.getByRole('button', { name: /save|create/i }).click();

    // Dialog should remain open
    await expect(dialog).toBeVisible({ timeout: 3000 });
  });
});
